'use strict';

const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'threadCreate',
  once : false,

  async execute(client, thread) {
    try {
      if (!thread.guild) return;

      const e = embed.log(thread.guild.id, 'Fil créé', [
        {
          name   : 'Fil',
          value  : `**${thread.name}** <#${thread.id}>`,
          inline : false,
        },
        {
          name   : 'Salon parent',
          value  : thread.parentId ? `<#${thread.parentId}>` : 'Aucun',
          inline : true,
        },
        {
          name   : 'Type',
          value  : thread.isPrivate ? 'Privé' : 'Public',
          inline : true,
        },
      ], {
        color     : '#57F287',
        timestamp : true,
      });

      await logger.send(client, thread.guild.id, 'channellog', e);
    } catch (err) {
      errorHandler.handle(err, { source: 'threadCreate', guildId: thread.guild?.id });
    }
  },
};
