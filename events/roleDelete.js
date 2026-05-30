'use strict';


const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'roleDelete',
  once : false,

  async execute(client, role) {
    try {
      if (!role.guild) return;

      const guildId = role.guild.id;
      const roleId  = role.id;

      if (typeof db.cleanupGuildRoleReferences === 'function') {
        db.cleanupGuildRoleReferences(guildId, roleId);
      }

      const e = embed.build(guildId, null, {
        title       : 'Rôle supprimé',
        description : `**${role.name}**`,
        color       : '#ED4245',
        timestamp   : true,
      });

      await logger.send(client, guildId, 'rolelog', e);
    } catch (err) {
      errorHandler.handle(err, {
        source : 'roleDelete',
        guildId: role.guild?.id,
      });
    }
  },
};
