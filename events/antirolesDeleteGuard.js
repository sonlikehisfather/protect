'use strict';

const { AuditLogEvent } = require('discord.js');
const errorHandler = require('../utils/errorHandler');
const { countGuard } = require('../utils/antiraidModules');
const core = require('../utils/antiraidCore');

module.exports = {
  name : 'roleDelete',
  once : false,

  async execute(client, role) {
    const guild = role.guild;
    try {
      const result = await countGuard(client, guild, {
        prefix    : 'antiroles',
        auditType : AuditLogEvent.RoleDelete,
        targetId  : role.id,
        item      : { kind: 'delete', snap: core.snapshotRole(role) },
        label     : 'Antiroles - suppression déclenchée',
        detail    : `Rôle supprimé : ${role.name} (${role.id})`,
      });

      if (result?.cfg.antirolesRestore) {
        for (const it of result.items) {
          if (it?.kind === 'delete') await core.restoreRole(guild, it.snap);
        }
      }
    } catch (err) {
      errorHandler.handle(err, { source: 'antirolesDeleteGuard', guildId: guild.id });
    }
  },
};
