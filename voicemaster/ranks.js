'use strict';

/**
 * VoiceMaster - toute la logique de rang est ici et nulle part ailleurs.
 */

const store = require('./store');
const { LEVELS, STORED_RANKS } = require('./config');

function isPrincipal(userId) {
  return Boolean(process.env.BUYER_ID) && userId === process.env.BUYER_ID;
}

/** Niveau effectif = le plus haut entre le rang stocke et l'indicateur WL. */
function getLevel(guildId, userId) {
  if (isPrincipal(userId)) return LEVELS.PRINCIPAL;

  const stored = store.getStoredRank(guildId, userId);
  const guildLevel = stored ? STORED_RANKS[stored] : LEVELS.NONE;
  const rankLevel = store.isSysPlus(userId) ? Math.max(guildLevel, LEVELS.SYS_PLUS) : guildLevel;
  const wlLevel = store.isWl(guildId, userId) ? LEVELS.WL : LEVELS.NONE;

  return Math.max(rankLevel, wlLevel);
}

function isAtLeast(guildId, userId, level) {
  return getLevel(guildId, userId) >= level;
}

/** Vrai si a est strictement au-dessus de b. */
function outranks(guildId, aId, bId) {
  return getLevel(guildId, aId) > getLevel(guildId, bId);
}

/** Vrai si a est au moins egal a b. */
function matchesOrOutranks(guildId, aId, bId) {
  return getLevel(guildId, aId) >= getLevel(guildId, bId);
}

/**
 * Qui peut attribuer quel rang stocke.
 *  - sys+ : le principal uniquement
 *  - sys, owner : Sys+ et plus
 * Le principal lui-meme n'est jamais modifiable.
 */
function canGrantStoredRank(guildId, actorId, rank) {
  if (rank === 'sys+') return isPrincipal(actorId);
  if (rank === 'sys' || rank === 'owner') {
    return isAtLeast(guildId, actorId, LEVELS.SYS_PLUS);
  }
  return false;
}

module.exports = {
  isPrincipal,
  getLevel,
  isAtLeast,
  outranks,
  matchesOrOutranks,
  canGrantStoredRank,
};
