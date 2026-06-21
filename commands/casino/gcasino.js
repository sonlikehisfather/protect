'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'gcasino',
  description: 'Toggle gérant casino par serveur. Sans argument : liste.',
  use        : 'gcasino [@membre|id]',
  usage      : 'gcasino [@membre|id]',
  aliases    : ['gcasinos'],
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {

  const authorId    = message.author.id;
  const guildId     = message.guild.id;
  const commandUsed = message.content.trim().split(/\s+/)[0].replace(/^./, '').toLowerCase();

  if (commandUsed === 'gcasinos' || args.length === 0) {

    if (
      !perms.isBuyer(authorId) &&
      !perms.isOwner(guildId, authorId) &&
      !db.isCasinoManager(guildId, authorId)
    ) {
      return embed.replyError(message, 'Permission refusée.');
    }

    return _list(message, guildId);

  }

  if (!perms.isBuyer(authorId) && !perms.isOwner(guildId, authorId)) {
    return embed.replyError(message, 'Seul un owner ou buyer peut modifier les gérants.');
  }

  const targetId = _resolveUserId(message, args[0]);

  if (!targetId) {
    return embed.replyError(message, 'Utilisation : `gcasino <@membre|id>`');
  }

  if (db.isCasinoManager(guildId, targetId)) {

    db.removeCasinoManager(guildId, targetId);

    return embed.reply(message, `<@${targetId}> n'est plus gérant casino sur ce serveur.`);

  }

  db.addCasinoManager(guildId, targetId, authorId);

  return embed.reply(message, `<@${targetId}> est maintenant gérant casino sur ce serveur.`);

};

async function _list(message, guildId) {

  const managers = db.getCasinoManagers(guildId);

  const lines = managers.length
    ? managers.map(m => `<@${m.userId}>`).join(', ')
    : 'Aucun';

  const content =
    `## ◆ Gérants Casino\n\n` +
    `**Gérants** (${managers.length})\n${lines}`;

  if (V2_AVAILABLE) {
    try {
      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
      return message.reply({
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      });
    } catch {}
  }

  return message.reply({
    embeds: [embed.build(guildId, null, {
      title    : '◆ Gérants Casino',
      fields   : [{ name: `Gérants (${managers.length})`, value: lines, inline: false }],
      timestamp: false,
    })],
    allowedMentions: { repliedUser: false },
  });

}

function _resolveUserId(message, raw) {

  const mentioned = message.mentions.users.first();

  if (mentioned)
    return mentioned.id;

  if (!raw)
    return null;

  const cleaned = raw.replace(/[<@!>]/g, '');

  return /^\d{17,20}$/.test(cleaned)
    ? cleaned
    : null;

}
