'use strict';


const permsCmd = require('./perms');

exports.help = {
  name        : 'clearperms',
  description : 'Supprime toutes les perms du serveur.',
  use         : 'clearperms',
  usage       : 'clearperms',
  aliases     : ['clear perms'],
  category    : 'owner',
};

exports.run = async (client, message) => {
  const guildId = message.guild.id;
  return permsCmd.handleClear(message, guildId);
};
