'use strict';


const {
  AuditLogEvent,
  PermissionsBitField,
} = require('discord.js');

const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const db           = require('../core/database');
const perms        = require('../utils/permissions');
const punishSteps  = require('../modules/punishSteps');
const errorHandler = require('../utils/errorHandler');
const tempvoc      = require('../modules/tempvoc');


const pollMap = new Map();


const _decoRaw = new Map();

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  name : 'voiceStateUpdate',
  once : false,

  async execute(client, oldState, newState) {
    const guild   = newState.guild ?? oldState.guild;
    const member  = newState.member ?? oldState.member;
    const guildId = guild.id;

    if (!member || member.user.bot) return;

    try {
      await _handleAntideco(client, oldState, newState, member, guild, guildId);
      await _handleVoiceLog(client, oldState, newState, member, guildId);

      if (tempvoc?.handleVoiceStateUpdate) {
        await tempvoc.handleVoiceStateUpdate(client, oldState, newState);
      }

      _handleVoiceTracking(oldState, newState, member, guildId);
    } catch (err) {
      errorHandler.handle(err, {
        source : 'voiceStateUpdate',
        guildId,
      });
    }
  },
};

async function _handleAntideco(client, oldState, newState, member, guild, guildId) {
  const config = db.getAntiraidConfig(guildId);

  if (!config?.antidecoEnabled) {
    _stopPoll(guildId);
    return;
  }

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

  if (!me?.permissions?.has(PermissionsBitField.Flags.ViewAuditLog)) {
    return;
  }

  _startPoll(client, guild, guildId);
}


function _startPoll(client, guild, guildId) {
  if (pollMap.has(guildId)) return;

  const snapshot = new Map();

  const interval = setInterval(async () => {
    try {
      const freshGuild = client.guilds.cache.get(guildId) ?? guild;
      await _pollAuditLog(client, freshGuild, guildId, snapshot);
    } catch (err) {
      errorHandler.handle(err, { source: 'antideco_poll', guildId });
    }
  }, 2000);

  _initSnapshot(guild, snapshot).catch(() => {});

  pollMap.set(guildId, { interval, snapshot });
}

function _stopPoll(guildId) {
  const entry = pollMap.get(guildId);
  if (!entry) return;
  clearInterval(entry.interval);
  pollMap.delete(guildId);
}

async function _initSnapshot(guild, snapshot) {
  const logs = await guild.fetchAuditLogs({
    type  : AuditLogEvent.MemberDisconnect,
    limit : 10,
  }).catch(() => null);

  if (!logs?.entries?.size) return;

  logs.entries.forEach(entry => {
    snapshot.set(entry.id, entry.extra?.count ?? 0);
  });
}

async function _pollAuditLog(client, guild, guildId, snapshot) {
  const config = db.getAntiraidConfig(guildId);

  if (!config?.antidecoEnabled) {
    _stopPoll(guildId);
    return;
  }

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions?.has(PermissionsBitField.Flags.ViewAuditLog)) return;

  const logs = await guild.fetchAuditLogs({
    type  : AuditLogEvent.MemberDisconnect,
    limit : 10,
  }).catch(() => null);

  if (!logs?.entries?.size) return;

  for (const entry of logs.entries.values()) {
    const executor     = entry.executor;
    const currentCount = entry.extra?.count ?? 0;
    const prevCount    = snapshot.get(entry.id) ?? null;

    if (prevCount === null) {
      snapshot.set(entry.id, currentCount);
      continue;
    }

    const delta = currentCount - prevCount;

    if (delta <= 0) continue;

    snapshot.set(entry.id, currentCount);

    if (!executor || executor.bot) continue;
    if (executor.id === client.user.id) continue;

    const executorMember =
      guild.members.cache.get(executor.id) ??
      await guild.members.fetch(executor.id).catch(() => null);
    if (!executorMember) continue;

    if (perms.isProtected(executor.id, guildId, executorMember)) continue;

    await _triggerAntideco(client, guild, guildId, executor, executorMember, delta, config);
  }
}


