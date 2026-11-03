'use strict';

const { AuditLogEvent } = require('discord.js');
const errorHandler = require('../utils/errorHandler');
const { countGuard } = require('../utils/antiraidModules');
const core = require('../utils/antiraidCore');

module.exports = {
  name : 'roleUpdate',
  once : false,

  async execute(client, oldRole, newRole) {
    const guild = newRole.guild;
    try {
      // Seules les modifications de permissions sont surveillées.
      if (oldRole.permissions.bitfield === newRole.permissions.bitfield) return;

      // @everyone est géré par antieveryoneperm quand il est actif : évite une double sanction.
      if (newRole.id === guild.id && core.isEnabled(guild.id, 'antieverypermEnabled')) return;

      const result = await countGuard(client, guild, {
        prefix    : 'antiroles',
        auditType : AuditLogEvent.RoleUpdate,
        targetId  : newRole.id,
        item      : { kind: 'update', roleId: newRole.id, oldPermissions: oldRole.permissions.bitfield.toString() },
        label     : 'Antiroles - modification déclenchée',
        detail    : `Rôle modifié : ${newRole.name} (${newRole.id})`,
      });

      if (result?.cfg.antirolesRestore) {
        for (const it of result.items) {
          if (it?.kind !== 'update') continue;
          const role = guild.roles.cache.get(it.roleId);
          if (role) {
            const ok = await role.setPermissions(BigInt(it.oldPermissions), 'Antiraid - antiroles restauration').then(() => true).catch(() => false);
            if (ok) core.record(guild.id, 'restore', 'antiroles', result.entry.executor.id, `permissions remises : ${role.name}`);
          }
        }
      }
    } catch (err) {
      errorHandler.handle(err, { source: 'antirolesUpdateGuard', guildId: guild.id });
    }
  },
};
