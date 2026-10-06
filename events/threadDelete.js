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

      const e = embed.log(thread.guild.id, 'Fil supprimé', [
        {
          name   : 'Fil',
          value  : `**${thread.name}** \`${thread.id}\``,
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
        color     : '#ED4245',
        timestamp : true,
      });

      await logger.send(client, thread.guild.id, 'channellog', e);
    } catch (err) {
      errorHandler.handle(err, { source: 'threadDelete', guildId: thread.guild?.id });
    }
  },
};
