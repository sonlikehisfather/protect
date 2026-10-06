'use strict';

const { AuditLogEvent } = require('discord.js');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'roleUpdate',
  once : false,

  async execute(client, oldRole, newRole) {
    try {
      if (!newRole.guild) return;

      const guildId = newRole.guild.id;
      const changes = [];

      if (oldRole.name !== newRole.name) {
        changes.push(`Nom: **${oldRole.name}** → **${newRole.name}**`);
      }

      if (oldRole.hexColor !== newRole.hexColor) {
        changes.push(`Couleur: \`${oldRole.hexColor}\` → \`${newRole.hexColor}\``);
      }

      if (oldRole.hoist !== newRole.hoist) {
        changes.push(`Affiché séparément: **${newRole.hoist ? 'Oui' : 'Non'}**`);
      }

      if (oldRole.mentionable !== newRole.mentionable) {
        changes.push(`Mentionnable: **${newRole.mentionable ? 'Oui' : 'Non'}**`);
      }

      if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        changes.push('Permissions modifiées');
      }

      if (changes.length === 0) return;

      const e = embed.log(guildId, 'Rôle modifié', [
        {
          name   : 'Rôle',
          value  : `<@&${newRole.id}> **${newRole.name}** \`${newRole.id}\``,
          inline : false,
        },
        {
          name   : 'Changements',
          value  : changes.slice(0, 6).join('\n'),
          inline : false,
        },
      ], {
        color     : '#FEE75C',
        timestamp : true,
      });

      // Try to find executor via audit logs
      let actor = null;
      try {
        const fetched = await newRole.guild.fetchAuditLogs({ type: AuditLogEvent.RoleUpdate, limit: 6 }).catch(() => null);
        if (fetched && fetched.entries) {
          const now = Date.now();
          const entry = [...fetched.entries.values()].find(x => x.target?.id === newRole.id || (now - (x.createdTimestamp || 0)) < 5000);
          if (entry?.executor) actor = { id: entry.executor.id, tag: entry.executor.tag, avatar: entry.executor.displayAvatarURL?.({ dynamic: true }) };
        }
      } catch {}

      await logger.send(client, guildId, 'rolelog', e, { actor });
    } catch (err) {
      errorHandler.handle(err, { source: 'roleUpdate', guildId: newRole.guild?.id });
    }
  },
};
