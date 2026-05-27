'use strict';


const { AuditLogEvent } = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const perms        = require('../utils/permissions');
const errorHandler = require('../utils/errorHandler');

const recentWebhookActions = new Map();


module.exports = {
  name: 'webhooksUpdate',
  once: false,

  async execute(client, channel) {
    const guild = channel.guild;
    if (!guild) return;

    const guildId = guild.id;

    try {
      const config      = db.getAntiraidConfig(guildId);
      const guildConfig = db.getGuildConfig(guildId);

      if (!guildConfig?.antiraidEnabled || !config?.antiwebhookEnabled) return;

      await new Promise(res => setTimeout(res, 1000));

      const punishment = config.antiwebhookPunish ?? 'derank';
      const now        = Date.now();

      const findByChannel = (entries) => entries.find(e =>
        e.extra?.channel?.id === channel.id &&
        now - e.createdTimestamp < 12_000
      );

      const createLogs = await guild.fetchAuditLogs({
        type  : AuditLogEvent.WebhookCreate,
        limit : 5,
      }).catch(() => null);

      const createEntry = createLogs
        ? [...createLogs.entries.values()].find(e =>
            now - e.createdTimestamp < 15_000
          )
        : null;

      if (createEntry?.executor) {
        const executorId = createEntry.executor.id;
        if (executorId === client.user.id) return;

        const executorMember =
          guild.members.cache.get(executorId) ??
          await guild.members.fetch(executorId).catch(() => null);

        if (perms.isProtected(executorId, guildId, executorMember)) return;

        const dedupeKey = `${guildId}_${createEntry.target?.id ?? 'unknown'}`;
        const lastHit = recentWebhookActions.get(dedupeKey);

        if (lastHit && now - lastHit < 5000) {
          return;
        }

        recentWebhookActions.set(dedupeKey, now);
        setTimeout(() => {
          recentWebhookActions.delete(dedupeKey);
        }, 5000);

        const webhooks = await channel.fetchWebhooks().catch(() => null);
        let deleted = 0;

        if (webhooks) {
          for (const webhook of webhooks.values()) {
            if (Date.now() - webhook.createdTimestamp < 60_000) {
              await webhook.delete('Antiwebhook - création abusive').then(() => {
                deleted++;
              }).catch(() => {});
            }
          }
        }

        await _applyPunishment(client, guild, executorId, punishment, 'antiwebhook-create');

        const e = embed.log(guildId, 'Antiwebhook - création', [
          {
            name   : 'Exécuteur',
            value  : `<@${executorId}> (${createEntry.executor.tag})`,
            inline : true,
          },
          {
            name   : 'Salon',
            value  : `<#${channel.id}>`,
            inline : true,
          },
          {
            name   : 'Webhooks supprimés',
            value  : String(deleted),
            inline : true,
          },
          {
            name   : 'Action',
            value  : punishment,
            inline : true,
          },
        ], {
          thumbnail: createEntry.executor.displayAvatarURL({ dynamic: true }),
        });

        await logger.send(client, guildId, 'raidlog', e);
        return;
      }

      const updateLogs = await guild.fetchAuditLogs({
        type  : AuditLogEvent.WebhookUpdate,
        limit : 5,
      }).catch(() => null);

      const updateEntry = updateLogs
        ? findByChannel(updateLogs.entries)
        : null;

      if (updateEntry?.executor) {
        const executorId = updateEntry.executor.id;
        if (executorId === client.user.id) return;

        const executorMember =
          guild.members.cache.get(executorId) ??
          await guild.members.fetch(executorId).catch(() => null);

        if (perms.isProtected(executorId, guildId, executorMember)) return;

        const dedupeKey = `${guildId}_${updateEntry.target?.id ?? 'unknown'}_update`;
        const lastHit = recentWebhookActions.get(dedupeKey);

        if (lastHit && now - lastHit < 5000) {
          return;
        }

        recentWebhookActions.set(dedupeKey, now);
        setTimeout(() => {
          recentWebhookActions.delete(dedupeKey);
        }, 5000);

        await _applyPunishment(client, guild, executorId, punishment, 'antiwebhook-update');

        const e = embed.log(guildId, 'Antiwebhook - modification', [
          {
            name   : 'Exécuteur',
            value  : `<@${executorId}> (${updateEntry.executor.tag})`,
            inline : true,
          },
          {
            name   : 'Salon',
            value  : `<#${channel.id}>`,
            inline : true,
          },
          {
            name   : 'Action',
            value  : punishment,
            inline : true,
          },
        ], {
          thumbnail: updateEntry.executor.displayAvatarURL({ dynamic: true }),
        });

        await logger.send(client, guildId, 'raidlog', e);
        return;
      }

      const deleteLogs = await guild.fetchAuditLogs({
        type  : AuditLogEvent.WebhookDelete,
        limit : 5,
      }).catch(() => null);

      const deleteEntry = deleteLogs
        ? findByChannel(deleteLogs.entries)
        : null;

      if (deleteEntry?.executor) {
        const executorId = deleteEntry.executor.id;
        if (executorId === client.user.id) return;

        const executorMember =
          guild.members.cache.get(executorId) ??
          await guild.members.fetch(executorId).catch(() => null);

        if (perms.isProtected(executorId, guildId, executorMember)) return;

        const dedupeKey = `${guildId}_${deleteEntry.target?.id ?? 'unknown'}_delete`;
        const lastHit = recentWebhookActions.get(dedupeKey);

        if (lastHit && now - lastHit < 5000) {
          return;
        }

        recentWebhookActions.set(dedupeKey, now);
        setTimeout(() => {
          recentWebhookActions.delete(dedupeKey);
        }, 5000);

        await _applyPunishment(client, guild, executorId, punishment, 'antiwebhook-delete');

        const e = embed.log(guildId, 'Antiwebhook - suppression', [
          {
            name   : 'Exécuteur',
            value  : `<@${executorId}> (${deleteEntry.executor.tag})`,
            inline : true,
          },
          {
            name   : 'Salon',
            value  : `<#${channel.id}>`,
            inline : true,
          },
          {
            name   : 'Action',
            value  : punishment,
            inline : true,
          },
        ], {
          thumbnail: deleteEntry.executor.displayAvatarURL({ dynamic: true }),
        });

        await logger.send(client, guildId, 'raidlog', e);
        return;
      }

    } catch (err) {
      errorHandler.handle(err, {
        source : 'antiwebhookGuard',
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
          .filter(r => r.id !== guild.id && !keepRoles.has(r.id) && !r.managed && (!me || me.roles.highest.comparePositionTo(r) > 0))
          .map(r => r.id);

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
