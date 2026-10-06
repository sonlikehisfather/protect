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
    activePresence     : (() => {
      if (!cfg.fivemActivePresence) return null;
      try { return JSON.parse(cfg.fivemActivePresence); } catch { return null; }
    })(),
  };
}

function setJsonConfig(guildId, key, arr) {
  db.setGuildConfig(guildId, key, JSON.stringify(uniqueIds(arr || [])));
}

function setTextConfig(guildId, key, value) {
  db.setGuildConfig(guildId, key, value || null);
}

function setActivePresence(guildId, payload) {
  db.setGuildConfig(guildId, 'fivemActivePresence', payload ? JSON.stringify(payload) : null);
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
  return message.reply(buildTextPayload(message.guild.id, text, options, commandName)).catch(() => null);
}

async function replyError(message, text, commandName = null) {
  return reply(message, text, { color: '#ED4245', timestamp: false }, commandName);
}

module.exports = {
  COMPONENTS_V2_FLAG,
  canUseFivem,
  canManageFivemOwners,
  getDeletePolicy,
  getModuleConfig,
  setJsonConfig,
  setTextConfig,
  setActivePresence,
  extractRoleIds,
  extractUserId,
  extractChannelId,
  modeForGuild,
  wrapByMode,
  buildTextPayload,
  reply,
  replyError,
};
