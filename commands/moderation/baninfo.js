'use strict';

const {
  AuditLogEvent,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

module.exports = {
  help: {
    name        : 'baninfo',
    description : 'Affiche les informations d’un utilisateur banni.',
    usage       : 'baninfo <id>',
    aliases     : ['binfo', 'infoban'],
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

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const ban = await guild.bans.fetch(userId).catch(() => null);
    const wetEntry = db.getWetEntry(userId);
    const blacklistEntry = db.getBlacklistEntry(guildId, userId);

    if (!ban && !wetEntry && !blacklistEntry) {
      const sent = await embed.replyError(
        message,
        'Cet utilisateur n’est pas banni.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const targetUser = ban?.user ?? await client.users.fetch(userId).catch(() => null);

    const activeBan = db.getActiveSanction
      ? db.getActiveSanction(guildId, userId, 'ban')
      : null;
    const banAudit = !wetEntry && !blacklistEntry
      ? await _findBanAuditEntry(guild, userId)
      : null;

    let statusText = wetEntry
      ? 'Wet'
      : blacklistEntry
      ? 'Blacklisté sur ce serveur'
      : 'Banni définitivement';
    let endText    = 'Aucune';
    let reasonText = activeBan?.reason || ban?.reason || banAudit?.reason || 'Aucune raison fournie';
    let modText    = 'Inconnu';

    if (wetEntry) {
      reasonText = wetEntry.reason || 'Aucune raison fournie';
    } else if (blacklistEntry) {
      reasonText = blacklistEntry.reason || 'Aucune raison fournie';
    } else if (activeBan) {
      if (activeBan.reason) {
        reasonText = activeBan.reason;
      }

      if (activeBan.moderatorId) {
        modText = await _resolveModeratorTag(client, guild, activeBan.moderatorId);
      }

      if (activeBan.duration && activeBan.createdAt) {
        const endTs = activeBan.createdAt + activeBan.duration;

        if (endTs > Math.floor(Date.now() / 1000)) {
          statusText = 'Banni temporairement';
          endText    = `<t:${endTs}:f>`;
        }
      }
    }

    if (!wetEntry && !blacklistEntry) {
      if (!activeBan?.reason && banAudit?.reason) {
        reasonText = banAudit.reason;
      }
      if (!activeBan?.moderatorId && banAudit?.executor?.id) {
        modText = await _resolveModeratorTag(client, guild, banAudit.executor.id);
      }
    }

    const isTmp  = statusText === 'Banni temporairement';
    const specialEntry = wetEntry ?? blacklistEntry;
    const banDateLabel = wetEntry
      ? 'Wet depuis'
      : blacklistEntry
      ? 'Blacklisté depuis'
      : 'Banni le';
    const banDateText = wetEntry?.addedAt
      ? `<t:${wetEntry.addedAt}:f>`
      : blacklistEntry?.addedAt
      ? `<t:${blacklistEntry.addedAt}:f>`
      : activeBan?.createdAt
      ? `<t:${activeBan.createdAt}:f>`
      : banAudit?.createdTimestamp
      ? `<t:${Math.floor(banAudit.createdTimestamp / 1000)}:f>`
      : 'Inconnue';

    const lines  = [
      `## <@${userId}> \`${userId}\``,
      '',
      `**Statut** › ${statusText}`,
      `**${banDateLabel}** › ${banDateText}`,
    ];

    if (!specialEntry) lines.push(`**Modérateur** › ${modText}`);

    if (isTmp) {
      lines.push(`**Expiration** › ${endText}`);
    }

    const tsFooter = wetEntry?.addedAt
      ? `-# Wet depuis <t:${wetEntry.addedAt}:f>`
      : blacklistEntry?.addedAt
      ? `-# Blacklisté depuis <t:${blacklistEntry.addedAt}:f>`
      : activeBan?.createdAt
      ? `-# <t:${activeBan.createdAt}:f>`
      : banAudit?.createdTimestamp
      ? `-# <t:${Math.floor(banAudit.createdTimestamp / 1000)}:f>`
      : null;
    lines.push('', `> ${_truncate(reasonText)}`);
    if (tsFooter) lines.push('', tsFooter);

    const body = lines.join('\n');

    let payload;

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
        payload = {
          embeds          : [],
          components      : [container],
          flags           : COMPONENTS_V2_FLAG,
          allowedMentions : { parse: [] },
        };
      } catch { V2_AVAILABLE && (payload = null); }
    }

    if (!payload) {
      const fields = [
        { name: 'Statut', value: statusText, inline: true },
      ];
      if (!specialEntry) fields.push({ name: 'Modérateur', value: modText, inline: true });
      if (wetEntry?.addedAt) fields.push({ name: 'Wet depuis', value: `<t:${wetEntry.addedAt}:f>`, inline: true });
      else if (blacklistEntry?.addedAt) fields.push({ name: 'Blacklisté depuis', value: `<t:${blacklistEntry.addedAt}:f>`, inline: true });
      else if (banDateText !== 'Inconnue') fields.push({ name: 'Banni le', value: banDateText, inline: true });
      if (isTmp) fields.push({ name: 'Expiration', value: endText, inline: true });
      fields.push({ name: 'Raison', value: _truncate(reasonText), inline: false });

      payload = {
        embeds: [embed.build(guildId, null, {
          authorName : targetUser?.username ?? userId,
          authorIcon : targetUser?.displayAvatarURL({ size: 64, extension: 'png' }),
          color      : '#ED4245',
          fields,
          footer     : { text: userId },
          timestamp  : false,
        })],
        allowedMentions: { repliedUser: false },
      };
    }

    const sent = await message.channel.send(payload).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function _resolveModeratorTag(client, guild, moderatorId) {
  if (!moderatorId) return 'Inconnu';

  if (client.user?.id === moderatorId) {
    return client.user.tag;
  }

  const member = await guild.members.fetch(moderatorId).catch(() => null);
  if (member) return member.user.tag;

  const user = await client.users.fetch(moderatorId).catch(() => null);
  if (user) return user.tag;

  return `<@${moderatorId}> (\`${moderatorId}\`)`;
}

async function _findBanAuditEntry(guild, userId) {
  const auditLogs = await guild.fetchAuditLogs({
    type : AuditLogEvent.MemberBanAdd,
    limit: 100,
  }).catch(() => null);
  if (!auditLogs) return null;

  return [...auditLogs.entries.values()]
    .filter(entry => entry.target?.id === userId)
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0] ?? null;
}

function _truncate(text, max = 300) {
  const value = String(text || 'Aucune raison fournie').trim();
  const cut   = value.length <= max ? value : `${value.slice(0, max - 3)}...`;
  return embed.breakLongTokens(cut);
}
