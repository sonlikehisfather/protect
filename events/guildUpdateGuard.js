'use strict';


const { AuditLogEvent } = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const perms        = require('../utils/permissions');
const errorHandler = require('../utils/errorHandler');

const recentGuildActions = new Map();


const DEDUPE_WINDOW_MS   = 5000;
const ACTION_WINDOW_MS   = 10000;
const ACTION_THRESHOLD   = 3;
const AUDIT_WAIT_MS      = 1000;
const AUDIT_MAX_AGE_MS   = 15000;

module.exports = {
  name: 'guildUpdate',
  once: false,

  async execute(client, oldGuild, newGuild) {
    const guild = newGuild;
    if (!guild) return;

    const guildId = guild.id;

    try {
      const config      = db.getAntiraidConfig(guildId);
      const guildConfig = db.getGuildConfig(guildId);

      if (!guildConfig?.antiraidEnabled) return;

      const antiupdateOn = !!config?.antiupdateEnabled;
      const antivanityOn = !!config?.antivanityEnabled;
      if (!antiupdateOn && !antivanityOn) return;

      const changedFields = _getChangedFields(oldGuild, newGuild);
      const vanityChanged = oldGuild.vanityURLCode !== newGuild.vanityURLCode;

      if (!changedFields.length && !vanityChanged) return;

      await new Promise(res => setTimeout(res, AUDIT_WAIT_MS));

      const now = Date.now();

      const logs = await guild.fetchAuditLogs({
        type  : AuditLogEvent.GuildUpdate,
        limit : 5,
      }).catch(() => null);

      if (!logs) return;

      const entry = [...logs.entries.values()].find(e =>
        e.target?.id === guildId &&
        now - e.createdTimestamp < AUDIT_MAX_AGE_MS
      );

      if (!entry?.executor) return;

      const executorId = entry.executor.id;
      if (executorId === client.user.id) return;

      const executorMember =
        guild.members.cache.get(executorId) ??
        await guild.members.fetch(executorId).catch(() => null);

      if (perms.isProtected(executorId, guildId, executorMember)) return;


      if (vanityChanged && antivanityOn) {
        const oldVanity = oldGuild.vanityURLCode;
        const punishment = config.antivanityPunish ?? 'derank';


        const restoreOk = await guild.setVanityCode(oldVanity ?? null)
          .then(() => true)
          .catch(() => false);

        await _applyPunishment(client, guild, executorId, punishment, 'vanity-update');

        const e = embed.log(guildId, 'Antiraid - Vanity URL modifiée', [
          {
            name   : 'Exécuteur',
            value  : `<@${executorId}> (${entry.executor.tag})`,
            inline : true,
          },
          {
            name   : 'Action',
            value  : punishment,
            inline : true,
          },
          {
            name   : 'Ancienne vanity',
            value  : oldVanity || 'Aucun',
            inline : true,
          },
          {
            name   : 'Nouvelle vanity',
            value  : newGuild.vanityURLCode || 'Aucun',
            inline : true,
          },
          {
            name   : 'Restauration',
            value  : restoreOk ? 'Réussie' : 'Échouée',
            inline : true,
          },
        ], {
          thumbnail: entry.executor.displayAvatarURL({ dynamic: true }),
        });

        await logger.send(client, guildId, 'raidlog', e);
        return;
      }

      if (!antiupdateOn || !changedFields.length) return;

      const changesKey = changedFields.join('|');
      const memoryKey  = `${guildId}_${executorId}`;
      const state      = recentGuildActions.get(memoryKey);

      if (state && state.lastChangesKey === changesKey && now - state.firstAt < DEDUPE_WINDOW_MS) {
        return;
      }

      if (!state || now - state.firstAt > ACTION_WINDOW_MS) {
        recentGuildActions.set(memoryKey, {
          count          : 1,
          firstAt        : now,
          lastChangesKey : changesKey,
        });

        _scheduleCleanup(memoryKey, now);
        return;
      }

      state.count += 1;
      state.lastChangesKey = changesKey;
      recentGuildActions.set(memoryKey, state);

      if (state.count < ACTION_THRESHOLD) {
        return;
      }

      recentGuildActions.delete(memoryKey);

      const punishment = config.antiupdatePunish ?? 'derank';

      await _applyPunishment(client, guild, executorId, punishment, 'guild-update');

      const displayedChanges = changedFields
        .slice(0, 10)
        .map(field => `- ${field}`)
        .join('\n');

      const e = embed.log(guildId, 'Antiraid - modification du serveur', [
        {
          name   : 'Exécuteur',
          value  : `<@${executorId}> (${entry.executor.tag})`,
          inline : true,
        },
        {
          name   : 'Action',
          value  : punishment,
          inline : true,
        },
        {
          name   : 'Détection',
          value  : `${ACTION_THRESHOLD} actions en ${Math.floor(ACTION_WINDOW_MS / 1000)}s`,
          inline : true,
        },
        {
          name   : 'Changements détectés',
          value  : displayedChanges || '- Inconnu',
          inline : false,
        },
      ], {
        thumbnail: entry.executor.displayAvatarURL({ dynamic: true }),
      });

      await logger.send(client, guildId, 'raidlog', e);

    } catch (err) {
      errorHandler.handle(err, {
        source : 'guildUpdateGuard',
        guildId,
      });
    }
  },
};

