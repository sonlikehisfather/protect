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
    name        : 'presencedm',
    description : 'DM les membres cibles qui n\'ont pas reagi (✅/❌/⏳) au message presence.',
    usage       : 'presencedm [message_id|lien_message]',
    aliases     : ['pdm'],
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

    const roleIds = cfg.activePresence.mentionRoleIds?.length
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

    const members = new Map();

    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId);
      if (!role) continue;
      for (const member of role.members.values()) {
        if (member.user.bot) continue;
        members.set(member.id, member);
      }
    }

    if (!members.size) {
      return replyError(message, 'Aucun membre cible pour les DMs.', module.exports.help.name);
    }

    const repliedUserIds = await _collectRepliedUserIds(targetMessage);
    const pendingMembers = [...members.values()].filter(m => !repliedUserIds.has(m.id));

    if (!pendingMembers.length) {
      return reply(message, 'Tous les membres cibles ont deja reagi (✅/❌/⏳).', { timestamp: false }, module.exports.help.name);
    }

    let ok = 0;
    let ko = 0;

    const link = `https://discord.com/channels/${guildId}/${targetMessage.channel.id}/${targetMessage.id}`;
    const body = [
      'Presence active',
      '',
      `Titre: ${cfg.activePresence.title || 'Sans titre'}`,
      `Lien: ${link}`,
    ].join('\n');

    for (const member of pendingMembers) {
      await member.send({ content: body }).then(() => { ok++; }).catch(() => { ko++; });
    }

    return reply(
      message,
      `DM presence termine. Cibles sans reaction: **${pendingMembers.length}** - Envoyes: **${ok}** - Echecs: **${ko}**`,
      { timestamp: false },
      module.exports.help.name
    );
  },
};

const REPLIED_EMOJIS = new Set(['✅', '❌', '⏳']);

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

async function _collectRepliedUserIds(message) {
  const ids = new Set();

  for (const reaction of message.reactions.cache.values()) {
    const emojiName = reaction.emoji?.name;
    if (!REPLIED_EMOJIS.has(emojiName)) continue;

    const users = await reaction.users.fetch().catch(() => null);
    if (!users) continue;

    for (const user of users.values()) {
      if (user.bot) continue;
      ids.add(user.id);
    }
  }

  return ids;
}
