'use strict';

/**
 * Garde générique "seuil / fenêtre" : lit la config d'un module antiraid
 * (<prefix>Enabled/Threshold/Window/Punish), retrouve l'exécuteur dans le
 * journal d'audit, compte, sanctionne et journalise dans raidlog.
 */

const db     = require('../core/database');
const embed  = require('./embed');
const logger = require('./logger');
const core   = require('./antiraidCore');

const _seenEntries = new Map();   // entryId -> timestamp

/**
 * @returns {Promise<null | { entry, items, cfg, punishment }>} null si pas de déclenchement
 */
async function countGuard(client, guild, opts) {
  const { prefix, auditType, targetId = null, item = null, label, detail = null, dedupeByEntry = false } = opts;
  const guildId = guild.id;

  if (!core.isEnabled(guildId, `${prefix}Enabled`)) return null;

  const entry = await core.findAuditEntry(guild, auditType, targetId);
  if (!entry?.executor) return null;

  if (dedupeByEntry && entry.id) {
    const now = Date.now();
    for (const [id, t] of _seenEntries) if (now - t > 60_000) _seenEntries.delete(id);
    if (_seenEntries.has(entry.id)) return null;
    _seenEntries.set(entry.id, now);
  }

  const executorId = entry.executor.id;
  if (executorId === client.user.id) return null;

  const executorMember =
    guild.members.cache.get(executorId) ??
    await guild.members.fetch(executorId).catch(() => null);

  if (core.isExempt(executorId, guildId, executorMember)) return null;

  const cfg       = db.getAntiraidConfig(guildId) || {};
  const threshold = Math.max(1, Number(cfg[`${prefix}Threshold`]) || 1);
  const windowMs  = Math.max(1000, (Number(cfg[`${prefix}Window`]) || 10) * 1000);

  const result = core.hit(`${prefix}_${guildId}_${executorId}`, threshold, windowMs, item);
  if (!result.triggered) return null;

  const punishment = cfg[`${prefix}Punish`] ?? 'derank';
  await core.punish(client, guild, executorId, punishment, prefix);

  const fields = [
    { name: 'Exécuteur', value: `<@${executorId}> (${entry.executor.tag})`, inline: true },
    { name: 'Détection', value: `${threshold} action(s) en ${Math.floor(windowMs / 1000)}s`, inline: true },
    { name: 'Action', value: punishment, inline: true },
  ];
  if (detail) fields.push({ name: 'Détail', value: String(detail).slice(0, 1000), inline: false });

  await logger.send(client, guildId, 'raidlog', embed.log(guildId, label, fields, {
    thumbnail: entry.executor.displayAvatarURL({ dynamic: true }),
  }));

  return { entry, items: result.items, cfg, punishment };
}

module.exports = { countGuard };
