'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require('discord.js');

const db                                    = require('../../core/database');
const embed                                 = require('../../utils/embed');
const perms                                 = require('../../utils/permissions');
const { parseJsonArray }                    = require('../../utils/parseJsonArray.js');
const { sendTicketLog, cancelPendingDelete } = require('../../modules/tickets');

exports.help = {
  name       : 'reopen',
  description: 'Rouvre un ticket fermé.',
  use        : 'reopen',
};

exports.run = async (client, message) => {
  if (!perms.check(message, exports.help.name)) return;
  const guildId = message.guild.id;
  const channel = message.channel;

  const ticket = db.getTicket(channel.id);

  if (!ticket) {
    return embed.replyError(message, 'Ce salon n’est pas un ticket.');
  }

  if (ticket.status !== 'closed') {
    return embed.replyError(message, 'Ce ticket n’est pas fermé.');
  }

  try {
    if (typeof db.reopenTicket === 'function') {
      db.reopenTicket(channel.id);
    } else {
      db.updateTicket(channel.id, { status: 'open' });
    }
    cancelPendingDelete(channel.id);

    if (typeof db.updateTicketActivity === 'function') {
      db.updateTicketActivity(channel.id, Math.floor(Date.now() / 1000));
    }

    const panel  = ticket.panelId ? db.getTicketPanel(ticket.panelId) : null;
    const option = ticket.optionId ? db.getTicketOption(ticket.optionId) : null;


    if (ticket.lastMessageId) {
      const targetMessage = await channel.messages.fetch(ticket.lastMessageId).catch(() => null);

      if (targetMessage) {
        const buttons = [];

        if (Number(panel?.showClaimButton ?? 1) === 1) {
          buttons.push(
            new ButtonBuilder()
              .setCustomId('ticket_claim')
              .setLabel('Claim')
              .setStyle(ButtonStyle.Primary)
          );
        }

        if (Number(panel?.showCloseButton ?? 1) === 1) {
          buttons.push(
            new ButtonBuilder()
              .setCustomId('ticket_close')
              .setLabel('Close')
              .setStyle(ButtonStyle.Danger)
          );
        }

        if (buttons.length) {
          await targetMessage.edit({
            components: [new ActionRowBuilder().addComponents(buttons)],
          }).catch(() => {});
        }
      }
    }


    if (option) {
      const staffRoles = parseJsonArray(option.staffRoles);

      const overwrites = [
        {
          id: message.guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: ticket.userId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks,
          ],
        },
        {
          id: client.user.id,
          allow: [
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
          id: roleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks,
          ],
        });
      }

      const owners =
        typeof db.getGlobalOwners === 'function'
          ? db.getGlobalOwners()
          : [];

      for (const ownerId of owners) {
        overwrites.push({
          id: ownerId,
          allow: [
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

    const reopenLog = embed.log(guildId, 'Ticket rouvert', [
      { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
      { name: 'Staff', value: `<@${message.author.id}>`, inline: true },
      { name: 'Créateur', value: `<@${ticket.userId}>`, inline: true },
    ]);

    await sendTicketLog(client, message.guild, ticket, reopenLog);

    return embed.reply(message, 'Le ticket a été rouvert.');
  } catch {
    return embed.replyError(message, 'Impossible de rouvrir ce ticket.');
  }
};
