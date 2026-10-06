'use strict';


const { AuditLogEvent } = require('discord.js');
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

      const e = embed.log(guildId, 'Rôle supprimé', [
        {
          name   : 'Rôle',
          value  : `**${role.name}** \`${role.id}\``,
          inline : false,
        },
        {
          name   : 'Couleur',
          value  : role.hexColor !== '#000000' ? role.hexColor : 'Aucune',
          inline : true,
        },
        {
          name   : 'Mentionnable',
          value  : role.mentionable ? 'Oui' : 'Non',
          inline : true,
        },
      ], {
        color     : '#ED4245',
        timestamp : true,
      });

      // Try to get executor from audit logs
      let actor = null;
      try {
        const fetched = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 6 }).catch(() => null);
        if (fetched && fetched.entries) {
          const now = Date.now();
          const entry = [...fetched.entries.values()].find(x => x.target?.id === roleId || (now - (x.createdTimestamp || 0)) < 5000);
          if (entry?.executor) actor = { id: entry.executor.id, tag: entry.executor.tag, avatar: entry.executor.displayAvatarURL?.({ dynamic: true }) };
        }
      } catch {}

      await logger.send(client, guildId, 'rolelog', e, { actor });
    } catch (err) {
      errorHandler.handle(err, {
        source : 'roleDelete',
        guildId: role.guild?.id,
      });
    }
  },
};
