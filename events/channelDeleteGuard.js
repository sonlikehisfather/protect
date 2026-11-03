'use strict';


const { AuditLogEvent } = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const perms        = require('../utils/permissions');
const errorHandler = require('../utils/errorHandler');
const core         = require('../utils/antiraidCore');

const channelDeleteMap = new Map();


const AUDIT_WAIT_MS    = 1000;
const AUDIT_MAX_AGE_MS = 8000;

module.exports = {
  name: 'channelDelete',
  once: false,

  async execute(client, channel) {

    const guild = channel.guild;
    if (!guild) return;

    const guildId = guild.id;

    try {

      const config      = db.getAntiraidConfig(guildId);
      const guildConfig = db.getGuildConfig(guildId);

      if (!guildConfig?.antiraidEnabled || !config?.antichannelEnabled)
        return;

      const entry = await core.findAuditEntry(guild, AuditLogEvent.ChannelDelete, channel.id);
      if (!entry?.executor) return;
      const now = Date.now();

      const executorId = entry.executor.id;

      if (executorId === client.user.id)
        return;

      const executorMember =
        guild.members.cache.get(executorId) ??
        await guild.members.fetch(executorId).catch(() => null);

      if (core.isExempt(executorId, guildId, executorMember))
        return;

      const threshold = Math.max(1, config.antichannelThreshold ?? 3);
      const windowMs  = Math.max(1000, (config.antichannelWindow ?? 10) * 1000);

      const result = core.hit(
        `chdel_${guildId}_${executorId}`, threshold, windowMs, core.snapshotChannel(channel)
      );
      if (!result.triggered) return;

      const punishment =
        config.antichannelPunish ?? 'derank';

      await _applyPunishment(
        client,
        guild,
        executorId,
        punishment,
        'antichannel-delete'
      );

      let restored = 0;
      if (config.antichannelRestore) {
        const snaps = [...result.items].sort((a, b) => (a.type === 4 ? -1 : 0) - (b.type === 4 ? -1 : 0));
        const idMap = new Map();   // ancien ID -> nouvel ID (pour rattacher les salons à leur catégorie recréée)
        for (const snap of snaps) {
          if (await core.restoreChannel(guild, snap, idMap)) restored++;
        }
      }

      const e = embed.log(
        guildId,
        'Antichannel suppression déclenchée',
        [
          {
            name   : 'Exécuteur',
            value  : `<@${executorId}> (${entry.executor.tag})`,
            inline : true,
          },
          {
            name   : 'Détection',
            value  : `${threshold} suppressions en ${Math.floor(windowMs / 1000)}s`,
            inline : true,
          },
          {
            name   : 'Salon supprimé',
            value  : `${channel.name} (${channel.id})`,
            inline : false,
          },
          {
            name   : 'Action',
            value  : punishment,
            inline : true,
          },
          {
            name   : 'Salons recréés (restauration)',
            value  : config.antichannelRestore ? `${restored}` : 'option désactivée',
            inline : true,
          },
        ],
        {
          thumbnail:
            entry.executor.displayAvatarURL({ dynamic: true }),
        }
      );

      await logger.send(
        client,
        guildId,
        'raidlog',
        e
      );

    } catch (err) {

      errorHandler.handle(err, {
        source : 'channelDeleteGuard',
        guildId,
      });

    }

  },
};

async function _applyPunishment(client, guild, userId, punishment, source) {
  return core.punish(client, guild, userId, punishment, source);
}
