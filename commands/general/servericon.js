'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'servericon',
    description : "Affiche l'icône du serveur.",
    usage       : 'servericon',
    aliases     : ['guildicon', 'serveravatar', 'siicon'],
  },

  async run(client, message) {

    const guild = message.guild;
    if (!guild) return;

    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const iconURL = guild.iconURL({
      dynamic: true,
      size   : 1024,
    });

    if (!iconURL) {
      const sent = await embed.replyError(
        message,
        'Ce serveur n’a pas d’icône.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          null,
          {
            title      : 'Icône du serveur',
            authorName : guild.name,
            authorIcon : iconURL,
            image      : iconURL,
            timestamp  : false,
          }
        )
      ],
      allowedMentions: {
        repliedUser: false,
      },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};
