'use strict';


const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const logger            = require('../../utils/logger');
const { resolveMember } = require('../../utils/memberResolver');

module.exports = {
  help: {
    name        : 'delrole',
    description : 'Retire un rôle à un membre.',
    usage       : 'delrole <membre> <rôle>',
    aliases     : ['removerole'],
    permission  : {
      level           : 'owner',
      label           : 'Moderation',
      discord         : ['ManageRoles'],
      targetProtection: true,
      bypass          : ['buyer', 'globalOwner'],
    },
  },

  async run(client, message, args) {

    if (!perms.check(message, 'delrole')) return;

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteRoleReplies ?? config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    const member   = await resolveMember(message, [args[0]]);
    const resolved = resolveRole(message, args.slice(1));

    if (!member) {
      const sent = await embed.replyError(
        message,
        'Membre introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (resolved.ambiguous) {
      const sent = await embed.replyError(
        message,
        'Plusieurs rôles correspondent à ce nom. Utilisez une mention ou un ID.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const role = resolved.role;

    if (!role) {
      const sent = await embed.replyError(
        message,
        'Rôle introuvable.',
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

    if (!member.roles.cache.has(role.id)) {
      const sent = await embed.replyError(
        message,
        'Ce membre ne possède pas ce rôle.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (role.managed) {
      const sent = await embed.replyError(
        message,
        'Ce rôle est géré par une intégration.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (role.id === guild.id) {
      const sent = await embed.replyError(
        message,
        'Ce rôle ne peut pas être retiré.',
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

    if (role.position >= me.roles.highest.position) {
      const sent = await embed.replyError(
        message,
        'Je ne peux pas retirer ce rôle car il est au-dessus de mon rôle le plus élevé.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const isBuyer       = perms.isBuyer(message.author.id);
    const isGlobalOwner = db.isGlobalOwner(message.author.id);

    if (!isBuyer && !isGlobalOwner) {

        if (role.position >= message.member.roles.highest.position) {
          const sent = await embed.replyError(
            message,
            'Vous ne pouvez pas retirer ce rôle car il est au-dessus de votre rôle le plus élevé.',
            { timestamp: false }
          ).catch(() => null);

          if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
          return;
        }

        if (
            member.id !== message.author.id &&
            member.roles.highest.position >= message.member.roles.highest.position
        ) {
          const sent = await embed.replyError(
            message,
            'Vous ne pouvez pas modifier les rôles de ce membre.',
            { timestamp: false }
          ).catch(() => null);

          if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
          return;
        }
    }

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const removed = await member.roles.remove(role).catch(() => null);

    if (!removed) {
      const sent = await embed.replyError(
        message,
        'Le retrait du rôle a échoué.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `${role} a été retiré de <@${member.id}>.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);

    const logEmbed = embed.sanction(guildId, {
      type        : 'delrole',
      targetTag   : member.user.tag,
      targetId    : member.id,
      moderatorTag: message.author.tag,
      reason      : `Retrait du rôle ${role.name}`,
    });

    await logger.send(client, guildId, 'modlog', logEmbed);

  },
};

function resolveRole(message, args) {

  const mentioned = message.mentions.roles.first();
  if (mentioned) return { role: mentioned, ambiguous: false };

  const raw = args.join(' ').trim();
  if (!raw) return { role: null, ambiguous: false };

  const cleaned = raw.replace(/[<@&>]/g, '').trim();

  if (/^\d{17,20}$/.test(cleaned)) {
    return { role: message.guild.roles.cache.get(cleaned) ?? null, ambiguous: false };
  }

  const lowered = raw.toLowerCase();

  const matches = message.guild.roles.cache.filter(r =>
    r.name.toLowerCase() === lowered
  );

  if (matches.size === 1) return { role: matches.first(), ambiguous: false };
  if (matches.size > 1)  return { role: null, ambiguous: true };

  return { role: null, ambiguous: false };
}
