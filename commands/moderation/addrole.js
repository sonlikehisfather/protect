'use strict';


const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const logger            = require('../../utils/logger');
const { resolveMember } = require('../../utils/memberResolver');

module.exports = {
  help: {
    name        : 'addrole',
    description : 'Ajoute un rôle à un membre.',
    usage       : 'addrole <membre> <rôle>',
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

    if (!perms.check(message, 'addrole')) return;

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteRoleReplies ?? config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    const member = await resolveMember(message, [args[0]]);
    const role   = resolveRole(message, args.slice(1));

    if (!member) {
      const sent = await embed.replyError(message, 'Membre introuvable.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!role) {
      const sent = await embed.replyError(message, 'Rôle introuvable.', { timestamp: false }).catch(() => null);
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

    if (member.roles.cache.has(role.id)) {
      const sent = await embed.replyError(
        message,
        'Ce membre possède déjà ce rôle.',
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
        'Ce rôle ne peut pas être attribué.',
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
        'Je ne peux pas attribuer ce rôle car il est au-dessus de mon rôle le plus élevé.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const isBuyer       = perms.isBuyer(message.author.id);
    const isGlobalOwner = db.isOwner(guildId,message.author.id);

    if (!isBuyer && !isGlobalOwner) {

      if (role.position >= message.member.roles.highest.position) {
        const sent = await embed.replyError(
          message,
          'Vous ne pouvez pas attribuer ce rôle car il est au-dessus de votre rôle le plus élevé.',
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

    const added = await member.roles.add(role).catch(() => null);

    if (!added) {
      const sent = await embed.replyError(
        message,
        'L’ajout du rôle a échoué.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `${role} a été ajouté à <@${member.id}>.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);

    const logEmbed = embed.sanction(guildId, {
      type        : 'addrole',
      targetTag   : member.user.tag,
      targetId    : member.id,
      moderatorTag: message.author.tag,
      reason      : `Ajout du rôle ${role.name}`,
    });

    await logger.send(client, guildId, 'modlog', logEmbed);

  },
};

function resolveRole(message, parts = []) {
  const guild = message.guild;
  if (!guild) return null;

  const input = parts.join(' ').trim();
  if (!input) return null;

  const mentionMatch = input.match(/^<@&(\d+)>$/);
  const id = mentionMatch?.[1] ?? (/^\d+$/.test(input) ? input : null);

  if (id) {
    return guild.roles.cache.get(id) ?? null;
  }

  const lowered = input.toLowerCase();

  return guild.roles.cache.find(role =>
    role.name.toLowerCase() === lowered
  ) ?? null;
}
