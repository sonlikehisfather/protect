'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name        : 'buyer',
  description : 'Toggle buyer global (super admin seulement). Sans argument : liste.',
  use         : 'buyer [@membre|id]',
  usage       : 'buyer [@membre|id]',
  category    : 'owner',
  aliases     : ['buyers'],
};

exports.run = async (client, message, args) => {

  const authorId    = message.author.id;
  const commandUsed = message.content.trim().split(/\s+/)[0].replace(/^./, '').toLowerCase();

  if (commandUsed === 'buyers' || args.length === 0) {

    if (!perms.isBuyer(authorId)) {
      return embed.replyError(message, 'Permission refusée.', { timestamp: false });
    }

    return _list(message);

  }

  if (!perms.isSuperAdmin(authorId)) {
    return embed.replyError(message, 'Seul le buyer principal peut modifier les buyers.', { timestamp: false });
  }

  const targetId = _resolveUserId(message, args[0]);

  if (!targetId) {
    return embed.replyError(message, 'Utilisation : `buyer <@membre|id>`', { timestamp: false });
  }

  if (targetId === authorId) {
    return embed.replyError(message, 'Vous êtes déjà le buyer principal.', { timestamp: false });
  }

  if (db.isGlobalBuyer(targetId)) {

    db.removeGlobalBuyer(targetId);
    return embed.reply(message, `<@${targetId}> n'est plus buyer.`);

  }

  db.addGlobalBuyer(targetId);
  return embed.reply(message, `<@${targetId}> est maintenant buyer.`);

};


async function _list(message) {

  const superAdminId = perms.getSuperAdminId();
  const buyers       = db.getGlobalBuyers();

  const fields = [

    {
      name  : 'Buyer Principal',
      value : `<@${superAdminId}>`,
      inline: false,
    },

    {
      name  : 'Buyers',
      value : buyers.length
        ? buyers.map(id => `<@${id}>`).join(', ')
        : 'Aucun',
      inline: false,
    },

  ];

  return message.reply({
    embeds: [
      embed.build(message.guild.id, null, {
        title    : 'Buyer list',
        fields,
        timestamp: false,
      }),
    ],
    allowedMentions: { repliedUser: false },
  });

}

function _resolveUserId(message, raw) {

  const mentioned = message.mentions.users.first();
  if (mentioned) return mentioned.id;

  if (!raw) return null;

  const cleaned = raw.replace(/[<@!>]/g, '');
  return /^\d{17,20}$/.test(cleaned) ? cleaned : null;

}
