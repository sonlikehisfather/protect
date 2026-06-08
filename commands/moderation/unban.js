'use strict';


const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');
const logger = require('../../utils/logger');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

module.exports = {
  help: {
    name        : 'unban',
    description : 'Débannit un utilisateur.',
    usage       : 'unban <id> [raison]',
    aliases     : [],
    permission  : {
      level           : 'owner',
      label           : 'Moderation',
      discord         : [],
      targetProtection: true,
      bypass          : [],
      notes           : ['BanMembers implicite via guild.bans.remove'],
    },
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    const userId = args[0]?.trim();

    if (!userId || !/^\d{17,20}$/.test(userId)) {
      const sent = await embed.replyError(
        message,
        'Veuillez fournir un ID Discord valide.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (perms.isProtected(userId, guildId)) {
      const sent = await embed.replyError(
        message,
        'Cet utilisateur est protégé.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const ban = await guild.bans.fetch(userId).catch(() => null);

    if (!ban) {
      const sent = await embed.replyError(
        message,
        'Cet utilisateur n’est pas banni.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const reason = args.slice(1).join(' ').trim() || 'Aucune raison fournie';

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const unbanned = await guild.bans.remove(userId, reason).catch(() => null);

    if (!unbanned) {
      const sent = await embed.replyError(
        message,
        'Le débannissement a échoué.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const activeBan = db.getActiveSanction(guildId, userId, 'ban');
    if (activeBan) {
      db.expireSanction(activeBan.id);
    }

    db.addSanction(guildId, userId, message.author.id, 'unban', reason);

    let sentPayload;
    if (V2_AVAILABLE) {
      try {
        const body =
          `## Débanni

` +
          `**Membre** › <@${userId}> \`${userId}\`
` +
          `**Raison** › ${reason}
` +
          `**Modérateur** › <@${message.author.id}>

` +
          `-# <t:${Math.floor(Date.now() / 1000)}:f>`;
        const container = new ContainerBuilder().setAccentColor(0x57F287);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
        sentPayload = { embeds: [], components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
      } catch {}
    }
    if (!sentPayload) {
      sentPayload = {
        embeds: [embed.build(guildId, null, {
          authorName: ban.user.username,
          color     : '#57F287',
          fields    : [{ name: 'Raison', value: reason, inline: false }],
          footer    : { text: userId },
          timestamp : false,
        })],
        allowedMentions: { repliedUser: false },
      };
    }

    const sent = await message.channel.send(sentPayload).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);

    const e = embed.sanction(guildId, {
      type        : 'unban',
      targetTag   : ban.user.tag,
      targetId    : userId,
      moderatorTag: message.author.tag,
      reason,
    });

    await logger.send(client, guildId, 'modlog', e);
  },
};
