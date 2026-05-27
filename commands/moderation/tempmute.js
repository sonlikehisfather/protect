'use strict';


const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const logger            = require('../../utils/logger');
const modDm             = require('../../utils/modDm');
const { parseDuration } = require('../../utils/parseDuration.js');
const { resolveMember } = require('../../utils/memberResolver');

module.exports = {
  help: {
    name        : 'tempmute',
    description : 'Mute temporairement un membre.',
    usage       : 'tempmute <membre> <durée> [raison]',
    aliases     : ['tmute'],
    permission  : {
      level           : 'owner',
      label           : 'Moderation',
      discord         : ['ModerateMembers', 'ManageRoles'],
      targetProtection: true,
      bypass          : ['buyer', 'globalOwner'],
      notes           : ['ModerateMembers pour timeout, ManageRoles pour role mute'],
    },
  },

  async run(client, message, args) {

    if (!perms.check(message, 'tempmute')) return;

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd    = Boolean(config?.autoDeleteModCmds);
    const deleteReply  = Boolean(config?.autoDeleteModReplies);
    const deleteDelay  = config?.autoDeleteDelay ?? 5;
    const modDmEnabled = Boolean(config?.modDmEnabled ?? 1);

    const member = await resolveMember(message, [args[0]]);

    if (!member) {
      const sent = await embed.replyError(
        message,
        'Membre introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    const durationStr = args[1];
    const durationMs  = parseDuration(durationStr, { minMs: 1000 });

    if (!durationMs || durationMs < 1000) {

      const sent = await embed.replyError(
        message,
        'Durée invalide. Exemple : `10m`, `1h`, `1d`.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    if (perms.isProtected(member.id, guildId, member)) {

      const sent = await embed.replyError(
        message,
        'Ce membre est protégé.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    const me = guild.members.me
      ?? await guild.members.fetchMe().catch(() => null);

    if (!me) return;

    const isBuyer       = perms.isBuyer(message.author.id);
    const isGlobalOwner = db.isGlobalOwner(message.author.id);

    if (!isBuyer && !isGlobalOwner) {

      if (
        member.id !== message.author.id &&
        member.roles.highest.position >= message.member.roles.highest.position
      ) {

        const sent = await embed.replyError(
          message,
          'Vous ne pouvez pas mute ce membre.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply)
          embed.scheduleDelete(sent, deleteDelay);

        return;
      }
    }

    const reason =
      args.slice(2).join(' ')
      || 'Aucune raison fournie';

    if (deleteCmd)
      await message.delete().catch(() => {});


    const useTimeout = Boolean(config?.useTimeout);

    let muteApplied = false;
    const muteWarnings = [];

    if (useTimeout) {

      if (!me.permissions.has('ModerateMembers')) {

        const sent = await embed.replyError(
          message,
          'Je n’ai pas la permission Timeout.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply)
          embed.scheduleDelete(sent, deleteDelay);

        return;
      }


      if (durationMs > 28 * 24 * 60 * 60 * 1000) {

        const sent = await embed.replyError(
          message,
          'La durée maximale d’un timeout Discord est de 28 jours.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply)
          embed.scheduleDelete(sent, deleteDelay);

        return;
      }

      muteApplied = await member.timeout(
        durationMs,
        reason
      ).then(() => true).catch(() => false);

    }

    else {

      const muteRoleId = config?.muteRoleId;

      if (!muteRoleId) {

        const sent = await embed.replyError(
          message,
          'Aucun rôle mute configuré.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply)
          embed.scheduleDelete(sent, deleteDelay);

        return;
      }

      const muteRole =
        guild.roles.cache.get(muteRoleId);

      if (!muteRole) {

        const sent = await embed.replyError(
          message,
          'Le rôle mute configuré est introuvable.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply)
          embed.scheduleDelete(sent, deleteDelay);

        return;
      }


      if (!me.permissions.has('ManageRoles')) {

        const sent = await embed.replyError(
          message,
          'Je n’ai pas la permission de gérer les rôles.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply)
          embed.scheduleDelete(sent, deleteDelay);

        return;
      }

      if (me.roles.highest.comparePositionTo(muteRole) <= 0) {

        const sent = await embed.replyError(
          message,
          'Le rôle mute est au-dessus de mon rôle le plus haut. Déplacez mon rôle au-dessus.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply)
          embed.scheduleDelete(sent, deleteDelay);

        return;
      }

      muteApplied = await member.roles.add(muteRole, reason)
        .then(() => true)
        .catch(() => false);


      if (muteApplied && typeof db.addTempRole === 'function') {

        db.addTempRole(
          guildId,
          member.id,
          muteRoleId,
          Math.floor(durationMs / 1000)
        );

      }


      if (muteApplied) {

        if (member.permissions.has('Administrator')) {
          muteWarnings.push(
            'Ce membre possède la permission **Administrator** : le rôle mute peut être inopérant.'
          );
        }

        const channelPerms = message.channel.permissionsFor(member);
        if (channelPerms?.has('SendMessages')) {
          muteWarnings.push(
            'Ce membre peut encore écrire dans ce salon. Vérifiez les overwrites du rôle mute (essayez `+muteconfig setup`).'
          );
        }

      }

    }

    if (!muteApplied) {

      const sent = await embed.replyError(
        message,
        'Le mute a échoué.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    db.addSanction(
      guildId,
      member.id,
      message.author.id,
      'mute',
      reason,
      Math.floor(durationMs / 1000)
    );

    await modDm.send(client, guild, member, {
      type     : 'mute',
      reason,
      duration : durationStr,
      modDmEnabled,
      moderator: message.member ?? message.author,
    });

    const successFields = [
      {
        name  : 'Raison',
        value : reason,
        inline: false,
      },
    ];

    if (muteWarnings.length > 0) {
      successFields.push({
        name  : 'Avertissement',
        value : muteWarnings.join('\n'),
        inline: false,
      });
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `<@${member.id}> a été mute pendant **${durationStr}**.`,
          {
            fields    : successFields,
            timestamp : false,
          }
        )
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply)
      embed.scheduleDelete(sent, deleteDelay);

    const logEmbed = embed.sanction(guildId, {
      type        : 'mute',
      targetTag   : member.user.tag,
      targetId    : member.id,
      moderatorTag: message.author.tag,
      reason,
      duration    : durationStr,
    });

    await logger.send(
      client,
      guildId,
      'modlog',
      logEmbed
    );

  },
};
