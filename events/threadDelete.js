'use strict';

const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'threadDelete',
  once : false,

  async execute(client, thread) {
    try {
      if (!thread.guild) return;

      const e = embed.build(thread.guild.id, null, {
        title       : 'Fil supprimé',
        description : `**${thread.name}**`,
        color       : '#ED4245',
        timestamp   : true,
      });

      await logger.send(client, thread.guild.id, 'channellog', e);
    } catch (err) {
      errorHandler.handle(err, { source: 'threadDelete', guildId: thread.guild?.id });
    }
  },
};
