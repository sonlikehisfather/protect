'use strict';


const { EmbedBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const db = require('../core/database');

const _V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';
const _V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);


const COLOR_ERROR   = '#ED4245';
const COLOR_DEFAULT = '#2B2D31';


const PRIVATE_INTERACTION_DEFAULT_DURATION = 15 * 60 * 1000;
const privateInteractions = new Map();

function fmtCoins(n) {
  if (n == null) return '0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000_000) return (n / 1_000_000_000_000_000).toFixed(2) + 'Qd';
  if (abs >= 1_000_000_000_000) return (n / 1_000_000_000_000).toFixed(2) + 'Td';
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'Bd';
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function _getMessageId(messageLike) {
  if (!messageLike) return null;

  if (typeof messageLike === 'string') {
    return messageLike;
  }

  return messageLike.id ?? null;
}

function registerPrivateInteraction(messageLike, ownerId, durationMs = PRIVATE_INTERACTION_DEFAULT_DURATION) {
  const messageId = _getMessageId(messageLike);

  if (!messageId || !ownerId) {
    return false;
  }

  const duration = Number(durationMs);
  const ttl = Number.isFinite(duration) && duration > 0
    ? duration
    : PRIVATE_INTERACTION_DEFAULT_DURATION;

  clearPrivateInteraction(messageId);

  const expiresAt = Date.now() + ttl;

  const timeout = setTimeout(() => {
    const data = privateInteractions.get(messageId);
    if (!data) return;

    if (data.ownerId === ownerId) {
      privateInteractions.delete(messageId);
    }
  }, ttl);

  timeout.unref?.();

  privateInteractions.set(messageId, {
    ownerId,
    expiresAt,
    timeout,
  });

  return true;
}

function clearPrivateInteraction(messageLike) {
  const messageId = _getMessageId(messageLike);

  if (!messageId) {
    return false;
  }

  const data = privateInteractions.get(messageId);

  if (data?.timeout) {
    clearTimeout(data.timeout);
  }

  return privateInteractions.delete(messageId);
}

function getPrivateInteractionOwner(messageLike) {
  const messageId = _getMessageId(messageLike);

  if (!messageId) {
    return null;
  }

  const data = privateInteractions.get(messageId);

  if (!data) {
    return null;
  }

  if (Date.now() > data.expiresAt) {
    clearPrivateInteraction(messageId);
    return null;
  }

  return data.ownerId;
}

async function replyPrivateInteractionDenied(interaction) {
  if (!interaction) {
    return null;
  }

  const payload = {
    content: `${interaction.user}, vous ne pouvez pas utiliser cette interaction.`,
    flags: 64,
    allowedMentions: {
      users: [interaction.user.id],
      roles: [],
    },
  };

  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp(payload);
    }

    return await interaction.reply(payload);
  } catch {
    return null;
  }
}

async function handlePrivateInteraction(interaction) {
  if (!interaction?.isMessageComponent?.()) {
    return false;
  }

  const messageId = interaction.message?.id;
  if (!messageId) {
    return false;
  }

  const data = privateInteractions.get(messageId);
  if (!data) {
    return false;
  }

  if (Date.now() > data.expiresAt) {
    clearPrivateInteraction(messageId);
    return false;
  }

  if (interaction.user.id === data.ownerId) {
    return false;
  }

  interaction.__privateInteractionDenied = true;

  await replyPrivateInteractionDenied(interaction);
  return true;
}


const ZWS = '\u200B';


