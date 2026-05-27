'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'serverbanner',
    description : 'Affiche la bannière du serveur.',
    usage       : 'serverbanner',
    aliases     : ['guildbanner', 'sbanner'],
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

    const fetchedGuild = await client.guilds.fetch(guildId).catch(() => guild);

    const bannerURL = fetchedGuild.bannerURL({
      dynamic: true,
      size   : 1024,
    });

    if (!bannerURL) {
      const sent = await embed.replyError(
        message,
        'Ce serveur n’a pas de bannière.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const iconURL = guild.iconURL({
      dynamic: true,
      size   : 256,
    });

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          null,
          {
            title      : 'Bannière du serveur',
            authorName : guild.name,
            authorIcon : iconURL ?? undefined,
            image      : bannerURL,
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
