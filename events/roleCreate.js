'use strict';

const { AuditLogEvent } = require('discord.js');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'roleCreate',
  once : false,

  async execute(client, role) {
    try {
      if (!role.guild) return;

      const e = embed.log(role.guild.id, 'Rôle créé', [
        {
          name   : 'Rôle',
          value  : `<@&${role.id}> **${role.name}** \`${role.id}\``,
          inline : false,
        },
        {
          name   : 'Couleur',
          value  : role.hexColor !== '#000000' ? role.hexColor : 'Aucune',
          inline : true,
        },
        {
          name   : 'Affiché séparément',
          value  : role.hoist ? 'Oui' : 'Non',
          inline : true,
        },
        {
          name   : 'Mentionnable',
          value  : role.mentionable ? 'Oui' : 'Non',
          inline : true,
        },
      ], {
        color     : role.hexColor !== '#000000' ? role.hexColor : '#57F287',
        timestamp : true,
      });

      // Try to get executor from audit logs
      let actor = null;
      try {
        const fetched = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleCreate, limit: 6 }).catch(() => null);
        if (fetched && fetched.entries) {
          const now = Date.now();
          const entry = [...fetched.entries.values()].find(x => x.target?.id === role.id || (now - (x.createdTimestamp || 0)) < 5000);
          if (entry?.executor) actor = { id: entry.executor.id, tag: entry.executor.tag, avatar: entry.executor.displayAvatarURL?.({ dynamic: true }) };
        }
      } catch {}

      await logger.send(client, role.guild.id, 'rolelog', e, { actor });
    } catch (err) {
      errorHandler.handle(err, { source: 'roleCreate', guildId: role.guild?.id });
    }
  },
};
