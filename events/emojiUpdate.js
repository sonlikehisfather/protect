'use strict';

const logger = require('../utils/logger');
const embed = require('../utils/embed');

module.exports = {
  name: 'emojiUpdate',
  once: false,

  async execute(client, oldEmoji, newEmoji) {
    try {
      if (oldEmoji.name === newEmoji.name) return;

      await logger.send(
        client,
        newEmoji.guild.id,
        'emojilog',
        embed.build(newEmoji.guild.id, null, {
          title: 'Emoji renommé',
          description: `Ancien: **${oldEmoji.name}**\nNouveau: **${newEmoji.name}** ${newEmoji.toString()}`,
          color: '#FEE75C',
          timestamp: true,
        })
      );
    } catch {}
  },
};
