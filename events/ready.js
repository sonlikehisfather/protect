'use strict';


const { ActivityType } = require('discord.js');
const { startAntidecoPoll } = require('./voiceStateUpdate');
const db               = require('../core/database');
const errorHandler     = require('../utils/errorHandler');
const { deploySlash }  = require('../core/loader');
const { safeSetTimeout } = require('../utils/safeTimers');
const giveaways        = require('../modules/giveaways');
const showpics         = require('../modules/showpics');
const modmail          = require('../modules/modmail');
const tempvoc          = require('../modules/tempvoc');
const customCommands   = require('../modules/customCommands');
const tickets          = require('../modules/tickets');
const counters         = require('../modules/counters');
const inviteTracker    = require('../utils/inviteTracker');

const TICK_MS             = 60 * 1000;
const RAINBOW_TICK_MS     = 10 * 1000;
const INACTIVE_TICK_MS    = 5 * 60 * 1000;
const PRESENCE_ROTATE_MS  = 5 * 60 * 1000;
const SOUTIEN_RESYNC_MS   = 10 * 60 * 1000;


const GUILD_PURGE_TTL_S   = 30 * 24 * 60 * 60;
const GUILD_PURGE_TICK_MS = 24 * 60 * 60 * 1000;


const DEBUG_SANCTIONS  = process.env.DEBUG_SANCTIONS  === '1';
const DEBUG_TEMPROLES  = process.env.DEBUG_TEMPROLES  === '1';
const DEBUG_REMINDERS  = process.env.DEBUG_REMINDERS  === '1';
const DEBUG_MUTEBACKUP = process.env.DEBUG_MUTEBACKUP === '1';
const DEBUG_ACTIVITY   = process.env.DEBUG_ACTIVITY === 'true' || process.env.DEBUG_ACTIVITY === '1';

const dbgSanctions  = (...a) => { if (DEBUG_SANCTIONS)  console.log('[sanctions:debug]',  ...a); };
const dbgTempRoles  = (...a) => { if (DEBUG_TEMPROLES)  console.log('[temproles:debug]',  ...a); };
const dbgReminders  = (...a) => { if (DEBUG_REMINDERS)  console.log('[reminders:debug]',  ...a); };
const dbgMuteBackup = (...a) => { if (DEBUG_MUTEBACKUP) console.log('[mutebackup:debug]', ...a); };
const dbgActivity   = (...a) => { if (DEBUG_ACTIVITY)   console.log('[activity:debug]',   ...a); };

