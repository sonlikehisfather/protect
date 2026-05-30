'use strict';

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

      const e = embed.build(guildId, null, {
        title       : 'Rôle modifié',
        description : `<@&${newRole.id}>\n${changes.join('\n')}`,
        color       : '#FEE75C',
        timestamp   : true,
      });

      await logger.send(client, guildId, 'rolelog', e);
    } catch (err) {
      errorHandler.handle(err, { source: 'roleUpdate', guildId: newRole.guild?.id });
    }
  },
};
