'use strict';

/**
 * Mode panique : verrouille le serveur (salons, niveau de vérification, invitations).
 * L'état d'origine est sauvegardé en base pour pouvoir tout remettre avec `lockdown off`,
 * même après un redémarrage du bot.
 */

const { ChannelType, GuildVerificationLevel } = require('discord.js');

const db   = require('../core/database');
const core = require('./antiraidCore');

const LOCKABLE_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);

const _sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isLocked(guildId) {
  return Boolean(db.getLockdownState(guildId));
}

async function enable(client, guild, lockedBy = null) {
  const guildId = guild.id;
  if (isLocked(guildId)) return { ok: false, error: 'Le serveur est déjà en lockdown.' };

  const cfg = db.getAntiraidConfig(guildId) || {};
  const state = { verificationLevel: null, invitesWereDisabled: null, channels: {} };
  const result = { channels: 0, verification: false, invites: false, failed: 0 };

  // 1) Niveau de vérification
  if (cfg.antiraidLockdownVerif !== 0) {
    state.verificationLevel = guild.verificationLevel;
    if (guild.verificationLevel !== GuildVerificationLevel.VeryHigh) {
      result.verification = await guild
        .setVerificationLevel(GuildVerificationLevel.VeryHigh, 'Lockdown')
        .then(() => true).catch(() => false);
    }
  }

  // 2) Invitations
  if (cfg.antiraidLockdownInvites !== 0) {
    state.invitesWereDisabled = Boolean(guild.features?.includes('INVITES_DISABLED'));
    if (!state.invitesWereDisabled) {
      result.invites = await guild.disableInvites(true).then(() => true).catch(() => false);
    }
  }

  // 3) Salons : on retire l'envoi de messages à @everyone (valeur d'origine mémorisée)
  if (cfg.antiraidLockdownChannels !== 0) {
    for (const channel of guild.channels.cache.values()) {
      if (!LOCKABLE_TYPES.has(channel.type)) continue;

      const existing = channel.permissionOverwrites.cache.get(guild.id);
      const previous = {
        SendMessages          : existing ? (existing.allow.has('SendMessages') ? true : existing.deny.has('SendMessages') ? false : null) : null,
        SendMessagesInThreads : existing ? (existing.allow.has('SendMessagesInThreads') ? true : existing.deny.has('SendMessagesInThreads') ? false : null) : null,
        CreatePublicThreads   : existing ? (existing.allow.has('CreatePublicThreads') ? true : existing.deny.has('CreatePublicThreads') ? false : null) : null,
      };

      const ok = await channel.permissionOverwrites.edit(
        guild.id,
        { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false },
        { reason: 'Lockdown' }
      ).then(() => true).catch(() => false);

      if (ok) {
        state.channels[channel.id] = previous;
        result.channels++;
      } else {
        result.failed++;
      }
      await _sleep(250);   // évite le rate-limit sur les gros serveurs
    }
  }

  db.setLockdownState(guildId, state, lockedBy);
  core.record(guildId, 'lockdown', 'lockdown', lockedBy, `ON - ${result.channels} salon(s) verrouillé(s)`);
  return { ok: true, ...result };
}

async function disable(client, guild, unlockedBy = null) {
  const guildId = guild.id;
  const row = db.getLockdownState(guildId);
  if (!row) return { ok: false, error: 'Le serveur n’est pas en lockdown.' };

  const state = row.data || {};
  const result = { channels: 0, verification: false, invites: false, failed: 0 };

  if (state.verificationLevel != null && guild.verificationLevel === GuildVerificationLevel.VeryHigh
      && state.verificationLevel !== GuildVerificationLevel.VeryHigh) {
    result.verification = await guild
      .setVerificationLevel(state.verificationLevel, 'Fin du lockdown')
      .then(() => true).catch(() => false);
  }

  if (state.invitesWereDisabled === false) {
    result.invites = await guild.disableInvites(false).then(() => true).catch(() => false);
  }

  for (const [channelId, previous] of Object.entries(state.channels || {})) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;

    const ok = await channel.permissionOverwrites.edit(guild.id, previous, { reason: 'Fin du lockdown' })
      .then(() => true).catch(() => false);
    if (ok) result.channels++; else result.failed++;
    await _sleep(250);
  }

  db.deleteLockdownState(guildId);
  core.record(guildId, 'lockdown', 'lockdown', unlockedBy, `OFF - ${result.channels} salon(s) rétabli(s)`);
  return { ok: true, ...result };
}

/** Verrouille un salon créé pendant un lockdown (appelé par l'événement channelCreate). */
async function lockNewChannel(guild, channel) {
  const row = db.getLockdownState(guild.id);
  if (!row || !LOCKABLE_TYPES.has(channel.type)) return;
  if ((db.getAntiraidConfig(guild.id) || {}).antiraidLockdownChannels === 0) return;

  const state = row.data || {};
  state.channels = state.channels || {};
  if (state.channels[channel.id]) return;

  const existing = channel.permissionOverwrites.cache.get(guild.id);
  const read = flag => existing ? (existing.allow.has(flag) ? true : existing.deny.has(flag) ? false : null) : null;
  const previous = {
    SendMessages          : read('SendMessages'),
    SendMessagesInThreads : read('SendMessagesInThreads'),
    CreatePublicThreads   : read('CreatePublicThreads'),
  };

  const ok = await channel.permissionOverwrites.edit(
    guild.id,
    { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false },
    { reason: 'Lockdown (salon créé pendant le lockdown)' }
  ).then(() => true).catch(() => false);

  if (ok) {
    state.channels[channel.id] = previous;
    db.updateLockdownData(guild.id, state);
    core.record(guild.id, 'lockdown', 'lockdown', null, `nouveau salon verrouillé : ${channel.name}`);
  }
}

module.exports = { enable, disable, isLocked, lockNewChannel };