module.exports = {
  name : 'clientReady',
  once : true,

  async execute(client) {
    for (const [, guild] of client.guilds.cache) {
      inviteTracker.loadGuild(guild).catch(() => {});
    }

    const memberCount = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
    const djsVersion  = require('discord.js').version;


    const wsPing = client.ws.ping;
    const pingStr = wsPing < 0 ? '-' : `${wsPing}ms`;

    {
      const W    = 44;
      const R    = '\x1b[0m';
      const CYAN = '\x1b[96m';
      const GRN  = '\x1b[92m';
      const hr   = `${CYAN}├${'─'.repeat(W)}┤${R}`;
      const bTop = `${CYAN}┌${'─'.repeat(W)}┐${R}`;
      const bBot = `${CYAN}└${'─'.repeat(W)}┘${R}`;
      const brow = (label, val) => {
        const inner = `  ${label.padEnd(12)}${String(val)}`;
        return `${CYAN}│${R}${inner.padEnd(W)}${CYAN}│${R}`;
      };
      const trow = (text) => {
        const inner = `  ${text}`;
        return `${CYAN}│${R}${GRN}${inner.padEnd(W)}${R}${CYAN}│${R}`;
      };
      const cmdCount   = client.__cmdCount         ?? client.commands.size;
      const evtModules = client.__eventModuleCount ?? '?';
      const evtTypes   = client.__eventTypeCount   ?? client.eventNames().length;
      console.log('');
      console.log(bTop);
      console.log(trow(`${client.user.tag} est en ligne`));
      console.log(hr);
      console.log(brow('Guilds',     client.guilds.cache.size));
      console.log(brow('Membres',    memberCount));
      console.log(brow('Latence',    pingStr));
      console.log(brow('Node.js',    process.version));
      console.log(brow('discord.js', `v${djsVersion}`));
      console.log(brow('Env',        process.env.NODE_ENV ?? 'development'));
      console.log(hr);
      console.log(brow('Commandes',  `${cmdCount} prefix`));
      console.log(brow('Events',     `${evtModules} modules / ${evtTypes} types`));
      console.log(bBot);
      console.log('');
    }

    await deploySlash(client);

    client.__customActivityLocked = false;
    client.__presenceStatus = 'online';

    client.__setDefaultPresence = () => {
      client.__customActivityLocked = false;
      _setPresence(client, true);
    };

    const _savedActivity = db.getBotActivity();

    if (_savedActivity && !_savedActivity.removed) {
      _restoreSavedActivity(client, _savedActivity);


      safeSetTimeout(() => {
        try {
          const refresh = db.getBotActivity();
          if (refresh && !refresh.removed) {
            _restoreSavedActivity(client, refresh, { silent: true });
            dbgActivity('Activite reappliquee apres delai (5s).');
          }
        } catch (err) {
          errorHandler.handle(err, { source: 'activityRestore' });
        }
      }, 5000);
    } else {
      _setPresence(client, true);
      _safeInterval(() => _setPresence(client), PRESENCE_ROTATE_MS);
    }

    await client.guilds.fetch().catch((err) => {
      errorHandler.handle(err, { source: 'readyFetchGuilds' });
    });

    await _recoverExpiredSanctions(client);
    await _recoverTempRoles(client);
    await _recoverReminders(client);
    await _recoverGiveaways(client);
    await _recoverMuteRoleBackups(client);
    await tickets.restorePendingDeletes(client);
    await _recoverPendingVerifications(client);
    _processDuePurges(client);

    const refundedBets = db.refundAllPendingBets();
    if (refundedBets > 0) console.log(`[ready] Remboursement de ${refundedBets} pari(s) casino interrompu(s).`);

    _safeInterval(() => _processSanctions(client), TICK_MS);
    _safeInterval(() => _processTempRoles(client), TICK_MS);
    _safeInterval(() => _processReminders(client), TICK_MS);
    _safeInterval(() => _processRainbowRoles(client), RAINBOW_TICK_MS);
    _safeInterval(() => tickets.processInactiveTickets(client), INACTIVE_TICK_MS);
    _safeInterval(() => _processDuePurges(client), GUILD_PURGE_TICK_MS);
    showpics.start(client);
    counters.init(client);

    startAntidecoPoll(client);

    try {
      modmail.loadCache(client);
    } catch (err) {
      errorHandler.handle(err, { source: 'modmail.loadCache' });
    }

    if (tempvoc?.cleanupTempvocChannels) {
      await tempvoc.cleanupTempvocChannels(client);
    }

    await _syncVoiceTracking(client);
    await _syncSoutienTracking(client);


    if (!client.__soutienResyncStarted) {
      client.__soutienResyncStarted = true;
      _safeInterval(() => _syncSoutienTracking(client), SOUTIEN_RESYNC_MS);
    }
  },
};


const ACTIVITIES = [
  () => ({
    name: '+help',
    type: ActivityType.Listening,
  }),

  (c) => {
    const count = c.guilds.cache.size;

    return {
      name: `${count} ${_plural(count, 'serveur', 'serveurs')}`,
      type: ActivityType.Watching,
    };
  },

  (c) => {
    const total = c.guilds.cache.reduce((a, g) => a + (g.memberCount || 0), 0);

    return {
      name: `${total} ${_plural(total, 'membre', 'membres')}`,
      type: ActivityType.Watching,
    };
  },
];

let _activityIndex = 0;

function _plural(count, singular, plural) {
  return Number(count) > 1 ? plural : singular;
}

