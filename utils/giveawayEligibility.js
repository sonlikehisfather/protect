'use strict';


const db     = require('../core/database');
const levels = require('../modules/levels');


function getVoiceSeconds(stats) {
  if (!stats) return 0;
  let total = stats.totalSeconds || 0;
  if (stats.joinedAt) {
    total += Math.max(0, Math.floor(Date.now() / 1000) - stats.joinedAt);
  }
  return total;
}


function getLevel(guildId, userId) {
  const data = db.getLevel(guildId, userId);
  if (!data || !data.xp) return 0;
  const config = db.getGuildConfig(guildId);
  if (config?.levelCumul) {
    return levels.levelFromXp(data.xp);
  }
  let level = 0;
  let xp = data.xp;
  while (xp >= levels.xpForLevel(level)) {
    xp -= levels.xpForLevel(level);
    level++;
  }
  return level;
}


async function checkGiveawayEligibility(member, giveaway, client = null) {
  const guildId = giveaway.guildId;
  const userId  = member.id;
  const reasons = [];

  const reqGuildIds = _parseJsonArray(giveaway.requiredGuildIds);


  const hasConditions = Boolean(
    giveaway.requiredRoleId ||
    giveaway.deniedRoleId ||
    giveaway.soutienRequired ||
    giveaway.statusRequired ||
    giveaway.tagRequired ||
    giveaway.minLevel ||
    giveaway.voiceRequired ||
    giveaway.minVoiceSeconds ||
    reqGuildIds.length
  );

  if (!hasConditions) {
    return {
      eligible: true,
      reasons : [],
      details : {},
    };
  }

  const details = {};

  if (giveaway.requiredRoleId) {
    details.hasRequiredRole = member.roles.cache.has(giveaway.requiredRoleId);
    if (!details.hasRequiredRole) {
      reasons.push(`Role <@&${giveaway.requiredRoleId}> requis.`);
    }
  }

  if (giveaway.deniedRoleId) {
    details.hasDeniedRole = member.roles.cache.has(giveaway.deniedRoleId);
    if (details.hasDeniedRole) {
      reasons.push(`Role <@&${giveaway.deniedRoleId}> interdit.`);
    }
  }

  const needsTracking = giveaway.soutienRequired || giveaway.statusRequired || giveaway.tagRequired;
  const soutienConfig = needsTracking ? db.getGuildConfig(guildId) : null;
  const soutienRoleId = soutienConfig?.soutienRoleId;
  const tracking      = needsTracking ? db.getSoutienTracking(guildId, userId) : null;


  const lazyGranted = Boolean(tracking?.lazyGranted);

  if (giveaway.soutienRequired && soutienRoleId) {
    details.hasSoutienRole = member.roles.cache.has(soutienRoleId);
    if (!details.hasSoutienRole) {
      reasons.push('Role soutien requis.');
    }

    if (details.hasSoutienRole && giveaway.requireBeforeStart && !lazyGranted) {
      details.roleGrantedAt = tracking?.roleGrantedAt ?? null;
      if (!details.roleGrantedAt || details.roleGrantedAt > giveaway.createdAt) {
        reasons.push('Soutien requis avant le debut du giveaway.');
      }
    }
  }

  if (giveaway.statusRequired) {
    details.statusValidSince = tracking?.statusValidSince ?? null;
    if (!details.statusValidSince) {
      reasons.push('Statut soutien valide requis.');
    } else if (giveaway.requireBeforeStart && !lazyGranted && details.statusValidSince > giveaway.createdAt) {
      reasons.push('Statut soutien requis avant le debut du giveaway.');
    }
  }

  if (giveaway.tagRequired) {
    details.tagValidSince = tracking?.tagValidSince ?? null;
    if (!details.tagValidSince) {
      reasons.push('Tag de guilde valide requis.');
    } else if (giveaway.requireBeforeStart && !lazyGranted && details.tagValidSince > giveaway.createdAt) {
      reasons.push('Tag de guilde requis avant le debut du giveaway.');
    }
  }

  if (giveaway.minLevel) {
    details.level = getLevel(guildId, userId);
    if (details.level < giveaway.minLevel) {
      reasons.push(`Niveau ${giveaway.minLevel} requis (actuel : ${details.level}).`);
    }
  }

  if (giveaway.voiceRequired || giveaway.minVoiceSeconds) {
    const stats = db.getVoiceStats(guildId, userId);
    details.voiceSeconds      = getVoiceSeconds(stats);
    details.isInVoice         = Boolean(stats?.joinedAt);
    details.lastStaleClearAt  = stats?.lastStaleClearAt ?? null;

    if (giveaway.voiceRequired && !details.isInVoice) {
      reasons.push('Etre en vocal requis.');
    }

    if (giveaway.minVoiceSeconds && details.voiceSeconds < giveaway.minVoiceSeconds) {
      const needed = _formatSeconds(giveaway.minVoiceSeconds);
      const has    = _formatSeconds(details.voiceSeconds);
      reasons.push(`Temps vocal minimum : ${needed} (actuel : ${has}).`);
    }
  }

  if (reqGuildIds.length && client) {
    for (const rGuildId of reqGuildIds) {
      const g = client.guilds.cache.get(rGuildId);
      if (!g) continue;
      const m = await g.members.fetch(userId).catch(() => null);
      if (!m) {
        reasons.push(`Vous devez etre membre du serveur **${g.name}**.`);
      }
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    details,
  };
}


function formatEligibilityReasons(result) {
  if (result.eligible) return null;
  return result.reasons.map(r => `- ${r}`).join('\n');
}

function _parseJsonArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}

function _formatSeconds(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h${m}m` : `${h}h`;
}

module.exports = {
  checkGiveawayEligibility,
  formatEligibilityReasons,
  getVoiceSeconds,
  getLevel,
};
