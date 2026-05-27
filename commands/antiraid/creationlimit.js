'use strict';


const { parseDuration, formatDuration } = require('../../utils/parseDuration.js');
const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');

exports.help = {
  name        : 'creationlimit',
  description : 'Définir l’ancienneté minimale d’un compte pour rejoindre le serveur.',
  usage       : 'creationlimit <durée|off>',
  aliases     : ['creation'],
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const sub     = args[0]?.toLowerCase();
  const config  = db.getGuildConfig(guildId);

  if (!perms.check(message, exports.help.name)) {
    return;
  }

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const antiraid       = db.getAntiraidConfig(guildId) || {};
  const creationLimit  = Number(antiraid.creationLimit) || 0;

  if (!sub) {
    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Âge minimum du compte requis : **${creationLimit > 0 ? formatDuration(creationLimit, { unit: 's', format: 'fr-long' }) : 'Désactivé'}**.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (sub === 'off') {
    if (creationLimit === 0) {
      const sent = await embed.replyError(
        message,
        'La limite de création de compte est déjà désactivée.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.setAntiraidConfig(guildId, 'creationLimit', 0);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          'La limite de création de compte a été désactivée.',
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  const parsed = parseDuration(sub);

  if (parsed === null) {
    const sent = await embed.replyError(
      message,
      'Durée invalide. Exemples : `10m`, `1h`, `7j`, `30d`.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  const seconds = Math.floor(parsed / 1000);

  if (seconds <= 0) {
    const sent = await embed.replyError(
      message,
      'La durée doit être supérieure à `0s`.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (creationLimit === seconds) {
    const sent = await embed.replyError(
      message,
      'Cette valeur est déjà configurée.',
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  db.setGuildConfig(guildId, 'antiraidEnabled', 1);
  db.setAntiraidConfig(guildId, 'creationLimit', seconds);

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `L’âge minimum du compte requis est maintenant de **${formatDuration(seconds, { unit: 's', format: 'fr-long' })}**.`,
        { timestamp: false }
      )
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};
