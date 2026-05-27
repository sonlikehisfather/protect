'use strict';


const db     = require('../core/database');
const embed  = require('./embed');
const logger = require('./logger');

const COLORS = {
  success : '#43B581',
  warn    : '#FAA61A',
  error   : '#ED4245',
  info    : '#5865F2',
};


async function sendVerifyLog(client, guildId, payload = {}) {
  try {
    if (!client || !guildId || !payload?.title) return null;

    const config = db.getGuildConfig(guildId) || {};
    const dedicated = config.verifyLogChannel;

    const built = embed.log(guildId, payload.title, payload.fields || [], {
      color     : COLORS[payload.level] || COLORS.info,
      thumbnail : payload.thumbnail || null,
    });

    if (dedicated) {
      const channel = await client.channels.fetch(dedicated).catch(() => null);
      if (channel?.isTextBased?.()) {
        const sent = await channel.send({
          embeds          : [built],
          allowedMentions : { parse: [] },
        }).catch(() => null);
        if (sent) return sent;
      }
    }

    return await logger.send(client, guildId, 'joinlog', built).catch(() => null);
  } catch {
    return null;
  }
}

module.exports = {
  sendVerifyLog,
};
