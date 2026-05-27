'use strict';


const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'guildBanRemove',
  once : false,

  async execute(client, ban) {
    const guildId = ban.guild.id;

    try {
      if (db.isBlacklisted(ban.user.id)) {
        const entry = db.getBlacklistEntry(ban.user.id);

        const reason = entry?.reason
          ? `Blacklist globale - ${entry.reason}`
          : 'Blacklist globale';

        await ban.guild.members
          .ban(ban.user.id, { reason })
          .catch(() => {});
      }

      const fields = [
        {
          name   : 'Membre',
          value  : `<@${ban.user.id}> (${ban.user.tag}) \`${ban.user.id}\``,
          inline : true,
        },
      ];

      const e = embed.log(guildId, 'Membre débanni', fields, {
        thumbnail : ban.user.displayAvatarURL({ dynamic: true }),
      });

      await logger.send(client, guildId, 'modlog', e);

    } catch (err) {
      errorHandler.handle(err, {
        source : 'guildBanRemove',
        guildId,
      });
    }
  },
};
