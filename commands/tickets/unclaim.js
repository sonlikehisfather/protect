'use strict';

const { PermissionsBitField } = require('discord.js');

const db                 = require('../../core/database');
const embed              = require('../../utils/embed');
const perms              = require('../../utils/permissions');
const { parseJsonArray } = require('../../utils/parseJsonArray.js');
const { sendTicketLog }  = require('../../modules/tickets');

exports.help = {
  name       : 'unclaim',
  description: 'Retire le claim d’un ticket.',
  use        : 'unclaim',
};

exports.run = async (client, message) => {
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

  if (!ticket.claimedBy) {
    return embed.replyError(message, 'Ce ticket n’est pas claim.');
  }

  try {
    db.unclaimTicket(channel.id);


    const panel  = ticket.panelId  ? db.getTicketPanel(ticket.panelId)   : null;
    const option = ticket.optionId ? db.getTicketOption(ticket.optionId) : null;

    if (panel && (panel.claimMode === 'lock' || panel.claimMode === 'cache')) {
      const staffRoles = option ? parseJsonArray(option.staffRoles) : [];
      const owners     = typeof db.getGlobalOwners === 'function' ? db.getGlobalOwners() : [];

      const overwrites = [
        {
          id   : message.guild.id,
          deny : [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id    : ticket.userId,
          allow : [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks,
          ],
        },
        {
          id    : client.user.id,
          allow : [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.ManageMessages,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks,
          ],
        },
      ];

      for (const roleId of staffRoles) {
        if (!message.guild.roles.cache.has(roleId)) continue;
        overwrites.push({
          id    : roleId,
          allow : [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks,
          ],
        });
      }

      for (const ownerId of owners) {
        overwrites.push({
          id    : ownerId,
          allow : [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks,
          ],
        });
      }

      await channel.permissionOverwrites.set(overwrites).catch(() => {});
    }

    const unclaimLog = embed.log(guildId, 'Ticket unclaim', [
      { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
      { name: 'Staff', value: `<@${message.author.id}>`, inline: true },
      { name: 'Créateur', value: `<@${ticket.userId}>`, inline: true },
    ]);

    await sendTicketLog(client, message.guild, ticket, unclaimLog);

    return embed.reply(message, 'Le ticket a été unclaim.');
  } catch {
    return embed.replyError(message, 'Impossible de retirer le claim.');
  }
};
