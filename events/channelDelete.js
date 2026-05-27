'use strict';


const db           = require('../core/database');
const giveaways    = require('../modules/giveaways');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'channelDelete',
  once : false,

  async execute(client, channel) {
    try {
      if (!channel.guild) return;

      const guildId = channel.guild.id;

      const ticket = db.getTicket(channel.id);


      if (ticket && ticket.status !== 'closed') {
        if (typeof db.closeTicket === 'function') {
          db.closeTicket(
            channel.id,
            client.user.id,
            'Salon supprimé manuellement',
            null
          );
        }
      }

      if (typeof db.getTicketPanels === 'function') {
        const panels = db.getTicketPanels(guildId);
        for (const p of panels) {
          if (p.channelId === channel.id && typeof db.clearTicketPanelChannel === 'function') {
            db.clearTicketPanelChannel(p.id);
          }
        }
      }

      if (giveaways?.cleanupDeletedChannel) {
        giveaways.cleanupDeletedChannel(channel.id);
      }

      const menus   = db.getRoleMenusByChannel(guildId, channel.id);

      for (const menu of menus) {
        const opts = db.getRoleMenuOptions(menu.id);

        if (!opts || opts.length === 0) {
          db.deleteRoleMenu(menu.id);
        } else {
          db.clearRoleMenuMessage(menu.id);
        }
      }


      try {
        if (typeof db.cleanupGuildChannelReferences === 'function') {
          db.cleanupGuildChannelReferences(guildId, channel.id);
        }
      } catch {}

    } catch (err) {
      errorHandler.handle(err, {
        source : 'channelDelete',
        guildId: channel.guild?.id,
      });
    }
  },
};
