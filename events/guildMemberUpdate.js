'use strict';


const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');

const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');
const db           = require('../core/database');
const perms        = require('../utils/permissions');
const { replaceVariables } = require('../utils/variables');
const { applyMute }        = require('../utils/applyMute');

const DEFAULT_BOOST_MESSAGE =
  'Merci {user} pour le boost sur **{server}**.\nLe serveur possede maintenant **{boosts}** boost(s).';

module.exports = {
  name : 'guildMemberUpdate',
  once : false,

  async execute(client, oldMember, newMember) {
    const guildId = newMember.guild.id;

    if (newMember.user.bot) return;

    try {
      const oldRoles = oldMember.roles.cache;
      const newRoles = newMember.roles.cache;

      const added = newRoles.filter(role =>
        !oldRoles.has(role.id) &&
        role.id !== newMember.guild.id
      );

      const removed = oldRoles.filter(role =>
        !newRoles.has(role.id) &&
        role.id !== newMember.guild.id
      );

      if (added.size || removed.size) {
        const fields = [
          {
            name   : 'Membre',
            value  : `<@${newMember.id}> (${newMember.user.username})`,
            inline : false,
          },
        ];

        if (added.size) {
          fields.push({
            name   : 'Roles ajoutes',
            value  : added.map(role => `<@&${role.id}>`).join(', '),
            inline : false,
          });
        }

        if (removed.size) {
          fields.push({
            name   : 'Roles retires',
            value  : removed.map(role => `<@&${role.id}>`).join(', '),
            inline : false,
          });
        }

        const e = embed.log(guildId, 'R\u00f4les modifi\u00e9s', fields);
        await logger.send(client, guildId, 'rolelog', e);
      }

      if (added.size) {
        await _handleBlrankGuard(client, newMember, added).catch(err =>
          errorHandler.handle(err, { source: 'guildMemberUpdate.blrankGuard', guildId })
        );
      }

      if (added.size || removed.size) {
        await _handleSoutienManualIgnore(client, oldMember, newMember, added, removed).catch(err =>
          errorHandler.handle(err, { source: 'guildMemberUpdate.soutienManualIgnore', guildId })
        );
      }

      const startedBoosting = !oldMember.premiumSince && newMember.premiumSince;
      const stoppedBoosting = oldMember.premiumSince && !newMember.premiumSince;

      if (startedBoosting) {
        await _sendBoostEmbed(client, newMember);

        const e = embed.log(guildId, 'Nouveau boost', [
          {
            name   : 'Membre',
            value  : `<@${newMember.id}> (${newMember.user.username})`,
            inline : true,
          },
          {
            name   : 'Total boosts',
            value  : String(newMember.guild.premiumSubscriptionCount ?? '?'),
            inline : true,
          },
        ], {
          thumbnail : newMember.user.displayAvatarURL({ dynamic: true }),
        });

        await logger.send(client, guildId, 'boostlog', e);
      }

      if (stoppedBoosting) {
        const e = embed.log(guildId, 'Boost retire', [
          {
            name   : 'Membre',
            value  : `<@${newMember.id}> (${newMember.user.username})`,
            inline : true,
          },
        ]);

        await logger.send(client, guildId, 'boostlog', e);
      }

      const wasTimedOut = !!oldMember.communicationDisabledUntil;
      const isTimedOut  = !!newMember.communicationDisabledUntil;

      if (!wasTimedOut && isTimedOut) {
        const until = Math.floor(newMember.communicationDisabledUntilTimestamp / 1000);

        const e = embed.log(guildId, 'Membre timeout', [
          {
            name   : 'Membre',
            value  : `<@${newMember.id}> (${newMember.user.username})`,
            inline : true,
          },
          {
            name   : "Jusqu'a",
            value  : `<t:${until}:R>`,
            inline : true,
          },
        ]);

        await logger.send(client, guildId, 'modlog', e);
      }

      if (wasTimedOut && !isTimedOut) {
        const e = embed.log(guildId, 'Timeout leve', [
          {
            name   : 'Membre',
            value  : `<@${newMember.id}> (${newMember.user.username})`,
            inline : true,
          },
        ]);

        await logger.send(client, guildId, 'modlog', e);

        const backup = db.getMuteRoles(guildId, newMember.id);

        if (backup) {
          const guild = newMember.guild;

          const me = guild.members.me
            ?? await guild.members.fetchMe().catch(() => null);

          if (me) {
            const validRoleIds = backup.roleIds.filter(id => {
              const role = guild.roles.cache.get(id);
              if (!role) return false;
              if (role.managed) return false;
              if (me.roles.highest.comparePositionTo(role) <= 0) return false;
              return true;
            });

            if (validRoleIds.length > 0) {
              await newMember.roles.add(validRoleIds, 'Automod re-rank post-mute (timeout leve)')
                .catch(err => errorHandler.handle(err, { source: 'guildMemberUpdate.restoreMuteRoles', guildId }));
            }
          }

          db.clearMuteRoles(guildId, newMember.id);
        }
      }

    } catch (err) {
      errorHandler.handle(err, {
        source : 'guildMemberUpdate',
        guildId,
      });
    }
  },
};

