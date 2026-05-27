'use strict';


const {
  ChannelType,
  PermissionsBitField,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'autoreact',
    description : 'Ajoute ou supprime une réaction automatique dans un salon.',
    usage       : 'autoreact <add/del/list> [salon] [émoji]',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const action = args[0]?.toLowerCase();

    if (!['add', 'del', 'delete', 'remove', 'list'].includes(action)) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}autoreact <add/del/list> [salon] [émoji]\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (action === 'list') {
      return _handleList(message, guildId, deleteReply, deleteDelay);
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me || !me.permissions.has(PermissionsBitField.Flags.AddReactions)) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas la permission d\'ajouter des réactions.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const channel = await _resolveTextChannel(guild, args[1]);
    const emoji   = args[2];

    if (!channel || !emoji) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}autoreact ${action} <salon> <émoji>\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const botPerms = channel.permissionsFor(me);

    if (
      !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
      !botPerms?.has(PermissionsBitField.Flags.SendMessages) ||
      !botPerms?.has(PermissionsBitField.Flags.ReadMessageHistory) ||
      !botPerms?.has(PermissionsBitField.Flags.AddReactions)
    ) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas les permissions nécessaires dans ce salon.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const resolvedEmoji = _resolveEmoji(client, emoji);

    if (!resolvedEmoji) {
      const sent = await embed.replyError(
        message,
        'Émoji invalide ou introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const testMessage = await channel.send({
      content: 'Test de réaction...',
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (testMessage) {
      const ok = await testMessage.react(resolvedEmoji.react)
        .then(() => true)
        .catch(() => false);

      await testMessage.delete().catch(() => {});

      if (!ok) {
        const sent = await embed.replyError(
          message,
          'Je ne peux pas utiliser cet émoji.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
    }

    if (['del', 'delete', 'remove'].includes(action)) {
      return _handleDel(message, guildId, channel, resolvedEmoji, deleteReply, deleteDelay);
    }

    return _handleAdd(message, guildId, channel, resolvedEmoji, deleteReply, deleteDelay);
  },
};

async function _handleAdd(message, guildId, channel, emoji, deleteReply, deleteDelay) {
  const existing = db.getChannelAutoreacts(guildId, channel.id).includes(emoji.stored);

  if (existing) {
    const sent = await embed.replyError(
      message,
      'Cette réaction automatique existe déjà pour ce salon.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  db.addAutoreact(guildId, channel.id, emoji.stored);

  const sent = await embed.reply(
    message,
    `Réaction automatique ajoutée dans ${channel} avec ${emoji.display}.`,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _handleDel(message, guildId, channel, emoji, deleteReply, deleteDelay) {
  const changes = db.removeAutoreact(guildId, channel.id, emoji.stored);

  if (!changes) {
    const sent = await embed.replyError(
      message,
      'Aucune réaction automatique trouvée avec cet émoji dans ce salon.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const sent = await embed.reply(
    message,
    `Réaction automatique supprimée dans ${channel}.`,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _handleList(message, guildId, deleteReply, deleteDelay) {
  const rows = db.listAutoreactsByGuild(guildId);

  if (!rows.length) {
    const sent = await embed.replyError(
      message,
      'Aucune réaction automatique configurée.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const lines = rows.slice(0, 25).map((row, index) =>
    `\`${index + 1}.\` <#${row.channelId}> - ${row.emoji}`
  );

  const text =
    `**Réactions automatiques**\n` +
    lines.join('\n') +
    (rows.length > 25 ? `\n\nEt \`${rows.length - 25}\` autre(s).` : '');

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        text,
        {
          title     : 'Autoreact',
          timestamp : false,
        }
      ),
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _resolveTextChannel(guild, query) {
  if (!query || typeof query !== 'string') return null;

  const clean = query.replace(/[<#>]/g, '');

  if (/^\d{17,20}$/.test(clean)) {
    const channel =
      guild.channels.cache.get(clean) ??
      await guild.channels.fetch(clean).catch(() => null);

    return _isTextChannel(channel) ? channel : null;
  }

  const lower = query.toLowerCase();

  return guild.channels.cache.find(channel =>
    _isTextChannel(channel) &&
    channel.name.toLowerCase() === lower
  ) ?? null;
}

function _isTextChannel(channel) {
  return Boolean(
    channel &&
    (
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement
    )
  );
}

function _resolveEmoji(client, raw) {
  if (!raw || typeof raw !== 'string') return null;

  const custom = raw.match(/^<a?:([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/);

  if (custom) {
    const id = custom[2];
    const emoji = client.emojis.cache.get(id);

    if (!emoji) return null;

    return {
      react   : emoji.id,
      stored  : raw,
      display : raw,
    };
  }

  return {
    react   : raw,
    stored  : raw,
    display : raw,
  };
}
