'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const { resolveMember } = require('../../utils/memberResolver');


const CLEARWL_CONFIRM_IDLE_MS = 60_000;
const CLEARWL_CONFIRM_TIME_MS = 120_000;

module.exports = {
  help: {
    name        : 'clear',
    description : 'Supprime un nombre de messages dans le salon actuel. Par défaut, supprime 50 messages si aucun nombre n’est fourni.',
    usage       : 'clear [nombre] [membre]',
    aliases     : ['purge', 'clean'],
    multi       : true,

    subcommands : [
  {
    name        : 'clear wl',
    description : 'Supprimer toute la whitelist antiraid.',
    usage       : 'clear wl',
    category    : 'antiraid',
  }
],
  },

  async run(client, message, args) {

    const guild   = message.guild;
    const guildId = guild.id;
    const channel = message.channel;

    const config      = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;
    const clearLimit  = Math.max(1, Math.min(config?.clearLimit ?? 100, 100));

    const sub = args[0]?.toLowerCase();


    if (sub === 'perm' || sub === 'perms') {
      const clearperms = client.commands?.get?.('clearperms');
      if (clearperms?.run) {
        return clearperms.run(client, message, args.slice(1));
      }
    }

    if (sub === 'wl') {

      const authorId = message.author.id;

      if (
        !perms.isBuyer(authorId) &&
        !perms.isOwner(guildId, authorId)
      ) {

        const sent = await embed.replyError(
          message,
          'Permission refusée.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }

        return;
      }

      if (deleteCmd) {
        await message.delete().catch(() => {});
      }

      const list = db.getAntiraidWhitelist(guildId);

      if (!list.length) {

        const sent = await channel.send({
          embeds: [
            embed.build(
              guildId,
              'La whitelist antiraid est déjà vide.',
              { timestamp: false }
            )
          ],
          allowedMentions: { parse: [] },
        }).catch(() => null);

        if (sent && deleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }

        return;
      }


      const confirmMessage = await channel.send({
        embeds: [
          embed.build(
            guildId,
            `**Entrées dans la whitelist**\n` +
            `\`${list.length}\`\n\n` +
            `Cette action va supprimer **toute** la whitelist antiraid de ce serveur. Elle est irréversible.`,
            {
              title    : 'Confirmer clear wl',
              timestamp: false,
            }
          )
        ],
        components     : [_buildClearWlRow(false)],
        allowedMentions: { parse: [] },
      }).catch(() => null);

      if (!confirmMessage) return;

      embed.registerPrivateInteraction(confirmMessage, authorId, CLEARWL_CONFIRM_TIME_MS);

      const collector = confirmMessage.createMessageComponentCollector({
        filter: interaction =>
          interaction.user.id === authorId &&
          interaction.message.id === confirmMessage.id,
        idle: CLEARWL_CONFIRM_IDLE_MS,
        time: CLEARWL_CONFIRM_TIME_MS,
      });

      collector.on('collect', async interaction => {
        if (interaction.customId === 'local:clearwl:cancel') {
          collector.stop('cancelled');

          await interaction.update({
            embeds: [
              embed.build(
                guildId,
                'Action annulée. La whitelist antiraid est intacte.',
                {
                  title    : 'Clear wl annulé',
                  timestamp: false,
                }
              )
            ],
            components: [_buildClearWlRow(true)],
          }).catch(() => {});

          return;
        }

        if (interaction.customId !== 'local:clearwl:confirm') {
          return interaction.deferUpdate().catch(() => {});
        }

        collector.stop('confirmed');
        await interaction.deferUpdate().catch(() => {});

        let removed = 0;

        try {
          const before = db.getAntiraidWhitelist(guildId);
          removed = before.length;
          db.raw()
            .prepare('DELETE FROM antiraid_whitelist WHERE guildId = ?')
            .run(guildId);
        } catch {
          removed = -1;
        }

        const resultEmbed = removed < 0
          ? embed.build(
              guildId,
              'Impossible de supprimer la whitelist antiraid. Réessayez plus tard.',
              {
                title    : 'Clear wl échoué',
                timestamp: false,
              }
            )
          : embed.build(
              guildId,
              `Toute la whitelist antiraid a été supprimée. (${removed} entrée(s))`,
              {
                title    : 'Clear wl confirmé',
                timestamp: false,
              }
            );

        await confirmMessage.edit({
          embeds    : [resultEmbed],
          components: [_buildClearWlRow(true)],
        }).catch(() => {});

        if (deleteReply) {
          embed.scheduleDelete(confirmMessage, deleteDelay);
        }
      });

      collector.on('end', async (_collected, reason) => {
        embed.clearPrivateInteraction(confirmMessage);

        if (reason === 'confirmed' || reason === 'cancelled') return;


        await confirmMessage.edit({ components: [] }).catch(() => {});

        if (deleteReply) {
          embed.scheduleDelete(confirmMessage, deleteDelay);
        }
      });

      return;
    }

    const amountArg = args[0];
    const isExplicitAmount = typeof amountArg === 'string' && /^\d+$/.test(amountArg);
    const amount = args.length === 0
      ? 50
      : isExplicitAmount
        ? parseInt(amountArg, 10)
        : 50;

    if (!amount || isNaN(amount)) {
      const sent = await embed.replyError(
        message,
        'Utilisation : `clear [nombre] [membre]`',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (amount < 1) {

      const sent = await embed.replyError(
        message,
        'Le nombre doit être supérieur à 0.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (amount > clearLimit) {

      const sent = await embed.replyError(
        message,
        `Vous ne pouvez pas supprimer plus de **${clearLimit}** message(s) à la fois.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }


    const filterArgs = isExplicitAmount ? args.slice(1) : args;
    const targets    = [];
    const notFound   = [];

    for (const arg of filterArgs) {
      const parts = arg.includes(',') ? arg.split(',').map(p => p.trim()).filter(Boolean) : [arg];

      for (const part of parts) {
        if (part === ',') continue;
        const m = await resolveMember(message, [part]);
        if (m) {
          if (!targets.some(t => t.id === m.id)) targets.push(m);
        } else {
          notFound.push(part);
        }
      }
    }

    if (targets.length > 4) {
      const sent = await embed.replyError(
        message,
        'Vous pouvez fournir 4 cibles maximum.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    if (filterArgs.length && !targets.length) {
      const sent = await embed.replyError(
        message,
        `Aucun membre trouv\u00e9 pour : \`${filterArgs.join(' ')}\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    await message.delete().catch(() => {});

    const hasFilter = targets.length > 0;
    const targetIds = new Set(targets.map(t => t.id));
    const fetchSize = Math.min(100, hasFilter ? Math.max(amount * 4, 20) : amount + 5);

    const fetched = await channel.messages.fetch({ limit: fetchSize }).catch(() => null);

    if (!fetched || !fetched.size) {
      const sent = await embed.replyError(
        message,
        'Impossible de r\u00e9cup\u00e9rer les messages du salon.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    let messagesToDelete = fetched
      .filter(m => m.id !== message.id)
      .filter(m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);

    if (hasFilter) {
      messagesToDelete = messagesToDelete.filter(m => targetIds.has(m.author.id));
    }

    messagesToDelete = messagesToDelete.first(amount);

    if (!messagesToDelete.length) {
      const names = targets.map(t => `**${t.user.username}**`).join(', ');
      const sent = await embed.replyError(
        message,
        hasFilter
          ? `Aucun message r\u00e9cent de ${names} n'a \u00e9t\u00e9 trouv\u00e9.`
          : 'Aucun message r\u00e9cent \u00e0 supprimer n\'a \u00e9t\u00e9 trouv\u00e9.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    const deleted = await channel.bulkDelete(messagesToDelete, true).catch(() => null);

    if (!deleted) {
      const sent = await embed.replyError(
        message,
        'La suppression a \u00e9chou\u00e9.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    const names = targets.map(t => `**${t.user.username}**`).join(', ');

    let desc = hasFilter
      ? `**${deleted.size}** message(s) de ${names} ont \u00e9t\u00e9 supprim\u00e9(s).`
      : `**${deleted.size}** message(s) ont \u00e9t\u00e9 supprim\u00e9(s).`;

    if (notFound.length) {
      desc += `\nIntrouvables : ${notFound.map(n => `\`${n}\``).join(', ')}`;
    }

    const sent = await channel.send({
      embeds: [
        embed.build(
          guildId,
          desc,
          { timestamp: false }
        )
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (sent) {
      embed.scheduleDelete(sent, 7);
    }

  },
};

function _buildClearWlRow(disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:clearwl:confirm')
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:clearwl:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}
