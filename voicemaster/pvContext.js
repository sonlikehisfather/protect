'use strict';

/**
 * VoiceMaster - résolution du salon pv visé par =acces et =all.
 *  - Sys et plus : leur propre salon pv (même à distance), sinon le vocal où ils sont
 *  - Owner       : le vocal où il se trouve
 * Le salon doit être pv et l'auteur doit être au moins égal au propriétaire du pv.
 */

const store    = require('./store');
const ranks    = require('./ranks');
const messages = require('./messages');
const { LEVELS } = require('./config');

/**
 * @returns {{ pv: object, channel: object } | { error: string }}
 */
function resolveManagedPv(message, level) {
  const guild   = message.guild;
  const actorId = message.author.id;

  let channelId = null;

  if (level >= LEVELS.SYS) {
    channelId = store.getPvByOwner(guild.id, actorId)?.channelId ?? null;
  }
  if (!channelId) channelId = message.member.voice?.channelId ?? null;
  if (!channelId) return { error: messages.needVoice() };

  const pv = store.getPvByChannel(guild.id, channelId);
  if (!pv) return { error: messages.notPv() };

  const channel = guild.channels.cache.get(channelId);
  if (!channel) {
    store.removePv(guild.id, channelId);
    return { error: messages.channelGone() };
  }

  const ownerLevel = ranks.getLevel(guild.id, pv.ownerId);
  if (pv.ownerId !== actorId && level < ownerLevel) {
    return { error: messages.pvHigherRank(ownerLevel) };
  }

  return { pv, channel };
}

module.exports = { resolveManagedPv };