function _setPresence(client, force = false) {
  if (!force && client.__customActivityLocked) return;

  try {
    const activity = ACTIVITIES[_activityIndex % ACTIVITIES.length](client);
    _activityIndex++;

    const status = client.__presenceStatus
      || client.user?.presence?.status
      || 'online';

    client.user.setPresence({
      status,
      activities: [activity],
    });
  } catch (err) {
    errorHandler.handle(err, { source: 'setPresence' });
  }
}

function _safeInterval(fn, delay) {
  const timer = setInterval(async () => {
    try {
      await fn();
    } catch (err) {
      errorHandler.handle(err, { source: 'safeInterval' });
    }
  }, delay);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return timer;
}

const RESTORE_ROTATE_MS = 30_000;

function _restoreSavedActivity(client, saved, opts = {}) {
  const silent = Boolean(opts.silent);

  let messages;
  try { messages = JSON.parse(saved.messages || '[]'); }
  catch { messages = []; }

  if (!messages.length) {
    if (!silent) console.log('[ready] Activite non restauree : aucun message en DB.');
    return;
  }

  const type   = Number(saved.type);
  const status = saved.status || 'online';

  if (Number.isNaN(type)) {
    console.log(`[ready] Activite non restauree : type invalide en DB (raw=${JSON.stringify(saved.type)}).`);
    return;
  }

  client.__customActivityLocked = true;
  client.__presenceStatus       = status;

  let index = 0;

  const apply = () => {
    const activity = { name: messages[index], type };
    if (type === ActivityType.Streaming && saved.url) {
      activity.url = saved.url;
    }
    client.user.setPresence({ status, activities: [activity] });
  };

  try { apply(); } catch (err) {
    errorHandler.handle(err, { source: 'activityRestore' });
    return;
  }


  if (!silent && messages.length > 1) {
    if (client.__activityRotation) {
      clearInterval(client.__activityRotation);
    }
    const interval = setInterval(() => {
      index = (index + 1) % messages.length;
      try { apply(); } catch (err) {
        errorHandler.handle(err, { source: 'activityRestore' });
      }
    }, RESTORE_ROTATE_MS);

    if (typeof interval.unref === 'function') interval.unref();
    client.__activityRotation = interval;
  }

  if (!silent) {
    console.log(`[ready] Activite restauree depuis DB : "${messages[0]}" (${messages.length} message(s), type=${type}${type === ActivityType.Streaming && saved.url ? ', streaming' : ''})`);
  }
}

module.exports.restoreSavedActivity = _restoreSavedActivity;


async function _recoverExpiredSanctions(client) {
  try {
    const expired = db.getExpiredSanctions();
    if (!expired.length) return;

    let processed = 0;

    for (const sanction of expired) {
      if (await _liftSanction(client, sanction)) processed++;
    }

    if (processed > 0) {
      console.log(`[sanctions] ${processed} sanction(s) expirée(s) traitée(s).`);
    }
  } catch (err) {
    errorHandler.handle(err, { source: 'recoverExpiredSanctions' });
  }
}

async function _processSanctions(client) {
  try {
    const expired = db.getExpiredSanctions();
    if (!expired.length) return;

    let processed = 0;

    for (const sanction of expired) {
      if (await _liftSanction(client, sanction)) processed++;
    }

    if (processed > 0) {
      console.log(`[sanctions] ${processed} sanction(s) expirée(s) traitée(s).`);
    }
  } catch (err) {
    errorHandler.handle(err, { source: 'sanctionTicker' });
  }
}

