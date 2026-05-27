'use strict';

const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const { sendTicketLog, isTicketStaff } = require('../../modules/tickets');

exports.help = {
  name       : 'rename',
  description: 'Renomme un ticket.',
  use        : 'rename <nom>',
};

exports.run = async (client, message, args) => {
  if (!perms.check(message, exports.help.name)) return;
  const guildId = message.guild.id;
  const channel = message.channel;

  const ticket = db.getTicket(channel.id);

  if (!ticket) {
    return embed.replyError(message, 'Ce salon n’est pas un ticket.');
  }

  if (ticket.status === 'closed') {
    return embed.replyError(message, 'Ce ticket est déjà fermé.');
  }

  if (!isTicketStaff(message, ticket)) {
    return embed.replyError(message, 'Vous n\'avez pas la permission de g\u00e9rer ce ticket.');
  }

  const newNameRaw = args.join(' ').trim();
  if (!newNameRaw) {
    return embed.replyError(message, 'Donnez un nom.\nExemple : `rename support-paiement`');
  }

  const oldName = channel.name;

  const safeName = newNameRaw
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 90);

  if (!safeName) {
    return embed.replyError(message, 'Nom invalide.');
  }

  try {
    await channel.setName(safeName, `Ticket renommé par ${message.author.tag}`);

    if (typeof db.renameTicket === 'function') {
      db.renameTicket(channel.id, safeName, message.author.id);
    }

    const renameLog = embed.log(guildId, 'Ticket renommé', [
      { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
      { name: 'Staff', value: `<@${message.author.id}>`, inline: true },
      { name: 'Ancien nom', value: oldName, inline: true },
      { name: 'Nouveau nom', value: safeName, inline: true },
    ]);

    await sendTicketLog(client, message.guild, ticket, renameLog);

    return embed.reply(message, `Ticket renommé en \`${safeName}\`.`);
  } catch {
    return embed.replyError(message, 'Impossible de renommer ce ticket.');
  }
};
