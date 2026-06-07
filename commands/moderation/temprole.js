'use strict';


const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const logger            = require('../../utils/logger');
const { resolveMember } = require('../../utils/memberResolver');
const { parseDuration } = require('../../utils/parseDuration.js');

module.exports = {
  help: {
    name        : 'temprole',
    description : 'Ajoute un rôle temporaire à un membre.',
    usage       : 'temprole <membre> <rôle> <durée>',
    aliases     : [],
  },

  async run(client, message, args) {
    if (!perms.check(message, 'temprole')) return;

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteRoleReplies ?? config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (!args.length) {
      const sent = await embed.replyError(
        message,
        'Utilisation : `temprole <membre> <rôle> <durée>`.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

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

    const durationStr = extractDuration(args);
    if (!durationStr) {
      const sent = await embed.replyError(
        message,
        'Durée invalide.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const durationMs = parseDuration(durationStr, { minMs: 1000 });
    if (!durationMs || durationMs <= 0) {
      const sent = await embed.replyError(
        message,
        'Durée invalide.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const resolved = resolveRole(message, args, durationStr);

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

    const added = await member.roles.add(role, `Temprole par ${message.author.username}`).catch(() => null);

    if (!added) {
      const sent = await embed.replyError(
        message,
        'Impossible d’ajouter ce rôle.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.addTempRole(
      guildId,
      member.id,
      role.id,
      Math.floor(durationMs / 1000)
    );

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `${role} a été ajouté à <@${member.id}> pendant **${durationStr}**.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

    const logEmbed = embed.sanction(guildId, {
      type         : 'temprole',
      targetTag    : member.user.username,
      targetId     : member.id,
      moderatorTag : message.author.username,
      reason       : `Ajout du rôle ${role.name}`,
      duration     : durationStr,
    });

    await logger.send(client, guildId, 'modlog', logEmbed);
  },
};

function resolveRole(message, args = [], durationStr = null) {
  const guild = message.guild;
  if (!guild) return { role: null, ambiguous: false };

  const mentioned = message.mentions.roles.first();
  if (mentioned) return { role: mentioned, ambiguous: false };

  const memberArg = args[0] ? String(args[0]) : '';
  const roleArgs = args.slice(1).filter(Boolean);

  if (!roleArgs.length) return { role: null, ambiguous: false };

  for (const part of roleArgs) {
    if (/^\d+$/.test(String(part))) {
      const roleById = guild.roles.cache.get(String(part));
      if (roleById) return { role: roleById, ambiguous: false };
    }
  }

  const filteredRoleParts = roleArgs.filter(part => {
    const value = String(part).trim();

    if (!value) return false;
    if (durationStr && value === durationStr) return false;

    const mentionMatch = value.match(/^<@&(\d+)>$/);
    if (mentionMatch) return false;

    return true;
  });

  const roleName = filteredRoleParts.join(' ').trim();
  if (!roleName) return { role: null, ambiguous: false };

  const matches = guild.roles.cache.filter(
    r => r.name.toLowerCase() === roleName.toLowerCase()
  );

  if (matches.size === 1) return { role: matches.first(), ambiguous: false };
  if (matches.size > 1)  return { role: null, ambiguous: true };

  return { role: null, ambiguous: false };
}

function extractDuration(args = []) {
  for (const arg of args) {
    if (parseDuration(String(arg)) != null) {
      return String(arg);
    }
  }
  return null;
}
