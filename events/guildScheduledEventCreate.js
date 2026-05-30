'use strict';

const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'guildScheduledEventCreate',
  once : false,

  async execute(client, event) {
    try {
      if (!event.guild) return;

      const startTime = event.scheduledStartTimestamp
        ? `<t:${Math.floor(event.scheduledStartTimestamp / 1000)}:F>`
        : 'Non défini';

      const e = embed.build(event.guild.id, null, {
        title       : 'Événement créé',
        description : `**${event.name}**\nDébut : ${startTime}`,
        color       : '#57F287',
        timestamp   : true,
      });

      await logger.send(client, event.guild.id, 'serverlog', e);
    } catch (err) {
      errorHandler.handle(err, { source: 'guildScheduledEventCreate', guildId: event.guild?.id });
    }
  },
};
