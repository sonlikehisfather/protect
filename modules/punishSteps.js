'use strict';


const db = require('../core/database');


const strikeMap = new Map();

const WARN_BEFORE_PUNISH = 2;
const DEFAULT_DECAY_MS   = 10 * 60 * 1000;

function _key(guildId, userId, source = 'global') {
  return `${guildId}_${userId}_${source || 'global'}`;
}

function _clampWeight(value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 20) return 20;

  return Math.floor(n);
}

function _readSteps(guildId) {
  try {
    const config = db.getAntiraidConfig(guildId);
    const raw    = config?.punishSteps;

    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(step =>
        Number(step.strikes) >= 1 &&
        Number(step.windowMs) >= 1000 &&
        typeof step.sanction === 'string'
      )
      .sort((a, b) => a.strikes - b.strikes || a.windowMs - b.windowMs);
  } catch {
    return [];
  }
}

function _defaultPunishment(count, defaultPunish) {
  if (count <= WARN_BEFORE_PUNISH) {
    return 'warn';
  }

  return defaultPunish ?? 'warn';
}

function _defaultNextInfo(count, defaultPunish) {
  const punish = defaultPunish ?? 'warn';

  if (count < WARN_BEFORE_PUNISH) {
    return {
      remaining      : WARN_BEFORE_PUNISH - count,
      nextPunishment : punish,
    };
  }

  if (count === WARN_BEFORE_PUNISH) {
    return {
      remaining      : 0,
      nextPunishment : punish,
    };
  }

  return {
    remaining      : 0,
    nextPunishment : null,
  };
}

function _getStepInfo(steps, hits, now, defaultPunish) {
  let matched = null;

  for (const step of steps) {
    const strikes  = Number(step.strikes);
    const windowMs = Number(step.windowMs);

    const count = hits.filter(ts => now - ts <= windowMs).length;

    if (count >= strikes) {
      matched = {
        step,
        count,
      };
    }
  }

  if (matched) {
    return {
      punishment     : matched.step.sanction,
      duration       : matched.step.duration ?? null,
      remaining      : 0,
      nextPunishment : null,
    };
  }

  let next = null;

  for (const step of steps) {
    const strikes  = Number(step.strikes);
    const windowMs = Number(step.windowMs);
    const count    = hits.filter(ts => now - ts <= windowMs).length;
    const remaining = Math.max(0, strikes - count);

    if (!next || remaining < next.remaining) {
      next = {
        remaining,
        nextPunishment : step.sanction,
      };
    }
  }

  return {
    punishment     : 'warn',
    duration       : null,
    remaining      : next?.remaining ?? 0,
    nextPunishment : next?.nextPunishment ?? (defaultPunish ?? null),
  };
}

function getPunishment(guildId, userId, defaultPunish, source = 'global', weight = 1) {
  return getPunishmentInfo(guildId, userId, defaultPunish, source, weight).punishment;
}

function getPunishmentInfo(guildId, userId, defaultPunish, source = 'global', weight = 1) {
  const safeSource = source || 'global';
  const key        = _key(guildId, userId, safeSource);
  const now        = Date.now();

  let entry = strikeMap.get(key);

  if (!entry) {
    entry = {
      hits  : [],
      timer : null,
    };
  }

  const safeWeight = _clampWeight(weight);

  for (let i = 0; i < safeWeight; i++) {
    entry.hits.push(now);
  }

  const steps = _readSteps(guildId);

  let result;

  if (steps.length) {
    const maxWindow = Math.max(...steps.map(step => Number(step.windowMs) || 0), DEFAULT_DECAY_MS);

    entry.hits = entry.hits.filter(ts => now - ts <= maxWindow);

    result = _getStepInfo(
      steps,
      entry.hits,
      now,
      defaultPunish
    );
  } else {
    const count    = entry.hits.length;
    const nextInfo = _defaultNextInfo(count, defaultPunish);

    result = {
      punishment     : _defaultPunishment(count, defaultPunish),
      duration       : null,
      remaining      : nextInfo.remaining,
      nextPunishment : nextInfo.nextPunishment,
    };
  }

  strikeMap.set(key, entry);

  return {
    punishment     : result.punishment,
    duration       : result.duration,
    count          : entry.hits.length,
    remaining      : result.remaining,
    nextPunishment : result.nextPunishment,
    source         : safeSource,
  };
}

function decay(guildId, userId, delay = DEFAULT_DECAY_MS, source = 'global') {
  const key   = _key(guildId, userId, source);
  const entry = strikeMap.get(key);

  if (!entry) return;

  if (entry.timer) {
    clearTimeout(entry.timer);
  }

  entry.timer = setTimeout(() => {
    strikeMap.delete(key);
  }, delay);
}

function reset(guildId, userId, source = 'global') {
  strikeMap.delete(_key(guildId, userId, source));
}

function getCount(guildId, userId, source = 'global') {
  const entry = strikeMap.get(_key(guildId, userId, source));
  return entry?.hits?.length ?? 0;
}

module.exports = {
  getPunishment,
  getPunishmentInfo,
  decay,
  reset,
  getCount,
};