async function _triggerAntideco(client, guild, guildId, executor, executorMember, delta, config) {
  const threshold  = Number(config.antidecoThreshold ?? 2);
  const windowMs   = Number(config.antidecoWindow ?? 10) * 1000;
  const decoRawKey = `${guildId}_${executor.id}`;

  if (!_decoRaw.has(decoRawKey)) {
    _decoRaw.set(decoRawKey, { count: 0, timer: null });
  }

  const raw = _decoRaw.get(decoRawKey);

  if (raw.timer) clearTimeout(raw.timer);

  raw.count += delta;

  raw.timer = setTimeout(() => {
    _decoRaw.delete(decoRawKey);
  }, windowMs);

  let totalDeco = raw.count;

  while (raw.count >= threshold) {
    raw.count -= threshold;

    const info = punishSteps.getPunishmentInfo(
      guildId,
      executor.id,
      config.antidecoPunish ?? 'derank',
      'antideco'
    );

    punishSteps.decay(guildId, executor.id, 10 * 60 * 1000, 'antideco');

    const punishment = info.punishment;

    await _applyAntidecoPunishment(client, guild, guildId, executorMember, punishment);
    await _sendAntidecoDm(guild, guildId, executorMember, punishment, info, totalDeco);

    const e = embed.log(
      guildId,
      'Automod -antideco',
      [
        {
          name   : 'Responsable',
          value  : `<@${executor.id}> (${executor.tag})`,
          inline : true,
        },
        {
          name   : 'Action',
          value  : punishment,
          inline : true,
        },
        {
          name   : 'Déconnexions',
          value  : `${raw.count + threshold}`,
          inline : true,
        },
      ]
    );

    await logger.send(client, guildId, 'raidlog', e);
  }
}


async function _applyAntidecoPunishment(client, guild, guildId, member, punishment) {
  const reason = 'Automod -antideco';

  switch (punishment) {
    case 'warn':
      db.addSanction(guildId, member.id, client.user.id, 'warn', reason);
      break;

    case 'mute':
      await member.timeout(10 * 60 * 1000, reason).catch(() => {});
      db.addSanction(guildId, member.id, client.user.id, 'mute', reason, 600);
      break;

    case 'kick':
      await member.kick(reason).catch(() => {});
      db.addSanction(guildId, member.id, client.user.id, 'kick', reason);
      break;

    case 'ban':
      await guild.members.ban(member.id, { reason }).catch(() => {});
      db.addSanction(guildId, member.id, client.user.id, 'ban', reason);
      break;

    case 'derank': {
      const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

      if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
        db.addSanction(guildId, member.id, client.user.id, 'warn',
          `${reason} - derank impossible (permission ManageRoles manquante)`);
        break;
      }

      const keepRoles      = new Set(db.getNoderankRoles(guildId));
      const removableRoles = member.roles.cache.filter(role =>
        role.id !== guild.id &&
        !keepRoles.has(role.id) &&
        !role.managed &&
        role.position < me.roles.highest.position
      );

      if (!removableRoles.size) {
        db.addSanction(guildId, member.id, client.user.id, 'warn',
          `${reason} - derank impossible (aucun rôle retirable)`);
        break;
      }

      await member.roles.remove(removableRoles, reason).catch(() => null);
      db.addSanction(guildId, member.id, client.user.id, 'warn',
        `${reason} (derank - ${removableRoles.size} rôle(s) retiré(s))`);
      break;
    }

    default:
      db.addSanction(guildId, member.id, client.user.id, 'warn', reason);
      break;
  }
}

async function _sendAntidecoDm(guild, guildId, member, punishment, info, amount) {
  const guildConfig = db.getGuildConfig(guildId);

  if (Number(guildConfig?.modDmEnabled ?? 1) !== 1) {
    return;
  }

  const guildName = guild?.name ?? guildId;
  const remaining = info?.remaining ?? 0;
  const next      = info?.nextPunishment ?? null;

  let content;

  if (punishment === 'warn' && next && remaining > 0) {
    content =
      `Vous avez reçu un avertissement automatique sur **${guildName}**.\n` +
      `Raison : **antideco**.\n` +
      `Déconnexions détectées : **${amount}**.\n` +
      `Il reste **${remaining}** infraction${remaining > 1 ? 's' : ''} avant **${next}**.`;
  } else if (punishment === 'warn' && next && remaining === 0) {
    content =
      `Vous avez reçu un dernier avertissement sur **${guildName}**.\n` +
      `Raison : **antideco**.\n` +
      `Déconnexions détectées : **${amount}**.\n` +
      `Prochain incident : **${next}**.`;
  } else {
    content =
      `Vous avez été sanctionné automatiquement sur **${guildName}**.\n` +
      `Raison : **antideco**.\n` +
      `Déconnexions détectées : **${amount}**.\n` +
      `Sanction appliquée : **${punishment}**.`;
  }

  await member.send({
    embeds: [embed.build(guildId, content, { timestamp: false })],
  }).catch(() => {});
}


