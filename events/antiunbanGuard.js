'use strict';


const { AuditLogEvent } = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const perms        = require('../utils/permissions');
const errorHandler = require('../utils/errorHandler');
const core         = require('../utils/antiraidCore');

const unbanMap = new Map();


const AUDIT_WAIT_MS    = 1000;
const AUDIT_MAX_AGE_MS = 8000;
const DEDUPE_MS        = 5000;

module.exports = {
  name : 'guildBanRemove',
  once : false,

  async execute(client, ban) {
    const guild   = ban.guild;
    const guildId = guild.id;

    try {
      const config      = db.getAntiraidConfig(guildId);
      const guildConfig = db.getGuildConfig(guildId);

      if (!guildConfig?.antiraidEnabled || !config?.antiunbanEnabled) return;

      const entry = await core.findAuditEntry(guild, AuditLogEvent.MemberBanRemove, ban.user.id);
      if (!entry?.executor) return;
      const now = Date.now();

      const executorId = entry.executor.id;

      if (executorId === client.user.id) return;

      const executorMember =
        guild.members.cache.get(executorId) ??
        await guild.members.fetch(executorId).catch(() => null);

      if (core.isExempt(executorId, guildId, executorMember)) return;

      const key     = `${guildId}_${executorId}_${ban.user.id}`;
      const lastHit = unbanMap.get(key);

      if (lastHit && now - lastHit < DEDUPE_MS) {
        return;
      }

      unbanMap.set(key, now);

      setTimeout(() => {
        const state = unbanMap.get(key);
        if (state !== now) return;
        unbanMap.delete(key);
      }, DEDUPE_MS + 1000);

      const punishment = config.antiunbanPunish ?? 'derank';

      await _applyPunishment(client, guild, executorId, punishment, 'antiunban');

      let rebanned = false;
      if (config.antiunbanRestore) {
        rebanned = await guild.members.ban(ban.user.id, { reason: 'Antiraid - antiunban restauration' })
          .then(() => true).catch(() => false);
        if (rebanned) core.record(guildId, 'restore', 'antiunban', executorId, `rebanni : ${ban.user.id}`);
      }

      const e = embed.log(guildId, 'Antiunban déclenché', [
        {
          name   : 'Exécuteur',
          value  : `<@${executorId}> (${entry.executor.tag})`,
          inline : true,
        },
        {
          name   : 'Cible débannie',
          value  : `<@${ban.user.id}> (${ban.user.tag}) \`${ban.user.id}\``,
          inline : false,
        },
        {
          name   : 'Rebanni (restauration)',
          value  : config.antiunbanRestore ? (rebanned ? 'oui' : 'échec') : 'option désactivée',
          inline : true,
        },
        {
          name   : 'Action',
          value  : punishment,
          inline : true,
        },
      ], {
        thumbnail : entry.executor.displayAvatarURL({ dynamic: true }),
      });

      await logger.send(client, guildId, 'raidlog', e);

    } catch (err) {
      errorHandler.handle(err, {
        source : 'antiunbanGuard',
        guildId,
      });
    }
  },
};

async function _applyPunishment(client, guild, userId, punishment, source) {
  return core.punish(client, guild, userId, punishment, source);
}
