'use strict';


const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'helpall',
    description : 'Affiche toutes les catégories de commandes.',
    use         : 'helpall',
    usage       : 'helpall',
    aliases     : [],
  },

  async run(client, message, args) {
    const help = client.commands.get('help');

    if (!help || typeof help.run !== 'function') {
      return embed.replyError(
        message,
        'La commande help est indisponible.',
        { timestamp: false }
      ).catch(() => null);
    }

    return help.run(client, message, ['all', ...(args || [])]);
  },
};