async function _liftSanction(client, sanction) {
  try {
    const guild = client.guilds.cache.get(sanction.guildId);

    if (!guild) {
      db.expireSanction(sanction.id);
      return;
    }

    if (sanction.type === 'mute') {
      const member = await guild.members.fetch(sanction.userId).catch(() => null);

      if (member) {
        if (member.communicationDisabledUntilTimestamp) {
          await member.timeout(null, 'Mute temporaire expire').catch((err) => {
            errorHandler.handle(err, {
              source  : 'liftSanctionTimeoutRemove',
              guildId : sanction.guildId,
              userId  : sanction.userId,
            });
          });
        }

        const config     = db.getGuildConfig(sanction.guildId);
        const muteRoleId = config?.muteRoleId ?? null;

        if (muteRoleId) {
          const muteRole = guild.roles.cache.get(muteRoleId);

          if (muteRole && member.roles.cache.has(muteRole.id)) {
            await member.roles.remove(
              muteRole,
              'Mute temporaire expire'
            ).catch((err) => {
              errorHandler.handle(err, {
                source  : 'liftSanctionMuteRoleRemove',
                guildId : sanction.guildId,
                userId  : sanction.userId,
                roleId  : muteRole.id,
              });
            });
          }
        }
      }
    }

    if (sanction.type === 'cmute') {
      if (!sanction.channelId) {
        db.expireSanction(sanction.id);
        return;
      }

      const channel = guild.channels.cache.get(sanction.channelId);

      if (channel) {
        await channel.permissionOverwrites
          .delete(sanction.userId)
          .catch((err) => {
            errorHandler.handle(err, {
              source    : 'liftSanctionCmuteDeleteOverwrite',
              guildId   : sanction.guildId,
              userId    : sanction.userId,
              channelId : sanction.channelId,
            });
          });
      }
    }

    if (sanction.type === 'ban' || sanction.type === 'tempban') {
      await guild.bans.remove(
        sanction.userId,
        'Ban temporaire expire'
      ).catch((err) => {
        errorHandler.handle(err, {
          source  : 'liftSanctionUnban',
          guildId : sanction.guildId,
          userId  : sanction.userId,
        });
      });
    }

    db.expireSanction(sanction.id);

    dbgSanctions(`${sanction.type} expire -> ${sanction.userId}`);
    return true;
  } catch (err) {
    db.expireSanction(sanction.id);

    errorHandler.handle(err, {
      source  : 'liftSanction',
      guildId : sanction.guildId,
      userId  : sanction.userId,
    });
    return false;
  }
}


async function _recoverTempRoles(client) {
  try {
    let total = 0;

    for (const guild of client.guilds.cache.values()) {
      const rows = db.getAllTempRoles(guild.id);
      if (!rows.length) continue;

      total += rows.length;

      for (const row of rows) {
        await _handleTempRole(client, row);
      }
    }

    if (total) {
      console.log(`[temproles] ${total} rôle(s) temporaire(s) récupéré(s).`);
    }
  } catch (err) {
    errorHandler.handle(err, { source: 'recoverTempRoles' });
  }
}

async function _processTempRoles(client) {
  try {
    const rows = db.getExpiredTempRoles();
    if (!rows.length) return;

    let processed = 0;

    for (const row of rows) {
      if (await _removeTempRole(client, row)) processed++;
    }

    if (processed > 0) {
      console.log(`[temproles] ${processed} rôle(s) temporaire(s) expiré(s) traité(s).`);
    }
  } catch (err) {
    errorHandler.handle(err, { source: 'tempRoleTicker' });
  }
}

async function _handleTempRole(client, row) {
  const now = Math.floor(Date.now() / 1000);

  if (row.expiresAt <= now) {
    await _removeTempRole(client, row);
    return;
  }

  const guild = client.guilds.cache.get(row.guildId);
  if (!guild) {
    db.removeTempRole(row.guildId, row.userId, row.roleId);
    return;
  }

  const role = guild.roles.cache.get(row.roleId);
  if (!role) {
    db.removeTempRole(row.guildId, row.userId, row.roleId);
    return;
  }

  const member = await guild.members.fetch(row.userId).catch(() => null);
  if (!member) {
    db.removeTempRole(row.guildId, row.userId, row.roleId);
    return;
  }

  if (!member.roles.cache.has(role.id)) {
    db.removeTempRole(row.guildId, row.userId, row.roleId);
  }
}

