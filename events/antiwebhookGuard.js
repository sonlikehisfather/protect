'use strict';


const { AuditLogEvent } = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const perms        = require('../utils/permissions');
const errorHandler = require('../utils/errorHandler');
const core         = require('../utils/antiraidCore');

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

      const createLogs = await core.fetchRecentAudit(guild, AuditLogEvent.WebhookCreate);

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

        if (core.isExempt(executorId, guildId, executorMember)) return;

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

      const updateLogs = await core.fetchRecentAudit(guild, AuditLogEvent.WebhookUpdate);

      const updateEntry = updateLogs
        ? findByChannel(updateLogs.entries)
        : null;

      if (updateEntry?.executor) {
        const executorId = updateEntry.executor.id;
        if (executorId === client.user.id) return;

        const executorMember =
          guild.members.cache.get(executorId) ??
          await guild.members.fetch(executorId).catch(() => null);

        if (core.isExempt(executorId, guildId, executorMember)) return;

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

      const deleteLogs = await core.fetchRecentAudit(guild, AuditLogEvent.WebhookDelete);

      const deleteEntry = deleteLogs
        ? findByChannel(deleteLogs.entries)
        : null;

      if (deleteEntry?.executor) {
        const executorId = deleteEntry.executor.id;
        if (executorId === client.user.id) return;

        const executorMember =
          guild.members.cache.get(executorId) ??
          await guild.members.fetch(executorId).catch(() => null);

        if (core.isExempt(executorId, guildId, executorMember)) return;

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
  return core.punish(client, guild, userId, punishment, source);
}
