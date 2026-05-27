'use strict';

const tickets = require('../../modules/tickets');
const perms   = require('../../utils/permissions');

exports.help = {
  name       : 'claim',
  description: 'Claim un ticket.',
  use        : 'claim',
};

exports.run = async (client, message) => {
  if (!perms.check(message, exports.help.name)) return;
  return tickets.handleClaim(client, message);
};
