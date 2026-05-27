'use strict';


const db                              = require('../core/database');
const { applyMuteOverwriteToChannel } = require('../utils/applyMuteOverwrites');

module.exports = {
  name : 'channelCreate',
  once : false,

  async execute(client, channel) {
    try {

      const guild = channel?.guild;
      if (!guild) return;


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