async function _removeTempRole(client, row) {
  try {
    const guild = client.guilds.cache.get(row.guildId);

    if (!guild) {
      db.removeTempRole(row.guildId, row.userId, row.roleId);
      return;
    }

    const member = await guild.members.fetch(row.userId).catch(() => null);
    const role   = guild.roles.cache.get(row.roleId);

    if (member && role && member.roles.cache.has(role.id)) {
      await member.roles.remove(role, 'Role temporaire expire').catch((err) => {
        errorHandler.handle(err, {
          source  : 'removeTempRoleRemoveRole',
          guildId : row.guildId,
          userId  : row.userId,
          roleId  : row.roleId,
        });
      });
    }

    db.removeTempRole(row.guildId, row.userId, row.roleId);

    dbgTempRoles(`expire -> guild=${row.guildId} user=${row.userId} role=${row.roleId}`);
    return true;
  } catch (err) {
    db.removeTempRole(row.guildId, row.userId, row.roleId);

    errorHandler.handle(err, {
      source  : 'removeTempRole',
      guildId : row.guildId,
      userId  : row.userId,
    });
    return false;
  }
}


async function _recoverReminders(client) {
  try {
    const due = db.getDueReminders();
    if (!due.length) return;

    const counters = { sent: 0, rescheduled: 0, cleaned: 0 };

    for (const reminder of due) {
      _bumpReminderCounters(counters, await _sendReminder(client, reminder));
    }

    _logReminderCounters(counters);
  } catch (err) {
    errorHandler.handle(err, { source: 'recoverReminders' });
  }
}

async function _processReminders(client) {
  try {
    const due = db.getDueReminders();
    if (!due.length) return;

    const counters = { sent: 0, rescheduled: 0, cleaned: 0 };

    for (const reminder of due) {
      _bumpReminderCounters(counters, await _sendReminder(client, reminder));
    }

    _logReminderCounters(counters);
  } catch (err) {
    errorHandler.handle(err, { source: 'reminderTicker' });
  }
}


async function _processRainbowRoles(client) {
  try {
    const now = Date.now();
    for (const guild of client.guilds.cache.values()) {
      const rows = db.getActiveRainbowRoles(guild.id);
      if (!rows.length) continue;

      for (const row of rows) {
        const nextRun = row.nextRun ? Date.parse(row.nextRun) : 0;
        if (Number.isNaN(nextRun) || nextRun > now) continue;
        await _applyRainbowRole(guild, row);
      }
    }
  } catch (err) {
    errorHandler.handle(err, { source: 'rainbowRoleTicker' });
  }
}


async function _applyRainbowRole(guild, row) {
  try {
    const role = guild.roles.cache.get(row.roleId);
    if (!role) {
      db.removeRainbowRole(guild.id, row.roleId);
      return;
    }

    if (!role.editable) {
      db.updateRainbowRole(guild.id, row.roleId, { active: 0 });
      return;
    }

    const nextInterval = Number(row.interval) || 60;
    const nextRun = new Date(Date.now() + nextInterval * 1000).toISOString();
    const nextColors = _getNextRainbowColors(row.color, row.mode, row.paletteSize);
    const nextColor = nextColors[0];

    try {
      const toInt = (c) => typeof c === 'string' ? Number(`0x${c.replace('#', '')}`) : c;
      const colorsObj = {
        primaryColor: toInt(nextColors[0]),
        secondaryColor: nextColors[1] !== undefined ? toInt(nextColors[1]) : undefined,
      };
      await role.edit({ colors: colorsObj, reason: 'Rainbow role update' });
      db.updateRainbowRole(guild.id, row.roleId, {
        nextRun,
        color: nextColor,
      });
    } catch (err) {
      if (err?.code === 50013) {
        db.updateRainbowRole(guild.id, row.roleId, { active: 0 });
      }
      errorHandler.handle(err, {
        source  : 'applyRainbowRole',
        guildId : guild.id,
        roleId  : row.roleId,
      });
    }
  } catch (err) {
    errorHandler.handle(err, {
      source  : 'applyRainbowRole',
      guildId : guild.id,
      roleId  : row.roleId,
    });
  }
}


