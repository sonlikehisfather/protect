'use strict';


const { ChannelType } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'unlock',
    description : 'Ouvre un salon textuel ou vocal.',
    usage       : 'unlock [salon]',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteLockReplies ?? config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    const channel = resolveChannel(message, args);

    if (!channel) {
      const sent = await embed.replyError(
        message,
        `Aucun salon trouvé pour : \`${args.join(' ') || 'inconnu'}\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!isLockable(channel)) {
      const sent = await embed.replyError(
        message,
        'Ce type de salon ne peut pas être déverrouillé.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const everyone = guild.roles.everyone;

    const edited = isTextChannel(channel)
      ? await channel.permissionOverwrites.edit(everyone, { SendMessages: null }).catch(() => null)
      : await channel.permissionOverwrites.edit(everyone, { Connect: null }).catch(() => null);

    if (!edited) {
      const sent = await embed.replyError(
        message,
        'Impossible de déverrouiller ce salon.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await channel.send({
      embeds: [
        embed.build(
          guildId,
          `Le salon ${channel} a été déverrouillé.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};

function resolveChannel(message, args) {
  const mentioned = message.mentions.channels.first();
  if (mentioned) return mentioned;

  const raw = args.join(' ').trim();
  if (!raw) return message.channel;

  const cleaned = raw.replace(/[<#>]/g, '').trim();
  if (/^\d{17,20}$/.test(cleaned)) {
    return message.guild.channels.cache.get(cleaned) ?? null;
  }

  const lowered = raw.toLowerCase();

  const exact = message.guild.channels.cache.find(c =>
    c.name?.toLowerCase() === lowered
  );
  if (exact) return exact;

  const partial = message.guild.channels.cache.find(c =>
    c.name?.toLowerCase().includes(lowered)
  );
  if (partial) return partial;

  return null;
}

function isTextChannel(channel) {
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
}

function isVoiceChannel(channel) {
  return channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;
}

function isLockable(channel) {
  return isTextChannel(channel) || isVoiceChannel(channel);
}
