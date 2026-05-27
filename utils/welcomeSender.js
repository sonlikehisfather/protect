'use strict';


const { EmbedBuilder } = require('discord.js');

const embed = require('./embed');
const { replaceVariables } = require('./variables');

async function sendWelcome(member, config) {
  const result = { publicSent: false, dmSent: false };

  if (!member || !member.guild) return result;
  if (member.user?.bot) return result;
  if (!config) return result;

  const guild   = member.guild;
  const guildId = guild.id;

  if (config.welcomeChannel) {
    const channel = guild.channels.cache.get(config.welcomeChannel);

    if (channel?.isTextBased()) {
      const autoDeleteDelay  = Math.max(0, Number(config?.welcomeAutoDeleteDelay ?? 0));
      const rawTemplate      = config?.welcomeMessage || 'Bienvenue {user} sur **{server}** !';
      const renderedMessage  = _parseVars(rawTemplate, member);
      const rawEmbedJson     = config?.welcomeEmbedJson || null;
      const parsedEmbed      = Number(config?.welcomeEmbedEnabled) === 1
        ? _parseEmbedJson(rawEmbedJson, config?.color)
        : null;
      const configuredEmbed  = parsedEmbed
        ? _buildConfiguredEmbed(guildId, parsedEmbed, member, config?.color)
        : null;

      let mode = _normalizeWelcomeMode(config?.welcomeSendMode);
      if ((mode === 'embed' || mode === 'both') && !configuredEmbed) {
        mode = 'message';
      }

      let sent = null;

      if (mode === 'message') {
        sent = await _sendModeMessage(channel, member, rawTemplate, renderedMessage);
      } else if (mode === 'message_embed') {
        sent = await _sendModeMessageEmbed(channel, guildId, member, rawTemplate, renderedMessage);
      } else if (mode === 'embed') {
        sent = await _sendModeEmbed(channel, member, rawEmbedJson, configuredEmbed);
      } else if (mode === 'both') {
        sent = await _sendModeBoth(channel, member, rawTemplate, renderedMessage, rawEmbedJson, configuredEmbed);
      }

      if (sent) {
        result.publicSent = true;

        if (autoDeleteDelay > 0) {
          embed.scheduleDelete(sent, autoDeleteDelay);
        }
      }
    }
  }

  if (Number(config.welcomeDmEnabled) === 1) {
    const text = _parseVars(
      config.welcomeDmMessage ?? 'Bienvenue sur **{server}**.',
      member
    );

    const dm = await member.user.send({
      embeds          : [embed.build(guildId, text, { timestamp: false })],
      allowedMentions : { parse: [] },
    }).catch(() => null);

    if (dm) {
      result.dmSent = true;
    }
  }

  return result;
}


function _normalizeWelcomeMode(mode) {
  if (['message', 'message_embed', 'embed', 'both'].includes(String(mode))) {
    return String(mode);
  }
  return 'message';
}

function _shouldPingMember(template) {
  if (!template) return false;
  const s = String(template);
  return /\{MemberMention\}/i.test(s);
}

function _isPureGhostPing(template) {
  if (!template) return false;
  return String(template).trim().toLowerCase() === '{membermention}';
}

async function _sendModeMessage(channel, member, rawTemplate, renderedMessage) {
  if (_isPureGhostPing(rawTemplate)) {
    return channel.send({
      content         : `<@${member.id}>`,
      allowedMentions : { users: [member.id] },
    }).catch(() => null);
  }

  const ping = _shouldPingMember(rawTemplate);
  return channel.send({
    content         : renderedMessage,
    allowedMentions : ping ? { users: [member.id] } : { parse: [] },
  }).catch(() => null);
}

async function _sendModeMessageEmbed(channel, guildId, member, rawTemplate, renderedMessage) {
  if (_isPureGhostPing(rawTemplate)) {
    return channel.send({
      content         : `<@${member.id}>`,
      allowedMentions : { users: [member.id] },
    }).catch(() => null);
  }

  const e = embed.build(guildId, renderedMessage, {
    thumbnail : member.user.displayAvatarURL({ dynamic: true }),
    footer    : `Membre #${member.guild.memberCount}`,
    timestamp : new Date(),
  });

  const ping    = _shouldPingMember(rawTemplate);
  const payload = {
    embeds          : [e],
    allowedMentions : ping ? { users: [member.id] } : { parse: [] },
  };
  if (ping) payload.content = `<@${member.id}>`;

  return channel.send(payload).catch(() => null);
}

