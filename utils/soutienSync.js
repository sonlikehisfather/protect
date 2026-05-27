'use strict';


const { ActivityType, PermissionsBitField } = require('discord.js');

const db                  = require('../core/database');
const errorHandler        = require('../utils/errorHandler');
const soutienAutoRemovals = require('../utils/soutienAutoRemovals');

const DEBUG_SOUTIEN = process.env.DEBUG_SOUTIEN === 'true' || process.env.DEBUG_SOUTIEN === '1';
const dbg = (...a) => { if (DEBUG_SOUTIEN) console.log('[soutien:sync]', ...a); };

const SYNC_MAX_MEMBERS = 10_000;
const ROLE_ACTION_DELAY_MS = 300;


function memberMatchesSoutien(member, config) {
  return getSoutienMatchInfo(member, config).matches;
}

function getSoutienMatchInfo(member, config) {
  let status = false;
  let tag    = false;
  let statusUnknown = false;

  const mode = config?.soutienMode || 'status';
  const checkStatus = (mode === 'status' || mode === 'both');
  const checkTag    = (mode === 'tag'    || mode === 'both');

  const keyword = String(config?.soutienKeyword || '').trim().toLowerCase();
  if (checkStatus && keyword) {
    const presence = member.presence;
    if (!presence || presence.status === 'offline') {

      statusUnknown = true;
    } else {
      const statusText = _getCustomStatusText(presence).toLowerCase();
      if (statusText.includes(keyword)) status = true;
    }
  }


  const expectedTag = String(config?.soutienTag || '').trim().toLowerCase();
  if (checkTag && expectedTag) {
    const pg = member.user?.primaryGuild;
    if (pg?.identityEnabled) {
      const userTag = String(pg.tag || '').trim().toLowerCase();
      if (userTag === expectedTag) tag = true;
    }
  }

  const matches = status || tag;
  let label = 'soutien';
  if (tag && status) label = 'tag + statut';
  else if (tag)      label = 'tag';
  else if (status)   label = 'statut';

  return { matches, tag, status, label, statusUnknown };
}

function _getCustomStatusText(presence) {
  const custom = presence?.activities?.find(a => a.type === ActivityType.Custom);
  if (!custom) return '';
  return [custom.state, custom.name].filter(Boolean).join(' ');
}


function _canManageRole(guild, role) {
  if (!role) return false;
  if (role.id === guild.id) return false;
  if (role.managed) return false;

  const me = guild.members.me;
  if (!me) return false;
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return false;
  if (role.position >= me.roles.highest.position) return false;

  return true;
}


async function syncSoutienGuild(client, guild, source = 'unknown', options = {}) {
  const force   = Boolean(options.force);
  const guildId = guild.id;
  const config  = db.getGuildConfig(guildId);

  const empty = {
    added: 0, removed: 0, tracked: 0, ignored: 0, errors: 0, ignoredOffline: 0,
  };

  if (!Number(config?.soutienEnabled)) {
    dbg('skip : soutien desactive', { guildId, source });
    return empty;
  }
  if (!config?.soutienRoleId) {
    dbg('skip : aucun role configure', { guildId, source });
    return empty;
  }

  const roleId = config.soutienRoleId;
  const role   = guild.roles.cache.get(roleId)
    ?? await guild.roles.fetch(roleId).catch(() => null);

  if (!_canManageRole(guild, role)) {
    dbg('skip : cannot manage role', { guildId, roleId, source });
    return empty;
  }

  dbg('start sync', { guildId, source, mode: config?.soutienMode || 'status' });

  let members;
  if (guild.memberCount > SYNC_MAX_MEMBERS) {
    members = guild.members.cache;
  } else {
    members = await guild.members.fetch().catch(() => null);
    if (!members) return empty;
  }

  let added           = 0;
  let removed         = 0;
  let tracked         = 0;
  let ignored         = 0;
  let ignoredOffline  = 0;
  let errors          = 0;

  for (const [, member] of members) {
    if (member.user.bot) continue;

    const matchInfo = getSoutienMatchInfo(member, config);
    const matches   = matchInfo.matches;
    const hasRole   = member.roles.cache.has(roleId);

    if (matches && !hasRole) {
      if (db.isSoutienManualIgnored(guildId, member.id, roleId)) { ignored++; continue; }

      const ok = await member.roles.add(role, `Soutien resync (${source})`).catch(err => {
        errorHandler.handle(err, { source: `soutienSync.add.${source}`, guildId, userId: member.id });
        return null;
      });
      if (!ok) { errors++; continue; }
      db.grantSoutienRoleTracking(guildId, member.id);
      _markValidTracking(member, config);
      added++;
      if (added % 5 === 0) await _sleep(ROLE_ACTION_DELAY_MS);
      continue;
    }

    if (matches && hasRole) {
      db.grantSoutienRoleTracking(guildId, member.id, true);
      _markValidTracking(member, config);
      db.removeSoutienManualIgnore(guildId, member.id, roleId);
      tracked++;
      continue;
    }


    if (!matches && hasRole) {

      if (db.isSoutienManualIgnored(guildId, member.id, roleId)) {
        ignored++;
        continue;
      }
      if (matchInfo.statusUnknown && !matchInfo.tag && !force) {


        ignoredOffline++;
        continue;
      }
      soutienAutoRemovals.mark(guildId, member.id, roleId);
      const ok = await member.roles.remove(role, `Soutien resync (${source})`).catch(err => {
        errorHandler.handle(err, { source: `soutienSync.remove.${source}`, guildId, userId: member.id });
        return null;
      });
      if (!ok) { errors++; continue; }
      db.revokeSoutienRoleTracking(guildId, member.id);
      db.clearSoutienStatusValid(guildId, member.id);
      db.clearSoutienTagValid(guildId, member.id);
      db.removeSoutienManualIgnore(guildId, member.id, roleId);
      removed++;
      if (removed % 5 === 0) await _sleep(ROLE_ACTION_DELAY_MS);
      continue;
    }

  }

  if (added || removed || tracked) {
    const forceTag = force ? ' force=true' : '';
    console.log(`[soutienSync] ${source}${forceTag} guild=${guild.name} : +${added} -${removed} ~${tracked}`);
  }

  return { added, removed, tracked, ignored, ignoredOffline, errors };
}


