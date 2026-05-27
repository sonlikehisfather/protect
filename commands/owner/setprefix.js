'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');


const FORBIDDEN_PREFIX_CHARS = /[\s@#`]/;

exports.help = {
  name       : 'setprefix',
  description: 'Changer le préfixe du bot.',
  use        : 'setprefix <préfixe>',
  usage      : 'setprefix <préfixe>',
  category   : 'owner',
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;


  if (!perms.check(message, exports.help.name)) {
    return embed.replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.");
  }

  const prefix = args[0];

  if (!prefix || prefix.length > 5) {
    return embed.replyError(message, 'Préfixe invalide (1 à 5 caractères).');
  }

  if (FORBIDDEN_PREFIX_CHARS.test(prefix)) {
    return embed.replyError(message, 'Le préfixe ne peut pas contenir d\'espaces, `@`, `#` ou `` ` ``.');
  }

  db.setGuildConfig(guildId, 'prefix', prefix);
  return embed.reply(message, `Préfixe mis à jour : \`${prefix}\``);
};
