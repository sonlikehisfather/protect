'use strict';


const { ActivityType } = require('discord.js');
const db                  = require('../core/database');
const errorHandler        = require('../utils/errorHandler');
const soutienAutoRemovals = require('../utils/soutienAutoRemovals');

const DEBUG_SOUTIEN = process.env.DEBUG_SOUTIEN === 'true' || process.env.DEBUG_SOUTIEN === '1';
const dbg = (...a) => { if (DEBUG_SOUTIEN) console.log('[soutien:presence]', ...a); };

module.exports = {
  name : 'presenceUpdate',
  once : false,

  async execute(client, oldPresence, newPresence) {
    if (!newPresence && !oldPresence) return;

    const guild  = newPresence?.guild  ?? oldPresence?.guild;
    const member = newPresence?.member ?? oldPresence?.member;
    if (!guild || !member || member.user?.bot) return;

    const oldStatus = _getCustomStatusText(oldPresence).toLowerCase();
    const newStatus = _getCustomStatusText(newPresence).toLowerCase();
    if (oldStatus === newStatus) return;

    const guildId = guild.id;

    try {
      const config = db.getGuildConfig(guildId);
      if (!Number(config?.soutienEnabled)) return;
      const soutienMode = config?.soutienMode || 'status';
      if (soutienMode !== 'status' && soutienMode !== 'both') {
        dbg('skip : mode ne traite pas le statut', { guildId, mode: soutienMode });
        return;
      }
      if (!config?.soutienRoleId) return;
      if (!config?.soutienKeyword) {
        dbg('skip : aucun keyword configure', { guildId });
        return;
      }

      dbg('event recu', {
        guildId,
        userId : member.id,
        mode   : soutienMode,
        oldStatus,
        newStatus,
        keyword: String(config.soutienKeyword).toLowerCase(),
      });

      await _syncSoutienStatus(guild, member, newPresence, config);
    } catch (err) {
      errorHandler.handle(err, {
        source  : 'presenceUpdate.soutien',
        guildId : guildId,
        userId  : member?.id,
      });
    }
  },
};

async function _syncSoutienStatus(guild, member, presence, config) {
  if (!presence) {
    dbg('skip : pas de presence', { guildId: guild.id, userId: member.id });
    return;
  }


  if (presence.status === 'offline') {
    dbg('skip : presence offline', { guildId: guild.id, userId: member.id });
    return;
  }

  const role = guild.roles.cache.get(config.soutienRoleId);
  if (!role || role.managed) {
    dbg('skip : role introuvable ou managed', { guildId: guild.id, roleId: config.soutienRoleId });
    return;
  }

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me) {
    dbg('skip : self member introuvable', { guildId: guild.id });
    return;
  }
  if (role.position >= me.roles.highest.position) {
    dbg('skip : role hierarchy', { guildId: guild.id, rolePos: role.position, mePos: me.roles.highest.position });
    return;
  }

  const keyword = String(config.soutienKeyword || '').trim().toLowerCase();
  if (!keyword) return;

  const mode           = config.soutienMode || 'status';
  const statusText     = _getCustomStatusText(presence).toLowerCase();
  const shouldHaveRole = statusText.includes(keyword);
  const hasRole        = member.roles.cache.has(role.id);

  dbg('evaluation status', {
    guildId: guild.id,
    userId : member.id,
    mode,
    statusText,
    shouldHaveRole,
    hasRole,
  });

  if (shouldHaveRole && !hasRole) {
    if (db.isSoutienManualIgnored(guild.id, member.id, role.id)) {
      dbg('skip add : manualIgnored', { guildId: guild.id, userId: member.id });
      db.markSoutienStatusValid(guild.id, member.id);
      return;
    }

    let addOk = true;
    await member.roles.add(role, 'Soutien - statut detecte').catch(err => {
      addOk = false;
      dbg('addRole FAIL', { guildId: guild.id, userId: member.id, err: err.message });
      errorHandler.handle(err, {
        source  : 'presenceUpdate.soutien.addRole',
        guildId : guild.id,
        userId  : member.id,
      });
    });
    if (addOk) dbg('addRole OK', { guildId: guild.id, userId: member.id });
    db.grantSoutienRoleTracking(guild.id, member.id);
    db.markSoutienStatusValid(guild.id, member.id);
    return;
  }

  if (shouldHaveRole && hasRole) {

    db.markSoutienStatusValid(guild.id, member.id);
    dbg('no-op : deja role + match', { guildId: guild.id, userId: member.id });
    return;
  }

  if (!shouldHaveRole && hasRole) {


    if (mode === 'both') {
      const pg = member.user?.primaryGuild;
      const expectedTag = String(config.soutienTag || '').trim().toLowerCase();
      const userTag     = String(pg?.tag || '').trim().toLowerCase();
      if (pg?.identityEnabled && expectedTag && userTag === expectedTag) {
        dbg('skip remove en mode both : tag matche encore', { guildId: guild.id, userId: member.id });
        db.clearSoutienStatusValid(guild.id, member.id);
        return;
      }
    }

    soutienAutoRemovals.mark(guild.id, member.id, role.id);
    await member.roles.remove(role, 'Soutien - statut retire').catch(err => {
      dbg('removeRole FAIL', { guildId: guild.id, userId: member.id, err: err.message });
      errorHandler.handle(err, {
        source  : 'presenceUpdate.soutien.removeRole',
        guildId : guild.id,
        userId  : member.id,
      });
    });
    dbg('removeRole tente', { guildId: guild.id, userId: member.id });
    db.revokeSoutienRoleTracking(guild.id, member.id);
    db.clearSoutienStatusValid(guild.id, member.id);
    db.removeSoutienManualIgnore(guild.id, member.id, role.id);
  }

  if (!shouldHaveRole && !hasRole) {

    db.clearSoutienStatusValid(guild.id, member.id);
  }
}

function _getCustomStatusText(presence) {
  const custom = presence?.activities?.find(activity =>
    activity.type === ActivityType.Custom
  );
  if (!custom) return '';
  return [
    custom.state,
    custom.name,
  ]
    .filter(Boolean)
    .join(' ');
}
