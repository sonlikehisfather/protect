'use strict';


const { ChannelType, PermissionsBitField } = require('discord.js');


const MUTE_DENY_TEXT_BITS = [
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.AddReactions,
  PermissionsBitField.Flags.CreatePublicThreads,
  PermissionsBitField.Flags.CreatePrivateThreads,
  PermissionsBitField.Flags.SendMessagesInThreads,
];


const MUTE_DENY_VOICE_BITS = [
  PermissionsBitField.Flags.Speak,
];


const MUTE_DENY_CATEGORY_BITS = [
  ...MUTE_DENY_TEXT_BITS,
  ...MUTE_DENY_VOICE_BITS,
];


const TEXT_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
]);

const VOICE_CHANNEL_TYPES = new Set([
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);


const FLAG_NAMES = new Map(
  Object.entries(PermissionsBitField.Flags).map(([name, bit]) => [bit, name])
);


function _buildOverwriteOptions(denyBits) {
  const opts = {};
  for (const bit of denyBits) {
    const name = FLAG_NAMES.get(bit);
    if (name) opts[name] = false;
  }
  return opts;
}


function _getDenyBitsForChannel(channel) {
  if (channel?.type === ChannelType.GuildCategory) return MUTE_DENY_CATEGORY_BITS;
  if (TEXT_CHANNEL_TYPES.has(channel?.type))       return MUTE_DENY_TEXT_BITS;
  if (VOICE_CHANNEL_TYPES.has(channel?.type))      return MUTE_DENY_VOICE_BITS;
  return null;
}


async function applyMuteOverwriteToChannel(channel, muteRole, me, opts = {}) {
  if (!channel || !muteRole || !me) {
    return _fail('Paramètres manquants.');
  }

  const denyBits = _getDenyBitsForChannel(channel);

  if (!denyBits) {
    return { ok: true, partial: false, skipped: true, reason: null };
  }


  const botPerms = channel.permissionsFor?.(me);

  if (!botPerms?.has(PermissionsBitField.Flags.Administrator)) {
    if (
      !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
      !botPerms?.has(PermissionsBitField.Flags.ManageChannels)
    ) {
      return _fail('Permissions bot insuffisantes dans ce salon (Voir les salons + Gérer les salons requis).');
    }
  }


  const overwriteOptions = _buildOverwriteOptions(denyBits);

  const editOk = await channel.permissionOverwrites.edit(
    muteRole.id,
    overwriteOptions,
    { reason: opts.reason ?? 'Mute role overwrites' }
  ).then(() => true).catch(() => false);

  if (!editOk) {
    return _fail('Échec API permissionOverwrites.edit.');
  }


  return { ok: true, partial: false, skipped: false, reason: null };
}

function _fail(reason) {
  return { ok: false, partial: false, skipped: false, reason };
}

module.exports = {
  applyMuteOverwriteToChannel,
  MUTE_DENY_TEXT_BITS,
  MUTE_DENY_VOICE_BITS,
  MUTE_DENY_CATEGORY_BITS,
};
