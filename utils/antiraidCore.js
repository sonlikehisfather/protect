'use strict';

/**
 * Noyau commun de l'antiraid : exemptions, recherche dans le journal d'audit,
 * compteurs seuil/fenêtre, suivi d'éléments (pour la réparation) et sanctions.
 */

const { AuditLogEvent } = require('discord.js');

const db    = require('../core/database');
const perms = require('./permissions');

const AUDIT_FIRST_WAIT_MS  = 800;
const AUDIT_RETRY_WAIT_MS  = 1500;
const AUDIT_MAX_AGE_MS     = 10_000;

// ── Configuration ───────────────────────────────────────────────────────────

function getConfig(guildId) {
  return {
    antiraid : db.getAntiraidConfig(guildId) || {},
    guild    : db.getGuildConfig(guildId) || {},
  };
}

/** Le module est-il actif (antiraid global + module) ? */
function isEnabled(guildId, enabledKey) {
  const { antiraid, guild } = getConfig(guildId);
  return Boolean(guild.antiraidEnabled) && Boolean(antiraid[enabledKey]);
}

// ── Exemptions ──────────────────────────────────────────────────────────────

/**
 * L'exécuteur est-il exempté de l'antiraid ?
 * Les buyers/owners/whitelist le sont toujours ; la liste protectuser
 * seulement si l'option antiraidProtectUserBypass est activée.
 */
function isExempt(executorId, guildId, executorMember = null) {
  const bypass = Boolean(db.getAntiraidConfig(guildId)?.antiraidProtectUserBypass);
  return perms.isProtected(executorId, guildId, executorMember, { ignoreProtectUser: !bypass });
}

// ── Journal d'audit ─────────────────────────────────────────────────────────

const _sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Lecture du journal d'audit "coalescée" : plusieurs événements simultanés (départs en masse, etc.)
// partagent la même requête au lieu d'en faire une chacun (évite le rate-limit).
const _auditCache = new Map();   // `${guildId}_${type}` -> { t, promise }

function fetchRecentAudit(guild, type, maxAgeMs = 700) {
  const key = `${guild.id}_${type}`;
  const cached = _auditCache.get(key);
  if (cached && Date.now() - cached.t < maxAgeMs) return cached.promise;

  const promise = guild.fetchAuditLogs({ type, limit: 50 }).catch(() => null);
  _auditCache.set(key, { t: Date.now(), promise });
  if (_auditCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _auditCache) if (now - v.t > 10_000) _auditCache.delete(k);
  }
  return promise;
}

/**
 * Cherche l'entrée du journal d'audit la plus récente correspondant à `type`
 * (et à `targetId` si fourni). Deux essais pour absorber la latence de Discord.
 */
async function findAuditEntry(guild, type, targetId = null) {
  for (const wait of [AUDIT_FIRST_WAIT_MS, AUDIT_RETRY_WAIT_MS]) {
    await _sleep(wait);

    const fetched = await fetchRecentAudit(guild, type);
    if (!fetched) continue;

    const now = Date.now();
    const matches = [...fetched.entries.values()]
      .filter(e => now - e.createdTimestamp < AUDIT_MAX_AGE_MS)
      .filter(e => targetId == null || e.target?.id === targetId)
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    if (matches[0]?.executor) return matches[0];
  }
  return null;
}

// ── Compteurs seuil / fenêtre ───────────────────────────────────────────────

const _hits  = new Map();   // key -> [{ t, item }]

/**
 * Enregistre une action et retourne { triggered, items }.
 * `items` = tous les éléments enregistrés dans la fenêtre (utile à la réparation).
 * Quand le seuil est atteint, le compteur est remis à zéro.
 */
function hit(key, threshold, windowMs, item = null) {
  const now  = Date.now();
  if (_hits.size > 500) {
    for (const [k, v] of _hits) {
      if (!v.length || now - v[v.length - 1].t > 10 * 60_000) _hits.delete(k);
    }
  }
  const list = (_hits.get(key) ?? []).filter(h => now - h.t <= windowMs);
  list.push({ t: now, item });

  if (list.length >= Math.max(1, threshold)) {
    _hits.delete(key);
    return { triggered: true, items: list.map(h => h.item).filter(i => i != null) };
  }

  _hits.set(key, list);
  return { triggered: false, items: [] };
}

// ── Historique & alertes ────────────────────────────────────────────────────

function record(guildId, kind, source, executorId = null, detail = null) {
  try { db.addAntiraidHistory(guildId, kind, source, executorId, detail); } catch {}
}

const _alertCooldown = new Map();

/** Prévient par message privé les buyers et les owners du serveur (option antiraidAlertDm). */
async function notifyOwners(client, guild, text, cooldownKey) {
  try {
    if (db.getAntiraidConfig(guild.id)?.antiraidAlertDm === 0) return;

    const now = Date.now();
    if (cooldownKey) {
      const last = _alertCooldown.get(cooldownKey);
      if (last && now - last < 30_000) return;
      _alertCooldown.set(cooldownKey, now);
    }

    const ids = new Set([
      perms.getSuperAdminId(),
      ...db.getGlobalBuyers(),
      ...db.getOwners(guild.id),
    ].filter(Boolean));

    for (const id of ids) {
      const user = await client.users.fetch(id).catch(() => null);
      if (!user || user.bot) continue;
      await user.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
    }
  } catch {}
}

// ── Sanctions ───────────────────────────────────────────────────────────────

const _recentPunish = new Map();

