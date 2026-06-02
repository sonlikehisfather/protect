'use strict';

const sharp  = require('sharp');
const https  = require('https');
const http   = require('http');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'gif',
    description : 'Convertit une image en GIF et l\'envoie dans le chat.',
    usage       : 'gif [image/url]',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'gif')) return;

    const config      = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const attachment = message.attachments.first();
    let imageUrl = attachment?.url ?? args[0] ?? null;

    if (!imageUrl) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}gif [image ou url]\``,
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!_isValidUrl(imageUrl)) {
      const sent = await embed.replyError(
        message,
        'URL invalide. Fournissez un lien HTTP/HTTPS vers une image.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const thinking = await message.channel.send({
      embeds: [embed.build(guildId, 'Conversion en cours...', { timestamp: false })],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    let gifBuffer;
    try {
      const rawBuffer = await _fetchBuffer(imageUrl);
      gifBuffer = await sharp(rawBuffer)
        .gif()
        .toBuffer();
    } catch {
      if (thinking) await thinking.delete().catch(() => {});
      const sent = await embed.replyError(
        message,
        'Impossible de convertir cette image. Vérifiez qu\'elle est valide et accessible.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (thinking) await thinking.delete().catch(() => {});

    const sent = await message.channel.send({
      files: [{ attachment: gifBuffer, name: 'image.gif' }],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};


function _isValidUrl(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function _fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}
