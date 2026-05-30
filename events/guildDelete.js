'use strict';


const db           = require('../core/database');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'guildDelete',
  once : false,

  async execute(client, guild) {
    try {

      const guildId = guild?.id;
      if (!guildId) return;


      if (guild?.available === false) return;

      db.markGuildPendingPurge(guildId, 'guildDelete');
    } catch (err) {
      errorHandler.handle(err, {
        source  : 'guildDelete',
        guildId : guild?.id,
      });
    }
  },
};
