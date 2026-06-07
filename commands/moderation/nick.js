'use strict';


const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const { resolveMember } = require('../../utils/memberResolver');

module.exports = {
  help: {
    name        : 'nick',
    description : 'Modifie le pseudo d’un membre.',
    usage       : 'nick <membre> <pseudo|reset>',
    aliases     : ['nickname'],
  },

  async run(client, message, args) {
    if (!perms.check(message, 'nick')) return;

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    const target = await resolveMember(message, [args[0]]);

    if (!target) {
      const sent = await embed.replyError(
        message,
        'Membre introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (target.id === client.user.id) {
      const sent = await embed.replyError(
        message,
        'Je ne peux pas modifier mon propre pseudo.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (perms.isProtected(target.id, guildId, target)) {
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

    if (!me.permissions.has('ManageNicknames')) {
      const sent = await embed.replyError(
        message,
        'Je n’ai pas la permission de gérer les pseudos.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const isBuyer = perms.isBuyer(message.author.id);
    const isGlobalOwner = db.isOwner(guildId,message.author.id);

    if (!isBuyer && !isGlobalOwner) {
      if (target.id !== message.author.id && target.roles.highest.position >= message.member.roles.highest.position) {
        const sent = await embed.replyError(
          message,
          'Vous ne pouvez pas modifier le pseudo de ce membre.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
    }

    if (!target.manageable || target.roles.highest.position >= me.roles.highest.position) {
      const sent = await embed.replyError(
        message,
        'Je ne peux pas modifier le pseudo de ce membre.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const rawNick = args.slice(1).join(' ').trim();

    if (!rawNick) {
      const sent = await embed.replyError(
        message,
        'Vous devez indiquer un pseudo ou `reset`.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const newNick = ['reset', 'off', 'none'].includes(rawNick.toLowerCase())
      ? null
      : rawNick;

    if (newNick && newNick.length > 32) {
      const sent = await embed.replyError(
        message,
        'Le pseudo ne peut pas dépasser 32 caractères.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const edited = await target.setNickname(newNick, `Modifié par ${message.author.tag}`).catch(() => null);

    if (!edited) {
      const sent = await embed.replyError(
        message,
        'Impossible de modifier le pseudo de ce membre.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          newNick
            ? `Le pseudo de <@${target.id}> a été modifié en **${newNick}**.`
            : `Le pseudo de <@${target.id}> a été réinitialisé.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};
