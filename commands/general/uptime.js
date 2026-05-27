'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'uptime',
    description : 'Affiche le temps en ligne du bot.',
    usage       : 'uptime',
    aliases     : ['upt'],
  },

  async run(client, message) {

    const guild   = message.guild;
    const guildId = guild.id;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const uptime = client.uptime;

    const seconds = Math.floor(uptime / 1000) % 60;
    const minutes = Math.floor(uptime / (1000 * 60)) % 60;
    const hours   = Math.floor(uptime / (1000 * 60 * 60)) % 24;
    const days    = Math.floor(uptime / (1000 * 60 * 60 * 24));

    const formatted =
      `${days} jour${days !== 1 ? 's' : ''}, ` +
      `${hours} heure${hours !== 1 ? 's' : ''}, ` +
      `${minutes} minute${minutes !== 1 ? 's' : ''}, ` +
      `${seconds} seconde${seconds !== 1 ? 's' : ''}`;

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          null,
          {
            title : 'Temps en ligne',
            fields: [
              {
                name  : 'Uptime',
                value : `\`${formatted}\``,
                inline: false,
              },
            ],
            timestamp : false,
          }
        ),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

  },
};
