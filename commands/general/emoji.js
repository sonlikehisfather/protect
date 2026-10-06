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

    const lines = [
      `## Informations \u00e9moji`,
      `> ${emoji}`,
      '',
      `**Nom** \u203a ${emoji.name ?? 'Inconnu'}`,
      `ID \u203a \`${emoji.id}\``,
      `Anim\u00e9 \u203a ${emoji.animated ? 'Oui' : 'Non'}`,
      `Disponible \u203a ${emoji.available ? 'Oui' : 'Non'}`,
    ];

    if (createdAt) {
      lines.push(`Cr\u00e9\u00e9 le \u203a <t:${createdAt}:F> (<t:${createdAt}:R>)`);
    }

    const text = lines.join('\n');

    let sent = null;

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
        container.addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(imageURL)
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
      const fields = [
        { name: '\u00c9moji', value: `${emoji}`, inline: true },
        { name: 'Nom', value: emoji.name ?? 'Inconnu', inline: true },
        { name: 'ID', value: emoji.id, inline: true },
        { name: 'Anim\u00e9', value: emoji.animated ? 'Oui' : 'Non', inline: true },
        { name: 'Disponible', value: emoji.available ? 'Oui' : 'Non', inline: true },
      ];

      if (createdAt) {
        fields.push({ name: 'Cr\u00e9\u00e9 le', value: `<t:${createdAt}:F>\n<t:${createdAt}:R>`, inline: true });
      }

      sent = await message.channel.send({
        embeds: [
          embed.build(guildId, null, {
            title      : 'Informations \u00e9moji',
            authorName : emoji.name ?? '\u00c9moji',
            image      : imageURL,
            fields,
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
