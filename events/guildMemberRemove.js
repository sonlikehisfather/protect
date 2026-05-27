'use strict';


const { EmbedBuilder } = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');
const tickets      = require('../modules/tickets');
const { replaceVariables } = require('../utils/variables');

module.exports = {
  name : 'guildMemberRemove',
  once : false,

  async execute(client, member) {
    const { guild } = member;
    const guildId   = guild.id;

    try {
      const config = db.getGuildConfig(guildId);

      if (config.leaveChannel) {
        const channel = guild.channels.cache.get(config.leaveChannel);

        if (channel?.isTextBased()) {
          const leaveEmbedJson  = _parseEmbedJson(config?.leaveEmbedJson, config?.color);
          const autoDeleteDelay = Math.max(0, Number(config?.leaveAutoDeleteDelay ?? 0));

          let sent = null;

          const rawLeaveMessage = config.leaveMessage ?? '**{username}** a quitté le serveur.';
          const rawEmbedJsonStr = String(config?.leaveEmbedJson || '');

          let mode = _normalizeLeaveMode(config);

          if ((mode === 'embed' || mode === 'both') && !leaveEmbedJson) {
            mode = 'message';
          }

          const pingFromMessage = _shouldPingMember(rawLeaveMessage);
          const pingFromEmbed   = leaveEmbedJson ? _shouldPingMember(rawEmbedJsonStr) : false;

          let wantPing = false;
          if (mode === 'message' || mode === 'message_embed') {
            wantPing = pingFromMessage;
          } else if (mode === 'embed') {
            wantPing = pingFromEmbed;
          } else if (mode === 'both') {
            wantPing = pingFromMessage || pingFromEmbed;
          }

          const allowedMentions = wantPing
            ? { users: [member.id], roles: [], parse: [] }
            : { parse: [] };

          if (mode === 'message') {
            const text = _parseVars(rawLeaveMessage, member);

            sent = await channel.send({
              content : text,
              allowedMentions,
            }).catch(() => null);
          } else if (mode === 'message_embed') {
            const auto = _buildMessageEmbed(rawLeaveMessage, member, config?.color);
            const payload = wantPing ? { content: `<@${member.id}>` } : {};

            sent = await channel.send({
              ...payload,
              embeds          : [auto],
              allowedMentions,
            }).catch(() => null);
          } else if (mode === 'embed') {
            const e = _buildConfiguredEmbed(guildId, leaveEmbedJson, member, config?.color);
            const payload = wantPing ? { content: `<@${member.id}>` } : {};

            sent = await channel.send({
              ...payload,
              embeds          : [e],
              allowedMentions,
            }).catch(() => null);
          } else if (mode === 'both') {
            const e = _buildConfiguredEmbed(guildId, leaveEmbedJson, member, config?.color);
            const text = _parseVars(rawLeaveMessage, member);
            const content = wantPing && !pingFromMessage
              ? `<@${member.id}>\n${text}`
              : text;

            sent = await channel.send({
              content,
              embeds          : [e],
              allowedMentions,
            }).catch(() => null);
          }

          if (sent && autoDeleteDelay > 0) {
            embed.scheduleDelete(sent, autoDeleteDelay);
          }
        }
      }

      const roles = member.roles.cache
        .filter(role => role.id !== guild.id)
        .map(role => `<@&${role.id}>`)
        .join(', ') || 'Aucun';

      const userTag    = member.user?.tag ?? `Utilisateur inconnu`;
      const userAvatar = member.user?.displayAvatarURL?.({ dynamic: true }) ?? null;

      const e = embed.log(guildId, 'Membre parti', [
        {
          name   : 'Membre',
          value  : `${userTag} (<@${member.id}>) \`${member.id}\``,
          inline : true,
        },
        {
          name   : 'Profil',
          value  : `https://discord.com/users/${member.id}`,
          inline : true,
        },
        {
          name   : 'Rôles',
          value  : roles,
          inline : false,
        },
        {
          name   : 'Membres total',
          value  : String(guild.memberCount),
          inline : true,
        },
      ], {
        ...(userAvatar ? { thumbnail: userAvatar } : {}),
      });

      await logger.send(client, guildId, 'leavelog', e);

    } catch (err) {
      errorHandler.handle(err, {
        source : 'guildMemberRemove',
        guildId,
      });
    }

    try {
      const openTickets = db.getOpenTickets(guildId, member.id);

      for (const ticket of openTickets) {
        const panel = ticket.panelId ? db.getTicketPanel(ticket.panelId) : null;

        if (panel && Number(panel.closeOnLeave) === 1) {
          await tickets.closeOnMemberLeave(client, guild, ticket);
        }
      }
    } catch (err) {
      errorHandler.handle(err, {
        source : 'guildMemberRemove.closeOnLeave',
        guildId,
      });
    }
  },
};

function _shouldPingMember(template) {
  return /\{MemberMention\}/i.test(String(template || ''));
}

function _renderImageUrl(value, member) {
  if (!value) return null;
  const rendered = _parseVars(String(value), member).trim();
  if (!rendered) return null;
  return _isImageUrl(rendered) ? rendered : null;
}

function _renderUrl(value, member) {
  if (!value) return null;
  const rendered = _parseVars(String(value), member).trim();
  if (!rendered) return null;
  return _isUrl(rendered) ? rendered : null;
}

