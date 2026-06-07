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
    name        : 'tempcmute',
    description : 'Mute temporairement un membre dans ce salon.',
    usage       : 'tempcmute <membre> <durée> [raison]',
    aliases     : ['tcmute'],
  },

  async run(client, message, args) {

    if (!perms.check(message, 'tempcmute')) return;

    const guild   = message.guild;
    const guildId = guild.id;
    const channel = message.channel;

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

    const isBuyer       = perms.isBuyer(message.author.id);
    const isGlobalOwner = db.isOwner(guildId,message.author.id);

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

    const edited = await channel.permissionOverwrites.edit(
      member.id,
      {
        SendMessages: false,
        AddReactions: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        SendMessagesInThreads: false,
      },
      { reason: 'CMute temporaire' }
    ).catch(() => null);

    if (!edited) {
      const sent = await embed.replyError(
        message,
        'Impossible de mute ce membre dans ce salon.',
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
      'cmute',
      reason,
      Math.floor(durationMs / 1000),
      channel.id
    );

    await modDm.send(client, guild, member, {
      type     : 'cmute',
      reason,
      duration : durationStr,
      modDmEnabled,
      moderator: message.member ?? message.author,
    });

    const sent = await channel.send({
      embeds: [
        embed.build(
          guildId,
          `<@${member.id}> a été mute dans ce salon pendant **${durationStr}**.`,
          {
            fields: [
              {
                name  : 'Raison',
                value : reason,
                inline: false,
              },
            ],
            timestamp: false,
          }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply)
      embed.scheduleDelete(sent, deleteDelay);

    const logEmbed = embed.sanction(guildId, {
      type        : 'cmute',
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
