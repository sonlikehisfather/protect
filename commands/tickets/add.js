'use strict';

const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const { sendTicketLog, isTicketStaff } = require('../../modules/tickets');

exports.help = {
  name       : 'add',
  description: 'Ajoute un membre à un ticket.',
  use        : 'add <membre>',
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
    return embed.replyError(message, 'Ce ticket est fermé.');
  }

  if (!isTicketStaff(message, ticket)) {
    return embed.replyError(message, 'Vous n\'avez pas la permission de g\u00e9rer ce ticket.');
  }

  const member = message.mentions.members.first()
    || (args[0] ? message.guild.members.cache.get(args[0].replace(/[<@!>]/g, '')) : null);

  if (!member) {
    return embed.replyError(message, 'Membre introuvable.');
  }

  try {
    await channel.permissionOverwrites.edit(member.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    }, {
      reason: `Ajout au ticket par ${message.author.tag}`,
    });

    const addLog = embed.log(guildId, 'Membre ajouté au ticket', [
      { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
      { name: 'Staff', value: `<@${message.author.id}>`, inline: true },
      { name: 'Membre ajouté', value: `<@${member.id}>`, inline: true },
    ]);

    await sendTicketLog(client, message.guild, ticket, addLog);

    return embed.reply(
      message,
      `<@${member.id}> a été ajouté au ticket.`
    );
  } catch {
    return embed.replyError(message, 'Impossible d’ajouter ce membre au ticket.');
  }
};
