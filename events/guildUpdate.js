'use strict';

const logger = require('../utils/logger');
const embed = require('../utils/embed');

module.exports = {
  name: 'guildUpdate',
  once: false,

  async execute(client, oldGuild, newGuild) {
    try {
      const changes = [];

      if (oldGuild.name !== newGuild.name) {
        changes.push(`Nom: **${oldGuild.name}** → **${newGuild.name}**`);
      }

      if (oldGuild.icon !== newGuild.icon) {
        changes.push('Icône modifiée');
      }

      if (oldGuild.banner !== newGuild.banner) {
        changes.push('Bannière modifiée');
      }

      if (oldGuild.description !== newGuild.description) {
        changes.push('Description modifiée');
      }

      if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
        changes.push('Niveau de vérification modifié');
      }

      if (changes.length === 0) return;

      await logger.send(
        client,
        newGuild.id,
        'serverlog',
        embed.build(newGuild.id, null, {
          title: 'Serveur modifié',
          description: changes.join('\n'),
          color: '#FEE75C',
          timestamp: true,
        })
      );
    } catch {}
  },
};
