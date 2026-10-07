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
      if (db.isWet(ban.user.id)) {
        const entry = db.getWetEntry(ban.user.id);
        const reason = entry?.reason ? `Wet - ${entry.reason}` : 'Wet';
        await ban.guild.members.ban(ban.user.id, { reason });
      }

      if (db.isBlacklisted(guildId, ban.user.id)) {
        const entry = db.getBlacklistEntry(guildId, ban.user.id);

        const reason = entry?.reason
          ? `Blacklist - ${entry.reason}`
          : 'Blacklist';

        await ban.guild.members.ban(ban.user.id, { reason });
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