function _getNextRainbowColor(previous = null, mode = 'rainbow', paletteSize = 7) {
  const normalizedMode = ['rainbow', 'gradient', 'base'].includes(mode) ? mode : 'base';

  const previousHsl = previous ? _hexToHsl(previous) : { h: Math.floor(Math.random() * 360), s: 75, l: 55 };
  const direction = Math.random() < 0.5 ? -1 : 1;
  const hueShiftMin = 90;
  const hueShiftMax = 180;
  const hueShift = hueShiftMin + Math.random() * (hueShiftMax - hueShiftMin);
  const hue = (previousHsl.h + hueShift * direction + 360) % 360;

  if (normalizedMode === 'base') {
    const saturation = 40 + Math.random() * 45;
    const light = 20 + Math.random() * 55;
    return _hslToHex(hue, saturation, light);
  }

  if (normalizedMode === 'gradient') {
    const saturation = Math.max(55, Math.min(92, previousHsl.s + (Math.random() < 0.5 ? -1 : 1) * 8));
    const light = Math.max(30, Math.min(80, previousHsl.l + (Math.random() < 0.5 ? -1 : 1) * 8));
    return _hslToHex(hue, saturation, light);
  }

  const saturation = 45 + Math.random() * 40;
  const light = Math.max(20, Math.min(75, previousHsl.l + (Math.random() < 0.5 ? -1 : 1) * 12));

  return _hslToHex(hue, saturation, light);
}

function _getNextRainbowColors(previous = null, mode = 'rainbow', paletteSize = 7) {
  const normalizedMode = ['rainbow', 'gradient', 'base'].includes(mode) ? mode : 'base';
  const primary = _getNextRainbowColor(previous, normalizedMode, paletteSize);

  if (normalizedMode === 'gradient') {
    const primaryHsl = _hexToHsl(primary);
    const hueShift = 120 + Math.random() * 60;
    const secondaryHue = (primaryHsl.h + hueShift + 360) % 360;
    const saturation = Math.max(55, Math.min(92, primaryHsl.s + (Math.random() < 0.5 ? -1 : 1) * 10));
    const light = Math.max(35, Math.min(75, primaryHsl.l + (Math.random() < 0.5 ? -1 : 1) * 10));
    const secondary = _hslToHex(secondaryHue, saturation, light);
    return [primary, secondary];
  }

  return [primary];
}

function _hexToHsl(hex) {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }

  return { h, s: s * 100, l: l * 100 };
}

function _hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}


function _bumpReminderCounters(counters, code) {
  switch (code) {
    case 'sent'           : counters.sent++;        break;
    case 'rescheduled'    : counters.rescheduled++; break;
    case 'deletedChannel' : counters.cleaned++;     break;
    case 'incomplete'     : counters.cleaned++;     break;
    case 'deletedCustom'  : counters.cleaned++;     break;

  }
}

function _logReminderCounters(c) {
  if (c.sent === 0 && c.rescheduled === 0 && c.cleaned === 0) return;
  console.log(`[reminders] ${c.sent} envoyé(s), ${c.rescheduled} reprogrammé(s), ${c.cleaned} nettoyé(s).`);
}

