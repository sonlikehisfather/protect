'use strict';


const { PermissionsBitField, AuditLogEvent } = require('discord.js');
const db            = require('../core/database');
const embed         = require('../utils/embed');
const logger        = require('../utils/logger');
const perms         = require('../utils/permissions');
const errorHandler  = require('../utils/errorHandler');
const welcomeSender = require('../utils/welcomeSender');
const inviteTracker = require('../utils/inviteTracker');

module.exports = {
  name : 'guildMemberAdd',
  once : false,

  async execute(client, member) {
    const { guild } = member;
    const guildId   = guild.id;

    try {
      const config = db.getGuildConfig(guildId);

      if (db.isBlacklisted(member.user.id)) {
        const entry = db.getBlacklistEntry(member.user.id);

        const reason = entry?.reason
          ? `Blacklist globale - ${entry.reason}`
          : 'Blacklist globale';

        await member.ban({ reason }).catch(() => {});
        return;
      }

      if (config.antiraidEnabled) {
        const antiraidConfig = db.getAntiraidConfig(guildId);

        if (antiraidConfig.antibotEnabled && member.user.bot) {

          const executorUser = await _findBotAddExecutor(guild, member.id);
          if (executorUser) {
            const executorMember = guild.members.cache.get(executorUser.id)
              ?? await guild.members.fetch(executorUser.id).catch(() => null);
            if (perms.isProtected(executorUser.id, guildId, executorMember)) {

              return;
            }
          }

          const punish = antiraidConfig.antibotPunish || 'kick';
          let actionDone = null;

          try {
            if (punish === 'ban') {
              await member.ban({ reason: 'Antibot - bot non autorisé' });
              actionDone = 'ban';
            } else {
              await member.kick('Antibot - bot non autorisé');
              actionDone = 'kick';
            }
          } catch {
            if (punish === 'ban' && !actionDone) {
              try {
                await member.kick('Antibot - bot non autorisé (fallback)');
                actionDone = 'kick';
              } catch {}
            }
          }

          if (actionDone) {
            try {
              const e = embed.log(guildId, 'Antibot activé', [
                {
                  name   : 'Bot',
                  value  : `<@${member.id}> (${member.user.tag}) \`${member.id}\``,
                  inline : true,
                },
                {
                  name   : 'Ajouté par',
                  value  : executorUser
                    ? `<@${executorUser.id}> (${executorUser.tag}) \`${executorUser.id}\``
                    : 'Inconnu',
                  inline : true,
                },
                {
                  name   : 'Action',
                  value  : actionDone,
                  inline : true,
                },
              ]);

              await logger.send(client, guildId, 'raidlog', e);
            } catch (err) {
              errorHandler.handle(err, {
                source : 'antibot',
                guildId,
              });
            }
          }

          return;
        }
      }

      if (config.antiraidEnabled) {
        const antiraidConfig = db.getAntiraidConfig(guildId);
        const creationLimit  = Number(antiraidConfig?.creationLimit) || 0;

        if (creationLimit > 0) {
          const accountAge = Math.floor(
            (Date.now() - member.user.createdTimestamp) / 1000
          );

          if (accountAge < creationLimit) {
            if (perms.isProtected(member.id, guildId, member)) return;

            const punishment = antiraidConfig.creationLimitPunish || 'kick';

            try {
              await _applyCreationLimitPunishment(client, guild, member, punishment);

              const e = embed.log(guildId, 'Creation limit déclenché', [
                {
                  name   : 'Membre',
                  value  : `<@${member.id}> (${member.user.tag}) \`${member.id}\``,
                  inline : true,
                },
                {
                  name   : 'Compte créé',
                  value  : `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
                  inline : true,
                },
                {
                  name   : 'Limite requise',
                  value  : _formatDuration(creationLimit),
                  inline : true,
                },
                {
                  name   : 'Action',
                  value  : punishment,
                  inline : true,
                },
              ], {
                thumbnail : member.user.displayAvatarURL({ dynamic: true }),
              });

              await logger.send(client, guildId, 'raidlog', e);
            } catch (err) {
              errorHandler.handle(err, {
                source : 'creationlimit',
                guildId,
              });
            }

            return;
          }
        }
      }

      if (!member.user.bot) {
        try {
          const inviterId = await inviteTracker.findInviter(client, guild);
          db.trackInvite(guildId, member.id, inviterId ?? null);

          if (inviterId) {
            await _applyInviteRewards(guild, inviterId).catch(() => {});
          }
        } catch (err) {
          errorHandler.handle(err, { source: 'guildMemberAdd.inviteTracker', guildId });
        }
      }

      await _applyAutoroles(guild, member);

      if (!member.user.bot && Number(config?.ghostPingEnabled) === 1 && config?.ghostPingChannels) {
        try {
          const channelIds = JSON.parse(config.ghostPingChannels);
          for (const channelId of channelIds) {
            const ch = guild.channels.cache.get(channelId)
              ?? await client.channels.fetch(channelId).catch(() => null);
            if (!ch?.isTextBased()) continue;
            const sent = await ch.send({
              content        : `<@${member.id}>`,
              allowedMentions: { users: [member.id] },
            }).catch(() => null);
            if (sent) sent.delete().catch(() => {});
          }
        } catch {}
      }

      try {
        const verifyEnabled  = Number(config?.verifyEnabled) === 1;
        const verifyDuration = Math.floor(Number(config?.verifyDuration) || 0);
        const verifyRoleId   = config?.verifyRoleId || null;

        if (
          verifyEnabled &&
          verifyDuration > 0 &&
          verifyRoleId &&
          !member.user.bot &&
          !member.roles.cache.has(verifyRoleId)
        ) {
          const verifyTimeouts = require('../utils/verifyTimeouts');
          const expiresAt = Math.floor(Date.now() / 1000) + verifyDuration;
          verifyTimeouts.schedule(client, guildId, member.id, expiresAt);
        }
      } catch (err) {
        errorHandler.handle(err, {
          source : 'guildMemberAdd.scheduleVerifyTimeout',
          guildId,
          userId : member.id,
        });
      }


      const skipWelcomeAtJoin =
        Number(config?.verifyEnabled) === 1 &&
        Number(config?.welcomeAfterVerify) === 1;

      if (!skipWelcomeAtJoin) {
        await welcomeSender.sendWelcome(member, config);
      }

      const e = embed.log(guildId, 'Membre arrivé', [
        {
          name   : 'Membre',
          value  : `<@${member.id}> (${member.user.tag}) \`${member.id}\``,
          inline : true,
        },
        {
          name   : 'Compte créé le',
          value  : `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
          inline : true,
        },
        {
          name   : 'Membres total',
          value  : String(guild.memberCount),
          inline : true,
        },
      ], {
        thumbnail : member.user.displayAvatarURL({ dynamic: true }),
      });

      await logger.send(client, guildId, 'joinlog', e);


    } catch (err) {
      errorHandler.handle(err, {
        source : 'guildMemberAdd',
        guildId,
      });
    }
  },
};

function _formatDuration(seconds) {
  if (!seconds) return '0s';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}j`;
}

async function _applyAutoroles(guild, member) {
  if (member.user.bot) return;

  const roleIds = db.getAutoroles(guild.id);
  if (!roleIds.length) return;

  const me = guild.members.me
    ?? await guild.members.fetchMe().catch(() => null);

  if (!me) return;

  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return;
  }

  const roles = [];

  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId)
      ?? await guild.roles.fetch(roleId).catch(() => null);

    if (!role) continue;
    if (role.id === guild.id) continue;
    if (role.managed) continue;
    if (role.position >= me.roles.highest.position) continue;

    roles.push(role);
  }

  if (!roles.length) return;

  await member.roles.add(roles, 'Autorole').catch(() => {});
}

const ANTIBOT_AUDIT_WAIT_MS    = 1000;
const ANTIBOT_AUDIT_MAX_AGE_MS = 8000;

async function _findBotAddExecutor(guild, botId) {
  await new Promise(res => setTimeout(res, ANTIBOT_AUDIT_WAIT_MS));

  const fetched = await guild.fetchAuditLogs({
    type  : AuditLogEvent.BotAdd,
    limit : 5,
  }).catch(() => null);

  if (!fetched) return null;

  const now = Date.now();

  const entry = [...fetched.entries.values()].find(e =>
    e.target?.id === botId &&
    now - e.createdTimestamp < ANTIBOT_AUDIT_MAX_AGE_MS
  );

  return entry?.executor ?? null;
}

async function _applyInviteRewards(guild, inviterId) {
  const guildId = guild.id;
  const stats   = db.getInviteStats(guildId, inviterId);
  const total   = stats.total;
  const rewards = db.getInviteRewards(guildId);
  if (!rewards.length) return;

  const inviterMember = guild.members.cache.get(inviterId)
    ?? await guild.members.fetch(inviterId).catch(() => null);
  if (!inviterMember) return;

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;

  for (const reward of rewards) {
    if (total >= reward.threshold && !inviterMember.roles.cache.has(reward.roleId)) {
      await inviterMember.roles.add(reward.roleId, `Récompense invite : ${reward.threshold} invitations`).catch(() => {});
    }
  }
}

async function _applyCreationLimitPunishment(client, guild, member, punishment) {
  const guildId = guild.id;
  const reason  = 'Creation limit - compte trop récent';

  switch (punishment) {
    case 'ban':
      await guild.members.ban(member.id, { reason }).catch(() => {});
      db.addSanction(guildId, member.id, client.user.id, 'ban', reason);
      break;

    case 'mute':
      await member.timeout(10 * 60 * 1000, reason).catch(() => {});
      db.addSanction(guildId, member.id, client.user.id, 'mute', reason, 600);
      break;

    case 'derank': {
      const keepRoles = new Set(db.getNoderankRoles(guildId));
      const rolesToRemove = member.roles.cache
        .filter(role => role.id !== guild.id && !keepRoles.has(role.id))
        .map(role => role.id);

      if (rolesToRemove.length) {
        const deranked = await member.roles
          .remove(rolesToRemove, reason)
          .then(() => true)
          .catch(() => false);

        if (deranked) {
          db.addSanction(guildId, member.id, client.user.id, 'derank', reason);
        }
      }
      break;
    }

    case 'kick':
    default:
      await member.kick(reason).catch(() => {});
      db.addSanction(guildId, member.id, client.user.id, 'kick', reason);
      break;
  }
}
