'use strict';


const { PermissionFlagsBits } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'member',
    description : 'Affiche les informations relatives à un membre sur le serveur.',
    usage       : 'member [membre]',
    aliases     : ['memberinfo', 'mi'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const member = await resolveMember(message, args);

    if (!member) {
      const sent = await embed.replyError(
        message,
        'Membre introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }


    const user = await client.users
      .fetch(member.user.id, { force: true })
      .catch(() => member.user);

    const avatarURL      = user.displayAvatarURL({ dynamic: true, size: 1024 });
    const guildAvatarURL = member.avatarURL({ dynamic: true, size: 1024 }) ?? null;
    const bannerURL      = user.bannerURL({ dynamic: true, size: 1024 }) ?? null;
    const guildBannerURL = member.bannerURL({ dynamic: true, size: 1024 }) ?? null;

    const createdAt = Math.floor(user.createdTimestamp / 1000);
    const joinedAt  = member.joinedTimestamp
      ? Math.floor(member.joinedTimestamp / 1000)
      : null;

    const premiumSince = member.premiumSinceTimestamp
      ? Math.floor(member.premiumSinceTimestamp / 1000)
      : null;

    const timeoutUntil = member.communicationDisabledUntilTimestamp
      ? Math.floor(member.communicationDisabledUntilTimestamp / 1000)
      : null;

    const roleList = member.roles.cache
      .filter(r => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map(r => `<@&${r.id}>`);

    const topRole = member.roles.highest?.id !== guild.id
      ? `<@&${member.roles.highest.id}>`
      : 'Aucun';

    const keyPerms = getKeyPermissions(member);

    const displayName = member.displayName && member.displayName !== user.username
      ? `${member.displayName} (@${user.username})`
      : `@${user.username}`;

    const fields = [
      {
        name  : 'Membre',
        value : `<@${user.id}>`,
        inline: true,
      },
      {
        name  : 'ID',
        value : user.id,
        inline: true,
      },
      {
        name  : 'Bot',
        value : user.bot ? 'Oui' : 'Non',
        inline: true,
      },
      {
        name  : 'Nom affiché',
        value : member.displayName ?? 'Aucun',
        inline: true,
      },
      {
        name  : 'Nom utilisateur',
        value : `@${user.username}`,
        inline: true,
      },
      {
        name  : 'Rôle principal',
        value : topRole,
        inline: true,
      },
      {
        name  : 'Compte créé le',
        value : `<t:${createdAt}:F>\n<t:${createdAt}:R>`,
        inline: true,
      },
      {
        name  : 'A rejoint le serveur',
        value : joinedAt
          ? `<t:${joinedAt}:F>\n<t:${joinedAt}:R>`
          : 'Inconnu',
        inline: true,
      },
      {
        name  : 'Boost',
        value : premiumSince
          ? `Depuis <t:${premiumSince}:F>\n<t:${premiumSince}:R>`
          : 'Non',
        inline: true,
      },
    ];

    if (timeoutUntil) {
      fields.push({
        name  : 'Timeout',
        value : `Jusqu'au <t:${timeoutUntil}:F>\n<t:${timeoutUntil}:R>`,
        inline: true,
      });
    }

    fields.push({
      name  : 'Avatar',
      value : `[Avatar global](${avatarURL})`,
      inline: true,
    });

    if (guildAvatarURL) {
      fields.push({
        name  : 'Avatar serveur',
        value : `[Avatar serveur](${guildAvatarURL})`,
        inline: true,
      });
    }


    if (bannerURL) {
      fields.push({
        name  : 'Bannière',
        value : `[Bannière globale](${bannerURL})`,
        inline: true,
      });
    }

    if (guildBannerURL) {
      fields.push({
        name  : 'Bannière serveur',
        value : `[Bannière serveur](${guildBannerURL})`,
        inline: true,
      });
    }

    const permsValue = joinSafe(keyPerms, ', ', 1024);
    if (permsValue) {
      fields.push({
        name  : 'Permissions clés',
        value : permsValue,
        inline: false,
      });
    }

    fields.push({
      name  : 'Rôles',
      value : buildRoleField(roleList),
      inline: false,
    });

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          null,
          {
            title      : 'Informations membre',
            authorName : displayName,

            authorIcon : guildAvatarURL ?? avatarURL,
            thumbnail  : guildAvatarURL ?? avatarURL,

            image      : guildBannerURL ?? bannerURL ?? undefined,
            fields,
            timestamp  : false,
          }
        ),
      ],
      allowedMentions: {
        repliedUser: false,
      },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function resolveMember(message, args) {
  if (message.reference?.messageId) {
    const repliedMessage = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);

    if (repliedMessage?.member) {
      return repliedMessage.member;
    }

    if (repliedMessage?.author) {
      return message.guild.members.fetch(repliedMessage.author.id).catch(() => null);
    }
  }

  const raw = args.join(' ').trim();

  if (!raw) return message.member;

  const cleaned = raw.replace(/[<@!>]/g, '').trim();

  if (/^\d{17,20}$/.test(cleaned)) {
    return message.guild.members.fetch(cleaned).catch(() => null);
  }

  const lowered = raw.toLowerCase();

  let member = message.guild.members.cache.find(m =>
    m.user.username.toLowerCase() === lowered ||
    (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
    m.displayName.toLowerCase() === lowered
  );

  if (member) return member;

  member = message.guild.members.cache.find(m =>
    m.user.username.toLowerCase().includes(lowered) ||
    (m.user.globalName && m.user.globalName.toLowerCase().includes(lowered)) ||
    m.displayName.toLowerCase().includes(lowered)
  );

  if (member) return member;

  const fetchedMembers = await message.guild.members.fetch().catch(() => null);

  if (fetchedMembers) {
    member = fetchedMembers.find(m =>
      m.user.username.toLowerCase() === lowered ||
      (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
      m.displayName.toLowerCase() === lowered
    );

    if (member) return member;

    member = fetchedMembers.find(m =>
      m.user.username.toLowerCase().includes(lowered) ||
      (m.user.globalName && m.user.globalName.toLowerCase().includes(lowered)) ||
      m.displayName.toLowerCase().includes(lowered)
    );

    if (member) return member;
  }

  return null;
}

function getKeyPermissions(member) {
  const perms = member.permissions;

  if (perms.has(PermissionFlagsBits.Administrator)) {
    return ['Administrateur'];
  }

  const labels = [];

  if (perms.has(PermissionFlagsBits.ManageGuild))    labels.push('Gérer le serveur');
  if (perms.has(PermissionFlagsBits.ManageChannels)) labels.push('Gérer les salons');
  if (perms.has(PermissionFlagsBits.ManageRoles))    labels.push('Gérer les rôles');
  if (perms.has(PermissionFlagsBits.KickMembers))    labels.push('Expulser');
  if (perms.has(PermissionFlagsBits.BanMembers))     labels.push('Bannir');
  if (perms.has(PermissionFlagsBits.ModerateMembers))labels.push('Timeout');
  if (perms.has(PermissionFlagsBits.ManageMessages)) labels.push('Gérer les messages');

  return labels;
}

function joinSafe(items, separator = ', ', maxLength = 1024) {
  if (!Array.isArray(items) || !items.length) return '';

  const result = [];
  let currentLength = 0;

  for (const item of items) {
    const value      = String(item);
    const extra      = result.length ? separator.length : 0;
    const nextLength = currentLength + extra + value.length;

    if (nextLength > maxLength) break;

    result.push(value);
    currentLength = nextLength;
  }

  return result.join(separator);
}

function buildRoleField(roleList) {
  if (!roleList.length) return 'Aucun';

  const header = `${roleList.length} rôle(s)\n`;
  const body   = joinSafe(roleList, ', ', 1024 - header.length);

  return `${header}${body || 'Aucun'}`;
}
