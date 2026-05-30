'use strict';


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

        await logger.send(
          client,
          guild.id,
          'channellog',
          embed.build(guild.id, null, {
            title: 'Salon créé',
            description: `**${channel.name}** (${typeNames[channel.type] || 'Inconnu'})\n<#${channel.id}>`,
            color: '#57F287',
            timestamp: true,
          })
        );
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