async function _sendBoostEmbed(client, member) {
  const guild   = member.guild;
  const guildId = guild.id;
  const config  = db.getGuildConfig(guildId);

  if (!Number(config?.boostEmbedEnabled)) return;

  const channelId =
    config?.boostEmbedChannelId ||
    config?.boostLogChannel     ||
    guild.systemChannelId;

  if (!channelId) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased()) return;

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me) return;

  const permissions = channel.permissionsFor(me);

  if (!permissions?.has('SendMessages') || !permissions?.has('EmbedLinks')) {
    return;
  }

  const content = _formatBoostMessage(
    config?.boostEmbedMessage || DEFAULT_BOOST_MESSAGE,
    member
  );

  await channel.send({
    embeds: [
      embed.build(
        guildId,
        content,
        {
          title     : 'Nouveau boost',
          image     : member.user.displayAvatarURL({ dynamic: true, size: 1024 }),
          timestamp : new Date(),
        }
      ),
    ],
    allowedMentions: { users: [member.id] },
  }).catch(err => {
    errorHandler.handle(err, {
      source  : 'guildMemberUpdate.boostEmbedSend',
      guildId : guildId,
      userId  : member.id,
    });
  });
}

function _formatBoostMessage(text, member) {
  return replaceVariables(String(text || DEFAULT_BOOST_MESSAGE), {
    user   : member.user,
    member,
    guild  : member.guild,
    client : member.client,
  });
}


const DANGEROUS_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ViewAuditLog,
];

function _isDangerousRole(role) {
  return DANGEROUS_PERMISSIONS.some(p => role.permissions.has(p));
}

async function _handleBlrankGuard(client, member, addedRoles) {
  const guild   = member.guild;
  const guildId = guild.id;

  const guildConfig = db.getGuildConfig(guildId);
  if (!guildConfig?.antiraidEnabled) return;

  const config = db.getAntiraidConfig(guildId);
  if (!config?.blrankEnabled) return;

  const blacklistedRoleIds = db.getBlacklistRanks(guildId);
  if (!blacklistedRoleIds.length) return;

  const blSet = new Set(blacklistedRoleIds);

  const targetHasBlacklisted = member.roles.cache.some(r => blSet.has(r.id));
  if (!targetHasBlacklisted) return;

  const mode = String(config.blrankMode ?? 'all').toLowerCase();

  let rolesToRemove = addedRoles;

  if (mode === 'danger') {
    rolesToRemove = addedRoles.filter(role => _isDangerousRole(role));
  }

  if (!rolesToRemove.size) return;


  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) return;

  const removable = rolesToRemove.filter(role =>
    !role.managed &&
    role.id !== guild.id &&
    me.roles.highest.comparePositionTo(role) > 0
  );

  if (!removable.size) return;


  const addedRoleIds = new Set(removable.map(r => r.id));
  const executor = await _findRoleUpdateExecutor(guild, member.id, addedRoleIds);

  if (executor) {
    if (executor.id === client.user.id) return;


    const executorMember = guild.members.cache.get(executor.id)
      ?? await guild.members.fetch(executor.id).catch(() => null);

    if (perms.isProtected(executor.id, guildId, executorMember)) return;
  } else {

    if (perms.isProtected(member.id, guildId, member)) return;
  }

  for (const role of removable.values()) {
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(
        role.id,
        'Blrank - rôle retiré (cible blacklist rank)'
      ).catch(() => {});
    }
  }

  const punishment = config.blrankPunish ?? 'derank';

  if (executor) {
    const execMember = guild.members.cache.get(executor.id)
      ?? await guild.members.fetch(executor.id).catch(() => null);

    await _applyBlrankPunishment(client, guild, executor.id, execMember, punishment);
  }

  const fields = [
    {
      name   : 'Cible',
      value  : `<@${member.id}> (${member.user.tag})`,
      inline : true,
    },
    {
      name   : 'Exécuteur',
      value  : executor
        ? `<@${executor.id}>${executor.tag ? ` (${executor.tag})` : ''}`
        : 'Inconnu',
      inline : true,
    },
    {
      name   : 'Mode',
      value  : mode,
      inline : true,
    },
    {
      name   : 'Action',
      value  : executor ? punishment : 'Aucune (exécuteur inconnu)',
      inline : true,
    },
    {
      name   : 'Rôle(s) retiré(s)',
      value  : removable.map(r => `<@&${r.id}>`).join(', ').slice(0, 1024),
      inline : false,
    },
  ];

  const logEmbed = embed.log(guildId, 'Blrank déclenché', fields);
  await logger.send(client, guildId, 'raidlog', logEmbed).catch(() => {});
}

