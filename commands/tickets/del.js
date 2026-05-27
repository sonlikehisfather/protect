'use strict';

const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const { sendTicketLog, isTicketStaff } = require('../../modules/tickets');

exports.help = {
  name       : 'del',
  description: 'Retire un membre d’un ticket.',
  use        : 'del <membre>',
};

exports.run = async (client, message, args) => {

  if (args[0]?.toLowerCase() === 'perm') {
    const delperm = client.commands?.get?.('delperm');
    if (delperm?.run) {
      return delperm.run(client, message, args.slice(1));
    }
  }

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

  if (member.id === ticket.userId) {
    return embed.replyError(message, 'Vous ne pouvez pas retirer le créateur du ticket.');
  }

  try {
    await channel.permissionOverwrites.delete(member.id, `Retrait du ticket par ${message.author.tag}`);

    const delLog = embed.log(guildId, 'Membre retiré du ticket', [
      { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
      { name: 'Staff', value: `<@${message.author.id}>`, inline: true },
      { name: 'Membre retiré', value: `<@${member.id}>`, inline: true },
    ]);

    await sendTicketLog(client, message.guild, ticket, delLog);

    return embed.reply(
      message,
      `<@${member.id}> a été retiré du ticket.`
    );
  } catch {
    return embed.replyError(message, 'Impossible de retirer ce membre du ticket.');
  }
};
