'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'emoji',
    description : "Affiche l'image et les infos d'un émoji.",
    usage       : 'emoji <émoji>',
    aliases     : ['emojiinfo', 'ei'],
  },

  async run(client, message, args) {

    const guildId = message.guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const raw   = args.join(' ').trim();
    const emoji = resolveEmoji(message, raw);

    if (!emoji) {
      const sent = await embed.replyError(
        message,
        `Aucun émoji trouvé pour : \`${raw || 'inconnu'}\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const createdAt = emoji.createdTimestamp
      ? Math.floor(emoji.createdTimestamp / 1000)
      : null;

    const imageURL = emoji.imageURL({
      dynamic: true,
      size   : 1024,
    });

    const fields = [
      {
        name  : 'Émoji',
        value : `${emoji}`,
        inline: true,
      },
      {
        name  : 'Nom',
        value : emoji.name ?? 'Inconnu',
        inline: true,
      },
      {
        name  : 'ID',
        value : emoji.id,
        inline: true,
      },
      {
        name  : 'Animé',
        value : emoji.animated ? 'Oui' : 'Non',
        inline: true,
      },
      {
        name  : 'Disponible',
        value : emoji.available ? 'Oui' : 'Non',
        inline: true,
      },
    ];

    if (createdAt) {
      fields.push({
        name  : 'Créé le',
        value : `<t:${createdAt}:F>\n<t:${createdAt}:R>`,
        inline: true,
      });
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          null,
          {
            title      : 'Informations émoji',
            authorName : emoji.name ?? 'Émoji',
            image      : imageURL,
            fields,
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

function resolveEmoji(message, raw) {

  if (!raw) return null;

  const customMatch = raw.match(/^<a?:([\w_]+):(\d{17,20})>$/);
  if (customMatch) {
    const emojiId = customMatch[2];
    return message.client.emojis.cache.get(emojiId)
      ?? message.guild.emojis.cache.get(emojiId)
      ?? null;
  }

  if (/^\d{17,20}$/.test(raw)) {
    return message.client.emojis.cache.get(raw)
      ?? message.guild.emojis.cache.get(raw)
      ?? null;
  }

  const lowered = raw.toLowerCase();

  const exactEmoji =
    message.guild.emojis.cache.find(e =>
      e.name?.toLowerCase() === lowered
    )
    ?? message.client.emojis.cache.find(e =>
      e.name?.toLowerCase() === lowered
    );

  if (exactEmoji) return exactEmoji;

  const partialEmoji =
    message.guild.emojis.cache.find(e =>
      e.name?.toLowerCase().includes(lowered)
    )
    ?? message.client.emojis.cache.find(e =>
      e.name?.toLowerCase().includes(lowered)
    );

  if (partialEmoji) return partialEmoji;

  return null;

}
