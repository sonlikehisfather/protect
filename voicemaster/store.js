'use strict';

/**
 * VoiceMaster - unique point d'acces a la base de donnees.
 * Les commandes ne touchent jamais la DB directement.
 */

const db = require('../core/database');
const { STORED_RANKS } = require('./config');

let _ready = false;

function _db() {
  return db.raw();
}

function init() {
  if (_ready) return;

  _db().exec(`
    CREATE TABLE IF NOT EXISTS vm_ranks (
      guildId   TEXT NOT NULL,
      userId    TEXT NOT NULL,
      rank      TEXT NOT NULL,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (guildId, userId)
    );

    CREATE TABLE IF NOT EXISTS vm_sysplus (
      userId    TEXT PRIMARY KEY,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS vm_wlmv (
      guildId   TEXT NOT NULL,
      userId    TEXT NOT NULL,
      allowedId TEXT NOT NULL,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (guildId, userId, allowedId)
    );

    CREATE TABLE IF NOT EXISTS vm_cuffs (
      guildId   TEXT NOT NULL,
      userId    TEXT NOT NULL,
      channelId TEXT NOT NULL,
      byId      TEXT NOT NULL,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (guildId, userId),
      UNIQUE (guildId, byId)
    );

    CREATE TABLE IF NOT EXISTS vm_follow (
      guildId    TEXT NOT NULL,
      followerId TEXT NOT NULL,
      targetId   TEXT NOT NULL,
      createdAt  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (guildId, followerId)
    );

    CREATE TABLE IF NOT EXISTS vm_logs (
      guildId   TEXT NOT NULL,
      type      TEXT NOT NULL,
      channelId TEXT,
      enabled   INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (guildId, type)
    );

    CREATE TABLE IF NOT EXISTS vm_wl (
      guildId   TEXT NOT NULL,
      userId    TEXT NOT NULL,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (guildId, userId)
    );

    CREATE TABLE IF NOT EXISTS vm_pv (
      guildId   TEXT NOT NULL,
      channelId TEXT NOT NULL,
      ownerId   TEXT NOT NULL,
      ownerRank INTEGER NOT NULL,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (guildId, channelId),
      UNIQUE (guildId, ownerId)
    );

    CREATE TABLE IF NOT EXISTS vm_access (
      guildId   TEXT NOT NULL,
      channelId TEXT NOT NULL,
      userId    TEXT NOT NULL,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (guildId, channelId, userId)
    );
  `);

  _ready = true;
}

/* Rangs stockes : owner | sys | sys+ */

function getStoredRank(guildId, userId) {
  const row = _db()
    .prepare('SELECT rank FROM vm_ranks WHERE guildId = ? AND userId = ?')
    .get(guildId, userId);
  return row && STORED_RANKS[row.rank] ? row.rank : null;
}

function setStoredRank(guildId, userId, rank) {
  if (!STORED_RANKS[rank]) throw new Error(`Rang VoiceMaster invalide : ${rank}`);
  _db()
    .prepare(`
      INSERT INTO vm_ranks (guildId, userId, rank) VALUES (?, ?, ?)
      ON CONFLICT (guildId, userId) DO UPDATE SET rank = excluded.rank
    `)
    .run(guildId, userId, rank);
}

function removeStoredRank(guildId, userId) {
  return _db()
    .prepare('DELETE FROM vm_ranks WHERE guildId = ? AND userId = ?')
    .run(guildId, userId).changes > 0;
}

function listStoredRank(guildId, rank) {
  return _db()
    .prepare('SELECT userId FROM vm_ranks WHERE guildId = ? AND rank = ? ORDER BY createdAt')
    .all(guildId, rank)
    .map(r => r.userId);
}

function listSysPlus() {
  return _db()
    .prepare('SELECT userId FROM vm_sysplus ORDER BY createdAt')
    .all()
    .map(r => r.userId);
}

/* Logs VoiceMaster : un salon par type, avec un indicateur actif/inactif */

function getLogEntry(guildId, type) {
  const row = _db()
    .prepare('SELECT channelId, enabled FROM vm_logs WHERE guildId = ? AND type = ?')
    .get(guildId, type);
  return row ? { channelId: row.channelId, enabled: row.enabled === 1 } : null;
}

function listLogEntries(guildId) {
  return _db()
    .prepare('SELECT type, channelId, enabled FROM vm_logs WHERE guildId = ?')
    .all(guildId)
    .map(r => ({ type: r.type, channelId: r.channelId, enabled: r.enabled === 1 }));
}

