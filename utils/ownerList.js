'use strict';

const db    = require('../core/database');
const embed = require('./embed');
const perms = require('./permissions');

/**
 * Affiche la liste des owners/buyers selon le niveau du demandeur :
 *  - owner            : owners
 *  - buyer            : owners + buyers
 *  - buyer principal  : owners + buyers + buyer principal
 */
async function sendHierarchyList(message, title = 'Owner list') {
  const viewerId = message.author.id;
  const guildId  = message.guild.id;
  const mainId   = perms.getSuperAdminId();

  const isMain  = perms.isSuperAdmin(viewerId);
  const isBuyer = isMain || perms.isBuyer(viewerId);

  const fields = [];

  if (isMain) {
    fields.push({ name: 'Buyer Principal', value: `<@${mainId}>`, inline: false });
  }

  if (isBuyer) {
    const buyers = db.getGlobalBuyers().filter(id => id !== mainId);
    fields.push({
      name  : 'Buyers',
      value : buyers.length ? buyers.map(id => `<@${id}>`).join(', ') : 'Aucun',
      inline: false,
    });
  }

  const owners = db.getOwners(guildId);
  fields.push({
    name  : 'Owners (ce serveur)',
    value : owners.length ? owners.map(id => `<@${id}>`).join(', ') : 'Aucun',
    inline: false,
  });

  return embed.sendEmbed(message.channel, guildId, null, {
    title,
    fields,
    timestamp: false,
  });
}

module.exports = { sendHierarchyList };
