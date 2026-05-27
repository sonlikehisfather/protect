'use strict';


const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');
const logger = require('../../utils/logger');

const { resolveMember } = require('../../utils/memberResolver');

module.exports = {
  help: {
    name        : 'untemprole',
    description : 'Retire un rôle temporaire.',
    usage       : 'untemprole <membre> <rôle>',
    aliases     : [],
  },

  async run(client, message, args) {
    if (!perms.check(message, 'untemprole')) return;

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteRoleReplies ?? config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (!args.length) {
      const sent = await embed.replyError(
        message,
        'Utilisation : `untemprole <membre> <rôle>`.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const target = await resolveMember(message, args);

    if (!target) {
      const sent = await embed.replyError(
        message,
        'Membre introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const resolved = resolveRole(message, args.slice(1));

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

    if (perms.isProtected(target.id, guildId, target)) {
      const sent = await embed.replyError(
        message,
        'Ce membre est protégé.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!target.roles.cache.has(role.id)) {
      const sent = await embed.replyError(
        message,
        'Ce membre ne possède pas ce rôle.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const removed = await target.roles.remove(
      role,
      `Untemprole par ${message.author.username}`
    ).catch(() => null);

    if (!removed) {
      const sent = await embed.replyError(
        message,
        'Impossible de retirer ce rôle.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.deleteTempRole(guildId, target.id, role.id);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Le rôle **${role.name}** a été retiré à **${target.user.username}**.`,
          { timestamp: false }
        ),
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

    const logEmbed = embed.sanction(guildId, {
      type         : 'untemprole',
      targetTag    : target.user.username,
      targetId     : target.id,
      moderatorTag : message.author.username,
      reason       : 'Suppression rôle temporaire',
    });

    await logger.send(client, guildId, 'modlog', logEmbed);
  },
};

function resolveRole(message, parts = []) {
  const guild = message.guild;
  if (!guild) return { role: null, ambiguous: false };

  const mentioned = message.mentions.roles.first();
  if (mentioned) return { role: mentioned, ambiguous: false };

  const raw = parts.join(' ').trim();
  if (!raw) return { role: null, ambiguous: false };

  const cleaned = raw.replace(/[<@&>]/g, '').trim();

  if (/^\d{17,20}$/.test(cleaned)) {
    return { role: guild.roles.cache.get(cleaned) ?? null, ambiguous: false };
  }

  const lowered = raw.toLowerCase();
  const matches = guild.roles.cache.filter(r => r.name.toLowerCase() === lowered);

  if (matches.size === 1) return { role: matches.first(), ambiguous: false };
  if (matches.size > 1)  return { role: null, ambiguous: true };

  return { role: null, ambiguous: false };
}
