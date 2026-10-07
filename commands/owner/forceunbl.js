'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'forceunbl',
  description: "Forcer le retrait d'un membre de la blacklist.",
  use        : 'forceunbl <@membre/ID>',
  usage      : 'forceunbl <@membre/ID>',
  category   : 'owner',
};

exports.run = async (client, message, args) => {
  const authorId = message.author.id;
  const guildId  = message.guild.id;


  if (!perms.isBuyer(authorId)) {
    return embed.replyError(message, 'Commande réservée au buyer.');
  }

  const target =
    message.mentions.users.first() ??
    await client.users.fetch(args[0]).catch(() => null);

  if (!target) {
    return embed.replyError(message, 'Utilisateur introuvable.');
  }

  if (db.isWet(target.id)) {
    return embed.replyError(message, `${target.username} est wet et ne peut être débanni qu’avec \`unwet\`.`);
  }

  const entry = db.getBlacklistEntry(guildId, target.id);

  if (!entry) {
    return embed.replyError(message, `${target.username} n'est pas dans la blacklist.`);
  }

  db.removeBlacklist(guildId, target.id);

  const unbanned = await message.guild.bans.remove(target.id, 'Blacklist retirée (force)')
    .then(() => true)
    .catch(() => false);

  return embed.reply(
    message,
    `${target.username} retiré de la blacklist de ce serveur. ${unbanned ? 'Débanni ici.' : 'Le débannissement a échoué, il reste banni ici.'}`
  );
};
