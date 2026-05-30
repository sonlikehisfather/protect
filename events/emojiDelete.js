'use strict';

const logger = require('../utils/logger');
const embed = require('../utils/embed');

module.exports = {
  name: 'emojiDelete',
  once: false,

  async execute(client, emoji) {
    try {
      await logger.send(
        client,
        emoji.guild.id,
        'emojilog',
        embed.build(emoji.guild.id, null, {
          title: 'Emoji supprimé',
          description: `**${emoji.name}**`,
          color: '#ED4245',
          timestamp: true,
        })
      );
    } catch {}
  },
};
