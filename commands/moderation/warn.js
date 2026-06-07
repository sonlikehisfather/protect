'use strict';


const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const logger            = require('../../utils/logger');
const modDm             = require('../../utils/modDm');
const { resolveTargets } = require('../../utils/targetResolver');

module.exports = {
  help: {
    name        : 'warn',
    description : 'Avertit un membre.',
    usage       : 'warn <membre> <raison>',
    aliases     : [],
    multi       : true,
    permission  : {
      level           : 'owner',
      label           : 'Moderation',
      discord         : [],
      targetProtection: true,
      bypass          : ['buyer', 'globalOwner'],
      notes           : ['Sanctions auto (mute/kick/ban) utilisent les perms bot correspondantes'],
    },
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd    = Boolean(config?.autoDeleteModCmds);
    const deleteReply  = Boolean(config?.autoDeleteModReplies);
    const deleteDelay  = config?.autoDeleteDelay ?? 5;
    const modDmEnabled = Boolean(config?.modDmEnabled ?? 1);

    const result = await resolveTargets(guild, args, { maxTargets: 4 });

    if (result.limitExceeded) {
      const sent = await embed.replyError(
        message,
        'Vous pouvez fournir 4 cibles maximum.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (result.ambiguous.length) {
      const list = result.ambiguous.map(a => `\`${a}\``).join(', ');
      const sent = await embed.replyError(
        message,
        `Membres ambigus : ${list}. Utilisez des mentions ou IDs.`,
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!result.members.length) {
      const sent = await embed.replyError(message, 'Membre introuvable.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const reason = result.reason;

    if (!reason) {
      const sent = await embed.replyError(message, 'Vous devez fournir une raison.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const isBuyer       = perms.isBuyer(message.author.id);
    const isGlobalOwner = db.isOwner(guildId,message.author.id);
    const thresholds    = db.getWarnThresholds(guildId);

    const warned           = [];
    const skippedSelf      = [];
    const skippedBot       = [];
    const skippedProtected = [];
    const skippedHierarchy = [];

    for (const target of result.members) {

      if (target.id === message.author.id) {
        skippedSelf.push(target); continue;
      }

      if (target.id === client.user.id) {
        skippedBot.push(target); continue;
      }

      if (perms.isProtected(target.id, guildId, target)) {
        skippedProtected.push(target); continue;
      }

      if (
        !isBuyer && !isGlobalOwner &&
        target.roles.highest.position >= message.member.roles.highest.position
      ) {
        skippedHierarchy.push(target); continue;
      }

      db.addSanction(guildId, target.id, message.author.id, 'warn', reason);

      const allWarnSanctions = db.getSanctions(guildId, target.id).filter(s => s.type === 'warn');
      let total              = allWarnSanctions.length;
      const hit              = thresholds.find(t => t.threshold === total);

      let resetWarns = false;

      if (hit) {
        await _applyWarnThreshold(client, message, guild, guildId, target, hit, total, deleteReply, deleteDelay, modDmEnabled);

        const maxThreshold = thresholds.length
          ? Math.max(...thresholds.map(t => t.threshold))
          : null;

        if (maxThreshold !== null && total === maxThreshold) {
          db.clearWarnSanctions(guildId, target.id);
          total = 0;
          resetWarns = true;
        }
      }

      warned.push({ target, total, resetWarns });

      await modDm.send(client, guild, target, {
        type: 'warn',
        reason,
        modDmEnabled,
        moderator: message.member ?? message.author,
      });

      const e = embed.sanction(guildId, {
        type        : 'warn',
        targetTag   : target.user.tag,
        targetId    : target.id,
        moderatorTag: message.author.tag,
        reason,
      });

      await logger.send(client, guildId, 'modlog', e);
    }

    const lines = [];

    if (warned.length) {
      const warnLines = warned.map(w => {
        const reset = w.resetWarns ? ' *(compteur réinitialisé)*' : '';
        return `**${w.target.user.tag}** (total : ${w.total})${reset}`;
      });
      lines.push(`**Avertis**\n${warnLines.join('\n')}`);
    }

    if (skippedProtected.length)
      lines.push(`**Ignorés (protégés)**\n${skippedProtected.map(t => t.user.tag).join(', ')}`);

    if (skippedHierarchy.length)
      lines.push(`**Ignorés (hiérarchie)**\n${skippedHierarchy.map(t => t.user.tag).join(', ')}`);

    if (skippedSelf.length)
      lines.push(`**Ignorés (self)**\n${skippedSelf.map(t => t.user.tag).join(', ')}`);

    if (skippedBot.length)
      lines.push(`**Ignorés (bot)**\n${skippedBot.map(t => t.user.tag).join(', ')}`);

    if (result.notFound.length)
      lines.push(`**Introuvables**\n${result.notFound.map(n => `\`${n}\``).join(', ')}`);

    if (result.duplicatesSkipped)
      lines.push(`**Doublons ignorés** : ${result.duplicatesSkipped}`);

    if (!lines.length)
      lines.push('Aucune action effectuée.');

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          lines.join('\n\n'),
          {
            fields   : [{ name: 'Raison', value: reason, inline: false }],
            timestamp: false,
          }
        ),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function _applyWarnThreshold(client, message, guild, guildId, target, hit, total, deleteReply, deleteDelay, modDmEnabled) {
  const config      = db.getGuildConfig(guildId);
  const muteRoleId  = config?.muteRoleId ?? null;


  const useTimeout  = Boolean(config?.useTimeout);
  const { sanction, duration } = hit;
  const reason = `Seuil de warns atteint (${total} warns)`;

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me) return;

  let applied    = false;
  let loggedType = sanction;

  try {
    if (sanction === 'mute') {
      if (useTimeout) {
        if (!me.permissions.has('ModerateMembers')) return;
        if (!target.moderatable || target.roles.highest.position >= me.roles.highest.position) return;

        const timeoutMs = (duration ?? (10 * 60)) * 1000;
        const muted = await target.timeout(timeoutMs, reason).catch(() => null);

        if (muted) {
          db.addSanction(guildId, target.id, client.user.id, 'mute', reason, duration ?? (10 * 60));
          applied    = true;
          loggedType = 'mute';

          await modDm.send(client, guild, target, {
            type: 'mute',
            reason,
            duration: _formatDuration(duration ?? (10 * 60)),
            modDmEnabled,
            moderator: message.member ?? message.author,
          });
        }
      } else {
        if (!muteRoleId) return;

        const muteRole = guild.roles.cache.get(muteRoleId);
        if (!muteRole) return;
        if (!me.permissions.has('ManageRoles')) return;
        if (!target.manageable || target.roles.highest.position >= me.roles.highest.position) return;
        if (me.roles.highest.position <= muteRole.position) return;
        if (target.roles.cache.has(muteRoleId)) return;

        const added = await target.roles.add(muteRole, reason).catch(() => null);
        if (added) {
          const durationSec = duration ?? (10 * 60);

          db.addSanction(guildId, target.id, client.user.id, 'mute', reason, durationSec);
          db.addTempRole(guildId, target.id, muteRoleId, durationSec);

          applied    = true;
          loggedType = 'mute';

          await modDm.send(client, guild, target, {
            type: 'mute',
            reason,
            duration: _formatDuration(durationSec),
            modDmEnabled,
            moderator: message.member ?? message.author,
          });
        }
      }
    }

    else if (sanction === 'kick') {
      if (!me.permissions.has('KickMembers')) return;
      if (!target.kickable || target.roles.highest.position >= me.roles.highest.position) return;

      await modDm.send(client, guild, target, {
        type: 'kick',
        reason,
        modDmEnabled,
        moderator: message.member ?? message.author,
      });

      const kicked = await target.kick(reason).catch(() => null);

      if (kicked !== null) {
        db.addSanction(guildId, target.id, client.user.id, 'kick', reason);
        applied = true;
        loggedType = 'kick';
      }
    }

    else if (sanction === 'ban' || sanction === 'tempban') {
      if (!me.permissions.has('BanMembers')) return;
      if (!target.bannable || target.roles.highest.position >= me.roles.highest.position) return;

      await modDm.send(client, guild, target, {
        type: sanction,
        reason,
        duration: sanction === 'tempban' && duration ? _formatDuration(duration) : null,
        modDmEnabled,
        moderator: message.member ?? message.author,
      });

      const banned = await guild.bans.create(target.id, {
        reason,
        deleteMessageSeconds: 0,
      }).catch(() => null);

      if (banned) {
        db.addSanction(
          guildId,
          target.id,
          client.user.id,
          'ban',
          reason,
          sanction === 'tempban' ? (duration ?? null) : null
        );
        applied = true;
        loggedType = 'ban';
      }
    }

    if (!applied) return;

    const e = embed.sanction(guildId, {
      type        : loggedType,
      targetTag   : target.user.tag,
      targetId    : target.id,
      moderatorTag: client.user.tag,
      reason,
      duration    : sanction === 'mute' || sanction === 'tempban'
        ? _formatDuration(duration)
        : undefined,
    });

    await logger.send(client, guildId, 'modlog', e);

    const sanctionLabel =
      sanction === 'mute'
        ? `mute (${_formatDuration(duration ?? (10 * 60))})`
        : sanction.toLowerCase();

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Seuil de **${total} warns** atteint.\nUtilisateur **${target.user.tag}** sanctionné : **${sanctionLabel}**.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

  } catch {
    return;
  }
}

function _formatDuration(seconds) {
  if (!seconds) return '';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}j`;
}