function setLogChannel(guildId, type, channelId) {
  _db()
    .prepare(`
      INSERT INTO vm_logs (guildId, type, channelId, enabled) VALUES (?, ?, ?, 1)
      ON CONFLICT (guildId, type) DO UPDATE SET channelId = excluded.channelId
    `)
    .run(guildId, type, channelId);
}

function clearLogChannel(guildId, type) {
  return _db()
    .prepare('DELETE FROM vm_logs WHERE guildId = ? AND type = ?')
    .run(guildId, type).changes > 0;
}

function setAllLogsEnabled(guildId, enabled) {
  return _db()
    .prepare('UPDATE vm_logs SET enabled = ? WHERE guildId = ?')
    .run(enabled ? 1 : 0, guildId).changes;
}

/* wlmv : personnes autorisées à =mv un membre malgré un rang inférieur */

function hasWlmv(guildId, userId, allowedId) {
  return Boolean(
    _db()
      .prepare('SELECT 1 FROM vm_wlmv WHERE guildId = ? AND userId = ? AND allowedId = ?')
      .get(guildId, userId, allowedId)
  );
}

function addWlmv(guildId, userId, allowedId) {
  _db()
    .prepare('INSERT OR IGNORE INTO vm_wlmv (guildId, userId, allowedId) VALUES (?, ?, ?)')
    .run(guildId, userId, allowedId);
}

function removeWlmv(guildId, userId, allowedId) {
  return _db()
    .prepare('DELETE FROM vm_wlmv WHERE guildId = ? AND userId = ? AND allowedId = ?')
    .run(guildId, userId, allowedId).changes > 0;
}

/* Menottes : un membre attaché à un salon, une seule personne menottée par menotteur */

function getCuff(guildId, userId) {
  return _db()
    .prepare('SELECT userId, channelId, byId FROM vm_cuffs WHERE guildId = ? AND userId = ?')
    .get(guildId, userId) ?? null;
}

function getCuffByCuffer(guildId, byId) {
  return _db()
    .prepare('SELECT userId, channelId, byId FROM vm_cuffs WHERE guildId = ? AND byId = ?')
    .get(guildId, byId) ?? null;
}

function setCuff(guildId, userId, channelId, byId) {
  _db()
    .prepare('INSERT INTO vm_cuffs (guildId, userId, channelId, byId) VALUES (?, ?, ?, ?)')
    .run(guildId, userId, channelId, byId);
}

function removeCuff(guildId, userId) {
  return _db()
    .prepare('DELETE FROM vm_cuffs WHERE guildId = ? AND userId = ?')
    .run(guildId, userId).changes > 0;
}

/* Follow : un suiveur ne suit qu'une personne à la fois */

function getFollow(guildId, followerId) {
  return _db()
    .prepare('SELECT followerId, targetId FROM vm_follow WHERE guildId = ? AND followerId = ?')
    .get(guildId, followerId) ?? null;
}

function listFollowers(guildId, targetId) {
  return _db()
    .prepare('SELECT followerId FROM vm_follow WHERE guildId = ? AND targetId = ?')
    .all(guildId, targetId)
    .map(r => r.followerId);
}

function setFollow(guildId, followerId, targetId) {
  _db()
    .prepare(`
      INSERT INTO vm_follow (guildId, followerId, targetId) VALUES (?, ?, ?)
      ON CONFLICT (guildId, followerId) DO UPDATE SET targetId = excluded.targetId
    `)
    .run(guildId, followerId, targetId);
}

function removeFollow(guildId, followerId) {
  return _db()
    .prepare('DELETE FROM vm_follow WHERE guildId = ? AND followerId = ?')
    .run(guildId, followerId).changes > 0;
}

/* Sys+ : rang GLOBAL (valable sur tous les serveurs), contrairement à owner et sys. */

function isSysPlus(userId) {
  return Boolean(_db().prepare('SELECT 1 FROM vm_sysplus WHERE userId = ?').get(userId));
}

function addSysPlus(userId) {
  _db().prepare('INSERT OR IGNORE INTO vm_sysplus (userId) VALUES (?)').run(userId);
}

function removeSysPlus(userId) {
  return _db().prepare('DELETE FROM vm_sysplus WHERE userId = ?').run(userId).changes > 0;
}

