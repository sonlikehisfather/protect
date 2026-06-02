'use strict';

const logger        = require('../utils/logger');
const embed         = require('../utils/embed');
const inviteTracker = require('../utils/inviteTracker');

module.exports = {
  name: 'inviteCreate',
  once: false,

  async execute(client, invite) {
    try {
      const guild = invite.guild;
      if (!guild) return;

      inviteTracker.cacheInvite(guild.id, invite);

      const inviter = invite.inviter;
      const description = inviter
        ? `Invitation créée par ${inviter.tag}\nCode: \`${invite.code}\``
        : `Invitation créée\nCode: \`${invite.code}\``;

      await logger.send(
        client,
        guild.id,
        'invitelog',
        embed.build(guild.id, null, {
          title: 'Invitation créée',
          description,
          color: '#57F287',
          timestamp: true,
        })
      );
    } catch {}
  },
};
