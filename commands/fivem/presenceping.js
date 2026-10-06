'use strict';

const {
  canUseFivem,
  getDeletePolicy,
  getModuleConfig,
  reply,
  replyError,
} = require('./_shared');

module.exports = {
  help: {
    name        : 'presenceping',
    description : 'Ping les membres cibles qui n\'ont pas reagi sur le message de presence.',
    usage       : 'presenceping [message_id|lien_message]',
    aliases     : ['pping'],
    category    : 'fivem',
  },

  async run(client, message, args) {
    const guild = message.guild;
    const guildId = guild.id;

    if (!canUseFivem(message, module.exports.help.name)) {
      return replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.", module.exports.help.name);
    }

    const del = getDeletePolicy(guildId);
    if (del.deleteCmd) await message.delete().catch(() => {});

    const cfg = getModuleConfig(guildId);

    const parsedTarget = _parseMessageTarget(args || []);

    if (!parsedTarget.messageId && !cfg.activePresence?.messageId) {
      return replyError(message, 'Aucun message cible fourni et aucune presence active enregistree.', module.exports.help.name);
    }

    const roleIds = cfg.activePresence?.mentionRoleIds?.length
      ? cfg.activePresence.mentionRoleIds
      : cfg.presenceMentionRoles;

    if (!roleIds.length) {
      return replyError(message, 'Aucun role de ping configure.', module.exports.help.name);
    }

    const targetMessageId = parsedTarget.messageId || cfg.activePresence.messageId;
    const targetMessage = await _resolveTargetMessage(guild, cfg, message, parsedTarget.channelId, targetMessageId);

    if (!targetMessage) {
      return replyError(message, 'Message cible introuvable.', module.exports.help.name);
    }

    const targetChannel = targetMessage.channel;

    const eligibleUserIds = _collectEligibleUserIds(guild, roleIds);
    if (!eligibleUserIds.size) {
      return replyError(message, 'Aucun membre cible trouve avec les roles configures.', module.exports.help.name);
    }

    const reactedUserIds = await _collectReactedUserIds(targetMessage);
    const toPing = [...eligibleUserIds].filter(userId => !reactedUserIds.has(userId));

    if (!toPing.length) {
      return reply(message, 'Tous les membres cibles ont deja reagi a ce message.', { timestamp: false }, module.exports.help.name);
    }

    const chunks = _chunk(toPing, 40);
    const link = `https://discord.com/channels/${guildId}/${targetChannel.id}/${targetMessage.id}`;

    for (let i = 0; i < chunks.length; i++) {
      const batch = chunks[i];
      const mentionText = batch.map(id => `<@${id}>`).join(' ');
      const header = i === 0
        ? `Presence active: ${link}\nMembres sans reaction (${toPing.length}):`
        : `Suite (${i + 1}/${chunks.length}):`;

      await targetChannel.send({
        content         : `${header}\n${mentionText}`,
        allowedMentions : { users: batch, roles: [], parse: [] },
      }).catch(() => null);
    }

    return reply(
      message,
      `Ping envoye: **${toPing.length}** membre(s) n\'avaient pas reagi.`,
      { timestamp: false },
      module.exports.help.name
    );
  },
};

function _parseMessageTarget(args) {
  const raw = args.join(' ').trim();
  if (!raw) return { messageId: null, channelId: null };

  const linkMatch = raw.match(/channels\/\d+\/(\d{17,20})\/(\d{17,20})/i);
  if (linkMatch) {
    return {
      channelId: linkMatch[1],
      messageId: linkMatch[2],
    };
  }

  const idMatch = raw.match(/\d{17,20}/);
  return {
    channelId: null,
    messageId: idMatch ? idMatch[0] : null,
  };
}

async function _resolveTargetMessage(guild, cfg, message, preferredChannelId, messageId) {
  if (!messageId) return null;

  const channelIds = [];
  const push = (id) => {
    if (!id) return;
    if (!channelIds.includes(id)) channelIds.push(id);
  };

  push(preferredChannelId);
  push(cfg.activePresence?.channelId);
  push(cfg.presenceOpChannelId);
  push(cfg.presenceMission1ChannelId);
  push(cfg.presenceMission2ChannelId);
  push(cfg.presenceChannelId);
  push(message.channel.id);

  for (const channelId of channelIds) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased?.()) continue;
    const found = await channel.messages.fetch(messageId).catch(() => null);
    if (found) return found;
  }

  return null;
}

function _collectEligibleUserIds(guild, roleIds) {
  const ids = new Set();

  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;

    for (const member of role.members.values()) {
      if (member.user?.bot) continue;
      ids.add(member.id);
    }
  }

  return ids;
}

async function _collectReactedUserIds(message) {
  const ids = new Set();

  for (const reaction of message.reactions.cache.values()) {
    const users = await reaction.users.fetch().catch(() => null);
    if (!users) continue;

    for (const user of users.values()) {
      if (user.bot) continue;
      ids.add(user.id);
    }
  }

  return ids;
}

function _chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
