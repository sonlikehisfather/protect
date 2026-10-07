'use strict';

const db = require('../../core/database');
const perms = require('../../utils/permissions');
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
    name        : 'fown',
    description : 'Gerer les owners du module FiveM.',
    usage       : 'fown [@membre|id]',
    aliases     : ['fowners'],
    category    : 'fivem',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!canUseFivem(message, module.exports.help.name)) {
      return replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.", module.exports.help.name);
    }

    const del = getDeletePolicy(guildId);
    if (del.deleteCmd) await message.delete().catch(() => {});

    if (!args.length) {
      return _list(message, guildId);
    }

    if (!canManageFivemOwners(message)) {
      return replyError(message, 'Seul un owner/buyer peut modifier les owners FiveM.', module.exports.help.name);
    }

    const targetId = extractUserId(message, args[0]);
    if (!targetId) return replyError(message, 'Utilisation : `fown <@membre|id>`', module.exports.help.name);

    if (perms.isBuyer(targetId)) {
      return replyError(message, 'Le buyer ne peut pas etre ajoute en owner FiveM.', module.exports.help.name);
    }

    if (db.isFivemOwner(guildId, targetId)) {
      return replyError(message, `<@${targetId}> est deja owner FiveM.`, module.exports.help.name);
    }

    db.addFivemOwner(guildId, targetId);
    return reply(message, `<@${targetId}> est maintenant owner FiveM.`, { timestamp: false }, module.exports.help.name);
  },
};

async function _list(message, guildId) {
  const fowners = db.getFivemOwners(guildId);
  const owners = db.getOwners(guildId);
  const buyers = db.getGlobalBuyers();
  const blacklistCount = db.getBlacklist(guildId).length;

  const text = [
    `Buyer principal: <@${perms.getSuperAdminId()}>`,
    `Buyers: ${buyers.length ? buyers.map(id => `<@${id}>`).join(', ') : 'Aucun'}`,
    `Owners serveur: ${owners.length ? owners.map(id => `<@${id}>`).join(', ') : 'Aucun'}`,
    `Owners FiveM: ${fowners.length ? fowners.map(id => `<@${id}>`).join(', ') : 'Aucun'}`,
    `Blacklist: ${blacklistCount}`,
  ].join('\n');

  return reply(message, text, {
    title     : 'FiveM owners',
    timestamp : false,
    allowedMentions: { parse: [] },
  }, module.exports.help.name);
}
