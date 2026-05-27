'use strict';


const db    = require('../core/database');
const embed = require('./embed');
const perms = require('./permissions');

const DEFAULT_KEY = '__default';
const ENABLED_KEY = '__enabled';

const DEFAULT_COOLDOWN_MS = 2_000;
const CUSTOM_COMMAND_COOLDOWN_MS = 2_000;
const NOTICE_COOLDOWN_MS = 2_000;

const BYPASS_MIN_LEVEL = 9;

const FALLBACK_COMMAND_COOLDOWNS = {
  cmdcooldown    : 0,
  commandcooldown: 0,
  cooldown       : 0,
  cmdcd          : 0,

  help       : 2_000,
  pic        : 5_000,
  banner     : 5_000,
  rolemembers: 5_000,

  serverinfo : 5_000,
  vocinfo    : 5_000,
  channel    : 3_000,
  user       : 3_000,
  member     : 3_000,

  settings   : 5_000,
  embed      : 10_000,
  ticket     : 10_000,
  rolemenu   : 10_000,
  tempvoc    : 10_000,

  banlist    : 10_000,
  mutelist   : 10_000,
  sanctions  : 5_000,

  gstart     : 10_000,
  giveaway   : 10_000,
  reroll     : 10_000,
  choose     : 10_000,

  massiverole  : 30_000,
  unmassiverole: 30_000,
  voicemove    : 15_000,
  bringall     : 20_000,
  cleanup      : 20_000,
  unbanall     : 60_000,

  clear     : 5_000,
  renew     : 10_000,
  lockall   : 15_000,
  unlockall : 15_000,
  hideall   : 15_000,
  unhideall : 15_000,
};

const cooldowns = new Map();
const noticeCooldowns = new Map();

function isEnabled(message) {
  const guildId = message?.guild?.id ?? null;

  if (!guildId || typeof db.getCommandCooldown !== 'function') {
    return true;
  }

  const enabled = db.getCommandCooldown(guildId, ENABLED_KEY);

  return !(enabled !== null && enabled !== undefined && Number(enabled) === 0);
}

function getCooldownMs(message, commandName, command = null) {
  if (command?.help?.cooldown === false) {
    return 0;
  }

  const helpValue = Number(command?.help?.cooldownMs ?? command?.help?.cooldown);

  if (Number.isFinite(helpValue) && helpValue >= 0) {
    return Math.floor(helpValue);
  }

  const guildId = message?.guild?.id ?? null;
  const name = _normalizeCommandName(commandName);

  if (!name) {
    return DEFAULT_COOLDOWN_MS;
  }

  if (guildId && typeof db.getCommandCooldown === 'function') {
    const commandCooldown = db.getCommandCooldown(guildId, name);

    if (commandCooldown !== null && commandCooldown !== undefined) {
      return Math.max(0, Number(commandCooldown) || 0);
    }

    const defaultCooldown = db.getCommandCooldown(guildId, DEFAULT_KEY);

    if (defaultCooldown !== null && defaultCooldown !== undefined) {
      return Math.max(0, Number(defaultCooldown) || 0);
    }
  }

  return FALLBACK_COMMAND_COOLDOWNS[name] ?? DEFAULT_COOLDOWN_MS;
}

function getCustomCommandCooldownMs(message, commandName) {
  const guildId = message?.guild?.id ?? null;
  const name = _normalizeCommandName(commandName);

  if (guildId && name && typeof db.getCommandCooldown === 'function') {
    const customCooldown = db.getCommandCooldown(guildId, name);

    if (customCooldown !== null && customCooldown !== undefined) {
      return Math.max(0, Number(customCooldown) || 0);
    }

    const defaultCooldown = db.getCommandCooldown(guildId, DEFAULT_KEY);

    if (defaultCooldown !== null && defaultCooldown !== undefined) {
      return Math.max(0, Number(defaultCooldown) || 0);
    }
  }

  return CUSTOM_COMMAND_COOLDOWN_MS;
}

