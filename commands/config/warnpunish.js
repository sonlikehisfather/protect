'use strict';


const { parseDuration, formatDuration } = require('../../utils/parseDuration.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const SANCTIONS = ['mute', 'kick', 'ban', 'tempban'];

module.exports = {
  help: {
    name        : 'warnpunish',
    description : 'Configure les paliers de sanction automatique sur les warns.',
    usage       : 'warnpunish [add|del|setup|reset|list]',
    aliases     : ['warnthreshold', 'warnsanction'],
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, 'warnpunish')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    const sub = args[0]?.toLowerCase();

    if (!sub || sub === 'list') {
      if (deleteCmd) {
        await message.delete().catch(() => {});
      }

      const sent = await _showThresholds(message, guildId).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (sub === 'setup') {
      if (deleteCmd) {
        await message.delete().catch(() => {});
      }

      db.setupDefaultWarnThresholds(guildId);

      const sent = await message.channel.send({
        embeds: [
          embed.build(
            guildId,
            [
              'Paliers par défaut configurés :',
              '`3 warns` - mute 10m',
              '`5 warns` - kick',
              '`7 warns` - tempban 1j',
              '`10 warns` - ban',
            ].join('\n'),
            { timestamp: false }
          ),
        ],
        allowedMentions: { repliedUser: false },
      }).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (sub === 'reset') {
      if (deleteCmd) {
        await message.delete().catch(() => {});
      }

      db.clearWarnThresholds(guildId);

      const sent = await embed.reply(
        message,
        'Tous les paliers de warns ont été supprimés.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (sub === 'add') {
      const threshold = Number.parseInt(args[1], 10);
      const sanction  = args[2]?.toLowerCase();
      const rawDur    = args[3];

      if (!Number.isInteger(threshold) || threshold < 1) {
        const sent = await embed.replyError(
          message,
          'Seuil invalide. Entrez un nombre de warns supérieur ou égal à 1.\nExemple : `warnpunish add 3 mute 10m`',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }

        return;
      }

      if (!SANCTIONS.includes(sanction)) {
        const sent = await embed.replyError(
          message,
          `Sanction invalide. Valeurs acceptées : \`${SANCTIONS.join('`, `')}\`.`,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }

        return;
      }

      let duration = null;

      if (rawDur) {
        const parsedMs = parseDuration(rawDur);

        if (!parsedMs) {
          const sent = await embed.replyError(
            message,
            'Durée invalide. Exemples : `10m`, `1h`, `7d`.',
            { timestamp: false }
          ).catch(() => null);

          if (sent && deleteReply) {
            embed.scheduleDelete(sent, deleteDelay);
          }

          return;
        }

        duration = Math.floor(parsedMs / 1000);
      }

      if ((sanction === 'mute' || sanction === 'tempban') && !duration) {
        const sent = await embed.replyError(
          message,
          `La sanction \`${sanction}\` nécessite une durée.\nExemple : \`warnpunish add ${threshold} ${sanction} 10m\``,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }

        return;
      }

      if ((sanction === 'kick' || sanction === 'ban') && duration) {
        const sent = await embed.replyError(
          message,
          `La sanction \`${sanction}\` ne doit pas avoir de durée.`,
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

      db.addWarnThreshold(guildId, threshold, sanction, duration);

      const sent = await embed.reply(
        message,
        `Palier ajouté : \`${threshold} warns\` - \`${sanction}\`${duration ? ` (${_formatDuration(duration)})` : ''}.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (sub === 'del') {
      const index = Number.parseInt(args[1], 10) - 1;
      const thresholds = db.getWarnThresholds(guildId);

      if (!Number.isInteger(index) || index < 0 || index >= thresholds.length) {
        const sent = await embed.replyError(
          message,
          'Numéro invalide. Utilisez `warnpunish` pour voir la liste.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }

        return;
      }

      const row = thresholds[index];

      if (deleteCmd) {
        await message.delete().catch(() => {});
      }

      db.removeWarnThreshold(guildId, row.threshold);

      const sent = await embed.reply(
        message,
        `Palier \`#${index + 1}\` supprimé : \`${row.threshold} warns\` - \`${row.sanction}\`.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const sent = await _showThresholds(message, guildId).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function _showThresholds(message, guildId) {
  const thresholds = db.getWarnThresholds(guildId);

  if (!thresholds.length) {
    return message.channel.send({
      embeds: [
        embed.build(
          guildId,
          'Aucun palier configuré.\nUtilisez `warnpunish add <seuil> <sanction> [durée]` ou `warnpunish setup`.',
          { timestamp: false }
        ),
      ],
      allowedMentions: { repliedUser: false },
    });
  }

  const lines = thresholds.map((threshold, index) =>
    `\`${index + 1}.\` ${threshold.threshold} warns - **${threshold.sanction}**${threshold.duration ? ` (${_formatDuration(threshold.duration)})` : ''}`
  );

  return message.channel.send({
    embeds: [
      embed.build(
        guildId,
        null,
        {
          title  : 'Paliers de sanction automatique',
          fields : [
            {
              name   : 'Paliers',
              value  : lines.join('\n'),
              inline : false,
            },
            {
              name   : 'Information',
              value  : 'La sanction se déclenche automatiquement lorsqu’un membre atteint un seuil configuré. Après le dernier palier, les warns peuvent être réinitialisés par la logique de warn.',
              inline : false,
            },
          ],
          timestamp: false,
        }
      ),
    ],
    allowedMentions: { repliedUser: false },
  });
}

function _formatDuration(seconds) {
  if (!seconds) return '';
  return formatDuration(seconds, { unit: 's', format: 'fr-long' }) || `${seconds}s`;
}
