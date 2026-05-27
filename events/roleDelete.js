'use strict';


const db           = require('../core/database');
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

    } catch (err) {

      errorHandler.handle(err, {
        source : 'roleDelete',
        guildId: role.guild?.id,
      });

    }

  },
};
