'use strict';


const { PermissionFlagsBits } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'role',
    description : 'Affiche les informations relatives à un rôle.',
    usage       : 'role <rôle>',
    aliases     : ['roleinfo', 'ri'],
  },

  async run(client, message, args) {

    const guild = message.guild;
    if (!guild) return;

    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd = Boolean(config?.autoDeleteInfoCmds);


    const deleteReply =
      config?.autoDeleteRoleReplies != null
        ? Boolean(config.autoDeleteRoleReplies)
        : Boolean(config?.autoDeleteInfoReplies);

    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const role = resolveRole(message, args);

    if (!role) {
      const sent = await embed.replyError(
        message,
        `Aucun rôle trouvé pour : \`${args.join(' ') || 'inconnu'}\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const createdAt   = role.createdTimestamp
      ? Math.floor(role.createdTimestamp / 1000)
      : null;

    const memberCount = role.members?.size ?? 0;
    const shownPerms  = getImportantPermissions(role);

    const fields = [
      {
        name  : 'Rôle',
        value : `<@&${role.id}>`,
        inline: true,
      },
      {
        name  : 'ID',
        value : role.id,
        inline: true,
      },
      {
        name  : 'Couleur',
        value : role.hexColor && role.hexColor !== '#000000'
          ? `\`${role.hexColor}\``
          : 'Aucune',
        inline: true,
      },
      {
        name  : 'Position',
        value : String(role.position),
        inline: true,
      },
      {
        name  : 'Membres',
        value : String(memberCount),
        inline: true,
      },
      {
        name  : 'Mentionnable',
        value : role.mentionable ? 'Oui' : 'Non',
        inline: true,
      },
      {
        name  : 'Affiché séparément',
        value : role.hoist ? 'Oui' : 'Non',
        inline: true,
      },
      {
        name  : 'Géré par une intégration',
        value : role.managed ? 'Oui' : 'Non',
        inline: true,
      },
      {
        name  : 'Créé le',
        value : createdAt
          ? `<t:${createdAt}:F>\n<t:${createdAt}:R>`
          : 'Inconnu',
        inline: true,
      },
    ];

    const permsValue = joinSafe(shownPerms, ', ', 1024);
    if (permsValue) {
      fields.push({
        name  : 'Permissions clés',
        value : permsValue,
        inline: false,
      });
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          null,
          {
            title     : role.name,
            thumbnail : role.iconURL() ?? undefined,
            fields,
            timestamp : false,
          }
        )
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

function resolveRole(message, args) {

  const mentionedRole = message.mentions.roles.first();
  if (mentionedRole) return mentionedRole;

  const raw = args.join(' ').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[<@&>]/g, '').trim();

  if (/^\d{17,20}$/.test(cleaned)) {
    return message.guild.roles.cache.get(cleaned) ?? null;
  }

  const lowered = raw.toLowerCase();

  const exactRole = message.guild.roles.cache.find(r =>
    r.name.toLowerCase() === lowered
  );
  if (exactRole) return exactRole;

  const partialRole = message.guild.roles.cache.find(r =>
    r.name.toLowerCase().includes(lowered)
  );
  if (partialRole) return partialRole;

  return null;
}

function getImportantPermissions(role) {

  const perms = role.permissions;
  const labels = [];

  if (perms.has(PermissionFlagsBits.Administrator)) {
    return ['Administrateur'];
  }

  if (perms.has(PermissionFlagsBits.ManageGuild)) {
    labels.push('Gérer le serveur');
  }

  if (perms.has(PermissionFlagsBits.ManageChannels)) {
    labels.push('Gérer les salons');
  }

  if (perms.has(PermissionFlagsBits.ManageRoles)) {
    labels.push('Gérer les rôles');
  }

  if (perms.has(PermissionFlagsBits.ViewAuditLog)) {
    labels.push('Voir les logs');
  }

  if (perms.has(PermissionFlagsBits.KickMembers)) {
    labels.push('Expulser');
  }

  if (perms.has(PermissionFlagsBits.BanMembers)) {
    labels.push('Bannir');
  }

  if (perms.has(PermissionFlagsBits.ModerateMembers)) {
    labels.push('Timeout');
  }

  if (perms.has(PermissionFlagsBits.ManageMessages)) {
    labels.push('Gérer les messages');
  }

  if (perms.has(PermissionFlagsBits.MentionEveryone)) {
    labels.push('Mention everyone');
  }

  if (perms.has(PermissionFlagsBits.ManageWebhooks)) {
    labels.push('Gérer les webhooks');
  }

  if (perms.has(PermissionFlagsBits.ManageEmojisAndStickers)) {
    labels.push('Gérer les émojis');
  }

  return labels;
}

function joinSafe(items, separator = ', ', maxLength = 1024) {
  if (!Array.isArray(items) || !items.length) return '';

  const result = [];
  let currentLength = 0;

  for (const item of items) {
    const value = String(item);
    const extra = result.length ? separator.length : 0;
    const nextLength = currentLength + extra + value.length;

    if (nextLength > maxLength) break;

    result.push(value);
    currentLength = nextLength;
  }

  return result.join(separator);
}