async function _sendReminder(client, reminder) {
  try {
    const guild = client.guilds.cache.get(reminder.guildId);

    if (!guild) {
      db.markReminderDone(reminder.id);
      return;
    }

    const channel = guild.channels.cache.get(reminder.channelId);

    if (!channel || !channel.isTextBased()) {
      db.deleteReminder(reminder.id);
      dbgReminders(`salon supprime, reminder ${reminder.id} supprime`);
      return 'deletedChannel';
    }


    if (!reminder.customCommandName && !reminder.message) {
      db.deleteReminder(reminder.id);
      dbgReminders(`incomplet supprime -> ${reminder.id}`);
      return 'incomplete';
    }

    if (reminder.customCommandName) {
      let custom;

      try {
        custom = db.getCustomCommand(reminder.guildId, reminder.customCommandName);
      } catch {
        custom = null;
      }

      if (!custom) {
        db.deleteReminder(reminder.id);
        dbgReminders(`custom command supprimee, reminder ${reminder.id} supprime`);
        return 'deletedCustom';
      }

      const creator = guild.members.cache.get(reminder.userId)
        ?? await guild.members.fetch(reminder.userId).catch(() => null);

      const context = {
        guildName   : guild.name,
        channelName : channel.name,
        userMention : `<@${reminder.userId}>`,
        username    : creator?.user?.username || 'utilisateur',
      };

      const payload = customCommands.buildReminderPayload(custom, context);

      const sent = await channel.send(payload).catch((err) => {
        errorHandler.handle(err, {
          source  : 'sendReminderCustomCommand',
          guildId : reminder.guildId,
        });
        return null;
      });

      if (sent) {
        await customCommands.applyReminderReactions(sent, custom);
      }
    } else if (reminder.message) {
      await channel.send({
        content         : `<@${reminder.userId}> rappel : ${reminder.message}`,
        allowedMentions : { users: [reminder.userId] },
      }).catch((err) => {
        errorHandler.handle(err, {
          source  : 'sendReminderSendMessage',
          guildId : reminder.guildId,
          userId  : reminder.userId,
        });
      });
    }

    const repeatEvery = Number(reminder.repeatEvery) || 0;

    if (repeatEvery > 0) {
      const nextAt = Math.floor(Date.now() / 1000) + repeatEvery;
      db.rescheduleReminder(reminder.id, nextAt);
      dbgReminders(`reprogramme -> ${reminder.id} a ${nextAt}`);
      return 'rescheduled';
    }

    db.markReminderDone(reminder.id);
    dbgReminders(`envoye -> ${reminder.id}`);
    return 'sent';
  } catch (err) {
    db.markReminderDone(reminder.id);

    errorHandler.handle(err, {
      source  : 'sendReminder',
      guildId : reminder.guildId,
      userId  : reminder.userId,
    });
    return 'error';
  }
}


async function _recoverGiveaways(client) {
  try {
    await giveaways.restoreActive(client);
  } catch (err) {
    errorHandler.handle(err, { source: 'recoverGiveaways' });
  }
}


async function _recoverMuteRoleBackups(client) {
  try {
    const nowTs   = Math.floor(Date.now() / 1000);
    const pending = db.getExpiredMuteRoles(nowTs + 86400 * 7);

    if (!pending.length) return;

    let immediate   = 0;
    let rescheduled = 0;

    for (const entry of pending) {
      const { guildId, userId, roleIds, restoreAt } = entry;

      try {
        const guild = client.guilds.cache.get(guildId);

        if (!guild) {
          db.clearMuteRoles(guildId, userId);
          continue;
        }

        const member = await guild.members.fetch(userId).catch(() => null);

        if (!member) {
          db.clearMuteRoles(guildId, userId);
          continue;
        }

        const remaining = (restoreAt * 1000) - Date.now();

        if (remaining <= 0) {
          await _restoreMuteRoles(guild, member, roleIds, guildId, userId, 'recovery-immediate');
          immediate++;
        } else {
          dbgMuteBackup(`Replanifie restore pour ${userId} dans ${Math.round(remaining / 1000)}s`);


          safeSetTimeout(async () => {
            const freshMember = await guild.members.fetch(userId).catch(() => null);

            if (freshMember) {
              await _restoreMuteRoles(guild, freshMember, roleIds, guildId, userId, 'recovery-scheduled');
            } else {
              db.clearMuteRoles(guildId, userId);
            }
          }, remaining + 2000);

          rescheduled++;
        }
      } catch (err) {
        errorHandler.handle(err, { source: 'recoverMuteRoleBackups', guildId, userId });
      }
    }

    if (immediate > 0 || rescheduled > 0) {
      console.log(`[mutebackup] ${pending.length} entrée(s) traitée(s) : ${immediate} restaurée(s), ${rescheduled} replanifiée(s).`);
    }
  } catch (err) {
    errorHandler.handle(err, { source: 'recoverMuteRoleBackups' });
  }
}