/* WL : indicateur separe du rang */

function isWl(guildId, userId) {
  return Boolean(
    _db()
      .prepare('SELECT 1 FROM vm_wl WHERE guildId = ? AND userId = ?')
      .get(guildId, userId)
  );
}

function addWl(guildId, userId) {
  _db()
    .prepare('INSERT OR IGNORE INTO vm_wl (guildId, userId) VALUES (?, ?)')
    .run(guildId, userId);
}

function removeWl(guildId, userId) {
  return _db()
    .prepare('DELETE FROM vm_wl WHERE guildId = ? AND userId = ?')
    .run(guildId, userId).changes > 0;
}

function listWl(guildId) {
  return _db()
    .prepare('SELECT userId FROM vm_wl WHERE guildId = ? ORDER BY createdAt')
    .all(guildId)
    .map(r => r.userId);
}

/* Salons privés (pv) */

function getPvByChannel(guildId, channelId) {
  return _db()
    .prepare('SELECT channelId, ownerId, ownerRank FROM vm_pv WHERE guildId = ? AND channelId = ?')
    .get(guildId, channelId) ?? null;
}

function getPvByOwner(guildId, ownerId) {
  return _db()
    .prepare('SELECT channelId, ownerId, ownerRank FROM vm_pv WHERE guildId = ? AND ownerId = ?')
    .get(guildId, ownerId) ?? null;
}

function listPv(guildId) {
  return _db()
    .prepare('SELECT channelId, ownerId, ownerRank FROM vm_pv WHERE guildId = ? ORDER BY createdAt')
    .all(guildId);
}

function setPv(guildId, channelId, ownerId, ownerRank) {
  _db()
    .prepare('INSERT INTO vm_pv (guildId, channelId, ownerId, ownerRank) VALUES (?, ?, ?, ?)')
    .run(guildId, channelId, ownerId, ownerRank);
}

/** Retire le pv et supprime tous ses accès. */
function removePv(guildId, channelId) {
  const conn = _db();
  const tx = conn.transaction(() => {
    conn.prepare('DELETE FROM vm_access WHERE guildId = ? AND channelId = ?').run(guildId, channelId);
    return conn.prepare('DELETE FROM vm_pv WHERE guildId = ? AND channelId = ?').run(guildId, channelId).changes > 0;
  });
  return tx();
}

/* Accès aux salons pv */

function hasAccess(guildId, channelId, userId) {
  return Boolean(
    _db()
      .prepare('SELECT 1 FROM vm_access WHERE guildId = ? AND channelId = ? AND userId = ?')
      .get(guildId, channelId, userId)
  );
}

function listAccess(guildId, channelId) {
  return _db()
    .prepare('SELECT userId FROM vm_access WHERE guildId = ? AND channelId = ? ORDER BY createdAt')
    .all(guildId, channelId)
    .map(r => r.userId);
}

function removeAccess(guildId, channelId, userId) {
  return _db()
    .prepare('DELETE FROM vm_access WHERE guildId = ? AND channelId = ? AND userId = ?')
    .run(guildId, channelId, userId).changes > 0;
}

function countAccess(guildId, channelId) {
  return _db()
    .prepare('SELECT COUNT(*) AS n FROM vm_access WHERE guildId = ? AND channelId = ?')
    .get(guildId, channelId).n;
}

function addAccess(guildId, channelId, userId) {
  return _db()
    .prepare('INSERT OR IGNORE INTO vm_access (guildId, channelId, userId) VALUES (?, ?, ?)')
    .run(guildId, channelId, userId).changes > 0;
}

module.exports = {
  getPvByChannel,
  getPvByOwner,
  listPv,
  setPv,
  removePv,
  hasAccess,
  removeAccess,
  countAccess,
  listAccess,
  addAccess,
  init,
  getLogEntry,
  listLogEntries,
  setLogChannel,
  clearLogChannel,
  setAllLogsEnabled,
  hasWlmv,
  addWlmv,
  removeWlmv,
  getCuff,
  getCuffByCuffer,
  setCuff,
  removeCuff,
  getFollow,
  listFollowers,
  setFollow,
  removeFollow,
  isSysPlus,
  addSysPlus,
  removeSysPlus,
  getStoredRank,
  setStoredRank,
  removeStoredRank,
  listStoredRank,
  listSysPlus,
  isWl,
  addWl,
  removeWl,
  listWl,
};
