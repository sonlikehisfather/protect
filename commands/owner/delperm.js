'use strict';


const permsCmd = require('./perms');

exports.help = {
  name        : 'delperm',
  description : 'Retire une perm d\'un rôle ou membre.',
  use         : 'delperm <1-9> <@role|@membre>, <@autre>, ...',
  usage       : 'delperm <1-9> <@role|@membre>, <@autre>, ...',
  aliases     : ['del perm'],
  category    : 'owner',
  multi       : true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const prefix  = message.prefix || '+';

  return permsCmd.handleDel(
    message,
    guildId,
    args[0],
    args.slice(1).join(' '),
    `${prefix}delperm <1-9> <@role|@membre>, <@autre>, ...`,
  );
};
