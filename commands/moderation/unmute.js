'use strict';


const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const logger            = require('../../utils/logger');
const modDm             = require('../../utils/modDm');
const { resolveMember } = require('../../utils/memberResolver');

module.exports = {
  help: {
    name        : 'unmute',
    description : 'Retire le timeout et/ou le rôle mute d’un membre.',
    usage       : 'unmute <membre> [raison]',
    aliases     : [],
    permission  : {
      level           : 'owner',
      label           : 'Moderation',
      discord         : ['ModerateMembers', 'ManageRoles'],
      targetProtection: true,
      bypass          : ['buyer', 'globalOwner'],
    },
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd    = Boolean(config?.autoDeleteModCmds);
    const deleteReply  = Boolean(config?.autoDeleteModReplies);
    const deleteDelay  = config?.autoDeleteDelay ?? 5;
    const muteRoleId   = config?.muteRoleId ?? null;
    const modDmEnabled = Boolean(config?.modDmEnabled ?? 1);

    const target = await resolveMember(message, args);

    if (!target) {
      const sent = await embed.replyError(message, 'Membre introuvable.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (target.id === message.author.id) {
      const sent = await embed.replyError(message, 'Vous ne pouvez pas vous unmute vous-même.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (target.id === client.user.id) {
      const sent = await embed.replyError(message, 'Je ne peux pas me unmute moi-même.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (perms.isProtected(target.id, guildId, target)) {
      const sent = await embed.replyError(message, 'Ce membre est protégé.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me) {
      const sent = await embed.replyError(message, 'Impossible de vérifier mes permissions.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const isBuyer       = perms.isBuyer(message.author.id);
    const isGlobalOwner = db.isOwner(guildId,message.author.id);

    if (!isBuyer && !isGlobalOwner && target.roles.highest.position >= message.member.roles.highest.position) {
      const sent = await embed.replyError(message, 'Vous ne pouvez pas unmute ce membre.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    let removedTimeout = false;
    let removedRole    = false;

    if (target.communicationDisabledUntilTimestamp) {
      if (!me.permissions.has('ModerateMembers')) {
        const sent = await embed.replyError(message, 'Je n’ai pas la permission de retirer les timeouts.', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (!target.moderatable || target.roles.highest.position >= me.roles.highest.position) {
        const sent = await embed.replyError(message, 'Je ne peux pas retirer le timeout de ce membre.', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      const unmuted = await target.timeout(null, reason).catch(() => null);
      if (unmuted) {
        removedTimeout = true;


        const backup = db.getMuteRoles(guildId, target.id);

        if (backup) {
          const validRoleIds = backup.roleIds.filter(id => {
            const role = guild.roles.cache.get(id);
            if (!role) return false;
            if (role.managed) return false;
            if (me.roles.highest.comparePositionTo(role) <= 0) return false;
            return true;
          });

          if (validRoleIds.length > 0) {
            await target.roles.add(validRoleIds, `Automod re-rank post-mute (unmute par ${message.author.tag})`)
              .catch(() => {});
          }

          db.clearMuteRoles(guildId, target.id);
        }
      }
    }

    if (muteRoleId) {
      const muteRole = guild.roles.cache.get(muteRoleId);

      if (muteRole && target.roles.cache.has(muteRoleId)) {
        if (!me.permissions.has('ManageRoles') || me.roles.highest.position <= muteRole.position) {
          const sent = await embed.replyError(message, 'Je ne peux pas retirer ce rôle mute.', { timestamp: false }).catch(() => null);
          if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
          return;
        }

        const removed = await target.roles.remove(muteRole, reason).catch(() => null);
        if (removed) {
          removedRole = true;

          if (db.removeTempRole) {
            db.removeTempRole(guildId, target.id, muteRoleId);
          }
        }
      }
    }

    if (!removedTimeout && !removedRole) {
      const sent = await embed.replyError(message, 'Ce membre n’est ni en timeout ni mute par rôle.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const activeMute = db.getActiveSanction(guildId, target.id, 'mute');
    if (activeMute) {
      db.expireSanction(activeMute.id);
    }

    db.addSanction(guildId, target.id, message.author.id, 'unmute', reason);

    await modDm.send(client, guild, target, {
      type: 'unmute',
      reason,
      modDmEnabled,
      moderator: message.member ?? message.author,
    });

    const details = [];
    if (removedTimeout) details.push('timeout retiré');
    if (removedRole) details.push('rôle mute retiré');

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `**${target.user.tag}** a été unmute.`,
          {
            fields: [
              { name: 'Raison', value: reason, inline: false },
              { name: 'Action', value: details.join(' • '), inline: false },
            ],
            timestamp: false,
          }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);

    const e = embed.sanction(guildId, {
      type        : 'unmute',
      targetTag   : target.user.tag,
      targetId    : target.id,
      moderatorTag: message.author.tag,
      reason,
    });

    await logger.send(client, guildId, 'modlog', e);
  },
};