async function punish(client, guild, userId, punishment, source) {
  const guildId = guild.id;
  const reason  = `Antiraid - ${source}`;
  const member  = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
  const cfg     = db.getAntiraidConfig(guildId) || {};

  // Même sanction sur le même membre en quelques secondes (deux modules pour un seul acte) : une seule fois.
  const dupKey = `${guildId}_${userId}_${punishment}`;
  const lastPunish = _recentPunish.get(dupKey);
  if (lastPunish && Date.now() - lastPunish < 5000) {
    record(guildId, 'sanction-doublon', source, userId, `${punishment} (déjà appliqué)`);
    return;
  }
  _recentPunish.set(dupKey, Date.now());
  if (_recentPunish.size > 200) {
    for (const [k, t] of _recentPunish) if (Date.now() - t > 60_000) _recentPunish.delete(k);
  }

  record(guildId, 'sanction', source, userId, punishment);
  notifyOwners(
    client, guild,
    `⚠ **Antiraid** sur **${guild.name}** : \`${source}\` déclenché.
Auteur : <@${userId}> (${userId})
Sanction : **${punishment}**`,
    `${guildId}_${source}_${userId}`
  );

  switch (punishment) {
    case 'warn':
      db.addSanction(guildId, userId, client.user.id, 'warn', reason);
      return;

    case 'mute': {
      const seconds = Math.max(10, Number(cfg.antiraidMuteDuration) || 600);
      if (member) await member.timeout(Math.min(seconds, 28 * 24 * 3600) * 1000, reason).catch(() => {});
      db.addSanction(guildId, userId, client.user.id, 'mute', reason, seconds);
      return;
    }

    case 'kick':
      if (member) await member.kick(reason).catch(() => {});
      db.addSanction(guildId, userId, client.user.id, 'kick', reason);
      return;

    case 'ban':
      await guild.members.ban(userId, { reason }).catch(() => {});
      db.addSanction(guildId, userId, client.user.id, 'ban', reason);
      return;

    case 'derank':
    default: {
      if (!member) return;
      const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
      const keepRoles = new Set(db.getNoderankRoles(guildId));
      const toRemove = member.roles.cache
        .filter(role =>
          role.id !== guild.id &&
          !keepRoles.has(role.id) &&
          !role.managed &&
          (!me || me.roles.highest.comparePositionTo(role) > 0)
        )
        .map(role => role.id);

      if (!toRemove.length) return;

      const ok = await member.roles.remove(toRemove, reason).then(() => true).catch(() => false);
      if (!ok) return;

      db.addSanction(guildId, userId, client.user.id, 'derank', reason);
      if (cfg.antiraidDerankBackup !== 0) {
        try { db.saveFivemRoleBackup(guildId, userId, 'derank', toRemove, client.user.id); } catch {}
      }
    }
  }
}

// ── Réparation ──────────────────────────────────────────────────────────────

/** Recrée un salon supprimé à partir d'un instantané pris avant suppression. */
async function restoreChannel(guild, snap, idMap = null) {
  try {
    const created = await guild.channels.create({
      name                 : snap.name,
      type                 : snap.type,
      topic                : snap.topic ?? undefined,
      nsfw                 : snap.nsfw ?? undefined,
      bitrate              : snap.bitrate ?? undefined,
      userLimit            : snap.userLimit ?? undefined,
      rateLimitPerUser     : snap.rateLimitPerUser ?? undefined,
      parent               : (() => {
        const mapped = snap.parentId ? (idMap?.get(snap.parentId) ?? snap.parentId) : null;
        return mapped && guild.channels.cache.has(mapped) ? mapped : undefined;
      })(),
      permissionOverwrites : (snap.overwrites || []).filter(o => o.type === 0 ? guild.roles.cache.has(o.id) : true),
      reason               : 'Antiraid - restauration salon',
    });
    if (typeof snap.position === 'number') await created.setPosition(snap.position).catch(() => {});
    idMap?.set(snap.id, created.id);
    record(guild.id, 'restore', 'antichannel', null, `salon recréé : ${snap.name}`);
    return created;
  } catch {
    return null;
  }
}

function snapshotChannel(channel) {
  return {
    id               : channel.id,
    name             : channel.name,
    type             : channel.type,
    topic            : channel.topic ?? null,
    nsfw             : channel.nsfw ?? null,
    bitrate          : channel.bitrate ?? null,
    userLimit        : channel.userLimit ?? null,
    rateLimitPerUser : channel.rateLimitPerUser ?? null,
    parentId         : channel.parentId ?? null,
    position         : channel.rawPosition ?? channel.position ?? null,
    overwrites       : [...(channel.permissionOverwrites?.cache?.values() ?? [])].map(o => ({
      id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield,
    })),
  };
}

function snapshotRole(role) {
  return {
    id          : role.id,
    name        : role.name,
    color       : role.color,
    hoist       : role.hoist,
    mentionable : role.mentionable,
    permissions : role.permissions.bitfield,
    position    : role.rawPosition ?? role.position,
  };
}

async function restoreRole(guild, snap) {
  try {
    const created = await guild.roles.create({
      name        : snap.name,
      color       : snap.color,
      hoist       : snap.hoist,
      mentionable : snap.mentionable,
      permissions : BigInt(snap.permissions),
      reason      : 'Antiraid - restauration rôle',
    });
    if (typeof snap.position === 'number') await created.setPosition(snap.position).catch(() => {});
    record(guild.id, 'restore', 'antiroles', null, `rôle recréé : ${snap.name}`);
    return created;
  } catch {
    return null;
  }
}

module.exports = {
  AuditLogEvent,
  getConfig,
  isEnabled,
  isExempt,
  findAuditEntry,
  fetchRecentAudit,
  record,
  notifyOwners,
  hit,
  punish,
  restoreChannel,
  snapshotChannel,
  restoreRole,
  snapshotRole,
};
