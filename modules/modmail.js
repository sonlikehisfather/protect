'use strict';


const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const perms        = require('../utils/permissions');
const errorHandler = require('../utils/errorHandler');
const transcript   = require('../utils/transcript');


const openByUser    = new Map();
const openByChannel = new Map();
const locks         = new Set();
const recentOpens   = new Map();
const dmSpamBuckets = new Map();
const handledMessageIds = new Set();


const _noModmailCooldown = new Map();

const MESSAGE_DEDUPE_TTL = 60 * 1000;


function _key(guildId, userId) {
  return `${guildId}:${userId}`;
}

function _color(config) {
  const fallback = '#2f3136';
  const value = config?.color;
  if (!value) return fallback;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    if (/^[0-9a-f]{6}$/i.test(value)) return `#${value}`;
  }
  return fallback;
}

function _cleanName(username, userId) {
  const base = String(username || 'user')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return `modmail-${base || userId}`;
}

function _isEnabled(config) {
  return Number(config?.modmailEnabled) === 1;
}


function _getLimits(config) {
  return {
    openCooldownMs: Math.max(30, Number(config?.modmailOpenCooldown ?? 300)) * 1000,
    spamLimit     : Math.max(2, Number(config?.modmailSpamLimit ?? 5)),
    spamWindowMs  : Math.max(5, Number(config?.modmailSpamWindow ?? 30)) * 1000,
    spamBlockMs   : Math.max(30, Number(config?.modmailSpamBlockTime ?? 300)) * 1000,
  };
}

function _isDuplicateMessage(messageId) {
  if (!messageId) return false;
  if (handledMessageIds.has(messageId)) return true;
  handledMessageIds.add(messageId);
  setTimeout(() => {
    handledMessageIds.delete(messageId);
  }, MESSAGE_DEDUPE_TTL);
  return false;
}

function _getOpenByUser(guildId, userId) {
  try {
    return db.getOpenModmailByUser(guildId, userId);
  } catch {
    return null;
  }
}

function _getOpenModmails(guildId) {
  try {
    return db.getOpenModmails(guildId) || [];
  } catch {
    return [];
  }
}

async function _safeSend(target, payload) {
  if (payload && typeof payload === 'object' && !payload.allowedMentions) {
    payload.allowedMentions = { parse: [] };
  }
  try {
    return await target.send(payload);
  } catch {
    return null;
  }
}

function _filesFromMessage(message) {
  const attachments = message?.attachments;
  if (!attachments?.size) return [];
  return [...attachments.values()].map((a) =>
    new AttachmentBuilder(a.url, { name: a.name || 'attachment' })
  );
}

function _contentOrFallback(message) {
  const content = message.content?.trim();
  return content?.length ? content : null;
}

function _makeEmbed(config, title, description) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description || '*Aucun contenu*')
    .setColor(_color(config))
    .setTimestamp();
}

function _makeUserEmbed(config, user, title, description) {
  const e = _makeEmbed(config, title, description);
  if (user) {
    e.setAuthor({
      name   : user.username,
      iconURL: user.displayAvatarURL({ dynamic: true }),
    });
  }
  return e;
}


function _checkDmSpam(guildId, userId, config) {
  const limits = _getLimits(config);
  const key = _key(guildId, userId);
  const now = Date.now();

  let bucket = dmSpamBuckets.get(key);

  if (!bucket) {
    bucket = {
      count       : 0,
      startedAt   : now,
      blockedUntil: 0,
      warned      : false,
    };
    dmSpamBuckets.set(key, bucket);
  }

  if (bucket.blockedUntil && now < bucket.blockedUntil) {
    return {
      blocked    : true,
      justBlocked: false,
      remaining  : Math.ceil((bucket.blockedUntil - now) / 1000),
    };
  }

  if (now - bucket.startedAt > limits.spamWindowMs) {
    bucket.count        = 0;
    bucket.startedAt    = now;
    bucket.blockedUntil = 0;
    bucket.warned       = false;
  }

  bucket.count++;

  if (bucket.count > limits.spamLimit) {
    bucket.blockedUntil = now + limits.spamBlockMs;
    const justBlocked = !bucket.warned;
    bucket.warned = true;
    return {
      blocked    : true,
      justBlocked,
      remaining  : Math.ceil(limits.spamBlockMs / 1000),
    };
  }

  return {
    blocked    : false,
    justBlocked: false,
    remaining  : 0,
  };
}

