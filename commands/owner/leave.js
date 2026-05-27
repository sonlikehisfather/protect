'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');
const config = require('../../config.json');

const IDLE_MS    = 60_000;
const TIMEOUT_MS = 120_000;

module.exports = {
  help: {
    name        : 'leave',
    description : 'Fait quitter un serveur au bot.',
    use         : 'leave [ID/nombre]',
    usage       : 'leave [ID/nombre]',
    aliases     : ['guildleave', 'serverleave'],
    category    : 'owner',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (String(args[0] || '').toLowerCase() === 'settings') {
      const leavesettings = require('../configserver/leavesettings');
      return leavesettings.run(client, message, args.slice(1));
    }

    if (!perms.isBuyer(message.author.id)) {
      return embed.replyError(
        message,
        'Seul le buyer du bot peut utiliser cette commande.',
        { timestamp: false }
      );
    }

    const guildConfig = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
    const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
    const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);
    const prefix      = guildConfig?.prefix ?? config.prefix ?? '+';

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const targetArg = args[0] || message.guild.id;
    const targetGuild = await _resolveGuild(client, targetArg);

    if (!targetGuild) {
      return _sendError(
        message,
        `Serveur introuvable. Utilisez \`${prefix}serverlist\` pour voir les IDs et numéros.`,
        deleteReply,
        deleteDelay
      );
    }

    const isCurrentGuild = targetGuild.id === message.guild.id;

    const confirmMessage = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Serveur : **${_escape(targetGuild.name)}**\n` +
          `ID : \`${targetGuild.id}\`\n` +
          `Membres : \`${Number(targetGuild.memberCount || 0)}\`\n\n` +
          `Confirmez-vous que le bot doit quitter ce serveur ?`,
          {
            title    : 'Confirmation de départ',
            timestamp: false,
          }
        ),
      ],
      components      : [_buildConfirmRow(false)],
      allowedMentions : { parse: [] },
    }).catch(() => null);

    if (!confirmMessage) return;

    embed.registerPrivateInteraction(confirmMessage, message.author.id, TIMEOUT_MS);

    const collector = confirmMessage.createMessageComponentCollector({
      filter: interaction =>
        interaction.user.id === message.author.id &&
        interaction.message.id === confirmMessage.id,
      idle: IDLE_MS,
      time: TIMEOUT_MS,
    });

    collector.on('collect', async interaction => {
      try {
        if (interaction.customId === 'local:leave:cancel') {
          collector.stop('cancelled');

          return interaction.update({
            embeds: [
              embed.build(
                guildId,
                'Action annulée.',
                {
                  title    : 'Départ annulé',
                  timestamp: false,
                }
              ),
            ],
            components: [_buildConfirmRow(true)],
          }).catch(() => {});
        }

        if (interaction.customId !== 'local:leave:confirm') {
          return interaction.deferUpdate().catch(() => {});
        }

        collector.stop('confirmed');

        if (isCurrentGuild) {
          await interaction.update({
            embeds: [
              embed.build(
                guildId,
                `Départ confirmé. Le bot quitte **${_escape(targetGuild.name)}**.`,
                {
                  title    : 'Départ confirmé',
                  timestamp: false,
                }
              ),
            ],
            components: [_buildConfirmRow(true)],
          }).catch(() => {});

          setTimeout(() => {
            targetGuild.leave().catch((err) => {
              console.error('[leave] Impossible de quitter le serveur courant :', err?.message ?? err);
            });
          }, 1500);

          return;
        }

        const left = await targetGuild.leave()
          .then(() => true)
          .catch((err) => {
            console.error('[leave] Impossible de quitter le serveur :', err?.message ?? err);
            return false;
          });

        if (!left) {
          return interaction.update({
            embeds: [
              embed.error(
                guildId,
                'Impossible de quitter ce serveur.',
                { timestamp: false }
              ),
            ],
            components: [_buildConfirmRow(true)],
          }).catch(() => {});
        }

        return interaction.update({
          embeds: [
            embed.build(
              guildId,
              `Le bot a quitté **${_escape(targetGuild.name)}**.`,
              {
                title    : 'Serveur quitté',
                timestamp: false,
              }
            ),
          ],
          components: [_buildConfirmRow(true)],
        }).catch(() => {});
      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error('[leave] Erreur collector :', err?.message ?? err);
        }
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(confirmMessage);

      if (!['cancelled', 'confirmed'].includes(reason)) {
        confirmMessage.edit({
          components: [_buildConfirmRow(true)],
        }).catch(() => {});
      }

      if (deleteReply) {
        embed.scheduleDelete(confirmMessage, deleteDelay);
      }
    });
  },
};

function _buildConfirmRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:leave:confirm')
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId('local:leave:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

async function _resolveGuild(client, value) {
  const raw = String(value || '').trim();

  if (!raw) return null;

  if (/^\d{17,20}$/.test(raw)) {
    return client.guilds.cache.get(raw)
      ?? await client.guilds.fetch(raw).catch(() => null);
  }

  const index = Number.parseInt(raw, 10);

  if (Number.isInteger(index) && index > 0) {
    return _getSortedGuilds(client)[index - 1] ?? null;
  }

  return null;
}

function _getSortedGuilds(client) {
  return [...client.guilds.cache.values()]
    .sort((a, b) => {
      const joinedA = Number(a.joinedTimestamp || 0);
      const joinedB = Number(b.joinedTimestamp || 0);

      if (joinedA && joinedB && joinedA !== joinedB) {
        return joinedA - joinedB;
      }

      return a.name.localeCompare(b.name);
    });
}

function _escape(value) {
  return String(value || '')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\'')
    .slice(0, 80);
}

async function _sendError(message, content, deleteReply, deleteDelay) {
  const sent = await message.channel.send({
    embeds: [
      embed.error(
        message.guild?.id,
        content,
        { timestamp: false }
      ),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
