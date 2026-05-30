'use strict';

const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'guildScheduledEventDelete',
  once : false,

  async execute(client, event) {
    try {
      if (!event.guild) return;

      const e = embed.build(event.guild.id, null, {
        title       : 'Événement supprimé',
        description : `**${event.name}**`,
        color       : '#ED4245',
        timestamp   : true,
      });

      await logger.send(client, event.guild.id, 'serverlog', e);
    } catch (err) {
      errorHandler.handle(err, { source: 'guildScheduledEventDelete', guildId: event.guild?.id });
    }
  },
};
