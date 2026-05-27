'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'setcolor',
  description: 'Changer la couleur des embeds du bot.',
  use        : 'setcolor <#hexcode>',
  usage      : 'setcolor <#hexcode>',
  category   : 'owner',
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;


  if (!perms.check(message, exports.help.name)) {
    return embed.replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.");
  }

  const color = args[0];

  if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return embed.replyError(message, 'Couleur invalide. Utilisation : `#RRGGBB` (ex: `#FFB6C1`).');
  }

  db.setGuildConfig(guildId, 'color', color);
  return embed.reply(message, `Couleur mise à jour : \`${color}\``);
};
