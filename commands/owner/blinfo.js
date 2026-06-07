'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'blinfo',
  description: "Afficher les infos de blacklist d'un membre.",
  use        : 'blinfo <@membre/ID>',
  usage      : 'blinfo <@membre/ID>',
  category   : 'owner',
};

exports.run = async (client, message, args) => {
  const authorId = message.author.id;
  const guildId  = message.guild.id;

  if (
    !perms.isBuyer(authorId) &&
    !perms.isOwner(guildId, authorId)
  ) {
    return embed.replyError(message, 'Permission refusée.');
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

  return embed.reply(message, null, {
    title    : `Blacklist - ${target.username}`,
    thumbnail: target.displayAvatarURL({ dynamic: true }),
    fields   : [
      {
        name  : 'Membre',
        value : `<@${entry.userId}> (${entry.userId})`,
        inline: true,
      },
      {
        name  : 'Ajouté par',
        value : `<@${entry.addedBy}>`,
        inline: true,
      },
      {
        name  : 'Date',
        value : `<t:${entry.addedAt}:F>`,
        inline: true,
      },
      {
        name  : 'Raison',
        value : entry.reason ?? 'Aucune raison',
        inline: false,
      },
    ],
    timestamp: false,
  });
};
