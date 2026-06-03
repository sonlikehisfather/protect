'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = !!(  
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder   === 'function' &&
  typeof TextDisplayBuilder === 'function'
);

const db    = require('../../core/database');
const embed = require('../../utils/embed');

const SUPPORT_LINK = 'https://discord.gg/yhqN42KRdt';

module.exports = {
  help: {
    name        : 'support',
    description : 'Affiche le lien du serveur support.',
    usage       : 'support',
    aliases     : ['discord'],
    category    : 'general',
  },

  async run(client, message) {
    const guildId     = message.guild.id;
    const guildConfig = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
    const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
    const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const linkBtn = new ButtonBuilder()
      .setLabel('Lien du serveur de support')
      .setURL(SUPPORT_LINK)
      .setStyle(ButtonStyle.Link);

    let sent;

    if (V2_AVAILABLE) {
      const container = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('## Serveur support'),
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(linkBtn),
        );

      sent = await message.channel.send({
        flags      : COMPONENTS_V2_FLAG,
        components : [container],
        embeds     : [],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    } else {
      sent = await message.channel.send({
        embeds: [embed.build(guildId, null, {
          title     : 'Serveur support',
          timestamp : false,
        })],
        components      : [new ActionRowBuilder().addComponents(linkBtn)],
        allowedMentions : { parse: [] },
      }).catch(() => null);
    }

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};
