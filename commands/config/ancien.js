'use strict';


const { parseDuration, formatDuration } = require('../../utils/parseDuration.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const MIN_SECONDS = 60;
const MAX_SECONDS = 365 * 24 * 60 * 60;

exports.help = {
  name        : 'ancien',
  description : 'Définir la durée après laquelle un membre est considéré ancien.',
  usage       : 'ancien <durée|0>',
};

exports.run = async (client, message, args) => {
  if (!perms.check(message, exports.help.name)) return;

  const guildId = message.guild.id;
  const config  = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const raw = args[0];

  if (!raw) {
    const current = Number(config?.ancienDuration ?? 604800);

    return _replyInfo(
      message,
      guildId,
      current === 0
        ? 'Tous les membres sont actuellement considérés comme anciens.'
        : `Les membres sont considérés comme anciens après **${_formatDuration(current)}**.\n` +
          'Utilisez `+ancien <durée>` pour modifier ou `+ancien 0` pour désactiver.',
      deleteReply,
      deleteDelay
    );
  }

  if (raw === '0') {
    db.setGuildConfig(guildId, 'ancienDuration', 0);

    return _replyInfo(
      message,
      guildId,
      'Durée ancien désactivée. Tous les membres sont désormais considérés comme anciens.',
      deleteReply,
      deleteDelay
    );
  }

  const parsedMs = parseDuration(raw);

  if (!parsedMs) {
    return _replyError(
      message,
      'Durée invalide. Exemples : `10m`, `1h`, `2d`, `7d`, `1w`, `0`.',
      deleteReply,
      deleteDelay
    );
  }

  const seconds = Math.floor(parsedMs / 1000);

  if (seconds < MIN_SECONDS) {
    return _replyError(
      message,
      `Durée trop courte. Minimum **${MIN_SECONDS}** secondes (ou \`0\` pour désactiver).`,
      deleteReply,
      deleteDelay
    );
  }

  if (seconds > MAX_SECONDS) {
    return _replyError(
      message,
      'Durée trop longue. Maximum **365 jours**.',
      deleteReply,
      deleteDelay
    );
  }

  db.setGuildConfig(guildId, 'ancienDuration', seconds);

  return _replyInfo(
    message,
    guildId,
    `Les membres sont considérés comme anciens après **${_formatDuration(seconds)}**.`,
    deleteReply,
    deleteDelay
  );
};

function _formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0';

  return formatDuration(seconds, { unit: 's', format: 'fr-long' }) || `${seconds}s`;
}

async function _replyInfo(message, guildId, content, deleteReply, deleteDelay) {
  const sent = await message.channel.send({
    embeds: [
      embed.build(guildId, content, { timestamp: false }),
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _replyError(message, content, deleteReply, deleteDelay) {
  const sent = await embed.replyError(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
