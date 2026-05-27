'use strict';


const db           = require('../core/database');
const errorHandler = require('./errorHandler');

const MAX_TIMEOUT_MS = 2_147_483_000;


const _timers = new Map();

function _key(guildId, userId) {
  return `${guildId}:${userId}`;
}


function schedule(client, guildId, userId, expiresAt) {
  if (!client || !guildId || !userId) return false;

  const exp = Math.floor(Number(expiresAt));
  if (!Number.isFinite(exp) || exp <= 0) return false;

  db.setPendingVerification(guildId, userId, exp);
  return _arm(client, guildId, userId, exp);
}

function _arm(client, guildId, userId, expiresAt) {
  const key = _key(guildId, userId);
  const existing = _timers.get(key);

  if (existing) {
    clearTimeout(existing);
    _timers.delete(key);
  }

  const remainingMs = Math.max(0, (expiresAt * 1000) - Date.now());
  const safeMs = Math.min(remainingMs, MAX_TIMEOUT_MS);

  const timer = setTimeout(() => {
    _timers.delete(key);
    _processTimeout(client, { guildId, userId, expiresAt }).catch((err) => {
      errorHandler.handle(err, {
        source : 'verifyTimeouts._processTimeout',
        guildId,
        userId,
      });
    });
  }, safeMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  _timers.set(key, timer);
  return true;
}


function cancel(guildId, userId) {
  if (!guildId || !userId) return false;

  const key = _key(guildId, userId);
  const timer = _timers.get(key);

  if (timer) {
    clearTimeout(timer);
    _timers.delete(key);
  }

  db.deletePendingVerification(guildId, userId);
  return true;
}


function cancelGuildAll(guildId) {
  if (!guildId) return 0;

  const prefix = `${guildId}:`;
  let count = 0;

  for (const [key, timer] of _timers.entries()) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer);
      _timers.delete(key);
      count++;
    }
  }

  db.clearGuildPendingVerifications(guildId);
  return count;
}


async function restoreAll(client) {
  if (!client) return 0;

  let scheduled = 0;
  let processed = 0;

  try {
    const rows = db.getPendingVerifications();
    if (!rows.length) return 0;

    const now = Math.floor(Date.now() / 1000);

    for (const row of rows) {
      try {
        if (row.expiresAt <= now) {
          await _processTimeout(client, row);
          processed++;
        } else {
          _arm(client, row.guildId, row.userId, row.expiresAt);
          scheduled++;
        }
      } catch (err) {
        errorHandler.handle(err, {
          source  : 'verifyTimeouts.restoreAll.row',
          guildId : row.guildId,
          userId  : row.userId,
        });
      }
    }

    if (scheduled || processed) {
      console.log(`[VerifyTimeouts] restore : ${scheduled} programme(s), ${processed} traite(s) immediat`);
    }
  } catch (err) {
    errorHandler.handle(err, { source: 'verifyTimeouts.restoreAll' });
  }

  return scheduled + processed;
}

async function _processTimeout(client, row) {
  const { guildId, userId } = row;

  try {
    const guild = client.guilds.cache.get(guildId)
      ?? await client.guilds.fetch(guildId).catch(() => null);

    if (!guild) {
      db.deletePendingVerification(guildId, userId);
      return;
    }

    const config = db.getGuildConfig(guildId) || {};


    if (Number(config.verifyEnabled) !== 1 || Number(config.verifyDuration) <= 0) {
      db.deletePendingVerification(guildId, userId);
      return;
    }

    const member = await guild.members.fetch(userId).catch(() => null);

    if (!member) {
      db.deletePendingVerification(guildId, userId);
      return;
    }

    if (config.verifyRoleId && member.roles.cache.has(config.verifyRoleId)) {
      db.deletePendingVerification(guildId, userId);
      return;
    }

    let kicked = false;
    try {
      await member.kick('Vérification expirée');
      kicked = true;
    } catch (err) {
      errorHandler.handle(err, {
        source : 'verifyTimeouts.kick',
        guildId,
        userId,
      });
    }

    db.deletePendingVerification(guildId, userId);

    try {
      const verifyLogger = require('./verifyLogger');
      await verifyLogger.sendVerifyLog(client, guildId, {
        title : kicked ? 'Vérification expirée' : 'Vérification expirée (kick échoué)',
        level : kicked ? 'warn' : 'error',
        fields : [
          {
            name   : 'Membre',
            value  : `<@${member.id}> (${member.user.tag}) \`${member.id}\``,
            inline : true,
          },
          {
            name   : 'Durée',
            value  : `${Number(config.verifyDuration) || 0}s`,
            inline : true,
          },
        ],
        thumbnail : member.user.displayAvatarURL?.({ dynamic: true }) || null,
      });
    } catch {
    }
  } catch (err) {
    db.deletePendingVerification(guildId, userId);
    errorHandler.handle(err, {
      source : 'verifyTimeouts._processTimeout.outer',
      guildId,
      userId,
    });
  }
}

module.exports = {
  schedule,
  cancel,
  cancelGuildAll,
  restoreAll,
};
