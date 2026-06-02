'use strict';


const {
  ChannelType,
  PermissionsBitField,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'cleanup',
    description : 'Déconnecte tous les utilisateurs d\'un salon vocal.',
    usage       : 'cleanup <salon>',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'cleanup')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me || !me.permissions.has(PermissionsBitField.Flags.MoveMembers)) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas la permission de déplacer des membres.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let channel = null;

    if (args.length) {
      channel = await _resolveVoiceChannel(guild, args.join(' '));
    } else {
      const authorVoiceState = guild.voiceStates.cache.get(message.author.id);
      channel = authorVoiceState?.channel ?? null;
    }

    if (!channel) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}cleanup <salon>\`\n\nSans salon précisé, vous devez être connecté à un vocal.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const botPerms = channel.permissionsFor(me);

    if (!botPerms?.has(PermissionsBitField.Flags.ViewChannel)) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas accès à ce salon vocal.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const members = channel.members.filter(member => !member.user.bot);

    if (!members.size) {
      const sent = await embed.replyError(
        message,
        'Aucun membre à déconnecter dans ce salon vocal.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let disconnected = 0;
    let failed       = 0;
    let protectedCnt = 0;

    for (const member of members.values()) {
      if (
        message.member.id !== guild.ownerId &&
        member.roles.highest.position >= message.member.roles.highest.position
      ) {
        protectedCnt++;
        continue;
      }

      const ok = await member.voice.disconnect(
        `Cleanup vocal par ${message.author.username}`
      ).then(() => true).catch(() => false);

      if (ok) disconnected++;
      else failed++;

      await _wait(500);
    }

    const text =
      `**Salon vocal**\n` +
      `${channel}\n\n` +
      `**Membres ciblés**\n` +
      `\`${members.size}\`\n\n` +
      `**Déconnectés**\n` +
      `\`${disconnected}\`\n\n` +
      `**Protégés**\n` +
      `\`${protectedCnt}\`\n\n` +
      `**Échecs**\n` +
      `\`${failed}\``;

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          text,
          {
            title     : 'Cleanup vocal terminé',
            timestamp : false,
          }
        ),
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function _resolveVoiceChannel(guild, query) {
  if (!query || typeof query !== 'string') return null;

  const clean = query.replace(/[<#>]/g, '');

  if (/^\d{17,20}$/.test(clean)) {
    const channel =
      guild.channels.cache.get(clean) ??
      await guild.channels.fetch(clean).catch(() => null);

    return _isVoiceChannel(channel) ? channel : null;
  }

  const lower = query.toLowerCase();

  return guild.channels.cache.find(channel =>
    _isVoiceChannel(channel) &&
    channel.name.toLowerCase() === lower
  ) ?? null;
}

function _isVoiceChannel(channel) {
  return Boolean(
    channel &&
    (
      channel.type === ChannelType.GuildVoice ||
      channel.type === ChannelType.GuildStageVoice
    )
  );
}

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
