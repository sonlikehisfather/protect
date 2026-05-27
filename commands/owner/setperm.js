'use strict';


const permsCmd = require('./perms');

exports.help = {
  name        : 'setperm',
  description : 'Assigne une perm à un rôle ou membre.',
  use         : 'setperm <1-9> <@role|@membre>, <@autre>, ...',
  usage       : 'setperm <1-9> <@role|@membre>, <@autre>, ...',
  aliases     : ['set perm'],
  category    : 'owner',
  multi       : true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const prefix  = message.prefix || '+';

  return permsCmd.handleSet(
    message,
    guildId,
    args[0],
    args.slice(1).join(' '),
    `${prefix}setperm <1-9> <@role|@membre>, <@autre>, ...`,
  );
};
