'use strict';


const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');

exports.help = {
  name        : 'raidlog',
  description : 'Configurer le salon des logs antiraid.',
  usage       : 'raidlog <on|off> [#salon]',
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  let   sub     = args[0]?.toLowerCase();
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

  const current = db.getGuildConfig(guildId);

  if (!sub) {
    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Logs antiraid : **${current?.raidLogChannel ? 'Activés' : 'Désactivés'}** - salon : ${current?.raidLogChannel ? `<#${current.raidLogChannel}>` : 'Non configuré'}.`,
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
    db.setGuildConfig(guildId, 'raidLogChannel', null);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          'Les logs antiraid ont été désactivés.',
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


  if (sub && sub !== 'on' && sub !== 'off') {
    const idMatch    = String(args[0] || '').match(/^<#(\d{17,20})>$|^(\d{17,20})$/);
    const idChannel  = idMatch ? message.guild.channels.cache.get(idMatch[1] || idMatch[2]) : null;
    const directChan = message.mentions.channels.first() || idChannel;

    if (directChan) {
      args = ['on', args[0], ...args.slice(1)];
      sub  = 'on';
    }
  }

  if (sub === 'on') {
    const channel =
      message.mentions.channels.first() ||
      message.guild.channels.cache.get(args[1]) ||
      null;

    const targetChannel = channel || (
      current?.raidLogChannel
        ? message.guild.channels.cache.get(current.raidLogChannel)
        : null
    );

    if (!targetChannel) {
      const sent = await embed.replyError(
        message,
        'Mentionnez un salon ou utilisez `raidlog on #salon`.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    if (!targetChannel.isTextBased()) {
      const sent = await embed.replyError(
        message,
        'Le salon indiqué doit être un salon textuel.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    db.setGuildConfig(guildId, 'raidLogChannel', targetChannel.id);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Les logs antiraid sont maintenant envoyés dans <#${targetChannel.id}>.`,
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

  const sent = await embed.replyError(
    message,
    'Utilisez `raidlog on [#salon]` ou `raidlog off`.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};
