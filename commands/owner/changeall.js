'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'changeall',
  description: 'Déplacer toutes les commandes d\'une permission vers une autre.',
  use        : 'changeall <ancienne_perm> <nouvelle_perm>',
  usage      : 'changeall <ancienne_perm> <nouvelle_perm>',

};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;

  if (!perms.isBuyer(message.author.id) && !perms.isOwner(message.guild.id, message.author.id)) {
    return embed.replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.");
  }

  const from = perms.parsePerm(args[0]);
  const to   = perms.parsePerm(args[1]);

  if (!from || !to) {
    return embed.replyError(message, 'Utilisation : `+changeall <ancienne> <nouvelle>` - Ex : `+changeall perm3 perm4`');
  }

  if (!perms.canEditPerm(message, from) || !perms.canEditPerm(message, to)) {
    return embed.replyError(
      message,
      'Vous ne pouvez pas modifier ces permissions.'
    );
  }

  db.moveCmdPerms(guildId, from, to);

  return embed.reply(message,
    `Toutes les commandes de **${perms.permLabel(from)}** déplacées vers **${perms.permLabel(to)}**.\n` +
    `Utilisez \`+help all\` pour visualiser le résultat.`
  );
};
