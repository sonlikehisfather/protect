'use strict';


const {
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'servericon',
    description : "Affiche l'icône du serveur.",
    usage       : 'servericon',
    aliases     : ['guildicon', 'serveravatar', 'siicon'],
    defaultPermission: 'everyone',
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

    let sent = null;

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `## Ic\u00f4ne du serveur\n> ${guild.name}`
        ));
        container.addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(iconURL)
          )
        );
        sent = await message.channel.send({
          components      : [container],
          flags           : COMPONENTS_V2_FLAG,
          allowedMentions : { repliedUser: false },
        }).catch(() => null);
      } catch {}
    }

    if (!sent) {
      sent = await message.channel.send({
        embeds: [
          embed.build(guildId, null, {
            title      : 'Ic\u00f4ne du serveur',
            authorName : guild.name,
            authorIcon : iconURL,
            image      : iconURL,
            timestamp  : false,
          })
        ],
        allowedMentions: { repliedUser: false },
      }).catch(() => null);
    }

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};
