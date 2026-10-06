'use strict';

const logger = require('../utils/logger');
const embed = require('../utils/embed');

module.exports = {
  name: 'emojiCreate',
  once: false,

  async execute(client, emoji) {
    try {
      const fields = [
        { name: 'Emoji', value: `${emoji.toString()} **${emoji.name}**`, inline: false },
        { name: 'ID', value: `\`${emoji.id}\``, inline: true },
        { name: 'Animé', value: emoji.animated ? 'Oui' : 'Non', inline: true },
      ];

      await logger.send(client, emoji.guild.id, 'emojilog', embed.log(emoji.guild.id, 'Emoji ajouté', fields, {
        color: '#57F287',
        timestamp: true,
      }));
    } catch {}
  },
};
