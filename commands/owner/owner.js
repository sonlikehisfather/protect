'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const { sendHierarchyList } = require('../../utils/ownerList');

exports.help = {
  name       : 'owner',
  description: 'Toggle owner par serveur (buyer seulement). Sans argument : liste.',
  use        : 'owner [@membre|id]',
  usage      : 'owner [@membre|id]',
  aliases    : ['owners'],
  permissionScopes: [
    {
      permission : 'owner',
      usage      : 'owners',
      description: 'Afficher les owners du serveur. Accessible aux Owners et Buyers.',
    },
    {
      permission : 'buyer',
      usage      : 'owner <@membre|id>',
      description: 'Ajouter ou retirer un Owner du serveur. Réservé aux Buyers.',
    },
  ],
};

exports.run = async (client, message, args) => {

  const authorId    = message.author.id;
  const guildId     = message.guild.id;
  const commandUsed = message.content.trim().split(/\s+/)[0].replace(/^./, '').toLowerCase();

  if (commandUsed === 'owners' || args.length === 0) {

    if (
      !perms.isBuyer(authorId) &&
      !perms.isOwner(guildId, authorId)
    ) {
      return embed.replyError(message, 'Permission refusée.');
    }

    return sendHierarchyList(message, 'Owner list');

  }

  if (!perms.isBuyer(authorId)) {
    return embed.replyError(message, 'Seul un buyer peut modifier les owners.');
  }

  const targetId = _resolveUserId(message, args[0]);

  if (!targetId) {
    return embed.replyError(message, 'Utilisation : `owner <@membre|id>`');
  }

  if (perms.isBuyer(targetId)) {
    return embed.replyError(message, 'Le buyer ne peut pas être ajouté comme owner.');
  }

  if (db.isOwner(guildId, targetId)) {

    db.removeOwner(guildId, targetId);

    return embed.reply(message, `<@${targetId}> n'est plus owner sur ce serveur.`);

  }

  db.addOwner(guildId, targetId);

  return embed.reply(message, `<@${targetId}> est maintenant owner sur ce serveur.`);

};

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
