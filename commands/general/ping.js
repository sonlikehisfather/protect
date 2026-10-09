'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'ping',
    description : 'Affiche la latence du bot.',
    usage       : 'ping',
    aliases     : [],
    defaultPermission: 'everyone',
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

    const apiPing = Math.round(client.ws.ping);

    let sent = null;

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
          '## Latence\n\nBot \u203a Calcul...\nAPI \u203a ' + apiPing + ' ms'
        ));
        sent = await message.channel.send({
          components      : [container],
          flags           : COMPONENTS_V2_FLAG,
          allowedMentions : { parse: [] },
        }).catch(() => null);
      } catch {}
    }

    if (!sent) {
      sent = await message.channel.send({
        embeds: [
          embed.build(guildId, null, {
            title : 'Latence',
            fields: [
              { name: 'Bot', value: 'Calcul...', inline: true },
              { name: 'API', value: `\`${apiPing} ms\``, inline: true },
            ],
            timestamp : false,
          }),
        ],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }

    if (!sent) return;

    const latency = sent.createdTimestamp - message.createdTimestamp;
    const finalApiPing = Math.round(client.ws.ping);

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
          '## Latence\n\nBot \u203a ' + latency + ' ms\nAPI \u203a ' + finalApiPing + ' ms'
        ));
        await sent.edit({
          embeds     : [],
          components : [container],
          flags      : COMPONENTS_V2_FLAG,
        }).catch(() => {});
      } catch {}
    } else {
      await sent.edit({
        embeds: [
          embed.build(guildId, null, {
            title : 'Latence',
            fields: [
              { name: 'Bot', value: `\`${latency} ms\``, inline: true },
              { name: 'API', value: `\`${finalApiPing} ms\``, inline: true },
            ],
            timestamp : false,
          }),
        ],
      });
    }

    if (deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

  },
};