function startAntidecoPoll(client) {
  for (const guild of client.guilds.cache.values()) {
    const config = db.getAntiraidConfig(guild.id);
    if (!config?.antidecoEnabled) continue;
    _startPoll(client, guild, guild.id);
  }
}

function startAntidecoGuild(client, guild) {
  if (!client || !guild) return;

  const config = db.getAntiraidConfig(guild.id);
  if (!config?.antidecoEnabled) return;

  _startPoll(client, guild, guild.id);
}

function stopAntidecoGuild(guildId) {
  _stopPoll(guildId);
}

module.exports.startAntidecoPoll  = startAntidecoPoll;
module.exports.startAntidecoGuild = startAntidecoGuild;
module.exports.stopAntidecoGuild  = stopAntidecoGuild;

async function _handleVoiceLog(client, oldState, newState, member, guildId) {
  const ch = newState.channelId ?? oldState.channelId;
  let desc = null;

  if (!oldState.channelId && newState.channelId) {
    desc = `<@${member.id}> a rejoint <#${newState.channelId}>`;
  }
  else if (oldState.channelId && !newState.channelId) {
    desc = `<@${member.id}> a quitt\u00e9 <#${oldState.channelId}>`;
  }
  else if (oldState.channelId !== newState.channelId) {
    desc = `<@${member.id}> s'est d\u00e9plac\u00e9 de <#${oldState.channelId}> vers <#${newState.channelId}>`;
  }
  else if (!oldState.selfMute && newState.selfMute) {
    desc = `<@${member.id}> s'est mute dans <#${ch}>`;
  }
  else if (oldState.selfMute && !newState.selfMute) {
    desc = `<@${member.id}> s'est unmute dans <#${ch}>`;
  }
  else if (!oldState.selfDeaf && newState.selfDeaf) {
    desc = `<@${member.id}> s'est mute casque dans <#${ch}>`;
  }
  else if (oldState.selfDeaf && !newState.selfDeaf) {
    desc = `<@${member.id}> s'est unmute casque dans <#${ch}>`;
  }
  else if (!oldState.serverMute && newState.serverMute) {
    desc = `<@${member.id}> a \u00e9t\u00e9 mute par le serveur dans <#${ch}>`;
  }
  else if (oldState.serverMute && !newState.serverMute) {
    desc = `<@${member.id}> a \u00e9t\u00e9 unmute par le serveur dans <#${ch}>`;
  }
  else if (!oldState.serverDeaf && newState.serverDeaf) {
    desc = `<@${member.id}> a \u00e9t\u00e9 sourdine par le serveur dans <#${ch}>`;
  }
  else if (oldState.serverDeaf && !newState.serverDeaf) {
    desc = `<@${member.id}> a \u00e9t\u00e9 d\u00e9sourdine par le serveur dans <#${ch}>`;
  }
  else if (!oldState.streaming && newState.streaming) {
    desc = `<@${member.id}> a lanc\u00e9 un stream dans <#${ch}>`;
  }
  else if (oldState.streaming && !newState.streaming) {
    desc = `<@${member.id}> a arr\u00eat\u00e9 son stream dans <#${ch}>`;
  }
  else if (!oldState.selfVideo && newState.selfVideo) {
    desc = `<@${member.id}> a activ\u00e9 sa cam\u00e9ra dans <#${ch}>`;
  }
  else if (oldState.selfVideo && !newState.selfVideo) {
    desc = `<@${member.id}> a d\u00e9sactiv\u00e9 sa cam\u00e9ra dans <#${ch}>`;
  }

  if (!desc) return;

  const e = embed.build(guildId, desc, {
    authorName: member.user.tag,
    authorIcon: member.user.displayAvatarURL({ size: 64 }),
  });

  await logger.send(client, guildId, 'voicelog', e);
}


function _handleVoiceTracking(oldState, newState, member, guildId) {
  const oldCh = oldState.channelId;
  const newCh = newState.channelId;

  if (oldCh === newCh) return;

  if (!oldCh && newCh) {
    db.voiceJoin(guildId, member.id, newCh);
    return;
  }

  if (oldCh && !newCh) {
    db.voiceLeave(guildId, member.id);
    return;
  }

  if (oldCh && newCh) {
    db.voiceMove(guildId, member.id, newCh);
  }
}
