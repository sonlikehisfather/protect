'use strict';


const { PermissionsBitField } = require('discord.js');
const db                  = require('../core/database');
const errorHandler        = require('../utils/errorHandler');
const soutienAutoRemovals = require('../utils/soutienAutoRemovals');

const DEBUG_SOUTIEN = process.env.DEBUG_SOUTIEN === 'true' || process.env.DEBUG_SOUTIEN === '1';
const dbg = (...a) => { if (DEBUG_SOUTIEN) console.log('[soutien:userUpdate]', ...a); };

module.exports = {
  name : 'userUpdate',
  once : false,

  async execute(client, oldUser, newUser) {
    try {
      const primaryGuild = newUser?.primaryGuild;
      if (!primaryGuild) {
        dbg('event recu, mais primaryGuild absent', { userId: newUser?.id });
        return;
      }


      const oldPrimary      = oldUser?.primaryGuild;
      const tagChanged      = oldPrimary?.tag             !== primaryGuild.tag;
      const badgeChanged    = oldPrimary?.badge           !== primaryGuild.badge;
      const identityChanged = oldPrimary?.identityEnabled !== primaryGuild.identityEnabled;
      if (!tagChanged && !badgeChanged && !identityChanged) {
        dbg('event recu, aucun changement tag/badge/identity', { userId: newUser?.id });
        return;
      }

      dbg('event recu', {
        userId       : newUser.id,
        oldTag       : oldPrimary?.tag ?? null,
        newTag       : primaryGuild.tag ?? null,
        identityEnabled: primaryGuild.identityEnabled,
      });

      for (const guild of client.guilds.cache.values()) {
        const config = db.getGuildConfig(guild.id);

        if (!Number(config?.soutienEnabled)) {
          dbg('skip guild : soutien desactive', { guildId: guild.id });
          continue;
        }
        const mode = config?.soutienMode || 'status';
        if (mode !== 'tag' && mode !== 'both') {
          dbg('skip guild : mode ne traite pas le tag', { guildId: guild.id, mode });
          continue;
        }
        if (!config?.soutienRoleId) {
          dbg('skip guild : aucun role configure', { guildId: guild.id });
          continue;
        }
        if (!config?.soutienTag) {
          dbg('skip guild : aucun tag attendu configure', { guildId: guild.id, mode });
          continue;
        }

        await _syncSoutienTag(guild, newUser, primaryGuild, config);
      }
    } catch (err) {
      errorHandler.handle(err, {
        source : 'userUpdate.soutien',
        userId : newUser?.id,
      });
    }
  },
};

async function _syncSoutienTag(guild, user, primaryGuild, config) {
  const mode = config.soutienMode || 'status';

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    dbg('skip : membre introuvable dans la guild', { guildId: guild.id, userId: user.id });
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
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    dbg('skip : missing ManageRoles', { guildId: guild.id });
    return;
  }
  if (role.position >= me.roles.highest.position) {
    dbg('skip : role hierarchy', { guildId: guild.id, rolePos: role.position, mePos: me.roles.highest.position });
    return;
  }

  const expectedTag   = String(config.soutienTag   || '').trim().toLowerCase();
  const expectedBadge = String(config.soutienBadge || '').trim().toLowerCase();

  const userTag   = String(primaryGuild.tag   || '').trim().toLowerCase();
  const userBadge = String(primaryGuild.badge || '').trim().toLowerCase();

  const tagMatch = expectedTag && userTag === expectedTag;

  const badgeMatch = expectedBadge ? userBadge === expectedBadge : true;

  const shouldHaveRole = Boolean(
    primaryGuild.identityEnabled &&
    tagMatch &&
    badgeMatch
  );

  const hasRole = member.roles.cache.has(role.id);

  dbg('evaluation tag', {
    guildId        : guild.id,
    userId         : user.id,
    mode,
    expectedTag,
    userTag,
    badgeMatch,
    identityEnabled: primaryGuild.identityEnabled,
    shouldHaveRole,
    hasRole,
  });

  if (shouldHaveRole && !hasRole) {
    if (db.isSoutienManualIgnored(guild.id, user.id, role.id)) {
      dbg('skip add : manualIgnored', { guildId: guild.id, userId: user.id });
      db.markSoutienTagValid(guild.id, user.id);
      return;
    }

    let addOk = true;
    await member.roles.add(role, 'Soutien - tag de guilde detecte').catch(e => {
      addOk = false;
      dbg('addRole FAIL', { guildId: guild.id, userId: user.id, err: e.message });
      errorHandler.handle(e, { source: 'userUpdate.soutien.addRole', guildId: guild.id, userId: user.id });
    });
    if (addOk) dbg('addRole OK', { guildId: guild.id, userId: user.id });
    db.grantSoutienRoleTracking(guild.id, user.id);
    db.markSoutienTagValid(guild.id, user.id);
    return;
  }

  if (shouldHaveRole && hasRole) {

    db.markSoutienTagValid(guild.id, user.id);
    dbg('no-op : deja role + match', { guildId: guild.id, userId: user.id });
    return;
  }

  if (!shouldHaveRole && hasRole) {


    if (mode === 'both') {
      dbg('skip remove en mode both : delegue a presenceUpdate / sync', { guildId: guild.id, userId: user.id });
      db.clearSoutienTagValid(guild.id, user.id);
      return;
    }

    soutienAutoRemovals.mark(guild.id, user.id, role.id);
    await member.roles.remove(role, 'Soutien - tag de guilde retire').catch(e => {
      dbg('removeRole FAIL', { guildId: guild.id, userId: user.id, err: e.message });
      errorHandler.handle(e, { source: 'userUpdate.soutien.removeRole', guildId: guild.id, userId: user.id });
    });
    dbg('removeRole tente', { guildId: guild.id, userId: user.id });
    db.revokeSoutienRoleTracking(guild.id, user.id);
    db.clearSoutienTagValid(guild.id, user.id);
    db.removeSoutienManualIgnore(guild.id, user.id, role.id);
  }

  if (!shouldHaveRole && !hasRole) {
    db.clearSoutienTagValid(guild.id, user.id);
    dbg('no-op : aucun match aucun role', { guildId: guild.id, userId: user.id });
  }
}