async function _sendModeEmbed(channel, member, rawEmbedJson, configuredEmbed) {
  const ping    = _shouldPingMember(rawEmbedJson);
  const payload = {
    embeds          : [configuredEmbed],
    allowedMentions : ping ? { users: [member.id] } : { parse: [] },
  };
  if (ping) payload.content = `<@${member.id}>`;

  return channel.send(payload).catch(() => null);
}

async function _sendModeBoth(channel, member, rawTemplate, renderedMessage, rawEmbedJson, configuredEmbed) {
  const ping = _shouldPingMember(rawTemplate) || _shouldPingMember(rawEmbedJson);

  const content = _isPureGhostPing(rawTemplate)
    ? `<@${member.id}>`
    : renderedMessage;

  return channel.send({
    content,
    embeds          : [configuredEmbed],
    allowedMentions : ping ? { users: [member.id] } : { parse: [] },
  }).catch(() => null);
}

function _parseVars(text, member) {
  return replaceVariables(String(text || ''), {
    user   : member.user,
    member,
    guild  : member.guild,
    client : member.client,
  });
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
      timestamp   : parsed.timestamp === true,
    };
  } catch {
    return null;
  }
}

function _buildConfiguredEmbed(guildId, data, member, baseColor = '#2f3136') {
  const e = new EmbedBuilder()
    .setColor(_safeColor(data?.color || baseColor));

  const title       = data?.title       ? _parseVars(data.title, member)       : null;
  const description = data?.description ? _parseVars(data.description, member) : null;
  const authorName  = data?.author      ? _parseVars(data.author, member)      : null;
  const footerText  = data?.footer      ? _parseVars(data.footer, member)      : null;

  if (title) e.setTitle(title.slice(0, 256));
  if (description) e.setDescription(description.slice(0, 4096));

  if (title) {
    const titleUrl = _renderUrl(data?.url, member);
    if (titleUrl) e.setURL(titleUrl);
  }

  if (authorName) {
    const opts = { name: authorName.slice(0, 256) };

    const iconURL = _renderImageUrl(data?.authorIcon, member);
    if (iconURL) opts.iconURL = iconURL;

    const authorUrl = _renderUrl(data?.authorUrl, member);
    if (authorUrl) opts.url = authorUrl;

    e.setAuthor(opts);
  }

  if (footerText) {
    const opts = { text: footerText.slice(0, 2048) };

    const iconURL = _renderImageUrl(data?.footerIcon, member);
    if (iconURL) opts.iconURL = iconURL;

    e.setFooter(opts);
  }

  const imageUrl = _renderImageUrl(data?.image, member);
  if (imageUrl) e.setImage(imageUrl);

  const thumbnailUrl = _renderImageUrl(data?.thumbnail, member);
  if (thumbnailUrl) e.setThumbnail(thumbnailUrl);

  if (Array.isArray(data?.fields) && data.fields.length) {
    const built = data.fields.slice(0, 25)
      .map(f => ({
        name   : _parseVars(String(f?.name || ''), member).slice(0, 256),
        value  : _parseVars(String(f?.value || ''), member).slice(0, 1024),
        inline : Boolean(f?.inline),
      }))
      .filter(f => f.name && f.value);

    if (built.length) e.addFields(built);
  }

  if (data?.timestamp === true) {
    e.setTimestamp(new Date());
  }

  const isEmpty = !title
    && !description
    && !authorName
    && !footerText
    && !data?.image
    && !data?.thumbnail
    && !(Array.isArray(data?.fields) && data.fields.length);

  if (isEmpty) {
    e.setDescription(_parseVars('Bienvenue {user} sur **{server}**.', member));
  }

  return e;
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

function _isImageUrl(value) {
  if (!_isUrl(value)) return false;

  const lower = String(value).toLowerCase();
  const path  = lower.split('?')[0];

  if (/\.(png|jpe?g|gif|webp)$/i.test(path)) return true;
  if (/^https:\/\/(cdn|media)\.discordapp\.(com|net)\//i.test(lower)) return true;
  if (/^https:\/\/i\.imgur\.com\//i.test(lower)) return true;
  if (/^https:\/\/media\.tenor\.com\//i.test(lower)) return true;
  if (/^https:\/\/media\.giphy\.com\//i.test(lower)) return true;

  return false;
}

module.exports = {
  sendWelcome,
};
