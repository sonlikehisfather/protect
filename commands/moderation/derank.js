'use strict';


const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const { resolveMember } = require('../../utils/memberResolver');

module.exports = {
  help: {
    name        : 'derank',
    description : 'Retire tous les rôles d’un membre.',
    usage       : 'derank <membre>',
    aliases     : [],
    permission  : {
      level           : 'owner',
      label           : 'Moderation',
      discord         : ['ManageRoles'],
      targetProtection: true,
      bypass          : ['buyer', 'globalOwner'],
    },
  },

  async run(client, message, args) {
    if (!perms.check(message, 'derank')) return;

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteRoleReplies ?? config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    const member = await resolveMember(message, args);

    if (!member) {
      const sent = await embed.replyError(
        message,
        'Membre introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (member.id === client.user.id) {
      const sent = await embed.replyError(
        message,
        'Je ne peux pas me retirer mes propres rôles.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (perms.isProtected(member.id, guildId, member)) {
      const sent = await embed.replyError(
        message,
        'Ce membre est protégé.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me) {
      const sent = await embed.replyError(
        message,
        'Impossible de vérifier mes permissions.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!me.permissions.has('ManageRoles')) {
      const sent = await embed.replyError(
        message,
        'Je n’ai pas la permission de gérer les rôles.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const isBuyer = perms.isBuyer(message.author.id);
    const isGlobalOwner = db.isGlobalOwner(message.author.id);

    if (!isBuyer && !isGlobalOwner) {
      if (member.id !== message.author.id && member.roles.highest.position >= message.member.roles.highest.position) {
        const sent = await embed.replyError(
          message,
          'Vous ne pouvez pas modifier les rôles de ce membre.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
    }

    const keepRoles = new Set(db.getNoderankRoles(guildId));

    const removableRoles = member.roles.cache.filter(role =>
      role.id !== guild.id &&
      !keepRoles.has(role.id) &&
      !role.managed &&
      role.position < me.roles.highest.position
    );

    if (!removableRoles.size) {
      const sent = await embed.replyError(
        message,
        'Aucun rôle retirable n’a été trouvé.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const removed = await member.roles.remove(removableRoles).catch(() => null);

    if (!removed) {
      const sent = await embed.replyError(
        message,
        'Le derank a échoué.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `**${removableRoles.size}** rôle(s) ont été retiré(s) à <@${member.id}>.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};
