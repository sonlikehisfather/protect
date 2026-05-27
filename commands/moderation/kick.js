'use strict';


const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const logger            = require('../../utils/logger');
const modDm             = require('../../utils/modDm');
const { resolveMember } = require('../../utils/memberResolver');

module.exports = {
  help: {
    name        : 'kick',
    description : 'Expulse un membre.',
    usage       : 'kick <membre> [raison]',
    aliases     : [],
    permission  : {
      level           : 'owner',
      label           : 'Moderation',
      discord         : ['KickMembers'],
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
    const modDmEnabled = Boolean(config?.modDmEnabled ?? 1);

    const target = await resolveMember(message, args);

    if (!target) {
      const sent = await embed.replyError(message, 'Membre introuvable.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (target.id === message.author.id) {
      const sent = await embed.replyError(message, 'Vous ne pouvez pas vous expulser vous-même.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (target.id === client.user.id) {
      const sent = await embed.replyError(message, 'Je ne peux pas m’expulser moi-même.', { timestamp: false }).catch(() => null);
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

    if (!me.permissions.has('KickMembers')) {
      const sent = await embed.replyError(message, 'Je n’ai pas la permission d’expulser des membres.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const isBuyer       = perms.isBuyer(message.author.id);
    const isGlobalOwner = db.isGlobalOwner(message.author.id);

    if (!isBuyer && !isGlobalOwner && target.roles.highest.position >= message.member.roles.highest.position) {
      const sent = await embed.replyError(message, 'Vous ne pouvez pas expulser ce membre.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!target.kickable || target.roles.highest.position >= me.roles.highest.position) {
      const sent = await embed.replyError(message, 'Je ne peux pas expulser ce membre.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    await modDm.send(client, guild, target, {
      type: 'kick',
      reason,
      modDmEnabled,
      moderator: message.member ?? message.author,
    });

    const kicked = await target.kick(reason).catch(() => null);

    if (kicked === null) {
      const sent = await embed.replyError(message, 'L’expulsion a échoué.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.addSanction(guildId, target.id, message.author.id, 'kick', reason);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `**${target.user.tag}** a été expulsé.`,
          {
            fields   : [{ name: 'Raison', value: reason, inline: false }],
            timestamp: false,
          }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

    const e = embed.sanction(guildId, {
      type        : 'kick',
      targetTag   : target.user.tag,
      targetId    : target.id,
      moderatorTag: message.author.tag,
      reason,
    });

    await logger.send(client, guildId, 'modlog', e);
  },
};
