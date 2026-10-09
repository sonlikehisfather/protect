'use strict';

const { AuditLogEvent } = require('discord.js');
const db = require('../core/database');
const embed = require('../utils/embed');

async function findRecentExecutor(guild, targetId, type = AuditLogEvent.MemberUpdate) {
  const logs = await guild.fetchAuditLogs({ type, limit: 8 }).catch(() => null);
  if (!logs) return null;

  const now = Date.now();
  const entry = logs.entries.find(item =>
    item.targetId === targetId &&
    now - item.createdTimestamp < 15_000
  );

  return entry?.executor ?? null;
}

async function notify(guild, text, preferredChannel = null) {
  const config = db.getGuildConfig(guild.id);
  const channel = preferredChannel?.isTextBased?.()
    ? preferredChannel
    : guild.channels.cache.get(config?.modLogChannel)
      ?? guild.systemChannel;

  if (!channel?.isTextBased?.()) return;

  await channel.send(embed.embedToPayload(
    guild.id,
    embed.build(guild.id, text, { timestamp: true }),
    {
      allowedMentions: { parse: [] },
      forceV2: true,
      withoutColor: true,
    }
  )).catch(() => {});
}

module.exports = { findRecentExecutor, notify };