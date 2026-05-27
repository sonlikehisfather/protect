'use strict';


const { AuditLogEvent } = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const perms        = require('../utils/permissions');
const errorHandler = require('../utils/errorHandler');

const unbanMap = new Map();


const AUDIT_WAIT_MS    = 1000;
const AUDIT_MAX_AGE_MS = 8000;
const DEDUPE_MS        = 5000;

module.exports = {
  name : 'guildBanRemove',
  once : false,

  async execute(client, ban) {
    const guild   = ban.guild;
    const guildId = guild.id;

    try {
      const config      = db.getAntiraidConfig(guildId);
      const guildConfig = db.getGuildConfig(guildId);

      if (!guildConfig?.antiraidEnabled || !config?.antiunbanEnabled) return;

      await new Promise(res => setTimeout(res, AUDIT_WAIT_MS));

      const fetched = await guild.fetchAuditLogs({
        type  : AuditLogEvent.MemberBanRemove,
        limit : 5,
      }).catch(() => null);

      if (!fetched) return;

      const now = Date.now();

      const entry = [...fetched.entries.values()].find(e =>
        e.target?.id === ban.user.id &&
        now - e.createdTimestamp < AUDIT_MAX_AGE_MS
      );

      if (!entry?.executor) return;

      const executorId = entry.executor.id;

      if (executorId === client.user.id) return;

      const executorMember =
        guild.members.cache.get(executorId) ??
        await guild.members.fetch(executorId).catch(() => null);

      if (perms.isProtected(executorId, guildId, executorMember)) return;

      const key     = `${guildId}_${executorId}_${ban.user.id}`;
      const lastHit = unbanMap.get(key);

      if (lastHit && now - lastHit < DEDUPE_MS) {
        return;
      }

      unbanMap.set(key, now);

      setTimeout(() => {
        const state = unbanMap.get(key);
        if (state !== now) return;
        unbanMap.delete(key);
      }, DEDUPE_MS + 1000);

      const punishment = config.antiunbanPunish ?? 'derank';

      await _applyPunishment(client, guild, executorId, punishment, 'antiunban');

      const e = embed.log(guildId, 'Antiunban déclenché', [
        {
          name   : 'Exécuteur',
          value  : `<@${executorId}> (${entry.executor.tag})`,
          inline : true,
        },
        {
          name   : 'Cible débannie',
          value  : `<@${ban.user.id}> (${ban.user.tag}) \`${ban.user.id}\``,
          inline : false,
        },
        {
          name   : 'Action',
          value  : punishment,
          inline : true,
        },
      ], {
        thumbnail : entry.executor.displayAvatarURL({ dynamic: true }),
      });

      await logger.send(client, guildId, 'raidlog', e);

    } catch (err) {
      errorHandler.handle(err, {
        source : 'antiunbanGuard',
        guildId,
      });
    }
  },
};

async function _applyPunishment(client, guild, userId, punishment, source) {
  const guildId = guild.id;
  const member  = await guild.members.fetch(userId).catch(() => null);

  switch (punishment) {
    case 'warn':
      db.addSanction(guildId, userId, client.user.id, 'warn', `Antiraid - ${source}`);
      break;

    case 'mute':
      if (member) {
        await member.timeout(10 * 60 * 1000, `Antiraid - ${source}`).catch(() => {});
      }
      db.addSanction(guildId, userId, client.user.id, 'mute', `Antiraid - ${source}`, 600);
      break;

    case 'kick':
      if (member) {
        await member.kick(`Antiraid - ${source}`).catch(() => {});
      }
      db.addSanction(guildId, userId, client.user.id, 'kick', `Antiraid - ${source}`);
      break;

    case 'ban':
      await guild.members.ban(userId, { reason: `Antiraid - ${source}` }).catch(() => {});
      db.addSanction(guildId, userId, client.user.id, 'ban', `Antiraid - ${source}`);
      break;

    case 'derank':
    default:
      if (member) {
        const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        const keepRoles = new Set(db.getNoderankRoles(guildId));
        const rolesToRemove = member.roles.cache
          .filter(role => role.id !== guild.id && !keepRoles.has(role.id) && !role.managed && (!me || me.roles.highest.comparePositionTo(role) > 0))
          .map(role => role.id);

        if (rolesToRemove.length) {
          const deranked = await member.roles
            .remove(rolesToRemove, `Antiraid - ${source}`)
            .then(() => true)
            .catch(() => false);

          if (deranked) {
            db.addSanction(guildId, userId, client.user.id, 'derank', `Antiraid - ${source}`);
          }
        }
      }
      break;
  }
}
