'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'owner',
  description: 'Toggle owner global (buyer seulement). Sans argument : liste.',
  use        : 'owner [@membre|id]',
  usage      : 'owner [@membre|id]',
  aliases    : ['owners'],
};

exports.run = async (client, message, args) => {

  const authorId    = message.author.id;
  const commandUsed = message.content.trim().split(/\s+/)[0].replace(/^./, '').toLowerCase();

  if (commandUsed === 'owners' || args.length === 0) {

    if (
      !perms.isBuyer(authorId) &&
      !perms.isGlobalOwner(authorId)
    ) {
      return embed.replyError(message, 'Permission refusée.');
    }

    return _list(message);

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

  if (db.isGlobalOwner(targetId)) {

    db.removeGlobalOwner(targetId);

    return embed.reply(message, `<@${targetId}> n'est plus owner global.`);

  }

  db.addGlobalOwner(targetId);

  return embed.reply(message, `<@${targetId}> est maintenant owner global.`);

};

async function _list(message) {

  const owners = db.getGlobalOwners();
  const buyers = db.getGlobalBuyers();

  const fields = [

    {
      name  : 'Buyer Principal',
      value : `<@${perms.getSuperAdminId()}>`,
      inline: false,
    },

    {
      name  : 'Buyers',
      value : buyers.length
        ? buyers.map(id => `<@${id}>`).join(', ')
        : 'Aucun',
      inline: false,
    },

    {
      name  : 'Owners',
      value : owners.length
        ? owners.map(id => `<@${id}>`).join(', ')
        : 'Aucun',
      inline: false,
    },

  ];

  return message.reply({

    embeds: [

      embed.build(
        message.guild.id,
        null,
        {
          title    : 'Owner list',
          fields,
          timestamp: false,
        }
      ),

    ],

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