function _scheduleCleanup(key, createdAt) {
  setTimeout(() => {
    const state = recentGuildActions.get(key);
    if (!state) return;
    if (state.firstAt !== createdAt) return;
    recentGuildActions.delete(key);
  }, ACTION_WINDOW_MS + 1000);
}

function _getChangedFields(oldGuild, newGuild) {
  const changes = [];

  if (oldGuild.name !== newGuild.name) {
    changes.push(`Nom : ${_fmt(oldGuild.name)} -> ${_fmt(newGuild.name)}`);
  }

  if (oldGuild.icon !== newGuild.icon) {
    changes.push('Icône du serveur modifiée');
  }

  if (oldGuild.banner !== newGuild.banner) {
    changes.push('Bannière du serveur modifiée');
  }

  if (oldGuild.splash !== newGuild.splash) {
    changes.push('Splash du serveur modifié');
  }

  if (oldGuild.discoverySplash !== newGuild.discoverySplash) {
    changes.push('Discovery splash modifié');
  }

  if (oldGuild.description !== newGuild.description) {
    changes.push(`Description : ${_fmt(oldGuild.description)} -> ${_fmt(newGuild.description)}`);
  }


  if (oldGuild.preferredLocale !== newGuild.preferredLocale) {
    changes.push(`Locale : ${_fmt(oldGuild.preferredLocale)} -> ${_fmt(newGuild.preferredLocale)}`);
  }

  if (oldGuild.afkTimeout !== newGuild.afkTimeout) {
    changes.push(`AFK timeout : ${_fmt(oldGuild.afkTimeout)} -> ${_fmt(newGuild.afkTimeout)}`);
  }

  if (oldGuild.afkChannelId !== newGuild.afkChannelId) {
    changes.push(`Salon AFK : ${_fmtChannel(oldGuild.afkChannelId)} -> ${_fmtChannel(newGuild.afkChannelId)}`);
  }

  if (oldGuild.systemChannelId !== newGuild.systemChannelId) {
    changes.push(`Salon système : ${_fmtChannel(oldGuild.systemChannelId)} -> ${_fmtChannel(newGuild.systemChannelId)}`);
  }

  if (oldGuild.rulesChannelId !== newGuild.rulesChannelId) {
    changes.push(`Salon règles : ${_fmtChannel(oldGuild.rulesChannelId)} -> ${_fmtChannel(newGuild.rulesChannelId)}`);
  }

  if (oldGuild.publicUpdatesChannelId !== newGuild.publicUpdatesChannelId) {
    changes.push(`Salon annonces : ${_fmtChannel(oldGuild.publicUpdatesChannelId)} -> ${_fmtChannel(newGuild.publicUpdatesChannelId)}`);
  }

  if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
    changes.push(`Niveau de vérification : ${_fmt(oldGuild.verificationLevel)} -> ${_fmt(newGuild.verificationLevel)}`);
  }

  if (oldGuild.defaultMessageNotifications !== newGuild.defaultMessageNotifications) {
    changes.push(`Notifications par défaut : ${_fmt(oldGuild.defaultMessageNotifications)} -> ${_fmt(newGuild.defaultMessageNotifications)}`);
  }

  if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) {
    changes.push(`Filtre de contenu : ${_fmt(oldGuild.explicitContentFilter)} -> ${_fmt(newGuild.explicitContentFilter)}`);
  }

  if (oldGuild.mfaLevel !== newGuild.mfaLevel) {
    changes.push(`Niveau MFA : ${_fmt(oldGuild.mfaLevel)} -> ${_fmt(newGuild.mfaLevel)}`);
  }

  return changes;
}

function _fmt(value) {
  if (value === null || value === undefined || value === '') return 'Aucun';

  const str = String(value);
  if (str.length > 120) {
    return `${str.slice(0, 117)}...`;
  }

  return str;
}

function _fmtChannel(channelId) {
  return channelId ? `<#${channelId}>` : 'Aucun';
}

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
