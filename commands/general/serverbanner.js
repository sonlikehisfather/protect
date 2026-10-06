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

    let sent = null;

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `## Banni\u00e8re du serveur\n> ${guild.name}`
        ));
        container.addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(bannerURL)
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
            title      : 'Banni\u00e8re du serveur',
            authorName : guild.name,
            authorIcon : iconURL ?? undefined,
            image      : bannerURL,
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
