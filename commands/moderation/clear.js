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


const MAX_CLEAR = 1000;
const MAX_SCAN  = 1000;

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
    const clearLimit  = Math.max(1, Math.min(config?.clearLimit ?? 100, MAX_CLEAR));

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

        const sent = await embed.sendEmbed(channel, guildId, 'La whitelist antiraid est déjà vide.', { timestamp: false , allowedMentions: { parse: [] } });

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
    let amount = args.length === 0
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

    // Membre ciblé sans nombre : supprime tout ce qui est trouvé (jusqu au max possible).
    const scanAll = hasFilter && !isExplicitAmount;
    if (scanAll) amount = MAX_CLEAR;
    const targetIds = new Set(targets.map(t => t.id));

    // Parcourt le salon page par page (100 messages max par appel) jusqu'à
    // trouver assez de messages, atteindre la limite de scan ou les 14 jours.
    const maxAge    = 14 * 24 * 60 * 60 * 1000;
    const scanLimit = scanAll ? MAX_SCAN : hasFilter ? Math.min(MAX_SCAN, Math.max(amount * 10, 300)) : amount + 5;
    const toDelete  = [];
    let scanned     = 0;
    let before      = message.id;
    let fetchFailed = false;

    while (toDelete.length < amount && scanned < scanLimit) {
      const page = await channel.messages
        .fetch({ limit: Math.min(100, scanLimit - scanned), before })
        .catch(() => null);

      if (!page) { fetchFailed = scanned === 0; break; }
      if (!page.size) break;

      scanned += page.size;
      before   = page.last().id;

      let tooOld = false;
      for (const m of page.values()) {
        if (Date.now() - m.createdTimestamp >= maxAge) { tooOld = true; continue; }
        if (hasFilter && !targetIds.has(m.author.id)) continue;
        if (toDelete.length < amount) toDelete.push(m);
      }

      // Pages triées du plus récent au plus ancien : inutile d'aller plus loin.
      if (tooOld) break;
    }

    if (fetchFailed) {
      const sent = await embed.replyError(
        message,
        'Impossible de récupérer les messages du salon.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    if (!toDelete.length) {
      const names = targets.map(t => `**${t.user.username}**`).join(', ');
      const sent = await embed.replyError(
        message,
        hasFilter
          ? `Aucun message récent de ${names} n'a été trouvé.`
          : 'Aucun message récent à supprimer n\'a été trouvé.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    // Suppression par lots de 100 (limite Discord pour bulkDelete).
    let deletedCount = 0;
    for (let i = 0; i < toDelete.length; i += 100) {
      const chunk = toDelete.slice(i, i + 100);
      const res   = chunk.length === 1
        ? await chunk[0].delete().then(() => ({ size: 1 })).catch(() => null)
        : await channel.bulkDelete(chunk, true).catch(() => null);
      if (res) deletedCount += res.size;
    }

    if (!deletedCount) {
      const sent = await embed.replyError(
        message,
        'La suppression a échoué.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    const deleted = { size: deletedCount };

    const names = targets.map(t => `**${t.user.username}**`).join(', ');

    let desc = hasFilter
      ? `**${deleted.size}** message(s) de ${names} ont \u00e9t\u00e9 supprim\u00e9(s).`
      : `**${deleted.size}** message(s) ont \u00e9t\u00e9 supprim\u00e9(s).`;

    if (notFound.length) {
      desc += `\nIntrouvables : ${notFound.map(n => `\`${n}\``).join(', ')}`;
    }

    const sent = await embed.sendEmbed(channel, guildId, desc, { timestamp: false , allowedMentions: { parse: [] } });

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
