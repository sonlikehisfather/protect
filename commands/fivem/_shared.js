'use strict';

const { MessageFlags } = require('discord.js');

const db = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(v => String(v)).filter(Boolean);
  } catch {
    return [];
  }
}

function uniqueIds(ids) {
  return [...new Set((ids || []).map(id => String(id)))];
}

function extractRoleIds(message, input = '') {
  const fromMentions = [...message.mentions.roles.values()].map(r => r.id);
  const raw = String(input || '');
  const fromRaw = raw.match(/\d{17,20}/g)?.map(String) ?? [];

  const guildRoles = message.guild?.roles?.cache;
  const fromNames = [];

  if (guildRoles?.size) {
    // Support tokens like @RoleName, RoleName, "Role Name", comma/newline-separated lists.
    const parts = raw
      .split(/[,\n]/g)
      .map(v => v.trim())
      .filter(Boolean);

    for (let part of parts) {
      part = part.replace(/^@/, '').replace(/^['"]|['"]$/g, '').trim();
      if (!part) continue;
      if (/^\d{17,20}$/.test(part)) continue;

      const lower = part.toLowerCase();
      const exact = guildRoles.find(role => String(role.name || '').toLowerCase() === lower);
      if (exact) {
        fromNames.push(exact.id);
        continue;
      }

      const contains = guildRoles.find(role => String(role.name || '').toLowerCase().includes(lower));
      if (contains) {
        fromNames.push(contains.id);
      }
    }
  }

  return uniqueIds([...fromMentions, ...fromRaw, ...fromNames]);
}

function extractUserId(message, input = '') {
  const mention = message.mentions.users.first();
  if (mention) return mention.id;
  const m = String(input).match(/\d{17,20}/);
  return m ? m[0] : null;
}

function extractChannelId(message, input = '') {
  const mention = message.mentions.channels.first();
  if (mention) return mention.id;

  const raw = String(input || '').trim();
  if (!raw) return null;

  const m = raw.match(/\d{17,20}/);
  if (m) return m[0];

  // Accept #channel-name, channel-name, or quoted channel names.
  let name = raw
    .replace(/^['"]|['"]$/g, '')
    .trim();

  if (name.startsWith('#')) {
    name = name.slice(1).trim();
  }

  if (!name) return null;

  const lower = name.toLowerCase();
  const byExactName = message.guild?.channels?.cache?.find(ch =>
    String(ch.name || '').toLowerCase() === lower
  );

  if (byExactName) return byExactName.id;

  const byContainsName = message.guild?.channels?.cache?.find(ch =>
    String(ch.name || '').toLowerCase().includes(lower)
  );

  return byContainsName?.id || null;
}

function _parseActivePresences(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter(p => p && p.messageId);
  } catch {
    return [];
  }
}

function getModuleConfig(guildId) {
  const cfg = db.getGuildConfig(guildId) || {};
  return {
    kpRoles            : parseJsonArray(cfg.fivemKpRoles),
    kpKeepRoleId       : cfg.fivemKpKeepRoleId || null,
    rcRoles            : parseJsonArray(cfg.fivemRcRoles),
    fblRoles           : parseJsonArray(cfg.fivemFblRoles),
    blacklistRoleId    : cfg.fivemBlacklistRoleId || null,
    presenceMentionRoles: parseJsonArray(cfg.fivemPresenceMentionRoles),
    presenceChannelId  : cfg.fivemPresenceChannelId || null,
    presenceOpChannelId: cfg.fivemPresenceChannelOpId || cfg.fivemPresenceChannelId || null,
    presenceMission1ChannelId: cfg.fivemPresenceChannelMission1Id || null,
    presenceMission2ChannelId: cfg.fivemPresenceChannelMission2Id || null,
    mission1MessageId  : cfg.fivemMission1MessageId || null,
    promotionChannelId : cfg.fivemPromotionChannelId || null,
    promotionUpChannelId: cfg.fivemPromotionUpChannelId || cfg.fivemPromotionChannelId || null,
    promotionDownChannelId: cfg.fivemPromotionDownChannelId || cfg.fivemPromotionChannelId || null,
    promotionRankHierarchy: parseJsonArray(cfg.fivemPromotionRankHierarchy),
    embedMode          : (cfg.fivemEmbedMode || 'v2').toLowerCase(),
    activePresences    : _parseActivePresences(cfg.fivemActivePresence),
    activePresence     : _parseActivePresences(cfg.fivemActivePresence).slice(-1)[0] || null,
  };
}

function setJsonConfig(guildId, key, arr) {
  db.setGuildConfig(guildId, key, JSON.stringify(uniqueIds(arr || [])));
}

function setTextConfig(guildId, key, value) {
  db.setGuildConfig(guildId, key, value || null);
}

function _writeActivePresences(guildId, list) {
  db.setGuildConfig(guildId, 'fivemActivePresence', list.length ? JSON.stringify(list) : null);
}

function addActivePresence(guildId, entry) {
  const list = _parseActivePresences(db.getGuildConfig(guildId)?.fivemActivePresence)
    .filter(p => p.messageId !== entry.messageId);
  list.push(entry);
  _writeActivePresences(guildId, list);
}

function removeActivePresence(guildId, messageId) {
  const list = _parseActivePresences(db.getGuildConfig(guildId)?.fivemActivePresence);
  _writeActivePresences(guildId, messageId ? list.filter(p => p.messageId !== messageId) : []);
}

/** Supprime les présences dont le message n'existe plus. Retourne la liste à jour. */
async function pruneActivePresences(guild) {
  const list = _parseActivePresences(db.getGuildConfig(guild.id)?.fivemActivePresence);
  const alive = [];
  for (const p of list) {
    const channel = guild.channels.cache.get(p.channelId);
    const msg = channel?.isTextBased?.()
      ? await channel.messages.fetch(p.messageId).catch(() => null)
      : null;
    if (msg) alive.push(p);
  }
  if (alive.length !== list.length) _writeActivePresences(guild.id, alive);
  return alive;
}

function canUseFivem(message, commandName) {
  const guildId = message.guild.id;
  const userId = message.author.id;

  if (perms.check(message, commandName)) return true;
  if (perms.isBuyer(userId)) return true;
  if (perms.isOwner(guildId, userId)) return true;
  if (db.isFivemOwner(guildId, userId)) return true;
  return false;
}

function canManageFivemOwners(message) {
  const guildId = message.guild.id;
  const userId = message.author.id;
  return perms.isBuyer(userId) || perms.isOwner(guildId, userId);
}

function getDeletePolicy(guildId) {
  const cfg = db.getGuildConfig(guildId) || {};
  return {
    deleteCmd   : Boolean(cfg.autoDeleteModCmds),
    deleteReply : Boolean(cfg.autoDeleteModReplies),
    deleteDelay : Number(cfg.autoDeleteDelay ?? 5),
  };
}

function modeForGuild(guildId) {
  const mode = (db.getGuildConfig(guildId)?.fivemEmbedMode || 'v2').toLowerCase();
  if (mode === 'v1' || mode === 'v2' || mode === 'auto') return mode;
  return 'v2';
}

function wrapByMode(guildId, payload, commandName) {
  const mode = modeForGuild(guildId);
  if (mode === 'v2') return payload;
  if (mode === 'v1') return embed.v2PayloadToV1(payload);
  return embed.wrapPayload(guildId, payload, commandName);
}

function buildTextPayload(guildId, text, options = {}, commandName = null) {
  const mode = modeForGuild(guildId);

  if (mode === 'v2') {
    return {
      components      : [embed.buildV2Container(guildId, text, options)],
      flags           : COMPONENTS_V2_FLAG,
      allowedMentions : options.allowedMentions ?? { parse: [] },
    };
  }

  if (mode === 'v1') {
    return {
      embeds          : [embed.build(guildId, text, options)],
      allowedMentions : options.allowedMentions ?? { parse: [] },
    };
  }

  return embed.buildPayload(guildId, text, {
    ...options,
    _cmdName: commandName,
  });
}

async function reply(message, text, options = {}, commandName = null) {
  const payload = buildTextPayload(message.guild.id, text, options, commandName);
  // Si la commande a été supprimée (autoDeleteModCmds), message.reply() échoue : on envoie dans le salon.
  return message.reply(payload).catch(() => message.channel.send(payload).catch(() => null));
}


/** Plus haute position de rôle de l'auteur (Infinity pour buyer/owner). */
function authorCeiling(message) {
  const perms = require('../../utils/permissions');
  if (perms.isBuyer(message.author.id) || perms.isOwner(message.guild.id, message.author.id)) return Infinity;
  return message.member?.roles.highest.position ?? 0;
}

/** Écrit une action FiveM dans le salon modlog. */
async function logAction(message, title, fields = []) {
  try {
    const logger = require('../../utils/logger');
    const guildId = message.guild.id;
    const e = embed.log(guildId, title, [
      { name: 'Modérateur', value: `<@${message.author.id}> (${message.author.tag})`, inline: false },
      ...fields,
    ]);
    await logger.send(message.client, guildId, 'modlog', e);
  } catch {}
}

/**
 * Vérifie qu'on peut agir sur `target` (retrait/ajout de rôles en masse).
 * Retourne un message d'erreur, ou null si OK.
 */
function checkTargetAllowed(message, target) {
  const guildId = message.guild.id;
  const authorId = message.author.id;

  if (target.id === authorId) return 'Tu ne peux pas utiliser cette commande sur toi-même.';
  if (target.id === message.client.user.id) return 'Impossible sur le bot.';
  if (perms.isProtected(target.id, guildId, target, { ignoreProtectUser: true })) {
    return 'Ce membre est protégé (buyer, owner ou whitelist).';
  }

  const isPrivileged = perms.isBuyer(authorId) || perms.isOwner(guildId, authorId);
  if (!isPrivileged && message.member &&
      target.roles.highest.position >= message.member.roles.highest.position) {
    return 'Tu ne peux pas agir sur un membre dont le rôle est supérieur ou égal au tien.';
  }
  return null;
}

async function replyError(message, text, commandName = null) {
  return reply(message, text, { color: '#ED4245', timestamp: false }, commandName);
}

module.exports = {
  COMPONENTS_V2_FLAG,
  canUseFivem,
  canManageFivemOwners,
  checkTargetAllowed,
  authorCeiling,
  logAction,
  getDeletePolicy,
  getModuleConfig,
  setJsonConfig,
  setTextConfig,
  addActivePresence,
  removeActivePresence,
  pruneActivePresences,
  extractRoleIds,
  extractUserId,
  extractChannelId,
  modeForGuild,
  wrapByMode,
  buildTextPayload,
  reply,
  replyError,
};
