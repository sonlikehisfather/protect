'use strict';


const { AuditLogEvent } = require('discord.js');
const db                = require('../core/database');
const logger            = require('../utils/logger');
const embed             = require('../utils/embed');
const giveaways         = require('../modules/giveaways');
const errorHandler      = require('../utils/errorHandler');

module.exports = {
  name : 'channelDelete',
  once : false,

  async execute(client, channel) {
    try {
      if (!channel.guild) return;

      const guildId = channel.guild.id;

      try {
        const built = embed.log(guildId, 'Salon supprimé', [
          {
            name   : 'Salon',
            value  : `**${channel.name}** \`${channel.id}\``,
            inline : false,
          },
          {
            name   : 'Type',
            value  : channel.isTextBased?.() ? 'Texte' : 'Autre',
            inline : true,
          },
          {
            name   : 'Catégorie',
            value  : channel.parentId ? `<#${channel.parentId}>` : 'Aucune',
            inline : true,
          },
        ], {
          color     : '#ED4245',
          timestamp : true,
        });

        // Try to resolve the executor from audit logs (best-effort)
        let actor = null;
        try {
          const fetched = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 6 }).catch(() => null);
          if (fetched && fetched.entries) {
            const now = Date.now();
            const entry = [...fetched.entries.values()].find(e => e.target?.id === channel.id || (now - (e.createdTimestamp || 0)) < 5000);
            if (entry?.executor) actor = { id: entry.executor.id, tag: entry.executor.tag, avatar: entry.executor.displayAvatarURL?.({ dynamic: true }) };
          }
        } catch {}

        await logger.send(client, guildId, 'channellog', built, { actor }).catch(() => {});
      } catch {}

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
