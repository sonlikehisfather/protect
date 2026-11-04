'use strict';

/**
 * VoiceMaster - réaction aux changements d'état vocal.
 *  - Arrivée dans un salon pv : déconnexion si ni propriétaire, ni accès, ni rang
 *    égal ou supérieur à celui du propriétaire.
 *  - Départ d'un salon pv par son propriétaire de rang Owner ou moins : le salon repasse
 *    en public et les accès sont supprimés (les Sys et plus gardent leur pv).
 *  - Ensuite : menottes et follow (voir automation.js).
 * Activer un pv ne déconnecte jamais ceux déjà présents.
 */

const store = require('./store');
const ranks = require('./ranks');
const automation = require('./automation');
const { LEVELS } = require('./config');

async function _pvGuard(oldState, newState, member, guildId) {
  const oldId = oldState.channelId;
  const newId = newState.channelId;

  if (oldId) {
    const pv = store.getPvByChannel(guildId, oldId);
    if (pv && pv.ownerId === member.id && ranks.getLevel(guildId, member.id) <= LEVELS.OWNER) {
      store.removePv(guildId, oldId);
    }
  }

  if (!newId) return;

  const pv = store.getPvByChannel(guildId, newId);
  if (!pv) return;

  if (pv.ownerId === member.id) return;
  if (store.hasAccess(guildId, newId, member.id)) return;

  const ownerLevel = ranks.getLevel(guildId, pv.ownerId);
  if (ranks.getLevel(guildId, member.id) >= ownerLevel) return;

  await newState.disconnect('VoiceMaster : salon privé').catch(() => {});
}

async function onVoiceStateUpdate(oldState, newState) {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  if (oldState.channelId === newState.channelId) return;

  const guildId = (newState.guild ?? oldState.guild).id;

  await _pvGuard(oldState, newState, member, guildId);
  await automation.onVoiceStateUpdate(newState, member, guildId);
}

function onChannelDelete(channel) {
  const guildId = channel.guild?.id;
  if (!guildId) return;
  if (store.getPvByChannel(guildId, channel.id)) store.removePv(guildId, channel.id);
}

module.exports = { onVoiceStateUpdate, onChannelDelete };
