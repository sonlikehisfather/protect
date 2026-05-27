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


  if (!perms.isBuyer(authorId)) {
    return embed.replyError(message, 'Commande réservée au buyer.');
  }

  const target =
    message.mentions.users.first() ??
    await client.users.fetch(args[0]).catch(() => null);

  if (!target) {
    return embed.replyError(message, 'Utilisateur introuvable.');
  }

  const entry = db.getBlacklistEntry(target.id);

  if (!entry) {
    return embed.replyError(message, `${target.username} n'est pas dans la blacklist.`);
  }

  db.removeBlacklist(target.id);

  let unbanned = 0;

  for (const guild of client.guilds.cache.values()) {
    const ok = await guild.bans.remove(target.id, 'Blacklist retirée (force)')
      .then(() => true)
      .catch(() => false);

    if (ok) unbanned++;

    await _wait(300);
  }

  return embed.reply(
    message,
    `${target.username} retiré de force de la blacklist. Débanni de ${unbanned} serveur(s).`
  );
};

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