async function cleanupTagOnlyGuild(client, guild) {
  const guildId = guild.id;
  const config  = db.getGuildConfig(guildId);

  const empty = {
    candidates: 0, removed: 0, ignoredManual: 0, ignoredAlreadyOff: 0,
    ignoredStatusMatch: 0, errors: 0,
  };

  if (!Number(config?.soutienEnabled)) return { ...empty, reason: 'soutien_disabled' };
  if (!config?.soutienRoleId)         return { ...empty, reason: 'no_role_configured' };

  const roleId = config.soutienRoleId;
  const role   = guild.roles.cache.get(roleId)
    ?? await guild.roles.fetch(roleId).catch(() => null);

  if (!_canManageRole(guild, role)) {
    return { ...empty, reason: 'cannot_manage_role' };
  }

  const candidates = db.listSoutienTagOnly(guildId);
  let candidatesCount    = candidates.length;
  let removed            = 0;
  let ignoredManual      = 0;
  let ignoredAlreadyOff  = 0;
  let ignoredStatusMatch = 0;
  let errors             = 0;

  const keyword = String(config?.soutienKeyword || '').trim().toLowerCase();

  for (const row of candidates) {
    const userId = row.userId;

    if (db.isSoutienManualIgnored(guildId, userId, roleId)) {
      ignoredManual++;

      db.revokeSoutienRoleTracking(guildId, userId);
      db.clearSoutienTagValid(guildId, userId);
      continue;
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {

      db.revokeSoutienRoleTracking(guildId, userId);
      db.clearSoutienTagValid(guildId, userId);
      ignoredAlreadyOff++;
      continue;
    }

    if (!member.roles.cache.has(roleId)) {

      db.revokeSoutienRoleTracking(guildId, userId);
      db.clearSoutienTagValid(guildId, userId);
      ignoredAlreadyOff++;
      continue;
    }


    if (keyword && member.presence && member.presence.status !== 'offline') {
      const text = _getCustomStatusText(member.presence).toLowerCase();
      if (text.includes(keyword)) {

        db.markSoutienStatusValid(guildId, userId, true);
        ignoredStatusMatch++;
        continue;
      }
    }

    soutienAutoRemovals.mark(guildId, userId, roleId);
    const ok = await member.roles.remove(role, 'Soutien cleanup tag-only').catch(err => {
      errorHandler.handle(err, { source: 'soutienSync.cleanupTagOnly', guildId, userId });
      return null;
    });
    if (!ok) { errors++; continue; }

    db.revokeSoutienRoleTracking(guildId, userId);
    db.clearSoutienTagValid(guildId, userId);
    db.clearSoutienStatusValid(guildId, userId);
    db.removeSoutienManualIgnore(guildId, userId, roleId);
    removed++;
    if (removed % 5 === 0) await _sleep(ROLE_ACTION_DELAY_MS);
  }

  if (removed || ignoredManual || ignoredAlreadyOff || ignoredStatusMatch) {
    console.log(`[soutienSync] cleanupTagOnly guild=${guild.name} : -${removed} (manual=${ignoredManual}, alreadyOff=${ignoredAlreadyOff}, statusMatch=${ignoredStatusMatch}, errors=${errors})`);
  }

  return {
    candidates : candidatesCount,
    removed,
    ignoredManual,
    ignoredAlreadyOff,
    ignoredStatusMatch,
    errors,
  };
}

function _markValidTracking(member, config) {
  const keyword = String(config.soutienKeyword || '').trim().toLowerCase();
  if (keyword && member.presence) {
    const text = _getCustomStatusText(member.presence).toLowerCase();
    if (text.includes(keyword)) {
      db.markSoutienStatusValid(member.guild.id, member.id, true);
    }
  }

  const expectedTag = String(config.soutienTag || '').trim().toLowerCase();
  if (expectedTag) {
    const pg = member.user?.primaryGuild;
    if (pg?.identityEnabled) {
      const userTag = String(pg.tag || '').trim().toLowerCase();
      if (userTag === expectedTag) {
        db.markSoutienTagValid(member.guild.id, member.id, true);
      }
    }
  }
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}


function getActiveSoutienStats(guild) {
  const guildId = guild.id;
  const config  = db.getGuildConfig(guildId);
  const stats   = { tag: 0, status: 0, all: 0 };

  if (!Number(config?.soutienEnabled)) return stats;
  if (!config?.soutienRoleId) return stats;

  const roleId = config.soutienRoleId;

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;
    if (!member.roles.cache.has(roleId)) continue;
    if (db.isSoutienManualIgnored(guildId, member.id, roleId)) continue;

    const info = getSoutienMatchInfo(member, config);
    if (!info.matches) continue;

    if (info.tag)    stats.tag++;
    if (info.status) stats.status++;
    stats.all++;
  }

  return stats;
}

module.exports = {
  memberMatchesSoutien,
  getSoutienMatchInfo,
  getActiveSoutienStats,
  syncSoutienGuild,
  cleanupTagOnlyGuild,
};
