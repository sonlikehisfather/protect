'use strict';

const {
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

    if (!ban) {
      const sent = await embed.replyError(
        message,
        'Cet utilisateur n’est pas banni.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const activeBan = db.getActiveSanction
      ? db.getActiveSanction(guildId, userId, 'ban')
      : null;

    let statusText = 'Banni définitivement';
    let endText    = 'Aucune';
    let reasonText = ban.reason || 'Aucune raison fournie';
    let modText    = 'Inconnu';

    if (activeBan) {
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

    const isTmp  = statusText === 'Banni temporairement';
    const banDateText = activeBan?.createdAt
      ? `<t:${activeBan.createdAt}:f>`
      : 'Inconnue';

    const lines  = [
      `## <@${ban.user.id}> \`${ban.user.id}\``,
      '',
      `**Statut** › ${statusText}`,
      `**Banni le** › ${banDateText}`,
      `**Modérateur** › ${modText}`,
    ];

    if (isTmp) {
      lines.push(`**Expiration** › ${endText}`);
    }

    const tsFooter = activeBan?.createdAt ? `-# <t:${activeBan.createdAt}:f>` : null;
    lines.push('', `> ${_truncate(reasonText)}`);
    if (tsFooter) lines.push('', tsFooter);

    const body = lines.join('\n');

    let payload;

    if (V2_AVAILABLE) {
      try {
        const container = new ContainerBuilder().setAccentColor(0xED4245);
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
        { name: 'Statut',      value: statusText,            inline: true },
        { name: 'Modérateur',  value: modText,               inline: true },
      ];
      if (isTmp) fields.push({ name: 'Expiration', value: endText, inline: true });
      fields.push({ name: 'Raison', value: _truncate(reasonText), inline: false });

      payload = {
        embeds: [embed.build(guildId, null, {
          authorName : `${ban.user.username}`,
          authorIcon : ban.user.displayAvatarURL({ size: 64, extension: 'png' }),
          color      : '#ED4245',
          fields,
          footer     : { text: ban.user.id },
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

function _truncate(text, max = 300) {
  const value = String(text || 'Aucune raison fournie').trim();
  const cut   = value.length <= max ? value : `${value.slice(0, max - 3)}...`;
  return embed.breakLongTokens(cut);
}
