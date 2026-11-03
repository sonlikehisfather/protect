'use strict';

const { AuditLogEvent } = require('discord.js');
const errorHandler = require('../utils/errorHandler');
const db = require('../core/database');
const embed = require('../utils/embed');
const logger = require('../utils/logger');
const core = require('../utils/antiraidCore');

/**
 * Suppression de messages en masse (bulkDelete) par un membre.
 * Le seuil compte le NOMBRE DE MESSAGES supprimés dans la fenêtre.
 * Les purges faites par le bot lui-même (commande clear) sont ignorées.
 */
module.exports = {
  name : 'messageDeleteBulk',
  once : false,

  async execute(client, messages, channel) {
    const guild = channel?.guild ?? messages.first?.()?.guild;
    if (!guild) return;

    _handle(client, guild, channel, messages.size).catch(err =>
      errorHandler.handle(err, { source: 'antimassdeleteGuard', guildId: guild.id })
    );
  },
};

async function _handle(client, guild, channel, size) {
  const guildId = guild.id;
  if (!core.isEnabled(guildId, 'antimassdeleteEnabled')) return;

  const entry = await core.findAuditEntry(guild, AuditLogEvent.MessageBulkDelete, channel.id);
  if (!entry?.executor) return;

  const executorId = entry.executor.id;
  if (executorId === client.user.id) return;

  const executorMember =
    guild.members.cache.get(executorId) ??
    await guild.members.fetch(executorId).catch(() => null);
  if (core.isExempt(executorId, guildId, executorMember)) return;

  const cfg       = db.getAntiraidConfig(guildId) || {};
  const threshold = Math.max(1, Number(cfg.antimassdeleteThreshold) || 30);
  const windowMs  = Math.max(1000, (Number(cfg.antimassdeleteWindow) || 10) * 1000);

  // Un "hit" par message supprimé : le seuil est un nombre de messages.
  let triggered = false;
  for (let i = 0; i < size && !triggered; i++) {
    triggered = core.hit(`massdel_${guildId}_${executorId}`, threshold, windowMs).triggered;
  }
  if (!triggered) return;

  const punishment = cfg.antimassdeletePunish ?? 'derank';
  await core.punish(client, guild, executorId, punishment, 'antimassdelete');

  await logger.send(client, guildId, 'raidlog', embed.log(guildId, 'Antimassdelete déclenché', [
    { name: 'Exécuteur', value: `<@${executorId}> (${entry.executor.tag})`, inline: true },
    { name: 'Détection', value: `${threshold} message(s) en ${Math.floor(windowMs / 1000)}s`, inline: true },
    { name: 'Action', value: punishment, inline: true },
    { name: 'Salon', value: `<#${channel.id}> (${size} message(s) supprimés)`, inline: false },
  ], { thumbnail: entry.executor.displayAvatarURL({ dynamic: true }) }));
}
