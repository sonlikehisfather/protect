'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const { resolveMember } = require('../../utils/memberResolver');

const PAGE_SIZE  = 5;
const IDLE_MS    = 300_000;
const TIMEOUT_MS = 900_000;

module.exports = {
  help: {
    name        : 'warninfo',
    description : 'Affiche les avertissements d’un membre.',
    usage       : 'warninfo <membre>',
    aliases     : ['winfo', 'infowarn'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    const target = await resolveMember(message, args);

    if (!target) {
      const sent = await embed.replyError(
        message,
        'Membre introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const sanctions = db.getSanctions(guildId, target.id).filter(s => s.type === 'warn');
    const total     = sanctions.length;

    if (!total) {
      const sent = await message.channel.send({
        embeds: [
          embed.build(
            guildId,
            `**${target.user.tag}** n’a aucun avertissement.`,
            { timestamp: false }
          )
        ],
        allowedMentions: { repliedUser: false },
      }).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const pages = _buildPages(client, guild, guildId, target, sanctions);
    let current = 0;

    const buildRows = (disabled = false) => [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('warninfo:prev')
          .setLabel('\u2190')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || current === 0),
        new ButtonBuilder()
          .setCustomId('warninfo:next')
          .setLabel('\u2192')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || current === pages.length - 1),
        new ButtonBuilder()
          .setCustomId('warninfo:close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled),
      ),
    ];

    const msg = await message.channel.send({
      embeds: [pages[current]],
      components: buildRows(),
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (!msg) return;

    embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

    const collector = msg.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id,
      idle   : IDLE_MS,
      time   : TIMEOUT_MS,
    });

    collector.on('collect', async i => {
      try {
        if (i.customId === 'warninfo:close') {
          await i.deferUpdate().catch(() => {});
          embed.clearPrivateInteraction(msg);
          collector.stop('closed');
          await message.delete().catch(() => {});
          return msg.delete().catch(() => {});
        }

        if (i.customId === 'warninfo:prev' && current > 0) current--;
        if (i.customId === 'warninfo:next' && current < pages.length - 1) current++;

        await i.update({
          embeds: [pages[current]],
          components: buildRows(),
        });
      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error(err);
        }
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(msg);
      if (reason === 'closed') return;
      msg.edit({ components: [] }).catch(() => {});
    });
  },
};

function _buildPages(client, guild, guildId, target, sanctions) {
  const total = sanctions.length;
  const pages = [];

  for (let i = 0; i < sanctions.length; i += PAGE_SIZE) {
    const chunk = sanctions.slice(i, i + PAGE_SIZE);

    const lines = chunk.map((warn, index) => {
      const absoluteIndex = total - (i + index);
      const moderatorText = warn.moderatorId === client.user.id
        ? client.user.tag
        : `<@${warn.moderatorId}> (\`${warn.moderatorId}\`)`;

      const dateText = warn.createdAt
        ? `<t:${warn.createdAt}:f>`
        : 'Date inconnue';

      const reason = _truncate(warn.reason || 'Aucune raison fournie', 180);

      return (
        `**Warn #${absoluteIndex}**\n` +
        `Date : ${dateText}\n` +
        `Modérateur : ${moderatorText}\n` +
        `Raison : ${reason}`
      );
    });

    pages.push(
      embed.build(guildId, null, {
        title  : 'Informations des avertissements',
        fields : [
          {
            name  : 'Utilisateur',
            value : `<@${target.id}> (${target.user.tag}) \`${target.id}\``,
            inline: false,
          },
          {
            name  : 'Total',
            value : `${total}`,
            inline: false,
          },
          {
            name  : 'Historique',
            value : lines.join('\n\n'),
            inline: false,
          },
        ],
        footer    : `Page ${Math.floor(i / PAGE_SIZE) + 1}/${Math.ceil(total / PAGE_SIZE)}`,
        timestamp : false,
      })
    );
  }

  return pages;
}

function _truncate(text, max = 200) {
  const value = String(text || 'Aucune raison fournie').replace(/\s+/g, ' ').trim();
  const cut   = value.length <= max ? value : `${value.slice(0, max - 3)}...`;
  return embed.breakLongTokens(cut);
}
