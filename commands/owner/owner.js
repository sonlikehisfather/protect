'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'owner',
  description: 'Gérer les owners globaux du bot.',
  use        : 'owner <add|remove|list> [@membre|id]',
  usage      : 'owner <add|remove|list> [@membre|id]',

};

exports.run = async (client, message, args) => {

  const authorId = message.author.id;
  const sub = args[0]?.toLowerCase();

  if (!sub)
    return _sendHelp(message);

  switch (sub) {

    case 'add': {

      if (!perms.isBuyer(authorId)) {

        return embed.replyError(
          message,
          'Seul le buyer peut ajouter un owner.'
        );

      }

      const targetId =
        _resolveUserId(message, args[1]);

      if (!targetId) {

        return embed.replyError(
          message,
          'Utilisation : `owner add <@membre|id>`'
        );

      }

      if (perms.isBuyer(targetId)) {

        return embed.replyError(
          message,
          'Le buyer ne peut pas être ajouté comme owner.'
        );

      }

      if (db.isGlobalOwner(targetId)) {

        return embed.replyError(
          message,
          `<@${targetId}> est déjà owner.`
        );

      }

      db.addGlobalOwner(targetId);

      return embed.reply(
        message,
        `<@${targetId}> est maintenant owner global.`
      );

    }

    case 'remove': {

      if (!perms.isBuyer(authorId)) {

        return embed.replyError(
          message,
          'Seul le buyer peut retirer un owner.'
        );

      }

      const targetId =
        _resolveUserId(message, args[1]);

      if (!targetId) {

        return embed.replyError(
          message,
          'Utilisation : `owner remove <@membre|id>`'
        );

      }

      if (!db.isGlobalOwner(targetId)) {

        return embed.replyError(
          message,
          `<@${targetId}> n'est pas owner.`
        );

      }

      db.removeGlobalOwner(targetId);

      return embed.reply(
        message,
        `<@${targetId}> n'est plus owner global.`
      );

    }

    case 'list': {

      if (
        !perms.isBuyer(authorId) &&
        !perms.isGlobalOwner(authorId)
      ) {

        return embed.replyError(
          message,
          'Permission refusée.'
        );

      }

      return _list(message);

    }

    default:

      return _sendHelp(message);

  }

};

async function _list(message) {

  const owners =
    db.getGlobalOwners();

  const fields = [

    {
      name  : 'Buyer',
      value : `<@${perms.getBuyerId()}>`,
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

    allowedMentions: {
      repliedUser: false
    },

  });

}

function _resolveUserId(message, raw) {

  const mentioned =
    message.mentions.users.first();

  if (mentioned)
    return mentioned.id;

  if (!raw)
    return null;

  const cleaned =
    raw.replace(/[<@!>]/g, '');

  return /^\d{17,20}$/.test(cleaned)
    ? cleaned
    : null;

}

function _sendHelp(message) {

  return embed.reply(
    message,
    null,
    {
      title : 'Owner command',

      fields: [

        {
          name : 'owner add <@membre|id>',
          value: 'Ajoute un owner global (buyer seulement)'
        },

        {
          name : 'owner remove <@membre|id>',
          value: 'Retire un owner global (buyer seulement)'
        },

        {
          name : 'owner list',
          value: 'Affiche la liste des owners globaux'
        },

      ],

      timestamp: false,

    }
  );

}
