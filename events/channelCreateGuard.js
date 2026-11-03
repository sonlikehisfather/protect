'use strict';


const { AuditLogEvent } = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const perms        = require('../utils/permissions');
const errorHandler = require('../utils/errorHandler');
const core         = require('../utils/antiraidCore');

const channelCreateMap = new Map();


const AUDIT_WAIT_MS    = 1000;
const AUDIT_MAX_AGE_MS = 8000;

module.exports = {
  name: 'channelCreate',
  once: false,

  async execute(client, channel) {

    const guild = channel.guild;
    if (!guild) return;

    const guildId = guild.id;

    try {

      const config      = db.getAntiraidConfig(guildId);
      const guildConfig = db.getGuildConfig(guildId);

      if (!guildConfig?.antiraidEnabled || !config?.antichannelEnabled) return;

      const entry = await core.findAuditEntry(guild, AuditLogEvent.ChannelCreate, channel.id);
      if (!entry?.executor) return;
      const now = Date.now();

      const executorId = entry.executor.id;

      if (executorId === client.user.id) return;

      const executorMember =
        guild.members.cache.get(executorId) ??
        await guild.members.fetch(executorId).catch(() => null);

      if (core.isExempt(executorId, guildId, executorMember)) return;

      const threshold = Math.max(1, config.antichannelThreshold ?? 3);
      const windowMs  = Math.max(1000, (config.antichannelWindow ?? 10) * 1000);

      const result = core.hit(`chcreate_${guildId}_${executorId}`, threshold, windowMs, channel.id);
      if (!result.triggered) return;

      if (channel.deletable) {
        await channel
          .delete('Antiraid - antichannel suppression salon')
          .catch(() => {});
      }

      const punishment = config.antichannelPunish ?? 'derank';

      await _applyPunishment(
        client,
        guild,
        executorId,
        punishment,
        'antichannel'
      );

      const e = embed.log(guildId, 'Antichannel déclenché', [
        {
          name   : 'Exécuteur',
          value  : `<@${executorId}> (${entry.executor.tag})`,
          inline : true,
        },
        {
          name   : 'Détection',
          value  : `${threshold} créations en ${Math.floor(windowMs / 1000)}s`,
          inline : true,
        },
        {
          name   : 'Action',
          value  : punishment,
          inline : true,
        },
        {
          name   : 'Salon supprimé',
          value  : `${channel.name} (${channel.id})`,
          inline : false,
        },
      ], {
        thumbnail: entry.executor.displayAvatarURL({ dynamic: true }),
      });

      await logger.send(client, guildId, 'raidlog', e);

    } catch (err) {

      errorHandler.handle(err, {
        source : 'channelCreateGuard',
        guildId,
      });

    }
  },
};

async function _applyPunishment(client, guild, userId, punishment, source) {
  return core.punish(client, guild, userId, punishment, source);
}
