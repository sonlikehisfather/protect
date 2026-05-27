'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'join',
    description : 'Raccourci Crow-like vers +joinsettings.',
    use         : 'join settings [options]',
    usage       : 'join settings [options]',
    aliases     : [],
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    const action = args[0]?.toLowerCase();

    if (action !== 'settings') {
      const config      = db.getGuildConfig(guildId);
      const deleteReply = Boolean(config?.autoDeleteModReplies);
      const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}join settings [options]\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const joinsettings = client.commands.get('joinsettings');

    if (!joinsettings || typeof joinsettings.run !== 'function') {
      return embed.replyError(
        message,
        'La commande joinsettings est indisponible.',
        { timestamp: false }
      ).catch(() => null);
    }

    return joinsettings.run(client, message, args.slice(1));
  },
};
