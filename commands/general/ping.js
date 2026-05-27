'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'ping',
    description : 'Affiche la latence du bot.',
    usage       : 'ping',
    aliases     : [],
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

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          null,
          {
            title : 'Latence',
            fields: [
              {
                name  : 'Bot',
                value : 'Calcul...',
                inline: true,
              },
              {
                name  : 'API',
                value : `\`${Math.round(client.ws.ping)} ms\``,
                inline: true,
              },
            ],
            timestamp : false,
          }
        ),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (!sent) return;

    const latency =
      sent.createdTimestamp - message.createdTimestamp;

    await sent.edit({
      embeds: [
        embed.build(
          guildId,
          null,
          {
            title : 'Latence',
            fields: [
              {
                name  : 'Bot',
                value : `\`${latency} ms\``,
                inline: true,
              },
              {
                name  : 'API',
                value : `\`${Math.round(client.ws.ping)} ms\``,
                inline: true,
              },
            ],
            timestamp : false,
          }
        ),
      ],
    });

    if (deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

  },
};
