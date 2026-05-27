'use strict';


const {
  ChannelType,
  PermissionsBitField,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');
const config = require('../../config.json');

module.exports = {
  help: {
    name        : 'invite',
    description : 'Envoie une invitation pour un serveur où se trouve le bot.',
    use         : 'invite <ID/nombre>',
    usage       : 'invite <ID/nombre>',
    aliases     : ['guildinvite', 'serverinvite'],
    category    : 'owner',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const guildConfig = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
    const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
    const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);
    const prefix      = guildConfig?.prefix ?? config.prefix ?? '+';

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const targetArg = args[0];

    if (!targetArg) {
      return _sendError(
        message,
        `Utilisation : \`${prefix}invite <ID/nombre>\`\nLe nombre correspond à la position dans \`${prefix}serverlist\`.`,
        deleteReply,
        deleteDelay
      );
    }

    const targetGuild = await _resolveGuild(client, targetArg);

    if (!targetGuild) {
      return _sendError(
        message,
        `Serveur introuvable. Utilisez \`${prefix}serverlist\` pour voir les IDs et numéros.`,
        deleteReply,
        deleteDelay
      );
    }

    const channel = await _findInviteChannel(targetGuild);

    if (!channel) {
      return _sendError(
        message,
        `Impossible de trouver un salon où créer une invitation sur \`${_escape(targetGuild.name)}\`.`,
        deleteReply,
        deleteDelay
      );
    }

    const invite = await channel.createInvite({
      maxAge : 86400,
      maxUses: 0,
      unique : false,
      reason : `Invitation demandée par ${message.author.tag}`,
    }).catch((err) => {
      console.error('[invite] Impossible de créer une invitation :', err?.message ?? err);
      return null;
    });

    if (!invite) {
      return _sendError(
        message,
        'Impossible de créer une invitation. Vérifiez les permissions du bot sur le serveur cible.',
        deleteReply,
        deleteDelay
      );
    }

    const sent = await message.reply({
      embeds: [
        embed.build(
          guildId,
          `Serveur : **${_escape(targetGuild.name)}**\n` +
          `ID : \`${targetGuild.id}\`\n` +
          `Salon : ${channel}\n` +
          `Invitation : ${invite.url}`,
          {
            title    : 'Invitation créée',
            timestamp: false,
          }
        ),
      ],
      allowedMentions: { repliedUser: false, parse: [] },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function _resolveGuild(client, value) {
  const raw = String(value || '').trim();

  if (!raw) return null;

  if (/^\d{17,20}$/.test(raw)) {
    return client.guilds.cache.get(raw)
      ?? await client.guilds.fetch(raw).catch(() => null);
  }

  const index = Number.parseInt(raw, 10);

  if (Number.isInteger(index) && index > 0) {
    return _getSortedGuilds(client)[index - 1] ?? null;
  }

  return null;
}

function _getSortedGuilds(client) {
  return [...client.guilds.cache.values()]
    .sort((a, b) => {
      const joinedA = Number(a.joinedTimestamp || 0);
      const joinedB = Number(b.joinedTimestamp || 0);

      if (joinedA && joinedB && joinedA !== joinedB) {
        return joinedA - joinedB;
      }

      return a.name.localeCompare(b.name);
    });
}

async function _findInviteChannel(guild) {
  const me = guild.members.me
    ?? await guild.members.fetchMe().catch(() => null);

  if (!me) return null;

  await guild.channels.fetch().catch(() => null);

  const preferred = [
    guild.systemChannel,
    guild.rulesChannel,
    guild.publicUpdatesChannel,
  ].filter(Boolean);

  const channels = [
    ...preferred,
    ...guild.channels.cache.values(),
  ];

  const seen = new Set();

  for (const channel of channels) {
    if (!channel || seen.has(channel.id)) continue;
    seen.add(channel.id);

    if (!_isInviteChannel(channel)) continue;

    const permissions = channel.permissionsFor(me);

    if (
      permissions?.has(PermissionsBitField.Flags.ViewChannel) &&
      permissions?.has(PermissionsBitField.Flags.CreateInstantInvite)
    ) {
      return channel;
    }
  }

  return null;
}

function _isInviteChannel(channel) {
  return Boolean(
    channel &&
    (
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement ||
      channel.type === ChannelType.GuildVoice ||
      channel.type === ChannelType.GuildStageVoice
    ) &&
    typeof channel.createInvite === 'function'
  );
}

function _escape(value) {
  return String(value || '')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\'')
    .slice(0, 80);
}

async function _sendError(message, content, deleteReply, deleteDelay) {
  const sent = await embed.replyError(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
