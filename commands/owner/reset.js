'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'reset',
  description: 'Réinitialiser les paramètres du bot.',
  use        : 'reset <server|all>',
  usage      : 'reset <server|all>',
  category   : 'owner',
};

exports.run = async (client, message, args) => {
  const guildId  = message.guild.id;
  const authorId = message.author.id;


  if (!perms.check(message, exports.help.name)) {
    return embed.replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.");
  }

  const sub = args[0]?.toLowerCase();

  if (sub === 'server') {
    await embed.reply(
      message,
      '⚠️ **Action irréversible.** Cela supprimera TOUS les paramètres du bot sur ce serveur ' +
      '(config, permissions, antiraid, logs, etc.).\nRépondez `confirmer` dans 15 secondes pour continuer.'
    );

    const filter    = m => m.author.id === authorId && m.content.toLowerCase() === 'confirmer';
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 15_000 }).catch(() => null);

    if (!collected?.size) {
      return embed.reply(message, 'Reset annulé.');
    }

    db.resetGuild(guildId);
    return embed.reply(message, ` Tous les paramètres du bot ont été réinitialisés sur **${message.guild.name}**.`);
  }


  if (sub === 'all') {
    if (!perms.isBuyer(authorId)) {
      return embed.replyError(message, 'Seul le buyer peut utiliser cette commande.');
    }

    await embed.reply(
      message,
      '⚠️ **Action irréversible.** Cela supprimera les paramètres du bot sur **TOUS** les serveurs.\n' +
      'Répondez `confirmer tout` dans 15 secondes pour continuer.'
    );

    const filter    = m => m.author.id === authorId && m.content.toLowerCase() === 'confirmer tout';
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 15_000 }).catch(() => null);

    if (!collected?.size) {
      return embed.reply(message, 'Reset annulé.');
    }

    for (const guild of client.guilds.cache.values()) {
      db.resetGuild(guild.id);
    }

    return embed.reply(message, ` Paramètres réinitialisés sur **${client.guilds.cache.size}** serveur(s).`);
  }

  return embed.replyError(message, 'Utilisation : `+reset server` ou `+reset all`');
};
