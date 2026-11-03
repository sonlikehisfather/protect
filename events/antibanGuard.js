'use strict';


const { AuditLogEvent } = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const perms        = require('../utils/permissions');
const errorHandler = require('../utils/errorHandler');
const core         = require('../utils/antiraidCore');

const banMap = new Map();


const AUDIT_WAIT_MS    = 1000;
const AUDIT_MAX_AGE_MS = 8000;

module.exports = {
  name : 'antibanGuard',
  once : false,

  async execute(client, ban) {
    const guild   = ban.guild;
    const guildId = guild.id;

    try {
      const config      = db.getAntiraidConfig(guildId);
      const guildConfig = db.getGuildConfig(guildId);

      if (!guildConfig?.antiraidEnabled || !config?.antibanEnabled) return;

      const entry = await core.findAuditEntry(guild, AuditLogEvent.MemberBanAdd, ban.user.id);
      if (!entry?.executor) return;
      const now = Date.now();

      const executorId = entry.executor.id;

      if (executorId === client.user.id) return;

      const executorMember =
        guild.members.cache.get(executorId) ??
        await guild.members.fetch(executorId).catch(() => null);

      if (core.isExempt(executorId, guildId, executorMember)) return;

      const threshold = Math.max(1, config.antibanThreshold ?? 3);
      const windowMs  = Math.max(1000, (config.antibanWindow ?? 10) * 1000);

      const result = core.hit(`ban_${guildId}_${executorId}`, threshold, windowMs, ban.user.id);
      if (!result.triggered) return;

      const punishment = config.antibanPunish ?? 'derank';

      await _applyPunishment(client, guild, executorId, punishment, 'antiban');

      let restored = 0;
      if (config.antibanRestore) {
        for (const victimId of new Set(result.items)) {
          const ok = await guild.members.unban(victimId, 'Antiraid - antiban restauration').then(() => true).catch(() => false);
          if (ok) restored++;
        }
        if (restored) core.record(guildId, 'restore', 'antiban', executorId, `${restored} membre(s) débanni(s)`);
      }

      const e = embed.log(guildId, 'Antiban déclenché', [
        {
          name   : 'Exécuteur',
          value  : `<@${executorId}> (${entry.executor.tag})`,
          inline : true,
        },
        {
          name   : 'Détection',
          value  : `${threshold} bans en ${Math.floor(windowMs / 1000)}s`,
          inline : true,
        },
        {
          name   : 'Action',
          value  : punishment,
          inline : true,
        },
        {
          name   : 'Débannis (restauration)',
          value  : config.antibanRestore ? `${restored}` : 'option désactivée',
          inline : true,
        },
        {
          name   : 'Dernière cible',
          value  : `<@${ban.user.id}> (${ban.user.tag}) \`${ban.user.id}\``,
          inline : false,
        },
      ], {
        thumbnail : entry.executor.displayAvatarURL({ dynamic: true }),
      });

      await logger.send(client, guildId, 'raidlog', e);

    } catch (err) {
      errorHandler.handle(err, {
        source : 'antibanGuard',
        guildId,
      });
    }
  },
};

async function _applyPunishment(client, guild, userId, punishment, source) {
  return core.punish(client, guild, userId, punishment, source);
}
