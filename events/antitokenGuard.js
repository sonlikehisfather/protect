'use strict';


const { GuildVerificationLevel } = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');

const joinMap = new Map();

module.exports = {
  name: 'guildMemberAdd',
  once: false,

  async execute(client, member) {

    const guild   = member.guild;
    const guildId = guild.id;

    try {

      const config      = db.getAntiraidConfig(guildId);
      const guildConfig = db.getGuildConfig(guildId);

      if (!guildConfig?.antiraidEnabled || !config?.antitokenEnabled) return;
      if (member.user.bot) return;

      const now       = Date.now();
      const threshold = Math.max(1, config.antitokenThreshold ?? 10);
      const windowMs  = Math.max(1000, (config.antitokenWindow ?? 10) * 1000);

      const entries = joinMap.get(guildId) ?? [];
      const recent  = entries.filter(ts => now - ts <= windowMs);

      recent.push(now);
      joinMap.set(guildId, recent);

      if (recent.length === 1) {
        setTimeout(() => {
          joinMap.delete(guildId);
        }, windowMs);
      }

      if (recent.length < threshold) return;

      joinMap.set(guildId, []);

      await guild.setVerificationLevel(
        GuildVerificationLevel.VeryHigh,
        `Antitoken déclenché (${recent.length} arrivées en ${config.antitokenWindow}s)`
      ).catch(() => {});

      const raidPing = config.raidPingRole
        ? `<@&${config.raidPingRole}> `
        : '';

      const fields = [

        {
          name   : 'Détection',
          value  : 'Antitoken',
          inline : true,
        },

        {
          name   : 'Seuil',
          value  : `${threshold} arrivées / ${config.antitokenWindow}s`,
          inline : true,
        },

        {
          name   : 'Déclenché à',
          value  : `${recent.length} arrivées`,
          inline : true,
        },

        {
          name   : 'Dernier membre',
          value  : `<@${member.id}> (${member.user.tag}) \`${member.id}\``,
          inline : false,
        },

        {
          name   : 'Action',
          value  : 'Verrouillage du serveur (vérification maximale)',
          inline : false,
        },

      ];

      const e = embed.log(
        guildId,
        'Raid détecté -Antitoken',
        fields,
        {
          thumbnail: member.user.displayAvatarURL({ dynamic: true }),
        }
      );

      await logger.send(client, guildId, 'raidlog', e);

      if (config.raidPingRole) {

        const channelId = db.getGuildConfig(guildId)?.raidLogChannel;

        const channel =
          channelId
            ? guild.channels.cache.get(channelId)
            : null;

        if (channel?.isTextBased()) {

          await channel.send({
            content : `${raidPing}raid détecté -serveur verrouillé.`,
            allowedMentions: {
              roles: [config.raidPingRole],
            },
          }).catch(() => {});

        }

      }

    }
    catch (err) {

      errorHandler.handle(err, {
        source  : 'antitokenGuard',
        guildId,
      });

    }

  },
};