const BLRANK_AUDIT_RETRIES   = 3;
const BLRANK_AUDIT_DELAY_MS  = 500;
const BLRANK_AUDIT_MAX_AGE   = 10_000;

async function _findRoleUpdateExecutor(guild, targetId, addedRoleIds) {
  for (let attempt = 0; attempt < BLRANK_AUDIT_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(res => setTimeout(res, BLRANK_AUDIT_DELAY_MS));
    }

    const fetched = await guild.fetchAuditLogs({
      type  : AuditLogEvent.MemberRoleUpdate,
      limit : 6,
    }).catch(() => null);

    if (!fetched) continue;

    const now = Date.now();

    for (const entry of fetched.entries.values()) {
      if (entry.target?.id !== targetId) continue;
      if (now - entry.createdTimestamp > BLRANK_AUDIT_MAX_AGE) continue;


      const changes = entry.changes ?? [];
      const addChange = changes.find(c => c.key === '$add');

      if (addChange?.new?.length) {
        const entryRoleIds = addChange.new.map(r => r.id);
        const hasMatch = entryRoleIds.some(id => addedRoleIds.has(id));
        if (!hasMatch) continue;
      }

      if (entry.executor) return entry.executor;
    }
  }

  return null;
}


const soutienAutoRemovals = require('../utils/soutienAutoRemovals');
const { getSoutienMatchInfo } = require('../utils/soutienSync');

async function _handleSoutienManualIgnore(client, oldMember, newMember, added, removed) {
  const guild   = newMember.guild;
  const guildId = guild.id;

  const config = db.getGuildConfig(guildId);
  if (!Number(config?.soutienEnabled)) return;
  if (!config?.soutienRoleId) return;

  const roleId = config.soutienRoleId;

  const wasAdded   = added.has(roleId);
  const wasRemoved = removed.has(roleId);

  if (!wasAdded && !wasRemoved) return;


  if (wasAdded) {
    db.removeSoutienManualIgnore(guildId, newMember.id, roleId);
    return;
  }


  if (soutienAutoRemovals.consume(guildId, newMember.id, roleId)) return;


  const matchInfo = getSoutienMatchInfo(newMember, config);
  if (!matchInfo.matches && !matchInfo.statusUnknown) return;


  db.addSoutienManualIgnore(guildId, newMember.id, roleId, null);
}


async function _applyBlrankPunishment(client, guild, userId, member, punishment) {
  const guildId = guild.id;
  const reason  = 'Antiraid - blrank';

  switch (punishment) {
    case 'warn':
      db.addSanction(guildId, userId, client.user.id, 'warn', reason);
      break;

    case 'mute': {
      if (!member) {


        db.addSanction(guildId, userId, client.user.id, 'warn',
          `${reason} [mute impossible: membre absent]`);
        break;
      }


      const guildCfg = db.getGuildConfig(guildId);
      const result   = await applyMute({
        guild,
        member,
        config    : guildCfg,
        durationMs: 10 * 60 * 1000,
        reason,
        source    : 'blrank',
      });

      if (!result.applied) {

        db.addSanction(guildId, userId, client.user.id, 'warn',
          `${reason} [mute impossible: ${result.reason ?? 'inconnu'}]`);
        break;
      }

      db.addSanction(guildId, userId, client.user.id, 'mute', reason, 600);
      break;
    }

    case 'kick':
      if (member) {
        await member.kick(reason).catch(() => {});
      }
      db.addSanction(guildId, userId, client.user.id, 'kick', reason);
      break;

    case 'ban':
      await guild.members.ban(userId, { reason }).catch(() => {});
      db.addSanction(guildId, userId, client.user.id, 'ban', reason);
      break;

    case 'derank':
    default:
      if (member) {
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
            db.addSanction(guildId, userId, client.user.id, 'derank', reason);
          }
        }
      }
      break;
  }
}
