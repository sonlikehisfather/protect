'use strict';

const errorHandler = require('../utils/errorHandler');
const lockdown = require('../utils/lockdown');

// Pendant un lockdown, tout nouveau salon est verrouillé automatiquement.
module.exports = {
  name : 'channelCreate',
  once : false,

  async execute(client, channel) {
    const guild = channel.guild;
    if (!guild) return;
    try {
      if (lockdown.isLocked(guild.id)) await lockdown.lockNewChannel(guild, channel);
    } catch (err) {
      errorHandler.handle(err, { source: 'lockdownChannelGuard', guildId: guild.id });
    }
  },
};
