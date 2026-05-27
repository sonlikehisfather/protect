'use strict';


const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const logger            = require('../../utils/logger');
const modDm             = require('../../utils/modDm');
const { resolveMember } = require('../../utils/memberResolver');
const { parseDuration } = require('../../utils/parseDuration.js');

module.exports = {
  help: {
    name        : 'tempban',
    description : 'Bannit temporairement un membre.',
    usage       : 'tempban <membre> <durée> [raison]',
    aliases     : ['tban'],
    permission  : {
      level           : 'owner',
      label           : 'Moderation',
      discord         : ['BanMembers'],
      targetProtection: true,
      bypass          : [],
      notes           : ['Pas de bypass hierarchy (contrairement a ban)'],
    },
  },

  async run(client, message, args) {

    if (!perms.check(message, 'tempban')) return;

    const guild   = message.guild;
    const guildId = guild.id;

    const config = db.getGuildConfig(guildId);

    const deleteCmd    = Boolean(config?.autoDeleteModCmds);
    const deleteReply  = Boolean(config?.autoDeleteModReplies);
    const deleteDelay  = config?.autoDeleteDelay ?? 5;
    const modDmEnabled = Boolean(config?.modDmEnabled ?? 1);

    if (!args[0]) {

      const sent = await embed.replyError(
        message,
        'Veuillez préciser un membre.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    if (!args[1]) {

      const sent = await embed.replyError(
        message,
        'Veuillez préciser une durée.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    const target = await resolveMember(message, [args[0]]);

    if (!target) {

      const sent = await embed.replyError(
        message,
        'Membre introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    if (target.id === message.author.id) {

      const sent = await embed.replyError(
        message,
        'Vous ne pouvez pas vous bannir vous-même.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    if (target.id === client.user.id) {

      const sent = await embed.replyError(
        message,
        'Je ne peux pas me bannir moi-même.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    if (perms.isProtected(target.id, guildId, target)) {

      const sent = await embed.replyError(
        message,
        'Ce membre est protégé.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me || !me.permissions.has('BanMembers')) {

      const sent = await embed.replyError(
        message,
        'Je n’ai pas la permission de bannir des membres.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    if (!target.bannable ||
        target.roles.highest.position >= me.roles.highest.position) {

      const sent = await embed.replyError(
        message,
        'Je ne peux pas bannir ce membre.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    const durationStr = args[1];
    const durationMs  = parseDuration(durationStr, { minMs: 1000 });

    if (!durationMs || isNaN(durationMs) || durationMs < 1000) {

      const sent = await embed.replyError(
        message,
        'Durée invalide. Exemples : `30m`, `1h`, `3d`, `7d`.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    const reason =
      args.slice(2).join(' ') ||
      'Aucune raison fournie';

    if (deleteCmd)
      await message.delete().catch(() => {});

    await modDm.send(client, guild, target, {
      type: 'tempban',
      reason,
      duration: durationStr,
      modDmEnabled,
      moderator: message.member ?? message.author,
    });

    const banned =
      await target.ban({ reason, deleteMessageSeconds: 86400 })
      .catch(() => null);

    if (!banned) {

      const sent = await embed.replyError(
        message,
        'Le bannissement temporaire a échoué.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    const durationSeconds =
      Math.floor(durationMs / 1000);

    db.addSanction(
      guildId,
      target.id,
      message.author.id,
      'ban',
      reason,
      durationSeconds
    );

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `**${target.user.tag}** a été banni temporairement pendant **${durationStr}**.`,
          {
            fields: [
              {
                name  : 'Raison',
                value : reason,
                inline: false,
              }
            ],
            timestamp: false,
          }
        )
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply)
      embed.scheduleDelete(sent, deleteDelay);

    const e = embed.sanction(guildId, {
      type        : 'ban',
      targetTag   : target.user.tag,
      targetId    : target.id,
      moderatorTag: message.author.tag,
      reason,
      duration    : durationStr,
    });

    await logger.send(client, guildId, 'modlog', e);

  }
};
