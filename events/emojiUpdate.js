'use strict';

const logger = require('../utils/logger');
const embed = require('../utils/embed');

module.exports = {
  name: 'emojiUpdate',
  once: false,

  async execute(client, oldEmoji, newEmoji) {
    try {
      if (oldEmoji.name === newEmoji.name) return;

      const fields = [
        { name: 'Ancien nom', value: `**${oldEmoji.name}**`, inline: true },
        { name: 'Nouveau nom', value: `**${newEmoji.name}** ${newEmoji.toString()}`, inline: true },
        { name: 'ID', value: `\`${newEmoji.id}\``, inline: true },
      ];

      await logger.send(client, newEmoji.guild.id, 'emojilog', embed.log(newEmoji.guild.id, 'Emoji renommé', fields, {
        color: '#FEE75C',
        timestamp: true,
      }));
    } catch {}
  },
};