function breakLongTokens(text, maxLen = 48) {
  if (!text || typeof text !== 'string') return text || '';
  return text.replace(/\S+/g, token => {
    if (token.length <= maxLen) return token;

    if (/^<[@#][!&]?\d+>$/.test(token)) return token;

    if (/^<a?:\w+:\d+>$/.test(token)) return token;

    if (/^https?:\/\//i.test(token)) return token;

    if (/^\[.*\]\(.*\)$/.test(token)) return token;
    let out = '';
    for (let i = 0; i < token.length; i += maxLen) {
      if (i > 0) out += ZWS;
      out += token.slice(i, i + maxLen);
    }
    return out;
  });
}


function getGuildColor(guildId) {
  if (!guildId) return COLOR_DEFAULT;

  try {
    const config = db.getGuildConfig(guildId);
    return config?.color ?? COLOR_DEFAULT;
  } catch {
    return COLOR_DEFAULT;
  }
}


function scheduleDelete(messageLike, seconds) {
  if (!messageLike) return;
  if (!seconds || seconds <= 0) return;

  setTimeout(() => {
    messageLike.delete().catch(() => {});
  }, seconds * 1000);
}


function build(guildId, description = '', options = {}) {
  const color = options.color ?? getGuildColor(guildId);

  const embed = new EmbedBuilder()
    .setColor(color);

  if (description) {
    embed.setDescription(description);
  }

  if (options.title) {
    embed.setTitle(options.title);
  }

  if (options.authorName) {
    embed.setAuthor({
      name   : options.authorName,
      iconURL: options.authorIcon ?? null,
      url    : options.authorUrl  ?? null,
    });
  }

  if (options.fields?.length) {
    embed.addFields(
      options.fields.map(f => ({
        name  : String(f.name),
        value : String(f.value),
        inline: f.inline ?? false,
      }))
    );
  }

  if (options.thumbnail) {
    embed.setThumbnail(options.thumbnail);
  }

  if (options.image) {
    embed.setImage(options.image);
  }


  if (options.footer) {
    const footerText = typeof options.footer === 'string'
      ? options.footer
      : options.footer.text ?? null;

    const footerIcon = typeof options.footer === 'object'
      ? (options.footer.iconURL ?? options.footerIcon ?? null)
      : (options.footerIcon ?? null);

    if (footerText) {
      embed.setFooter({
        text   : footerText,
        iconURL: footerIcon,
      });
    }
  }

  if (options.timestamp !== false) {
    const ts = options.timestamp === true ? Date.now() : (options.timestamp ?? Date.now());
    embed.setTimestamp(ts);
  }

  return embed;
}

function error(guildId, description, options = {}) {
  return build(
    guildId,
    description,
    {
      ...options,
      color    : COLOR_ERROR,
      timestamp: options.timestamp ?? false,
    }
  );
}


function noPerm(guildId) {
  return error(
    guildId,
    "Vous n'avez pas la permission d'utiliser cette commande."
  );
}

function usage(guildId, commandUsage, prefix = '+') {
  return build(
    guildId,
    `Utilisation : \`${prefix}${commandUsage}\``,
    { timestamp: false }
  );
}

function sanction(guildId, {
  type,
  targetTag,
  targetId,
  moderatorTag,
  moderatorId,
  reason,
  duration,
}) {
  const labels = {
    ban   : 'Bannissement',
    kick  : 'Expulsion',
    warn  : 'Avertissement',
    mute  : 'Mute',
    unmute: 'Unmute',
    unban : 'Unban',
  };

  const fields = [
    {
      name  : 'Membre',
      value : `<@${targetId}> (${targetTag}) \`${targetId}\``,
      inline: true,
    },
    {
      name  : 'Modérateur',
      value : (moderatorId ? `<@${moderatorId}>` + (moderatorTag ? ` (${moderatorTag})` : ` \`${moderatorId}\``) : (moderatorTag ?? 'Inconnu')),
      inline: true,
    },
    {
      name  : 'Raison',
      value : reason || 'Aucune raison fournie',
      inline: false,
    },
  ];

  if (targetId) {
    fields.push({
      name  : 'Profil',
      value : `https://discord.com/users/${targetId}`,
      inline: false,
    });
  }

  if (duration) {
    fields.push({
      name  : 'Durée',
      value : duration,
      inline: true,
    });
  }

  return build(
    guildId,
    null,
    {
      title: labels[type] ?? type,
      fields,
    }
  );
}

function log(guildId, title, fields = [], extra = {}) {
  return build(
    guildId,
    null,
    {
      title,
      fields,
      ...extra,
    }
  );
}


async function reply(message, description, options = {}) {
  const { allowedMentions: customAllowed, ...buildOpts } = options;

  const guildId = message.guild?.id;
  const cmdName = buildOpts._cmdName ?? message.commandName ?? null;
  if (shouldUseV2(guildId, cmdName)) {
    const container = buildV2Container(guildId, description, buildOpts);
    return message.reply({
      components      : [container],
      flags           : _V2_FLAG,
      allowedMentions : customAllowed ?? { parse: [], repliedUser: false },
    }).catch(() => null);
  }

  return message.reply({
    embeds: [
      build(
        message.guild?.id,
        description,
        buildOpts
      ),
    ],
    allowedMentions: customAllowed ?? {
      parse      : [],
      repliedUser: false,
    },
  }).catch(() => null);
}

async function replyError(message, description, options = {}) {
  const { allowedMentions: customAllowed, ...buildOpts } = options;

  const guildId = message.guild?.id;
  const cmdName = buildOpts._cmdName ?? message.commandName ?? null;
  if (shouldUseV2(guildId, cmdName)) {
    const container = buildV2Container(guildId, description, buildOpts);
    return message.reply({
      components      : [container],
      flags           : _V2_FLAG,
      allowedMentions : customAllowed ?? { parse: [], repliedUser: false },
    }).catch(() => null);
  }

  return message.reply({
    embeds: [
      error(
        message.guild?.id,
        description,
        buildOpts
      ),
    ],
    allowedMentions: customAllowed ?? {
      parse      : [],
      repliedUser: false,
    },
  }).catch(() => null);
}

async function replyInteraction(interaction, embedBuilt, ephemeral = false) {
  const payload = {
    embeds: [embedBuilt],
    ...(ephemeral ? { flags: 64 } : {}),
  };

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

async function send(channel, embedBuilt) {
  if (!channel) return null;

  return channel
    .send({ embeds: [embedBuilt] })
    .catch(() => null);
}


function buildV2Container(guildId, description = '', options = {}) {
  const container = new ContainerBuilder();
  const parts = [];

  if (options.title) parts.push('### ' + options.title);
  if (description) parts.push(String(description));
  if (!parts.length) parts.push('');

  if (options.fields?.length) {
    for (const f of options.fields) {
      parts.push('', '**' + f.name + '**', String(f.value));
    }
  }

  if (options.footer) {
    const footerText = typeof options.footer === 'string' ? options.footer : (options.footer?.text ?? '');
    if (footerText) parts.push('', '-# ' + footerText);
  }

  if (options.timestamp !== false) {
    parts.push('-# <t:' + Math.floor(Date.now() / 1000) + ':R>');
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(parts.join('\n').slice(0, 4000)));
  return container;
}


function _embedBuilderToContainer(embedBuilder, { withoutColor = false } = {}) {
  const data = embedBuilder?.data || embedBuilder || {};
  const container = new ContainerBuilder();
  const parts = [];

  if (data.title) parts.push('### ' + String(data.title));
  if (data.description) parts.push(String(data.description));
  if (data.author?.name) parts.push('> ' + String(data.author.name));
  if (Array.isArray(data.fields)) {
    for (const f of data.fields) {
      parts.push('', '**' + String(f.name || '') + '**', String(f.value || ''));
    }
  }
  if (data.footer?.text) parts.push('', '-# ' + String(data.footer.text));
  if (data.timestamp) parts.push('-# <t:' + Math.floor(Date.now() / 1000) + ':R>');

  if (parts.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(parts.join('\n').slice(0, 4000)));
  }

  const mediaItems = [];
  if (data.thumbnail?.url) mediaItems.push({ url: data.thumbnail.url });
  if (data.image?.url) mediaItems.push({ url: data.image.url });
  if (mediaItems.length) {
    const { MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
    const gallery = new MediaGalleryBuilder();
    for (const item of mediaItems) {
      gallery.addItems(new MediaGalleryItemBuilder().setURL(item.url));
    }
    container.addMediaGalleryComponents(gallery);
  }

  if (data.color && !withoutColor) {
    try { container.setAccentColor(data.color); } catch {}
  }

  return container;
}


function embedToPayload(guildId, embedBuilder, options = {}) {
  const { allowedMentions: customAllowed, components, forceV2, withoutColor, ...rest } = options;
  const cmdName = options._cmdName || null;

  if (forceV2 && !_V2_AVAILABLE) {
    throw new Error('Components V2 is not available in this Discord.js version.');
  }

  if (forceV2 || shouldUseV2(guildId, cmdName)) {
    try {
      const container = _embedBuilderToContainer(embedBuilder, { withoutColor });
      const payload = {
        components : components ? [container, ...components] : [container],
        flags      : _V2_FLAG,
        allowedMentions: customAllowed ?? { parse: [] },
      };
      return payload;
    } catch (err) {
      if (forceV2) throw err;
    }
  }

  const payload = {
    embeds: [embedBuilder],
    allowedMentions: customAllowed ?? { parse: [] },
  };
  if (components) payload.components = components;
  return payload;
}


function v2PayloadToV1(payload) {
  if (!payload?.components?.length) return payload;

  const container = payload.components[0];
  let data;
  try { data = container.toJSON ? container.toJSON() : container; } catch { return payload; }

  const { ActionRowBuilder } = require('discord.js');

  const textParts = [];
  const actionRows = [];

  if (data.components) {
    for (const comp of data.components) {
      const t = comp.type;
      if (t === 10 || t === 'TEXT_DISPLAY') {
        textParts.push(comp.content || '');
      } else if (t === 1 || t === 'ACTION_ROW') {
        try { actionRows.push(ActionRowBuilder.from(comp)); } catch {}
      }
    }
  }

  let title = null;
  let description = '';
  const fields = [];
  let footer = null;

  for (const text of textParts) {
    if (text.startsWith('## ')) {
      const lines = text.split('\n');
      title = lines[0].substring(3);
      const rest = lines.slice(1).join('\n').trim();
      if (rest) description += (description ? '\n' : '') + rest;
    } else if (text.startsWith('### ')) {
      const lines = text.split('\n');
      fields.push({ name: lines[0].substring(4), value: lines.slice(1).join('\n').trim() || ' ', inline: false });
    } else if (text.startsWith('-# ')) {
      footer = text.substring(3);
    } else if (text.trim()) {
      description += (description ? '\n' : '') + text;
    }
  }

  const e = new EmbedBuilder();
  if (title) e.setTitle(title.slice(0, 256));
  if (description.trim()) e.setDescription(description.trim().slice(0, 4096));
  if (fields.length) {
    for (const f of fields.slice(0, 25)) {
      e.addFields({ name: f.name.slice(0, 256), value: f.value.slice(0, 1024), inline: f.inline });
    }
  }
  if (footer) e.setFooter({ text: footer.slice(0, 2048) });

  const result = { embeds: [e] };
  if (actionRows.length) result.components = actionRows;
  if (payload.allowedMentions) result.allowedMentions = payload.allowedMentions;
  return result;
}


function wrapPayload(guildId, payload, cmdName = null) {
  if (shouldUseV2(guildId, cmdName)) return payload;
  return v2PayloadToV1(payload);
}


function buildPayload(guildId, description = '', options = {}) {
  const { allowedMentions: customAllowed, components, ...buildOpts } = options;
  const cmdName = options._cmdName || null;

  if (shouldUseV2(guildId, cmdName)) {
    try {
      const container = buildV2Container(guildId, description, buildOpts);
      const payload = {
        components : [container],
        flags      : _V2_FLAG,
        allowedMentions: customAllowed ?? { parse: [] },
      };
      if (components) payload.components = [container, ...components];
      return payload;
    } catch {}
  }

  const payload = {
    embeds: [build(guildId, description, buildOpts)],
    allowedMentions: customAllowed ?? { parse: [] },
  };
  if (components) payload.components = components;
  return payload;
}


async function sendEmbed(channel, guildId, description = '', options = {}) {
  if (!channel) return null;
  const { allowedMentions: customAllowed, ...buildOpts } = options;
  const cmdName = options._cmdName || null;

  if (shouldUseV2(guildId, cmdName)) {
    try {
      const container = buildV2Container(guildId, description, buildOpts);
      return channel.send({
        components      : [container],
        flags           : _V2_FLAG,
        allowedMentions : customAllowed ?? { parse: [] },
      }).catch(() => null);
    } catch {}
  }

  return channel.send({
    embeds          : [build(guildId, description, buildOpts)],
    allowedMentions : customAllowed ?? { parse: [] },
  }).catch(() => null);
}


async function editEmbed(message, guildId, description = '', options = {}) {
  if (!message) return null;
  const { allowedMentions: customAllowed, ...buildOpts } = options;
  const cmdName = options._cmdName || null;

  if (shouldUseV2(guildId, cmdName)) {
    try {
      const container = buildV2Container(guildId, description, buildOpts);
      return message.edit({
        components      : [container],
        flags           : _V2_FLAG,
        allowedMentions : customAllowed ?? { parse: [] },
      }).catch(() => null);
    } catch {}
  }

  return message.edit({
    embeds          : [build(guildId, description, buildOpts)],
    allowedMentions : customAllowed ?? { parse: [] },
  }).catch(() => null);
}


const EXPIRED_PANEL_GRACE_MS = 1500;


async function replyExpiredPanel(interaction) {
  if (!interaction) return null;

  const isSupported =
    interaction.isMessageComponent?.() ||
    interaction.isModalSubmit?.();

  if (!isSupported) return null;

  const messageId = interaction.message?.id ?? null;


  if (messageId) {
    const ownerId = getPrivateInteractionOwner(messageId);
    if (ownerId && ownerId === interaction.user?.id) {
      return null;
    }
  }

  await new Promise(r => setTimeout(r, EXPIRED_PANEL_GRACE_MS));

  if (interaction.replied || interaction.deferred) return null;


  if (messageId) {
    const ownerId = getPrivateInteractionOwner(messageId);
    if (ownerId && ownerId === interaction.user?.id) {
      return null;
    }
  }

  return interaction.reply({
    content        : 'Ce panneau a expiré ou le bot a redémarré. Veuillez refaire la commande.',
    flags          : 64,
    allowedMentions: { parse: [] },
  }).catch(() => null);
}


function shouldUseV2(guildId, commandName) {
  if (!guildId) return _V2_AVAILABLE;

  try {
    const config = db.getGuildConfig(guildId);
    const mode = config?.embedMode || 'auto';

    let exceptions = [];
    if (config?.embedModeExceptions) {
      try { exceptions = JSON.parse(config.embedModeExceptions); } catch {}
    }

    const isException = commandName && exceptions.includes(commandName);

    if (mode === 'v2') {
      return isException ? false : true;
    }

    if (mode === 'v1') {
      return isException ? true : false;
    }

    return _V2_AVAILABLE;
  } catch {
    return _V2_AVAILABLE;
  }
}


module.exports = {

  build,
  error,

  shouldUseV2,

  noPerm,
  usage,
  sanction,
  log,

  reply,
  replyError,
  replyInteraction,
  send,
  sendEmbed,
  editEmbed,
  buildV2Container,
  buildPayload,
  embedToPayload,
  v2PayloadToV1,
  wrapPayload,

  scheduleDelete,

  getGuildColor,

  registerPrivateInteraction,
  clearPrivateInteraction,
  getPrivateInteractionOwner,
  replyPrivateInteractionDenied,
  handlePrivateInteraction,

  replyExpiredPanel,

  breakLongTokens,

  COLOR_ERROR,
  COLOR_DEFAULT,

  fmtCoins,
};
