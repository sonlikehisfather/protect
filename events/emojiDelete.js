'use strict';

const logger = require('../utils/logger');
const embed = require('../utils/embed');

module.exports = {
  name: 'emojiDelete',
  once: false,

  async execute(client, emoji) {
    try {
      const fields = [
        { name: 'Emoji', value: `**${emoji.name}** ${emoji.toString()}`, inline: false },
        { name: 'ID', value: `\`${emoji.id}\``, inline: true },
        { name: 'Animé', value: emoji.animated ? 'Oui' : 'Non', inline: true },
      ];

      await logger.send(client, emoji.guild.id, 'emojilog', embed.log(emoji.guild.id, 'Emoji supprimé', fields, {
        color: '#ED4245',
        timestamp: true,
      }));
    } catch {}
  },
};
