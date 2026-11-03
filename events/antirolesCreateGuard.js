'use strict';

const { AuditLogEvent } = require('discord.js');
const errorHandler = require('../utils/errorHandler');
const { countGuard } = require('../utils/antiraidModules');
const core = require('../utils/antiraidCore');

module.exports = {
  name : 'roleCreate',
  once : false,

  async execute(client, role) {
    const guild = role.guild;
    try {
      const result = await countGuard(client, guild, {
        prefix    : 'antiroles',
        auditType : AuditLogEvent.RoleCreate,
        targetId  : role.id,
        item      : { kind: 'create', roleId: role.id },
        label     : 'Antiroles - création déclenchée',
        detail    : `Rôle créé : ${role.name} (${role.id})`,
      });

      // Option restauration : on supprime les rôles créés pendant la rafale.
      if (result?.cfg.antirolesRestore) {
        for (const it of result.items) {
          if (it?.kind === 'create') {
            const ok = await guild.roles.delete(it.roleId, 'Antiraid - antiroles restauration').then(() => true).catch(() => false);
            if (ok) core.record(guild.id, 'restore', 'antiroles', result.entry.executor.id, `rôle créé supprimé : ${it.roleId}`);
          }
        }
      }
    } catch (err) {
      errorHandler.handle(err, { source: 'antirolesCreateGuard', guildId: guild.id });
    }
  },
};
