'use strict';

const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'roleCreate',
  once : false,

  async execute(client, role) {
    try {
      if (!role.guild) return;

      const e = embed.build(role.guild.id, null, {
        title       : 'Rôle créé',
        description : `<@&${role.id}> **${role.name}**`,
        color       : role.hexColor !== '#000000' ? role.hexColor : '#57F287',
        timestamp   : true,
      });

      await logger.send(client, role.guild.id, 'rolelog', e);
    } catch (err) {
      errorHandler.handle(err, { source: 'roleCreate', guildId: role.guild?.id });
    }
  },
};
