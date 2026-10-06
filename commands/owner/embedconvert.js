'use strict';

const {
  ComponentType,
  ContainerBuilder,
  FileBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  TextDisplayBuilder,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

module.exports = {
  help: {
    name        : 'embedconvert',
    description : 'Convertit un embed envoyé par le bot en Components V2.',
    usage       : 'embedconvert <ID du message> (ou réponds au message)',
    aliases     : ['cv2', 'embedtov2', 'v2msg'],
    category    : 'owner',
  },

  async run(client, message, args) {
    const guildId = message.guild?.id;
    if (!guildId) return embed.replyError(message, 'Cette commande doit être utilisée dans un serveur.');

    if (
      !perms.isBuyer(message.author.id) &&
      !perms.isOwner(guildId, message.author.id) &&
      !db.isGlobalOwner(message.author.id)
    ) {
      return embed.replyError(message, 'Permission refusée.');
    }

    const messageId = message.reference?.messageId ?? args[0];
    if (!/^\d{17,20}$/.test(messageId ?? '')) {
      return embed.replyError(message, 'Réponds à un message du bot ou indique son ID.');
    }

    const target = await message.channel.messages.fetch(messageId).catch(() => null);
    if (!target) return embed.replyError(message, 'Message introuvable dans ce salon.');
    if (target.author.id !== client.user.id) {
      return embed.replyError(message, 'Je ne peux convertir que mes propres messages.');
    }
    if (target.flags.has(MessageFlags.IsComponentsV2)) {
      const uncolored = _removeContainerAccents(target.components);
      if (!uncolored.changed) {
        return embed.reply(message, 'Ce message est déjà en V2 et ses conteneurs n’ont pas de couleur accentuée.');
      }

      const componentCount = uncolored.components.reduce(_countComponents, 0);
      if (componentCount > 40) {
        return embed.replyError(message, 'Le message dépasse la limite de 40 composants après retrait des couleurs.');
      }

      try {
        await target.edit({
          components      : uncolored.components,
          allowedMentions : { parse: [] },
        });
        return embed.reply(message, 'Couleurs accentuées retirées. Les conteneurs, contours fins, boutons et menus ont été conservés.');
      } catch (error) {
        const code = Number(error?.code ?? error?.rawError?.code);
        const detail = code ? ` (erreur Discord ${code})` : '';
        return embed.replyError(message, `Impossible de retirer les couleurs${detail}; le message est inchangé.`);
      }
    }
    if (!target.embeds.length) {
      return embed.replyError(message, 'Ce message ne contient aucun embed à convertir.');
    }
    if (target.poll || target.stickers?.size) {
      return embed.replyError(message, 'Ce message contient un sondage ou un sticker qui ne peut pas être conservé en V2.');
    }
    if (target.components.some(component => {
      const data = typeof component.toJSON === 'function' ? component.toJSON() : component;
      return data.type !== ComponentType.ActionRow;
    })) {
      return embed.replyError(message, 'Le message contient un composant V1 non reconnu; aucune modification n’a été faite.');
    }

    try {
      const converted = _convertMessage(target);
      const componentCount = converted.components.reduce(_countComponents, 0);
      if (componentCount > 40) {
        return embed.replyError(message, 'Le message dépasse la limite de 40 composants après conversion.');
      }

      await target.edit({
        content         : null,
        embeds          : [],
        flags           : target.flags.bitfield | COMPONENTS_V2_FLAG,
        components      : converted.components,
        attachments     : converted.attachments,
        allowedMentions : { parse: [] },
      });

      return embed.reply(message, 'Embed converti en Components V2. Les boutons et menus existants ont été conservés.');
    } catch (error) {
      const code = Number(error?.code ?? error?.rawError?.code);
      const detail = code ? ` (erreur Discord ${code})` : '';
      return embed.replyError(message, `La conversion a échoué${detail}; le message d’origine est inchangé.`);
    }
  },
};

function _convertMessage(message) {
  const components = [];
  const referencedAttachments = new Set();

  for (const text of _splitText(message.content || '')) {
    components.push(new TextDisplayBuilder().setContent(text));
  }

  for (const sourceEmbed of message.embeds) {
    const data = sourceEmbed.toJSON();
    const text = _embedText(data);
    const container = new ContainerBuilder();

    for (const chunk of _splitText(text)) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
    }

    const media = [
      data.thumbnail?.url,
      data.image?.url,
      data.video?.url,
      data.author?.icon_url,
      data.footer?.icon_url,
    ].filter(url => _isMediaUrl(url));

    if (media.length) {
      const gallery = new MediaGalleryBuilder();
      for (const url of media) {
        gallery.addItems(new MediaGalleryItemBuilder().setURL(url));
        const attachmentName = url.match(/^attachment:\/\/(.+)$/)?.[1];
        if (attachmentName) referencedAttachments.add(attachmentName);
      }
      container.addMediaGalleryComponents(gallery);
    }

    components.push(container);
  }

  const attachments = message.attachments.map(attachment => ({
    id          : attachment.id,
    filename    : attachment.name,
    description : attachment.description ?? undefined,
    is_spoiler  : attachment.spoiler,
  }));

  for (const attachment of message.attachments.values()) {
    if (referencedAttachments.has(attachment.name)) continue;
    components.push(new FileBuilder()
      .setURL(`attachment://${attachment.name}`)
      .setSpoiler(attachment.spoiler));
  }

  for (const row of message.components) {
    components.push(row.toJSON());
  }

  return { components, attachments };
}

function _embedText(data) {
  const lines = [];

  if (data.author?.name) {
    const author = data.author.url
      ? `[${data.author.name}](${data.author.url})`
      : data.author.name;
    lines.push(`> ${author}`);
  }
  if (data.title) {
    const title = data.url ? `[${data.title}](${data.url})` : data.title;
    lines.push(`## ${title}`);
  }
  if (data.description) lines.push('', data.description);

  for (const field of data.fields ?? []) {
    lines.push('', `**${field.name}**`, field.value);
  }

  if (data.footer?.text) lines.push('', `-# ${data.footer.text}`);
  if (data.timestamp) {
    const timestamp = Math.floor(new Date(data.timestamp).getTime() / 1000);
    if (Number.isFinite(timestamp)) lines.push(`-# <t:${timestamp}:f>`);
  }

  return lines.join('\n').trim();
}

function _splitText(text, maxLength = 3900) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < maxLength / 2) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function _isMediaUrl(url) {
  return typeof url === 'string' && /^(https?:\/\/|attachment:\/\/)/i.test(url);
}

function _countComponents(component) {
  const data = typeof component.toJSON === 'function' ? component.toJSON() : component;
  const children = data.components ?? [];
  const mediaItems = data.items ?? [];
  return 1 + children.reduce((total, child) => total + _countComponents(child), 0) + mediaItems.length;
}

function _removeContainerAccents(components) {
  const result = [];
  let changed = false;

  const clean = component => {
    const data = typeof component.toJSON === 'function' ? component.toJSON() : component;
    let output = data;

    if (
      (data.type === ComponentType.Container || data.type === 17 || data.type === 'container') &&
      Object.prototype.hasOwnProperty.call(data, 'accent_color')
    ) {
      const { accent_color, ...withoutAccent } = data;
      output = withoutAccent;
      changed = true;
    }

    if (Array.isArray(data.components)) {
      const children = data.components.map(clean);
      if (children.some((child, index) => child !== data.components[index])) {
        output = { ...output, components: children };
      }
    }

    return output;
  };

  for (const component of components) result.push(clean(component));
  return { components: result, changed };
}