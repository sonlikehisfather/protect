'use strict';

const logger = require('../utils/logger');
const embed = require('../utils/embed');

module.exports = {
  name: 'emojiCreate',
  once: false,

  async execute(client, emoji) {
    try {
      await logger.send(
        client,
        emoji.guild.id,
        'emojilog',
        embed.build(emoji.guild.id, null, {
          title: 'Emoji ajouté',
          description: `**${emoji.name}** ${emoji.toString()}`,
          color: '#57F287',
          timestamp: true,
        })
      );
    } catch {}
  },
};
