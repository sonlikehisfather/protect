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
    name        : 'voicemove',
    description : 'Déplace tous les membres d\'un salon vocal vers un autre.',
    usage       : 'voicemove [salon départ] <salon arrivée>',
    aliases     : ['mv'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'voicemove')) return;

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

    let sourceChannel = null;
    let targetChannel = null;

    if (args.length === 1) {
      const authorVoiceState = guild.voiceStates.cache.get(message.author.id);
      sourceChannel = authorVoiceState?.channel ?? null;
      targetChannel = await _resolveVoiceChannel(guild, args[0]);
    }

    if (args.length >= 2) {
      sourceChannel = await _resolveVoiceChannel(guild, args[0]);
      targetChannel = await _resolveVoiceChannel(guild, args[1]);
    }

    if (!sourceChannel || !targetChannel) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}voicemove [salon départ] <salon arrivée>\`\n\nAvec un seul salon, vous devez être connecté à un vocal. Le bot déplacera les membres de votre vocal vers le salon indiqué.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sourceChannel.id === targetChannel.id) {
      const sent = await embed.replyError(
        message,
        'Le salon de départ et le salon d\'arrivée ne peuvent pas être identiques.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const botSourcePerms = sourceChannel.permissionsFor(me);
    const botTargetPerms = targetChannel.permissionsFor(me);

    if (!botSourcePerms?.has(PermissionsBitField.Flags.ViewChannel)) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas accès au salon vocal de départ.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (
      !botTargetPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
      !botTargetPerms?.has(PermissionsBitField.Flags.Connect)
    ) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas accès au salon vocal d\'arrivée ou je ne peux pas m\'y connecter.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const members = sourceChannel.members.filter(member =>
      !member.user.bot &&
      !perms.isProtected(member.id, guildId, member)
    );
    const protectedCount = sourceChannel.members.filter(member =>
      !member.user.bot &&
      perms.isProtected(member.id, guildId, member)
    ).size;

    if (!members.size) {
      const sent = await embed.replyError(
        message,
        'Aucun membre à déplacer dans le salon vocal de départ.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let moved  = 0;
    let failed = 0;

    for (const member of members.values()) {
      const ok = await member.voice.setChannel(
        targetChannel,
        `Voice move par ${message.author.username}`
      ).then(() => true).catch(() => false);

      if (ok) moved++; else failed++;

      await _wait(500);
    }

    const text =
      `**Salon de départ**\n` +
      `${sourceChannel}\n\n` +
      `**Salon d'arrivée**\n` +
      `${targetChannel}\n\n` +
      `**Protégés**\n` +
      `\`${protectedCount}\`\n\n` +
      `**Membres déplacés**\n` +
      `\`${moved}\`\n\n` +
      `**Échecs**\n` +
      `\`${failed}\``;

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          text,
          {
            title     : 'Déplacement vocal terminé',
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
