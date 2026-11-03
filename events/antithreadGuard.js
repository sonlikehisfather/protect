'use strict';

const { AuditLogEvent } = require('discord.js');
const errorHandler = require('../utils/errorHandler');
const { countGuard } = require('../utils/antiraidModules');
const core = require('../utils/antiraidCore');

module.exports = {
  name : 'threadCreate',
  once : false,

  async execute(client, thread, newlyCreated) {
    if (newlyCreated === false) return;   // thread rejoint, pas créé
    const guild = thread.guild;
    if (!guild) return;

    _handle(client, guild, thread).catch(err =>
      errorHandler.handle(err, { source: 'antithreadGuard', guildId: guild.id })
    );
  },
};

async function _handle(client, guild, thread) {
  if (!core.isEnabled(guild.id, 'antithreadEnabled')) return;

  const result = await countGuard(client, guild, {
    prefix    : 'antithread',
    auditType : AuditLogEvent.ThreadCreate,
    targetId  : thread.id,
    item      : thread.id,
    label     : 'Antithread déclenché',
    detail    : `Dernier fil : ${thread.name} (${thread.id})`,
  });

  if (!result?.cfg.antithreadRestore) return;

  let deleted = 0;
  for (const threadId of new Set(result.items)) {
    const t = guild.channels.cache.get(threadId) ?? await guild.channels.fetch(threadId).catch(() => null);
    if (t && await t.delete('Antiraid - antithread restauration').then(() => true).catch(() => false)) deleted++;
  }
  if (deleted) core.record(guild.id, 'restore', 'antithread', result.entry.executor.id, `${deleted} fil(s) supprimé(s)`);
}