function _clearDmSpam(guildId, userId) {
  dmSpamBuckets.delete(_key(guildId, userId));
}


async function _resolveGuildForUser(client, userId) {
  for (const guild of client.guilds.cache.values()) {
    let config;
    try {
      config = db.getGuildConfig(guild.id);
    } catch {
      continue;
    }
    if (!_isEnabled(config)) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) return { guild, config, member };
  }
  return null;
}

async function _findExistingChannelByTopic(guild, userId) {
  const cached = guild.channels.cache.find(channel =>
    channel?.isTextBased?.() &&
    typeof channel.topic === 'string' &&
    channel.topic.includes(`(${userId})`)
  );
  if (cached) return cached;
  const channels = await guild.channels.fetch().catch(() => null);
  if (!channels) return null;
  return channels.find(channel =>
    channel?.isTextBased?.() &&
    typeof channel.topic === 'string' &&
    channel.topic.includes(`(${userId})`)
  ) || null;
}

async function _resolveExistingChannel(guild, guildId, userId) {
  const modmail = _getOpenByUser(guildId, userId);

  if (modmail?.channelId) {
    const channel = guild.channels.cache.get(modmail.channelId)
      || await guild.channels.fetch(modmail.channelId).catch(() => null);
    if (channel?.isTextBased()) {
      openByUser.set(_key(guildId, userId), modmail);
      openByChannel.set(channel.id, modmail);
      return { modmail, channel };
    }
  }

  const topicChannel = await _findExistingChannelByTopic(guild, userId);

  if (topicChannel) {
    const fallbackModmail = modmail || {
      guildId,
      userId,
      channelId: topicChannel.id,
      status   : 'open',
    };
    openByUser.set(_key(guildId, userId), fallbackModmail);
    openByChannel.set(topicChannel.id, fallbackModmail);
    return { modmail: fallbackModmail, channel: topicChannel };
  }

  return null;
}

