'use strict';


const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');
const antibanGuard = require('./antibanGuard');

module.exports = {
  name : 'guildBanAdd',
  once : false,

  async execute(client, ban) {
    const guildId = ban.guild.id;

    try {
      await antibanGuard.execute(client, ban).catch(() => {});

      const fields = [
        {
          name   : 'Membre',
          value  : `<@${ban.user.id}> (${ban.user.tag}) \`${ban.user.id}\``,
          inline : true,
        },
        {
          name   : 'Raison',
          value  : ban.reason ?? 'Aucune raison',
          inline : false,
        },
      ];

      const e = embed.log(guildId, 'Membre banni', fields, {
        thumbnail: ban.user.displayAvatarURL({ dynamic: true }),
      });

      await logger.send(client, guildId, 'modlog', e);

    } catch (err) {
      errorHandler.handle(err, {
        source : 'guildBanAdd',
        guildId,
      });
    }
  },
};
