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
      value : moderatorTag,
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

  if (_V2_AVAILABLE) {
    const container = new ContainerBuilder();
    const parts = [];
    if (buildOpts.title) parts.push(`### ${buildOpts.title}`);
    if (description) parts.push(String(description));
    if (!parts.length) parts.push('');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(parts.join('\n\n')));
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

  if (_V2_AVAILABLE) {
    const container = new ContainerBuilder().setAccentColor(0xED4245);
    const parts = [];
    if (buildOpts.title) parts.push(`### ${buildOpts.title}`);
    if (description) parts.push(String(description));
    if (!parts.length) parts.push('');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(parts.join('\n\n')));
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


module.exports = {

  build,
  error,

  noPerm,
  usage,
  sanction,
  log,

  reply,
  replyError,
  replyInteraction,
  send,

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