function shouldBypass(message) {
  try {
    if (!message?.guild || !message?.member || !message?.author) {
      return false;
    }

    const guildId = message.guild.id;
    const userId = message.author.id;

    if (typeof perms.isBuyer === 'function' && perms.isBuyer(userId)) {
      return true;
    }

    if (typeof perms.isGlobalOwner === 'function' && perms.isGlobalOwner(userId)) {
      return true;
    }

    if (
      BYPASS_MIN_LEVEL > 0 &&
      typeof perms.hasLevel === 'function' &&
      perms.hasLevel(message.member, guildId, BYPASS_MIN_LEVEL)
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function check(message, commandName, command = null) {
  if (!message?.guild || !message?.author) {
    return { allowed: true };
  }

  if (!isEnabled(message)) {
    return { allowed: true };
  }

  if (shouldBypass(message)) {
    return { allowed: true };
  }

  const name = _normalizeCommandName(commandName);

  if (!name) {
    return { allowed: true };
  }

  const cooldownMs = getCooldownMs(message, name, command);

  if (!cooldownMs || cooldownMs <= 0) {
    return { allowed: true };
  }

  return _checkKey(
    `${message.guild.id}:${message.author.id}:${name}`,
    cooldownMs
  );
}

function checkCustom(message, commandName) {
  if (!message?.guild || !message?.author) {
    return { allowed: true };
  }

  if (!isEnabled(message)) {
    return { allowed: true };
  }

  if (shouldBypass(message)) {
    return { allowed: true };
  }

  const name = _normalizeCommandName(commandName) || 'custom';
  const cooldownMs = getCustomCommandCooldownMs(message, name);

  if (!cooldownMs || cooldownMs <= 0) {
    return { allowed: true };
  }

  return _checkKey(
    `${message.guild.id}:${message.author.id}:custom:${name}`,
    cooldownMs
  );
}

async function replyBlocked(message, remainingMs, deleteReply = false, deleteDelay = 5, shouldNotify = true) {
  if (!shouldNotify) {
    return null;
  }

  const seconds = Math.max(1, Math.ceil(Number(remainingMs || 0) / 1000));

  const sent = await embed.replyError(
    message,
    `Veuillez patienter encore \`${seconds}s\` avant de réutiliser cette commande.`,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }

  return sent;
}

function clearUser(userId, guildId = null) {
  if (!userId) return 0;

  let deleted = 0;

  for (const key of cooldowns.keys()) {
    const parts = key.split(':');
    const keyGuildId = parts[0];
    const keyUserId = parts[1];

    if (keyUserId !== String(userId)) continue;
    if (guildId && keyGuildId !== String(guildId)) continue;

    cooldowns.delete(key);
    deleted++;
  }

  return deleted;
}

function _checkKey(key, cooldownMs) {
  const now = Date.now();
  const expiresAt = cooldowns.get(key) || 0;

  if (expiresAt > now) {
    return {
      allowed: false,
      remainingMs: expiresAt - now,
      shouldNotify: _shouldNotify(key),
    };
  }

  cooldowns.set(key, now + cooldownMs);

  setTimeout(() => {
    const current = cooldowns.get(key);

    if (current && current <= Date.now()) {
      cooldowns.delete(key);
    }
  }, cooldownMs + 1000).unref?.();

  return { allowed: true };
}

function _shouldNotify(key) {
  const noticeKey = `${key}:notice`;
  const now = Date.now();
  const nextAllowed = noticeCooldowns.get(noticeKey) || 0;

  if (nextAllowed > now) {
    return false;
  }

  noticeCooldowns.set(noticeKey, now + NOTICE_COOLDOWN_MS);

  setTimeout(() => {
    const current = noticeCooldowns.get(noticeKey);

    if (current && current <= Date.now()) {
      noticeCooldowns.delete(noticeKey);
    }
  }, NOTICE_COOLDOWN_MS + 500).unref?.();

  return true;
}

function _normalizeCommandName(commandName) {
  const name = String(commandName || '').trim().toLowerCase();
  return name || null;
}

module.exports = {
  DEFAULT_KEY,
  ENABLED_KEY,

  check,
  checkCustom,
  replyBlocked,

  getCooldownMs,
  getCustomCommandCooldownMs,
  isEnabled,
  shouldBypass,
  clearUser,
};
