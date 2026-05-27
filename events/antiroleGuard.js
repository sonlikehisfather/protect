'use strict';


const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const perms        = require('../utils/permissions');
const errorHandler = require('../utils/errorHandler');

const roleMap = new Map();


const AUDIT_WAIT_MS    = 1000;
const AUDIT_MAX_AGE_MS = 8000;

const DANGEROUS_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageMessages,
];

module.exports = {
  name: 'guildMemberUpdate',
  once: false,

  async execute(client, oldMember, newMember) {
    const guild   = newMember.guild;
    const guildId = guild.id;

    try {
      const config      = db.getAntiraidConfig(guildId);
      const guildConfig = db.getGuildConfig(guildId);

      if (!guildConfig?.antiraidEnabled || !config?.antiroleEnabled) return;

      const addedRoles = newMember.roles.cache.filter(role =>
        !oldMember.roles.cache.has(role.id) &&
        role.id !== guild.id
      );

      if (!addedRoles.size) return;

      const antiroleMode = String(config.antiroleMode ?? 'danger').toLowerCase();

      let watchedRoles = addedRoles;

      if (antiroleMode === 'danger') {
        watchedRoles = addedRoles.filter(role => _isDangerousRole(role));
      } else if (antiroleMode === 'all') {
        watchedRoles = addedRoles;
      } else {
        watchedRoles = addedRoles.filter(role => _isDangerousRole(role));
      }

      if (!watchedRoles.size) return;

      await new Promise(res => setTimeout(res, AUDIT_WAIT_MS));

      const fetched = await guild.fetchAuditLogs({
        type  : AuditLogEvent.MemberRoleUpdate,
        limit : 5,
      }).catch(() => null);

      if (!fetched) return;

      const now = Date.now();

      const entry = [...fetched.entries.values()].find(e =>
        e.target?.id === newMember.id &&
        now - e.createdTimestamp < AUDIT_MAX_AGE_MS
      );

      if (!entry?.executor) return;

      const executorId = entry.executor.id;

      if (executorId === client.user.id) return;

      const executorMember =
        guild.members.cache.get(executorId) ??
        await guild.members.fetch(executorId).catch(() => null);

      if (perms.isProtected(executorId, guildId, executorMember)) return;

      const configuredThreshold = Math.max(1, config.antiroleThreshold ?? 3);
      const threshold = antiroleMode === 'all'
        ? 1
        : Math.max(2, configuredThreshold);

      const windowMs = Math.max(1000, (config.antiroleWindow ?? 10) * 1000);

      const watchedRoleIds = [...watchedRoles.keys()].sort();
      const roleIdsKey     = watchedRoleIds.join(',');
      const key            = `${guildId}_${executorId}`;
      const current        = roleMap.get(key);

      if (
        current &&
        current.lastTargetId === newMember.id &&
        current.lastRoleIdsKey === roleIdsKey &&
        now - current.firstAt < 3000
      ) {
        return;
      }

      if (!current || now - current.firstAt > windowMs) {
        roleMap.set(key, {
          count          : 1,
          firstAt        : now,
          lastTargetId   : newMember.id,
          lastRoleIdsKey : roleIdsKey,
        });

        setTimeout(() => {
          const state = roleMap.get(key);
          if (!state) return;
          if (state.firstAt !== now) return;
          roleMap.delete(key);
        }, windowMs + 1000);

        if (threshold > 1) {
          return;
        }
      } else {
        current.count += 1;
        current.lastTargetId   = newMember.id;
        current.lastRoleIdsKey = roleIdsKey;
        roleMap.set(key, current);

        if (current.count < threshold) {
          return;
        }
      }

      const state = roleMap.get(key);
      const reachedCount = state?.count ?? 1;

      roleMap.delete(key);

      for (const role of watchedRoles.values()) {
        if (newMember.roles.cache.has(role.id)) {
          await newMember.roles.remove(
            role.id,
            'Antiraid - antirole suppression rôle ajouté'
          ).catch(() => {});
        }
      }

      const punishment = config.antirolePunish ?? 'derank';

      await _applyPunishment(
        client,
        guild,
        executorId,
        punishment,
        'antirole'
      );

      const e = embed.log(guildId, 'Antirole déclenché', [
        {
          name   : 'Exécuteur',
          value  : `<@${executorId}> (${entry.executor.tag})`,
          inline : true,
        },
        {
          name   : 'Cible',
          value  : `<@${newMember.id}> (${newMember.user.tag})`,
          inline : true,
        },
        {
          name   : 'Mode',
          value  : antiroleMode,
          inline : true,
        },
        {
          name   : 'Rôle(x) surveillé(s) ajouté(s)',
          value  : watchedRoles.map(role => `<@&${role.id}>`).join(', '),
          inline : false,
        },
        {
          name   : 'Détection',
          value  : `${reachedCount} action(s) en ${Math.floor(windowMs / 1000)}s`,
          inline : true,
        },
        {
          name   : 'Action',
          value  : punishment,
          inline : true,
        },
      ], {
        thumbnail: entry.executor.displayAvatarURL({ dynamic: true }),
      });

      await logger.send(client, guildId, 'raidlog', e);

    } catch (err) {
      errorHandler.handle(err, {
        source : 'antiroleGuard',
        guildId,
      });
    }
  },
};

function _isDangerousRole(role) {
  return DANGEROUS_PERMISSIONS.some(permission =>
    role.permissions.has(permission)
  );
}

async function _applyPunishment(client, guild, userId, punishment, source) {
  const guildId = guild.id;

  const member = await guild.members
    .fetch(userId)
    .catch(() => null);

  switch (punishment) {
    case 'warn':
      db.addSanction(
        guildId,
        userId,
        client.user.id,
        'warn',
        `Antiraid - ${source}`
      );
      break;

    case 'mute':
      if (member) {
        await member.timeout(
          10 * 60 * 1000,
          `Antiraid - ${source}`
        ).catch(() => {});
      }

      db.addSanction(
        guildId,
        userId,
        client.user.id,
        'mute',
        `Antiraid - ${source}`,
        600
      );
      break;

    case 'kick':
      if (member) {
        await member.kick(
          `Antiraid - ${source}`
        ).catch(() => {});
      }

      db.addSanction(
        guildId,
        userId,
        client.user.id,
        'kick',
        `Antiraid - ${source}`
      );
      break;

    case 'ban':
      await guild.members
        .ban(userId, {
          reason: `Antiraid - ${source}`,
        })
        .catch(() => {});

      db.addSanction(
        guildId,
        userId,
        client.user.id,
        'ban',
        `Antiraid - ${source}`
      );
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
            .remove(
              rolesToRemove,
              `Antiraid - ${source}`
            )
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
