'use strict';

const db = require('../../core/database');
const {
  canUseFivem,
  canManageFivemOwners,
  getDeletePolicy,
  extractUserId,
  reply,
  replyError,
} = require('./_shared');

module.exports = {
  help: {
    name        : 'funown',
    description : 'Retirer un owner du module FiveM.',
    usage       : 'funown <@membre|id>',
    aliases     : [],
    category    : 'fivem',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!canUseFivem(message, module.exports.help.name)) {
      return replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.", module.exports.help.name);
    }

    const del = getDeletePolicy(guildId);
    if (del.deleteCmd) await message.delete().catch(() => {});

    if (!canManageFivemOwners(message)) {
      return replyError(message, 'Seul un owner/buyer peut retirer un owner FiveM.', module.exports.help.name);
    }

    const targetId = extractUserId(message, args[0] || '');
    if (!targetId) return replyError(message, 'Utilisation : `funown <@membre|id>`', module.exports.help.name);

    if (!db.isFivemOwner(guildId, targetId)) {
      return replyError(message, `<@${targetId}> n'est pas owner FiveM.`, module.exports.help.name);
    }

    db.removeFivemOwner(guildId, targetId);
    return reply(message, `<@${targetId}> n'est plus owner FiveM.`, { timestamp: false }, module.exports.help.name);
  },
};
