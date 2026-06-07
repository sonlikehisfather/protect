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
    name        : 'bringall',
    description : 'Déplace tous les membres en vocal du serveur vers un salon vocal.',
    usage       : 'bringall [salon]',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'bringall')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me) {
      const sent = await embed.replyError(
        message,
        'Impossible de vérifier mes permissions.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!me.permissions.has(PermissionsBitField.Flags.MoveMembers)) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas la permission de déplacer des membres.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let targetChannel = null;

    if (args.length) {
      targetChannel = await _resolveVoiceChannel(guild, args.join(' '));
    } else {
      const authorVoiceState = guild.voiceStates.cache.get(message.author.id);
      targetChannel = authorVoiceState?.channel ?? null;
    }

    if (!targetChannel) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}bringall [salon]\`\n\nSans salon précisé, vous devez être connecté à un vocal.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const botPerms = targetChannel.permissionsFor(me);

    if (
      !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
      !botPerms?.has(PermissionsBitField.Flags.Connect)
    ) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas accès au salon vocal d\'arrivée ou je ne peux pas m\'y connecter.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const members = guild.voiceStates.cache
      .filter(state =>
        state.channelId &&
        state.channelId !== targetChannel.id &&
        state.member &&
        !state.member.user.bot
      )
      .map(state => state.member);

    if (!members.length) {
      const sent = await embed.replyError(
        message,
        'Aucun membre à déplacer.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let moved        = 0;
    let failed       = 0;
    let protectedCnt = 0;

    const isBuyer = perms.isBuyer(message.author.id);
    const isOwner = perms.isOwner(guildId, message.author.id);

    for (const member of members) {
      if (perms.isProtected(member.id, guildId, member)) {
        protectedCnt++;
        continue;
      }

      if (
        !isBuyer &&
        !isOwner &&
        message.member.id !== guild.ownerId &&
        member.roles.highest.position >= message.member.roles.highest.position
      ) {
        protectedCnt++;
        continue;
      }

      const ok = await member.voice.setChannel(
        targetChannel,
        `Bringall par ${message.author.username}`
      ).then(() => true).catch(() => false);

      if (ok) moved++;
      else failed++;

      await _wait(500);
    }

    const text =
      `**Salon d'arrivée**\n` +
      `${targetChannel}\n\n` +
      `**Membres ciblés**\n` +
      `\`${members.length}\`\n\n` +
      `**Déplacés**\n` +
      `\`${moved}\`\n\n` +
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
            title     : 'Bringall terminé',
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
