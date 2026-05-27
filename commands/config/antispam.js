'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name        : 'antispam',
  description : 'Configurer l’antispam.',
  usage       : 'antispam <on|off|<msgs>/<secs>>',
};

exports.run = async (client, message, args) => {
  if (!perms.check(message, exports.help.name)) return;

  const guildId = message.guild.id;
  const arg     = args[0]?.toLowerCase();
  const config  = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  if (arg === 'on') {
    const current = Number(db.getAntiraidConfig(guildId)?.antispamEnabled ?? 0);
    if (current === 1) {
      const sent = await embed.replyError(
        message,
        'Antispam est déjà activé.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.setAntiraidConfig(guildId, 'antispamEnabled', 1);

    const antispam = db.getAntiraidConfig(guildId);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Antispam activé.\nSeuil actuel : **${antispam.antispamThreshold}** messages en **${antispam.antispamWindow}** secondes.`,
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

  if (arg === 'off') {
    const current = Number(db.getAntiraidConfig(guildId)?.antispamEnabled ?? 0);
    if (current === 0) {
      const sent = await embed.replyError(
        message,
        'Antispam est déjà désactivé.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.setAntiraidConfig(guildId, 'antispamEnabled', 0);

    const antispam = db.getAntiraidConfig(guildId);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Antispam désactivé.\nSeuil actuel : **${antispam.antispamThreshold}** messages en **${antispam.antispamWindow}** secondes.`,
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

  const match = arg?.match(/^(\d+)\/(\d+)$/);
  if (match) {
    const msgs = parseInt(match[1], 10);
    const secs = parseInt(match[2], 10);

    if (isNaN(msgs) || msgs < 2 || msgs > 20) {
      const sent = await embed.replyError(
        message,
        'Le nombre de messages doit être compris entre **2** et **20**.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    if (isNaN(secs) || secs < 2 || secs > 30) {
      const sent = await embed.replyError(
        message,
        'Le nombre de secondes doit être compris entre **2** et **30**.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    const cfg = db.getAntiraidConfig(guildId) || {};
    if (Number(cfg.antispamThreshold) === msgs && Number(cfg.antispamWindow) === secs) {
      const sent = await embed.replyError(
        message,
        'Cette valeur est déjà configurée.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.setAntiraidConfig(guildId, 'antispamThreshold', msgs);
    db.setAntiraidConfig(guildId, 'antispamWindow', secs);

    const antispam = db.getAntiraidConfig(guildId);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Antispam configuré : **${antispam.antispamEnabled ? 'Activé' : 'Désactivé'}** - **${msgs}** messages en **${secs}** secondes.`,
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

  const antispam = db.getAntiraidConfig(guildId);

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `Antispam : **${antispam.antispamEnabled ? 'Activé' : 'Désactivé'}** - **${antispam.antispamThreshold}** messages en **${antispam.antispamWindow}** secondes.`,
        { timestamp: false }
      )
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};
