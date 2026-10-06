'use strict';


const { AuditLogEvent }               = require('discord.js');
const db                              = require('../core/database');
const logger                          = require('../utils/logger');
const embed                           = require('../utils/embed');
const { applyMuteOverwriteToChannel } = require('../utils/applyMuteOverwrites');

module.exports = {
  name : 'channelCreate',
  once : false,

  async execute(client, channel) {
    try {

      const guild = channel?.guild;
      if (!guild) return;

      try {
        const typeNames = {
          0: 'Texte',
          2: 'Vocal',
          4: 'Catégorie',
          5: 'Annonces',
          13: 'Stage',
          15: 'Forum',
        };

        const built = embed.log(guild.id, 'Salon créé', [
            {
              name   : 'Salon',
              value  : `**${channel.name}** <#${channel.id}>`,
              inline : false,
            },
            {
              name   : 'Type',
              value  : typeNames[channel.type] || 'Inconnu',
              inline : true,
            },
            {
              name   : 'Catégorie',
              value  : channel.parent ? `<#${channel.parentId}>` : 'Aucune',
              inline : true,
            },
          ], {
            color     : '#57F287',
            timestamp : true,
          });

        // Try to resolve the executor from audit logs (best-effort)
        let actor = null;
        try {
          const fetched = await guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 6 }).catch(() => null);
          if (fetched && fetched.entries) {
            const now = Date.now();
            const entry = [...fetched.entries.values()].find(e => e.target?.id === channel.id || (now - (e.createdTimestamp || 0)) < 5000);
            if (entry?.executor) actor = { id: entry.executor.id, tag: entry.executor.tag, avatar: entry.executor.displayAvatarURL?.({ dynamic: true }) };
          }
        } catch {}

        await logger.send(client, guild.id, 'channellog', built, { actor }).catch(() => {});
      } catch {}


      const config = db.getGuildConfig(guild.id);
      if (Boolean(config?.useTimeout)) return;

      const muteRoleId = config?.muteRoleId ?? null;
      if (!muteRoleId) return;

      const muteRole = guild.roles.cache.get(muteRoleId);
      if (!muteRole) return;

      const me = guild.members.me
        ?? await guild.members.fetchMe().catch(() => null);
      if (!me) return;


      await applyMuteOverwriteToChannel(channel, muteRole, me, {
        reason: 'Auto-overwrite rôle mute (nouveau salon)',
      });
    } catch {


    }
  },
};
