'use strict';


const crypto = require('crypto');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const CODE_LENGTH        = 12;
const CODE_CHARSET       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const TRANSFER_TIMEOUT_MS = 5 * 60 * 1000;
const CONFIRM_TIMEOUT_MS  = 30 * 1000;


const _busy = new Set();

exports.help = {
  name        : 'buyer',
  description : 'Gérer le transfert de propriété du bot.',
  use         : 'buyer <@membre> | buyer code',
  usage       : 'buyer <@membre> | buyer code',
  category    : 'owner',
};

exports.run = async (client, message, args) => {

  if (!perms.isBuyer(message.author.id)) {
    return embed.replyError(
      message,
      'Seul le buyer peut utiliser cette commande.',
      { timestamp: false },
    );
  }

  const sub = args[0]?.toLowerCase();

  if (sub === 'code') {
    return _handleGenerateCode(client, message);
  }


  const target = message.mentions.members?.first()
    ?? _resolveMemberById(message, args[0]);

  if (!target) {
    return embed.replyError(
      message,
      `Utilisation : \`${message.prefix || '+'}buyer <@membre>\` ou \`${message.prefix || '+'}buyer code\`.`,
      { timestamp: false },
    );
  }

  return _handleTransfer(client, message, target);
};


async function _handleGenerateCode(client, message) {
  if (_busy.has(message.author.id)) {
    return embed.replyError(message, 'Une opération est déjà en cours.', { timestamp: false });
  }
  _busy.add(message.author.id);

  try {
    const prefix = message.prefix || '+';


    const existing = db.getBuyerRecoveryCode();

    if (existing) {
      await embed.reply(
        message,
        'Un code de récupération existe déjà. Répondez `oui` dans 30 secondes pour le remplacer.',
      );

      const filter = m =>
        m.author.id === message.author.id &&
        m.channel.id === message.channel.id &&
        m.content.toLowerCase() === 'oui';

      const collected = await message.channel.awaitMessages({
        filter,
        max  : 1,
        time : CONFIRM_TIMEOUT_MS,
      }).catch(() => null);

      if (!collected?.size) {
        return embed.reply(message, 'Génération annulée.');
      }
    }

    const code     = _generateCode(CODE_LENGTH);
    const codeHash = _hashCode(code);


    const dmChannel = await message.author.createDM().catch(() => null);

    if (!dmChannel) {
      return embed.replyError(
        message,
        'Impossible d\'ouvrir vos DMs. Activez les messages privés depuis ce serveur.',
        { timestamp: false },
      );
    }

    const dmSent = await dmChannel.send({
      embeds: [
        embed.build(message.guild.id, null, {
          title    : 'Code de récupération buyer',
          fields   : [
            {
              name  : 'Votre code',
              value : `\`${code}\``,
            },
            {
              name  : 'Important',
              value : 'Conservez-le précieusement. Il ne sera plus affiché et sera détruit après un transfert.',
            },
            {
              name  : 'Usage',
              value : `\`${prefix}buyer <@membre>\` puis envoyez ce code en DM au bot pour confirmer.`,
            },
          ],
          timestamp: false,
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (!dmSent) {
      return embed.replyError(
        message,
        'Impossible d\'envoyer le code en DM. Activez vos DMs.',
        { timestamp: false },
      );
    }

    try {
      db.setBuyerRecoveryCode(codeHash);
    } catch (err) {
      return embed.replyError(
        message,
        'Échec d\'enregistrement du code en base. Réessayez.',
        { timestamp: false },
      );
    }

    return embed.reply(message, 'Code envoyé en DM.');
  } finally {
    _busy.delete(message.author.id);
  }
}


async function _handleTransfer(client, message, target) {
  if (_busy.has(message.author.id)) {
    return embed.replyError(message, 'Une opération est déjà en cours.', { timestamp: false });
  }
  _busy.add(message.author.id);

  try {
    const prefix = message.prefix || '+';

    if (target.user?.bot) {
      return embed.replyError(
        message,
        'Vous ne pouvez pas transférer le bot à un autre bot.',
        { timestamp: false },
      );
    }

    if (target.id === message.author.id) {
      return embed.replyError(
        message,
        'Vous êtes déjà le buyer.',
        { timestamp: false },
      );
    }

    const existing = db.getBuyerRecoveryCode();
    if (!existing) {
      return embed.replyError(
        message,
        `Générez d\'abord un code avec \`${prefix}buyer code\`.`,
        { timestamp: false },
      );
    }


    const targetMember = await message.guild.members.fetch(target.id).catch(() => null);
    if (!targetMember) {
      return embed.replyError(
        message,
        'Ce membre n\'est pas sur le serveur.',
        { timestamp: false },
      );
    }


    try {
      const ban = await message.guild.bans.fetch(target.id);
      if (ban) {
        return embed.replyError(
          message,
          'Ce membre est banni du serveur.',
          { timestamp: false },
        );
      }
    } catch (err) {
      if (err?.code === 50013) {

      } else if (err?.code === 10026) {
      } else {
      }
    }


    const dmChannel = await message.author.createDM().catch(() => null);

    if (!dmChannel) {
      return embed.replyError(
        message,
        'Impossible d\'ouvrir vos DMs. Transfert annulé.',
        { timestamp: false },
      );
    }

    await message.reply({
      embeds: [
        embed.build(message.guild.id, null, {
          title    : 'Transfert buyer en attente',
          fields   : [
            {
              name  : 'Cible',
              value : `<@${target.id}> (\`${target.id}\`)`,
            },
            {
              name  : 'Confirmation',
              value : 'Envoyez votre code de récupération en DM au bot dans les 5 minutes.',
            },
            {
              name  : 'Attention',
              value : 'Cette action est irréversible. Le code de récupération sera détruit après cette action.',
            },
          ],
          timestamp: false,
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    await dmChannel.send({
      embeds: [
        embed.build(message.guild.id, null, {
          title    : 'Transfert buyer',
          fields   : [
            {
              name  : 'Cible',
              value : `<@${target.id}> (\`${target.id}\`)`,
            },
            {
              name  : 'Action requise',
              value : 'Répondez à ce DM avec votre code de récupération dans les 5 minutes.',
            },
          ],
          timestamp: false,
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);


    const filter = m =>
      m.author.id === message.author.id &&
      m.channel.id === dmChannel.id &&
      !m.author.bot;

    const collected = await dmChannel.awaitMessages({
      filter,
      max  : 1,
      time : TRANSFER_TIMEOUT_MS,
    }).catch(() => null);

    if (!collected?.size) {
      await dmChannel.send({
        embeds: [
          embed.build(message.guild.id, 'Transfert annulé. Délai dépassé.', { timestamp: false }),
        ],
        allowedMentions: { parse: [] },
      }).catch(() => {});

      return embed.replyError(message, 'Transfert annulé. Délai dépassé.', { timestamp: false });
    }

    const submitted     = collected.first().content.trim();
    const submittedHash = _hashCode(submitted);


    const current = db.getBuyerRecoveryCode();

    let codeOk = false;
    if (current) {
      try {
        const aBuf = Buffer.from(submittedHash, 'hex');
        const bBuf = Buffer.from(current.codeHash, 'hex');
        codeOk = aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
      } catch {
        codeOk = false;
      }
    }

    if (!codeOk) {
      await dmChannel.send({
        embeds: [
          embed.build(message.guild.id, 'Code incorrect. Transfert annulé.', { timestamp: false }),
        ],
        allowedMentions: { parse: [] },
      }).catch(() => {});

      return embed.replyError(message, 'Code incorrect. Transfert annulé.', { timestamp: false });
    }

    const oldBuyerId = message.author.id;
    const newBuyerId = target.id;

    try {
      db.setBotConfig('buyerId', newBuyerId);
      db.deleteBuyerRecoveryCode();
    } catch (err) {
      await dmChannel.send({
        embeds: [
          embed.build(message.guild.id, 'Échec d\'écriture en base. Transfert annulé.', { timestamp: false }),
        ],
        allowedMentions: { parse: [] },
      }).catch(() => {});

      return embed.replyError(message, 'Échec interne. Transfert annulé.', { timestamp: false });
    }

    const botName = client.user?.username || 'le bot';


    await dmChannel.send({
      embeds: [
        embed.build(message.guild.id, null, {
          title    : 'Transfert effectué',
          fields   : [
            {
              name  : 'Statut',
              value : `Vous n'êtes plus le buyer de **${botName}**.`,
            },
            {
              name  : 'Nouveau buyer',
              value : `<@${newBuyerId}> (\`${newBuyerId}\`)`,
            },
          ],
          timestamp: false,
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => {});


    let newBuyerDmOk = false;
    const newBuyerDM = await target.createDM().catch(() => null);
    if (newBuyerDM) {
      newBuyerDmOk = await newBuyerDM.send({
        embeds: [
          embed.build(message.guild.id, null, {
            title    : 'Nouveau buyer',
            fields   : [
              {
                name  : 'Statut',
                value : `Vous êtes maintenant le buyer de **${botName}**.`,
              },
              {
                name  : 'Ancien buyer',
                value : `<@${oldBuyerId}> (\`${oldBuyerId}\`)`,
              },
            ],
            timestamp: false,
          }),
        ],
        allowedMentions: { parse: [] },
      }).then(() => true).catch(() => false);
    }

    const dmNote = newBuyerDmOk
      ? ''
      : '\n⚠️ Impossible d\'envoyer un DM au nouveau buyer.';

    return message.channel.send({
      embeds: [
        embed.build(message.guild.id, `Transfert effectué. <@${newBuyerId}> est maintenant le nouveau buyer.${dmNote}`, { timestamp: false }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  } finally {
    _busy.delete(message.author.id);
  }
}


function _generateCode(length) {
  const bytes = crypto.randomBytes(length);
  let out     = '';
  for (let i = 0; i < length; i++) {
    out += CODE_CHARSET[bytes[i] % CODE_CHARSET.length];
  }
  return out;
}

function _hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function _resolveMemberById(message, raw) {
  if (!raw) return null;
  const id = String(raw).replace(/[<@!&>]/g, '');
  if (!/^\d{17,20}$/.test(id)) return null;
  return message.guild?.members?.cache?.get(id) ?? null;
}
