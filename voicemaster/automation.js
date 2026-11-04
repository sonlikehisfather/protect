'use strict';

/**
 * VoiceMaster - automatismes déclenchés par un changement de vocal :
 *  - menotte : un membre menotté est ramené dans son salon dès qu'il rejoint un autre vocal
 *  - follow  : les suiveurs sont déplacés avec la personne suivie (s'ils sont en vocal)
 */

const store = require('./store');

async function onVoiceStateUpdate(newState, member, guildId) {
  const newId = newState.channelId;
  if (!newId) return;

  const cuff = store.getCuff(guildId, member.id);
  if (cuff) {
    if (cuff.channelId !== newId) {
      const channel = newState.guild.channels.cache.get(cuff.channelId);

      if (!channel) {
        store.removeCuff(guildId, member.id);
      } else {
        await newState.setChannel(channel, 'VoiceMaster : menotte').catch(() => {});
        return;
      }
    }
  }

  for (const followerId of store.listFollowers(guildId, member.id)) {
    const follower = newState.guild.members.cache.get(followerId);
    if (!follower?.voice?.channelId || follower.voice.channelId === newId) continue;

    await follower.voice.setChannel(newId, 'VoiceMaster : follow').catch(() => {});
  }
}

module.exports = { onVoiceStateUpdate };