async function _restoreMuteRoles(guild, member, roleIds, guildId, userId, reason) {
  const validRoleIds = roleIds.filter(id => {
    const role = guild.roles.cache.get(id);
    const me   = guild.members.me;

    if (!role) return false;
    if (!me) return false;
    if (role.managed) return false;
    if (me.roles.highest.comparePositionTo(role) <= 0) return false;

    return true;
  });

  if (validRoleIds.length > 0) {
    await member.roles.add(validRoleIds, `Automod re-rank post-mute (${reason})`).catch((err) => {
      errorHandler.handle(err, { source: '_restoreMuteRoles', guildId, userId });
    });
  }

  db.clearMuteRoles(guildId, userId);

  dbgMuteBackup(`Roles restaures -> ${userId} sur ${guild.name} (${reason}): [${validRoleIds.join(', ')}]`);
}


async function _recoverPendingVerifications(client) {
  try {
    const verifyTimeouts = require('../utils/verifyTimeouts');
    await verifyTimeouts.restoreAll(client);
  } catch (err) {
    errorHandler.handle(err, { source: 'recoverPendingVerifications' });
  }
}


async function _syncVoiceTracking(client) {
  let synced  = 0;
  let cleared = 0;

  for (const guild of client.guilds.cache.values()) {
    try {

      const inVoice = new Set();

      for (const [, vs] of guild.voiceStates.cache) {
        if (!vs.channelId || !vs.member || vs.member.user.bot) continue;
        inVoice.add(vs.member.id);
        db.voiceJoin(guild.id, vs.member.id, vs.channelId);
        synced++;
      }

      const activeSessions = db.getActiveVoiceSessions(guild.id);

      for (const row of activeSessions) {
        if (!inVoice.has(row.userId)) {
          db.clearVoiceSession(guild.id, row.userId, { stale: true });
          cleared++;
        }
      }
    } catch (err) {
      errorHandler.handle(err, { source: 'syncVoiceTracking', guildId: guild.id });
    }
  }

  if (synced || cleared) {
    console.log(`[ready] Voice tracking synced : ${synced} session(s), ${cleared} stale(s) nettoyee(s)`);
  }
}


const { syncSoutienGuild } = require('../utils/soutienSync');

async function _syncSoutienTracking(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await syncSoutienGuild(client, guild, 'ready');
    } catch (err) {
      errorHandler.handle(err, { source: 'syncSoutienTracking', guildId: guild.id });
    }
  }
}


function _processDuePurges(client) {
  try {
    if (typeof db.getDuePendingPurges !== 'function') return;

    const cutoff = Math.floor(Date.now() / 1000) - GUILD_PURGE_TTL_S;
    const due    = db.getDuePendingPurges(cutoff);
    if (!due.length) return;

    let purged  = 0;
    let skipped = 0;

    for (const entry of due) {
      try {


        if (client?.guilds?.cache?.has(entry.guildId)) {
          db.unmarkGuildPendingPurge(entry.guildId);
          skipped++;
          continue;
        }

        db.purgeGuildData(entry.guildId);
        purged++;
      } catch (err) {
        errorHandler.handle(err, {
          source  : 'processDuePurges',
          guildId : entry.guildId,
        });
      }
    }

    if (purged || skipped) {
      console.log(`[guildPurge] ${purged} guild(s) purgée(s)${skipped ? `, ${skipped} ignorée(s) (encore présente)` : ''}.`);
    }
  } catch (err) {
    errorHandler.handle(err, { source: 'processDuePurges' });
  }
}


module.exports.syncVoiceTracking   = _syncVoiceTracking;
module.exports.syncSoutienTracking = _syncSoutienTracking;
