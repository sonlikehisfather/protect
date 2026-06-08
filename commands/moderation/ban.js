'use strict';


const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const logger            = require('../../utils/logger');
const modDm             = require('../../utils/modDm');
const { resolveMember } = require('../../utils/memberResolver');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

module.exports = {
  help: {
    name        : 'ban',
    description : 'Bannit un membre.',
    usage       : 'ban <membre> [raison]',
    aliases     : [],
    permission  : {
      level           : 'owner',
      label           : 'Moderation',
      discord         : ['BanMembers'],
      targetProtection: true,
      bypass          : ['buyer', 'globalOwner'],
    },
  },

  async run(client, message, args) {

    if (!perms.check(message, 'ban')) return;

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

    const target =
      await resolveMember(message, [args[0]]);

    const targetId =
      target?.id ??
      args[0]?.replace(/[<@!>]/g, '');

    const targetUser =
      target?.user ??
      await client.users.fetch(targetId).catch(() => null);

    if (!targetUser || !targetId) {

      const sent = await embed.replyError(
        message,
        'Utilisateur introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    if (targetId === message.author.id) {

      const sent = await embed.replyError(
        message,
        'Vous ne pouvez pas vous bannir vous-même.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    if (targetId === client.user.id) {

      const sent = await embed.replyError(
        message,
        'Je ne peux pas me bannir moi-même.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    if (perms.isProtected(targetId, guildId, target)) {

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
    const isOwner = perms.isOwner(guildId, message.author.id);

    if (target && !isBuyer && !isOwner && target.roles.highest.position >= message.member.roles.highest.position) {
      const sent = await embed.replyError(
        message,
        'Vous ne pouvez pas bannir ce membre.',
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

    if (target && (
        !target.bannable ||
        target.roles.highest.position >= me.roles.highest.position
    )) {

      const sent = await embed.replyError(
        message,
        'Je ne peux pas bannir ce membre.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    const reason =
      args.slice(1).join(' ') ||
      'Aucune raison fournie';

    if (deleteCmd)
      await message.delete().catch(() => {});

    if (target) {
      await modDm.send(client, guild, target, {
      type: 'ban',
      reason,
      modDmEnabled,
      moderator: message.member ?? message.author,
      });
    }

    const banned =
      await guild.members.ban(targetId, { reason, deleteMessageSeconds: 86400 })
      .catch(() => null);

    if (!banned) {

      const sent = await embed.replyError(
        message,
        'Le bannissement a échoué.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(sent, deleteDelay);

      return;
    }

    db.addSanction(
      guildId,
      targetId,
      message.author.id,
      'ban',
      reason,
      null
    );

    let sentPayload;
    if (V2_AVAILABLE) {
      try {
        const body =
          `## Banni

` +
          `**Membre** › <@${targetId}> \`${targetId}\`
` +
          `**Raison** › ${reason}
` +
          `**Modérateur** › <@${message.author.id}>

` +
          `-# <t:${Math.floor(Date.now() / 1000)}:f>`;
        const container = new ContainerBuilder().setAccentColor(0xED4245);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
        sentPayload = { embeds: [], components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
      } catch {}
    }
    if (!sentPayload) {
      sentPayload = {
        embeds: [embed.build(guildId, null, {
          authorName: targetUser.username,
          color     : '#ED4245',
          fields    : [{ name: 'Raison', value: reason, inline: false }],
          footer    : { text: targetId },
          timestamp : false,
        })],
        allowedMentions: { parse: [] },
      };
    }

    const sent = await message.channel.send(sentPayload).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);

    const e = embed.sanction(guildId, {
      type        : 'ban',
      targetTag   : targetUser.tag,
      targetId,
      moderatorTag: message.author.tag,
      reason,
    });

    await logger.send(client, guildId, 'modlog', e);

  }
};
