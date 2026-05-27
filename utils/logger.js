'use strict';


const db = require('../core/database');

const LOG_CHANNELS = {
  modlog    : 'modLogChannel',
  joinlog   : 'joinLogChannel',
  leavelog  : 'leaveLogChannel',
  messagelog: 'messageLogChannel',
  voicelog  : 'voiceLogChannel',
  boostlog  : 'boostLogChannel',
  rolelog   : 'roleLogChannel',
  raidlog   : 'raidLogChannel',
  errorlog  : 'errorLogChannel',
};


async function send(client, guildId, type, embedBuilt, options = null) {
  try {
    const configKey = LOG_CHANNELS[type];

    if (!configKey) {
      return null;
    }

    const sourceChannelId =
      typeof options === 'string'
        ? options
        : options?.sourceChannelId ?? null;

    if (sourceChannelId && isIgnored(guildId, sourceChannelId)) {
      return null;
    }

    const config = db.getGuildConfig(guildId);
    const logChannelId = config?.[configKey];

    if (!logChannelId) {
      return null;
    }


    if (!sourceChannelId && isIgnored(guildId, logChannelId)) {
      return null;
    }

    const channel = await client.channels.fetch(logChannelId).catch(() => null);

    if (!channel?.isTextBased()) {
      return null;
    }

    return await channel.send({
      embeds: [embedBuilt],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  } catch {
    return null;
  }
}


function isIgnored(guildId, channelId) {
  try {
    if (!guildId || !channelId) return false;
    return db.isNoLogChannel(guildId, channelId);
  } catch {
    return false;
  }
}

module.exports = {
  send,
  isIgnored,
  LOG_CHANNELS,
};
