'use strict';

const logger = require('../utils/logger');
const embed = require('../utils/embed');

module.exports = {
  name: 'inviteDelete',
  once: false,

  async execute(client, invite) {
    try {
      const guild = invite.guild;
      if (!guild) return;

      await logger.send(
        client,
        guild.id,
        'invitelog',
        embed.build(guild.id, null, {
          title: 'Invitation supprimée',
          description: `Code: \`${invite.code}\``,
          color: '#ED4245',
          timestamp: true,
        })
      );
    } catch {}
  },
};
