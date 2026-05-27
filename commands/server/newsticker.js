'use strict';


const {
  PermissionsBitField,
} = require('discord.js');

const sharp = require('sharp');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'newsticker',
    description : 'Crée un sticker sur le serveur.',
    usage       : 'newsticker <nom>',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'newsticker')) return;

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
        'Je n\'ai pas la permission de gérer les stickers.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const name = args[0];

    if (!name) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}newsticker <nom>\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!_isValidStickerName(name)) {
      const sent = await embed.replyError(
        message,
        'Nom invalide. Le nom doit contenir entre 2 et 30 caractères.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const attachment = message.attachments.first();
    const sticker    = message.stickers.first();

    let fileUrl = null;

    if (attachment) fileUrl = attachment.url;
    if (sticker)    fileUrl = sticker.url;

    if (!fileUrl) {
      const sent = await embed.replyError(
        message,
        'Vous devez envoyer une image ou un sticker avec la commande.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (guild.stickers.cache.size >= guild.stickerLimit) {
      const sent = await embed.replyError(
        message,
        'Le serveur a atteint la limite de stickers.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const convertedBuffer = await _downloadAndConvertSticker(fileUrl);

    if (!convertedBuffer) {
      const sent = await embed.replyError(
        message,
        'Impossible de traiter cette image.',
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
      created = await guild.stickers.create({
        file   : convertedBuffer,
        name,
        tags   : 'sticker',
        reason : `Sticker créé par ${message.author.username}`,
      });
    } catch (err) {
      clearTimeout(slowNotice);
      if (slowNoticeMessage) await slowNoticeMessage.delete().catch(() => {});

      let errorMsg;

      if (_isDiscordRateLimit(err)) {
        errorMsg = 'Discord limite temporairement les actions. Veuillez patienter quelques secondes.';
      } else if (err?.code === 50046 || err?.code === 50035) {
        errorMsg = 'Fichier invalide ou trop volumineux pour Discord.';
      } else if (err?.code === 50013) {
        errorMsg = 'Permissions insuffisantes pour créer ce sticker.';
      } else if (err?.code === 30039) {
        errorMsg = 'Le serveur a atteint la limite de stickers.';
      } else {
        errorMsg = 'Impossible de créer ce sticker. Vérifiez le format ou la taille.';
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
      `**ID**\n` +
      `\`${created.id}\``;

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          text,
          {
            title     : 'Sticker créé avec succès',
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

function _isValidStickerName(name) {
  return typeof name === 'string'
    && name.length >= 2
    && name.length <= 30;
}

function _isDiscordRateLimit(err) {
  return err?.status === 429 ||
    err?.code === 20028 ||
    err?.code === 31001 ||
    err?.rawError?.retry_after ||
    err?.retryAfter;
}

async function _downloadAndConvertSticker(url) {
  try {
    const response = await fetch(url);

    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const buffer      = Buffer.from(arrayBuffer);

    if (!buffer.length) return null;

    const converted = await sharp(buffer)
      .resize(320, 320, {
        fit        : 'contain',
        background : { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    return converted;
  } catch {
    return null;
  }
}