function _parseVars(text, member) {
  return replaceVariables(String(text || ''), {
    user   : member.user,
    member,
    guild  : member.guild,
    client : member.client,
  });
}

function _normalizeLeaveMode(config) {
  const mode = String(config?.leaveSendMode || '').toLowerCase();
  if (['message', 'message_embed', 'embed', 'both'].includes(mode)) return mode;
  return Number(config?.leaveEmbedEnabled) === 1 ? 'embed' : 'message';
}

function _parseEmbedJson(value, baseColor = '#2f3136') {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return {
      title       : parsed.title || null,
      description : parsed.description || null,
      url         : parsed.url || null,
      color       : _safeColor(parsed.color || baseColor),
      image       : parsed.image || null,
      thumbnail   : parsed.thumbnail || null,
      footer      : parsed.footer || null,
      footerIcon  : parsed.footerIcon || null,
      author      : parsed.author || null,
      authorIcon  : parsed.authorIcon || null,
      authorUrl   : parsed.authorUrl || null,
      fields      : Array.isArray(parsed.fields) ? parsed.fields : [],
      timestamp   : Boolean(parsed.timestamp),
    };
  } catch {
    return null;
  }
}

function _buildConfiguredEmbed(guildId, data, member, baseColor = '#2f3136') {
  const e = new EmbedBuilder()
    .setColor(_safeColor(data?.color || baseColor));

  const title = data?.title
    ? _parseVars(data.title, member)
    : null;

  const description = data?.description
    ? _parseVars(data.description, member)
    : null;

  const footerText = data?.footer
    ? _parseVars(data.footer, member)
    : null;

  const footerIcon = _renderImageUrl(data?.footerIcon, member);
  const authorName = data?.author ? _parseVars(data.author, member) : null;
  const authorIcon = _renderImageUrl(data?.authorIcon, member);
  const authorUrl  = _renderUrl(data?.authorUrl, member);

  const titleUrl     = title ? _renderUrl(data?.url, member) : null;
  const imageUrl     = _renderImageUrl(data?.image, member);
  const thumbnailUrl = _renderImageUrl(data?.thumbnail, member);

  if (title) e.setTitle(title);
  if (titleUrl) e.setURL(titleUrl);
  if (description) e.setDescription(description);

  if (authorName) {
    const authorOpts = { name: authorName.slice(0, 256) };
    if (authorIcon) authorOpts.iconURL = authorIcon;
    if (authorUrl) authorOpts.url = authorUrl;
    e.setAuthor(authorOpts);
  }

  if (footerText) {
    const footerOpts = { text: footerText.slice(0, 2048) };
    if (footerIcon) footerOpts.iconURL = footerIcon;
    e.setFooter(footerOpts);
  }

  if (imageUrl) e.setImage(imageUrl);
  if (thumbnailUrl) e.setThumbnail(thumbnailUrl);

  if (Array.isArray(data?.fields) && data.fields.length > 0) {
    const fields = data.fields.slice(0, 25).map(f => ({
      name   : _parseVars(String(f?.name || ''), member).slice(0, 256),
      value  : _parseVars(String(f?.value || ''), member).slice(0, 1024),
      inline : Boolean(f?.inline),
    })).filter(f => f.name && f.value);

    if (fields.length > 0) e.addFields(fields);
  }

  if (data?.timestamp === true) {
    e.setTimestamp(new Date());
  }

  const isEmpty =
    !title &&
    !description &&
    !authorName &&
    !footerText &&
    !imageUrl &&
    !thumbnailUrl &&
    (!Array.isArray(data?.fields) || data.fields.length === 0);

  if (isEmpty) {
    e.setDescription(_parseVars('{username} a quitté **{server}**.', member));
  }

  return e;
}

function _buildMessageEmbed(rawLeaveMessage, member, baseColor) {
  const description = _parseVars(rawLeaveMessage, member);

  return new EmbedBuilder()
    .setColor(_safeColor(baseColor || '#2f3136'))
    .setDescription(description || _parseVars('{username} a quitté **{server}**.', member))
    .setTimestamp(new Date());
}

function _safeColor(color) {
  if (typeof color === 'string' && /^#?[0-9a-f]{6}$/i.test(color)) {
    return color.startsWith('#') ? color : `#${color}`;
  }

  return '#2f3136';
}

function _isUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function _isImageUrl(value) {
  if (!_isUrl(value)) return false;

  const url = value.toLowerCase();
  const path = url.split('?')[0];

  return (
    path.endsWith('.png') ||
    path.endsWith('.jpg') ||
    path.endsWith('.jpeg') ||
    path.endsWith('.gif') ||
    path.endsWith('.webp') ||
    url.includes('cdn.discordapp.com/attachments/') ||
    url.includes('media.discordapp.net/attachments/') ||
    url.includes('cdn.discordapp.com/avatars/') ||
    url.includes('cdn.discordapp.com/icons/') ||
    url.includes('cdn.discordapp.com/banners/') ||
    url.includes('cdn.discordapp.com/guilds/') ||
    url.includes('cdn.discordapp.com/embed/avatars/') ||
    url.includes('i.imgur.com/') ||
    url.includes('media.tenor.com/') ||
    url.includes('media.giphy.com/')
  );
}
