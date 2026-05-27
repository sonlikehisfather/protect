'use strict';

const tickets = require('../../modules/tickets');
const perms   = require('../../utils/permissions');

exports.help = {
  name       : 'close',
  description: 'Ferme un ticket.',
  use        : 'close [raison]',
};

exports.run = async (client, message, args) => {
  if (!perms.check(message, exports.help.name)) return;
  const reason = args.join(' ').trim() || null;
  return tickets.handleClose(client, message, reason);
};