async function _createStaffChannel(guild, config, user) {
  const parent = config?.modmailCategory
    ? guild.channels.cache.get(config.modmailCategory)
    : null;

  const me = await guild.members.fetchMe().catch(() => null);
  if (!me) return null;

  const overwrites = [
    {
      id  : guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id   : me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  if (config?.modmailPingRole) {
    overwrites.push({
      id   : config.modmailPingRole,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    });
  }

  return guild.channels.create({
    name                : _cleanName(user.username, user.id),
    type                : ChannelType.GuildText,
    parent              : parent?.type === ChannelType.GuildCategory ? parent.id : null,
    topic               : `Modmail ouvert pour ${user.username} (${user.id})`,
    permissionOverwrites: overwrites,
    reason              : `Ouverture modmail pour ${user.username} (${user.id})`,
  }).catch(() => null);
}


async function _openThread(client, user, preResolved = null) {
  const resolved = preResolved || await _resolveGuildForUser(client, user.id);

  if (!resolved) {
    const interval = (resolved?.config?.modmailUnavailableInterval ?? 3600) * 1000;
    if (interval > 0) {
      const last = _noModmailCooldown.get(user.id) ?? 0;
      if (Date.now() - last > interval) {
        _noModmailCooldown.set(user.id, Date.now());
        await _safeSend(user, {
          embeds: [
            _makeEmbed(
              null,
              'Modmail indisponible',
              'Aucun serveur avec le modmail actif ne semble disponible pour ton compte.'
            ),
          ],
          allowedMentions: { parse: [] },
        });
      }
    }
    return null;
  }

  const { guild, config } = resolved;
  const guildId = guild.id;
  const lockKey = _key(guildId, user.id);

  if (locks.has(lockKey)) return null;

  locks.add(lockKey);

  try {
    const existing = await _resolveExistingChannel(guild, guildId, user.id);

    if (existing?.channel) {
      return {
        guild,
        config,
        channel: existing.channel,
        modmail: existing.modmail,
        created: false,
      };
    }

    const channel = await _createStaffChannel(guild, config, user);

    if (!channel) {
      await _safeSend(user, {
        embeds: [
          _makeEmbed(
            config,
            'Erreur modmail',
            'Impossible de créer le salon modmail. Contacte un administrateur.'
          ),
        ],
      });
      return null;
    }

    let modmailId;
    try {
      modmailId = db.createModmail(guild.id, user.id, channel.id);
    } catch {
      modmailId = null;
    }

    const modmail = {
      id       : modmailId,
      guildId  : guild.id,
      userId   : user.id,
      channelId: channel.id,
      status   : 'open',
    };

    openByUser.set(lockKey, modmail);
    openByChannel.set(channel.id, modmail);

    const ping = config?.modmailPingRole ? `<@&${config.modmailPingRole}>` : null;

    await _safeSend(channel, {
      content: ping || undefined,
      embeds : [
        _makeUserEmbed(
          config,
          user,
          'Nouveau modmail',
          `Utilisateur : ${user} (${user.id})\n` +
          `Compte créé : <t:${Math.floor(user.createdTimestamp / 1000)}:R>\n\n` +
          'Répondez dans ce salon pour envoyer un message à l\'utilisateur.\n' +
          'Vous pouvez fermer le modmail avec `close` ou `close <raison>`.'
        ),
      ],
      allowedMentions: {
        roles: config?.modmailPingRole ? [config.modmailPingRole] : [],
      },
    });

    const logChannel = config?.modmailLogChannel
      ? guild.channels.cache.get(config.modmailLogChannel)
      : null;

    if (logChannel?.isTextBased()) {
      await _safeSend(logChannel, {
        embeds: [
          _makeUserEmbed(
            config,
            user,
            'Modmail ouvert',
            `Utilisateur : ${user} (${user.id})\nSalon : ${channel}`
          ),
        ],
      });
    }

    await _safeSend(user, {
      embeds: [
        _makeEmbed(
          config,
          'Modmail ouvert',
          `Ton modmail a bien été ouvert sur **${guild.name}**.\n\n` +
          'Le staff va te répondre directement ici, en message privé.\n\n' +
          'Tu peux continuer à envoyer des messages ici pour ajouter des informations.'
        ),
      ],
    });

    return { guild, config, channel, modmail, created: true };
  } finally {
    locks.delete(lockKey);
  }
}


async function _forwardUserToStaff(client, message) {


  if (perms.isProtected(message.author.id, null)) return true;

  const resolved = await _resolveGuildForUser(client, message.author.id);

  if (!resolved) {
    const interval = (resolved?.config?.modmailUnavailableInterval ?? 3600) * 1000;
    if (interval > 0) {
      const last = _noModmailCooldown.get(message.author.id) ?? 0;
      if (Date.now() - last > interval) {
        _noModmailCooldown.set(message.author.id, Date.now());
        await _safeSend(message.author, {
          embeds: [
            _makeEmbed(
              null,
              'Modmail indisponible',
              'Aucun serveur avec le modmail actif ne semble disponible pour ton compte.'
            ),
          ],
          allowedMentions: { parse: [] },
        });
      }
    }
    return true;
  }

  const { guild, config, member } = resolved;
  const guildId = guild.id;
  const userId  = message.author.id;
  const userKey = _key(guildId, userId);
  const limits  = _getLimits(config);

  if (config?.modmailPingRole && member?.roles?.cache?.has(config.modmailPingRole)) return true;

  const spam = _checkDmSpam(guildId, userId, config);

  if (spam.blocked) {
    if (spam.justBlocked) {
      await _safeSend(message.author, {
        embeds: [
          _makeEmbed(
            config,
            'Modmail ralenti',
            `Tu envoies trop de messages rapidement sur **${guild.name}**.\n\n` +
            `Merci d\'attendre **${spam.remaining} seconde(s)** avant de renvoyer un message.`
          ),
        ],
      });
    }
    return true;
  }

  const existing = await _resolveExistingChannel(guild, guildId, userId);

  if (existing?.channel) {
    const content = _contentOrFallback(message);
    const files   = _filesFromMessage(message);
    await _safeSend(existing.channel, {
      embeds: [
        _makeUserEmbed(
          config,
          message.author,
          'Nouveau message utilisateur',
          content || '*Aucun texte*'
        ),
      ],
      files,
    });
    return true;
  }

  const recent = recentOpens.get(userKey);
  if (recent && Date.now() - recent < limits.openCooldownMs) {
    const remaining = Math.ceil((limits.openCooldownMs - (Date.now() - recent)) / 1000);
    await _safeSend(message.author, {
      embeds: [
        _makeEmbed(
          config,
          'Modmail récent',
          `Tu as déjà ouvert un modmail récemment sur **${guild.name}**.\n\n` +
          `Merci d\'attendre encore environ **${remaining} seconde(s)** avant d\'en ouvrir un nouveau.`
        ),
      ],
    });
    return true;
  }

  const opened = await _openThread(client, message.author, resolved);
  if (!opened?.channel) return true;

  if (opened.created) {
    recentOpens.set(userKey, Date.now());
    setTimeout(() => {
      recentOpens.delete(userKey);
    }, limits.openCooldownMs);
  }

  const content = _contentOrFallback(message);
  const files   = _filesFromMessage(message);

  await _safeSend(opened.channel, {
    embeds: [
      _makeUserEmbed(
        opened.config,
        message.author,
        'Message utilisateur',
        content || '*Aucun texte*'
      ),
    ],
    files,
  });

  return true;
}


async function _forwardStaffToUser(client, message, modmail) {
  if (!modmail?.userId || !modmail?.guildId) return false;

  const guild = client.guilds.cache.get(modmail.guildId);
  if (!guild) return false;

  const config = db.getGuildConfig(guild.id);
  const user   = await client.users.fetch(modmail.userId).catch(() => null);

  if (!user) {
    await embed.replyError(message, 'Impossible de retrouver l\'utilisateur lié à ce modmail.');
    return true;
  }

  const content = _contentOrFallback(message);
  const files   = _filesFromMessage(message);

  const sent = await _safeSend(user, {
    embeds: [
      _makeUserEmbed(
        config,
        message.author,
        `Réponse du staff - ${guild.name}`,
        content || '*Aucun texte*'
      ),
    ],
    files,
  });

  if (!sent) {
    await embed.replyError(
      message,
      'Impossible d\'envoyer le message. L\'utilisateur a sûrement fermé ses messages privés.'
    );
    return true;
  }

  try {
    await message.react('');
  } catch {}

  return true;
}


async function closeFromChannel(client, message, reason = null) {
  let modmail = openByChannel.get(message.channel.id);

  if (!modmail && message.guild) {
    const opened = _getOpenModmails(message.guild.id);
    modmail = opened.find((m) => m.channelId === message.channel.id) || null;
    if (modmail) {
      openByChannel.set(message.channel.id, modmail);
      openByUser.set(_key(message.guild.id, modmail.userId), modmail);
    }
  }

  if (!modmail) {
    await embed.replyError(message, 'Ce salon n\'est pas lié à un modmail ouvert.');
    return false;
  }

  const guild  = message.guild;
  const config = db.getGuildConfig(guild.id);
  const limits = _getLimits(config);
  const user   = await client.users.fetch(modmail.userId).catch(() => null);

  let transcriptFile = null;
  try {
    transcriptFile = await transcript.createHtmlTranscript(message.channel, {
      limit: 300,
    });
  } catch {
    transcriptFile = null;
  }

  try {
    db.closeModmail(modmail.channelId || message.channel.id);
  } catch {}

  openByUser.delete(_key(guild.id, modmail.userId));
  openByChannel.delete(message.channel.id);

  const cooldownKey = _key(guild.id, modmail.userId);
  recentOpens.set(cooldownKey, Date.now());
  setTimeout(() => recentOpens.delete(cooldownKey), limits.openCooldownMs);
  _clearDmSpam(guild.id, modmail.userId);

  if (user) {
    await _safeSend(user, {
      embeds: [
        _makeEmbed(
          config,
          'Modmail fermé',
          reason
            ? `Ton modmail avec **${guild.name}** a été fermé.\nRaison : ${reason}`
            : `Ton modmail avec **${guild.name}** a été fermé.`
        ),
      ],
    });
  }

  const logChannel = config?.modmailLogChannel
    ? guild.channels.cache.get(config.modmailLogChannel)
    : null;

  if (logChannel?.isTextBased()) {
    await _safeSend(logChannel, {
      embeds: [
        _makeEmbed(
          config,
          'Modmail fermé',
          `Utilisateur : ${user ? `${user} (${user.id})` : modmail.userId}\n` +
          `Staff : ${message.author} (${message.author.id})\n` +
          `Raison : ${reason || 'Aucune raison'}\n\n` +
          'Transcript : fichier joint ci-dessous.'
        ),
      ],
      files: transcriptFile ? [transcriptFile] : [],
    });
  }

  await embed.reply(message, 'Modmail fermé. Le salon sera supprimé dans 3 secondes.');

  setTimeout(async () => {
    await message.channel.delete('Fermeture modmail').catch(() => null);
  }, 3000);

  return true;
}


async function handleMessage(client, message) {
  if (!message || message.author?.bot) return false;
  if (_isDuplicateMessage(message.id)) return true;

  try {
    if (message.channel.type === ChannelType.DM) {
      return await _forwardUserToStaff(client, message);
    }

    if (!message.guild) return false;

    let modmail = openByChannel.get(message.channel.id);

    if (!modmail) {
      const opened = _getOpenModmails(message.guild.id);
      modmail = opened.find((m) => m.channelId === message.channel.id) || null;
      if (modmail) {
        openByChannel.set(message.channel.id, modmail);
        openByUser.set(_key(message.guild.id, modmail.userId), modmail);
      }
    }

    if (!modmail) return false;

    const raw   = message.content?.trim() || '';
    const lower = raw.toLowerCase();

    if (lower === 'close' || lower.startsWith('close ')) {
      const reason = raw.split(/\s+/).slice(1).join(' ').trim() || null;
      return await closeFromChannel(client, message, reason);
    }

    return await _forwardStaffToUser(client, message, modmail);
  } catch (err) {
    errorHandler.handle(err, {
      source : 'modmail.handleMessage',
      guildId: message.guild?.id || null,
      userId : message.author?.id || null,
    });
    try {
      if (message.guild) {
        await embed.replyError(message, 'Une erreur est survenue avec le modmail.');
      }
    } catch {}
    return true;
  }
}


async function handleRawDm(client, data) {
  if (!data?.author?.id) return false;
  if (!data?.id) return false;
  if (_isDuplicateMessage(data.id)) return true;

  const user = await client.users.fetch(data.author.id).catch(() => null);
  if (!user || user.bot) return false;


  if (perms.isProtected(user.id, null)) return false;

  const attachmentsMap = new Map();

  if (Array.isArray(data.attachments)) {
    for (const attachment of data.attachments) {
      attachmentsMap.set(attachment.id, {
        url : attachment.url,
        name: attachment.filename || 'attachment',
      });
    }
  }

  const fakeMessage = {
    id         : data.id,
    content    : data.content || '',
    author     : user,
    attachments: attachmentsMap,
    channel    : { type: ChannelType.DM },
  };

  return _forwardUserToStaff(client, fakeMessage);
}


function loadCache(client) {
  let count = 0;
  for (const guild of client.guilds.cache.values()) {
    const opened = _getOpenModmails(guild.id);
    for (const modmail of opened) {
      if (!modmail?.guildId || !modmail?.userId || !modmail?.channelId) continue;
      openByUser.set(_key(modmail.guildId, modmail.userId), modmail);
      openByChannel.set(modmail.channelId, modmail);
      count++;
    }
  }
  return count;
}


function clearGuildCache(guildId) {
  for (const [key] of openByUser) {
    if (key.startsWith(`${guildId}:`)) openByUser.delete(key);
  }
  for (const [key] of dmSpamBuckets) {
    if (key.startsWith(`${guildId}:`)) dmSpamBuckets.delete(key);
  }
  for (const [key] of recentOpens) {
    if (key.startsWith(`${guildId}:`)) recentOpens.delete(key);
  }
}

module.exports = {
  handleMessage,
  handleRawDm,
  closeFromChannel,
  loadCache,
  clearGuildCache,
};
