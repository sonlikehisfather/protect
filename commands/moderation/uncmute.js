'use strict';


const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const logger            = require('../../utils/logger');
const { resolveMember } = require('../../utils/memberResolver');

module.exports = {
  help: {
    name        : 'uncmute',
    description : 'Retire le mute d’un membre dans ce salon.',
    usage       : 'uncmute <membre> [raison]',
    aliases     : [],
  },

  async run(client, message, args) {

    if (!perms.check(message, 'uncmute')) return;

    const guild   = message.guild;
    const guildId = guild.id;
    const channel = message.channel;

    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

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
          'Vous ne pouvez pas modifier ce membre.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply)
          embed.scheduleDelete(sent, deleteDelay);

        return;
      }
    }

    const overwrite = channel.permissionOverwrites.cache.get(member.id);

    if (!overwrite) {
      const sent = await embed.replyError(
        message,
        'Ce membre n’est pas mute dans ce salon.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    const reason =
      args.slice(1).join(' ')
      || 'Aucune raison fournie';

    if (deleteCmd)
      await message.delete().catch(() => {});

    const removed = await channel.permissionOverwrites
      .delete(member.id, reason)
      .catch(() => null);

    if (!removed) {
      const sent = await embed.replyError(
        message,
        'Impossible de retirer le mute dans ce salon.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }


    if (typeof db.getSanctions === 'function' && typeof db.expireSanction === 'function') {
      const sanctions = db.getSanctions(guildId, member.id) || [];

      for (const sanction of sanctions) {
        if (
          sanction.type === 'cmute' &&
          sanction.deletedAt == null &&
          Number(sanction.active ?? 1) === 1 &&
          String(sanction.channelId ?? '') === String(channel.id)
        ) {
          db.expireSanction(sanction.id);
        }
      }
    }

    const sent = await channel.send({
      embeds: [
        embed.build(
          guildId,
          `<@${member.id}> n’est plus mute dans ce salon.`,
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
      type        : 'uncmute',
      targetTag   : member.user.tag,
      targetId    : member.id,
      moderatorTag: message.author.tag,
      reason,
    });

    await logger.send(
      client,
      guildId,
      'modlog',
      logEmbed
    );

  },
};
