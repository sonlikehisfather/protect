'use strict';


const db = require('../core/database');

const UPDATE_INTERVAL_MS = 30_000;
const RATE_LIMIT_COOLDOWN_MS = 600_000;

const COUNTER_CONFIG_KEYS = {
  members       : 'counterMembersChannel',
  online        : 'counterOnlineChannel',
  voice         : 'counterVoiceChannel',
  channels      : 'counterChannelsChannel',
  textchannels  : 'counterTextchannelsChannel',
  voicechannels : 'counterVoicechannelsChannel',
  threads       : 'counterThreadsChannel',
  boosts        : 'counterBoostsChannel',
  boostlevel    : 'counterBoostlevelChannel',
  emojis        : 'counterEmojisChannel',
};

const COUNTER_FORMATS = {
  members       : '👥 Membres・{count}',
  online        : '🟢 En ligne・{count}',
  voice         : '🔊 En vocal・{count}',
  channels      : '#️⃣ Salons・{count}',
  textchannels  : '📝 Textuels・{count}',
  voicechannels : '🎙️ Vocaux・{count}',
  threads       : '🧵 Fils・{count}',
  boosts        : '💎 Boosts・{count}',
  boostlevel    : '🏆 Niveau・{count}',
  emojis        : '😀 Emojis・{count}',
};

let _updateInterval = null;
const _lastUpdates = new Map();
const _lastValues = new Map();

function init(client) {
  if (_updateInterval) {
    clearInterval(_updateInterval);
  }

  console.log('[Counters] Module initialisé, mise à jour toutes les 30 secondes');

  _updateInterval = setInterval(() => {
    _updateAllCounters(client).catch(() => {});
  }, UPDATE_INTERVAL_MS);

}

function stop() {
  if (_updateInterval) {
    clearInterval(_updateInterval);
    _updateInterval = null;
  }
  _lastUpdates.clear();
  _lastValues.clear();
}

async function _updateAllCounters(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await _updateGuildCounters(guild);
    } catch (err) {
      console.error(`[Counters] Erreur guild ${guild.id}:`, err.message);
    }
  }
}

async function _updateGuildCounters(guild) {
  const config = db.getGuildConfig(guild.id);
  if (!config) return;

  const stats = _calculateStats(guild);

  for (const [type, configKey] of Object.entries(COUNTER_CONFIG_KEYS)) {
    const channelId = config[configKey];
    if (!channelId) continue;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      console.log(`[Counters] Channel ${channelId} not found in cache`);
      continue;
    }
    if (channel.type !== 2) {
      console.log(`[Counters] Channel ${channel.name} type is ${channel.type}, expected 2`);
      continue;
    }

    const baseName = _extractBaseName(channel.name);
    const newName = `${baseName}・${stats[type]}`;

    console.log(`[Counters] ${type}: current="${channel.name}", base="${baseName}", new="${newName}"`);

    const lastUpdateKey = `${guild.id}:${channelId}`;
    const lastUpdate = _lastUpdates.get(lastUpdateKey) || 0;
    const lastValue = _lastValues.get(lastUpdateKey);

    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdate;

    if (newName === channel.name) {
      console.log(`[Counters] ${type}: name already correct`);
      continue;
    }

    if (timeSinceLastUpdate < RATE_LIMIT_COOLDOWN_MS && lastValue === stats[type]) {
      console.log(`[Counters] ${type}: rate limited (${Math.round(timeSinceLastUpdate/1000)}s since last update)`);
      continue;
    }

    try {
      await channel.setName(newName, 'Mise à jour compteur automatique');
      _lastUpdates.set(lastUpdateKey, now);
      _lastValues.set(lastUpdateKey, stats[type]);
      console.log(`[Counters] ${type}: renamed to "${newName}"`);
      } catch (err) {
      if (err.code === 50035) {
        console.warn(`[Counters] Rate limit atteint pour ${channelId}`);
      }
    }
  }
}

function _extractBaseName(channelName) {
  const separatorIndex = channelName.lastIndexOf('・');
  if (separatorIndex === -1) return channelName;
  return channelName.substring(0, separatorIndex);
}

function _calculateStats(guild) {
  const stats = {
    members       : guild.memberCount || 0,
    online        : 0,
    voice         : 0,
    channels      : guild.channels.cache.size,
    textchannels  : 0,
    voicechannels : 0,
    threads       : guild.channels.cache.filter(c => c.isThread?.()).size,
    boosts        : guild.premiumSubscriptionCount || 0,
    boostlevel    : guild.premiumTier || 0,
    emojis        : guild.emojis.cache.size,
  };

  for (const [, channel] of guild.channels.cache) {
    if (channel.type === 0 || channel.type === 5) {
      stats.textchannels++;
    } else if (channel.type === 2 || channel.type === 13) {
      stats.voicechannels++;
    }
  }

  for (const [, member] of guild.members.cache) {
    const presence = member.presence;
    if (presence?.status && presence.status !== 'offline') {
      stats.online++;
    }

    if (member.voice?.channelId) {
      stats.voice++;
    }
  }

  return stats;
}

async function forceUpdate(client, guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  try {
    await _updateGuildCounters(guild);
  } catch (err) {
    console.error(`[Counters] Force update erreur guild ${guildId}:`, err.message);
  }
}

module.exports = {
  init,
  stop,
  forceUpdate,
};
