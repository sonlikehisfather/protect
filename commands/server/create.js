'use strict';


const {
  PermissionsBitField,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'create',
    description : 'Crée un émoji custom sur le serveur à partir d\'une image ou d\'un émoji.',
    usage       : 'create [émoji/image/url] [nom]',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'create')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageGuildExpressions)) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas la permission de gérer les émojis du serveur.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const attachment = message.attachments.first();

    let source = args[0];
    let name   = args[1];

    if (attachment) {
      source = attachment.url;
      name   = args[0];
    }

    if (!source || !name) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}create [émoji/image/url] [nom]\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    name = name.trim();

    if (!_isValidEmojiName(name)) {
      const sent = await embed.replyError(
        message,
        'Nom invalide. Le nom doit contenir entre 2 et 32 caractères, uniquement lettres, chiffres et underscores.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const imageUrl = _resolveEmojiSource(source);

    if (!imageUrl) {
      const sent = await embed.replyError(
        message,
        'Image invalide. Vous devez fournir un émoji custom, une URL d\'image ou une image en pièce jointe.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const emojiLimit    = guild.premiumTier >= 3 ? 250 : guild.premiumTier >= 2 ? 150 : guild.premiumTier >= 1 ? 100 : 50;
    const staticCount   = guild.emojis.cache.filter(e => !e.animated).size;
    const animatedCount = guild.emojis.cache.filter(e => e.animated).size;
    const isAnimated    = imageUrl.includes('.gif');

    if (!isAnimated && staticCount >= emojiLimit) {
      const sent = await embed.replyError(
        message,
        'Le serveur a atteint la limite d\'émojis classiques.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (isAnimated && animatedCount >= emojiLimit) {
      const sent = await embed.replyError(
        message,
        'Le serveur a atteint la limite d\'émojis animés.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let created;
    let slowNoticeMessage = null;

    const slowNotice = setTimeout(async () => {
      const sent = await embed.replyError(
        message,
        'Discord met plus de temps que prévu à répondre. Veuillez patienter.',
        { timestamp: false }
      ).catch(() => null);

      if (sent) {
        slowNoticeMessage = sent;
        embed.scheduleDelete(sent, 8);
      }
    }, 6000);
    slowNotice.unref?.();

    try {
      created = await guild.emojis.create({
        attachment : imageUrl,
        name,
        reason     : `Emoji créé par ${message.author.username}`,
      });
    } catch (err) {
      clearTimeout(slowNotice);
      if (slowNoticeMessage) await slowNoticeMessage.delete().catch(() => {});

      let errorMsg;

      if (_isDiscordRateLimit(err)) {
        errorMsg = 'Discord limite temporairement les actions. Veuillez patienter quelques secondes.';
      } else if (err?.code === 50035) {
        errorMsg = 'Image invalide ou trop volumineuse pour Discord.';
      } else if (err?.code === 50013) {
        errorMsg = 'Permissions insuffisantes pour créer cet émoji.';
      } else if (err?.code === 30008) {
        errorMsg = 'Le serveur a atteint la limite d\'émojis.';
      } else {
        errorMsg = 'Impossible de créer cet émoji. Vérifiez que l\'image est valide et que le serveur possède encore des emplacements disponibles.';
      }

      const sent = await embed.replyError(
        message,
        errorMsg,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    clearTimeout(slowNotice);
    if (slowNoticeMessage) await slowNoticeMessage.delete().catch(() => {});

    const text =
      `**Nom**\n` +
      `\`${created.name}\`\n\n` +
      `**Aperçu**\n` +
      `${created}\n\n` +
      `**ID**\n` +
      `\`${created.id}\``;

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          text,
          {
            title     : 'Émoji créé avec succès',
            timestamp : false,
          }
        ),
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

function _resolveEmojiSource(source) {
  if (!source || typeof source !== 'string') return null;

  const customEmoji = source.match(/^<a?:([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/);

  if (customEmoji) {
    const animated = source.startsWith('<a:');
    const id       = customEmoji[2];
    return `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?quality=lossless`;
  }

  if (_isImageUrl(source)) {
    return source;
  }

  return null;
}

function _isImageUrl(value) {
  try {
    const url = new URL(value);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }

    return /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

function _isValidEmojiName(name) {
  return /^[a-zA-Z0-9_]{2,32}$/.test(name);
}

function _isDiscordRateLimit(err) {
  return err?.status === 429 ||
    err?.code === 20028 ||
    err?.code === 31001 ||
    err?.rawError?.retry_after ||
    err?.retryAfter;
}
