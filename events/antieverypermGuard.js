'use strict';

const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const errorHandler = require('../utils/errorHandler');
const { countGuard } = require('../utils/antiraidModules');
const core = require('../utils/antiraidCore');

// Permissions qu'@everyone ne doit jamais recevoir.
const DANGEROUS = [
  ['Administrator',     PermissionFlagsBits.Administrator],
  ['ManageGuild',       PermissionFlagsBits.ManageGuild],
  ['ManageRoles',       PermissionFlagsBits.ManageRoles],
  ['ManageChannels',    PermissionFlagsBits.ManageChannels],
  ['ManageWebhooks',    PermissionFlagsBits.ManageWebhooks],
  ['BanMembers',        PermissionFlagsBits.BanMembers],
  ['KickMembers',       PermissionFlagsBits.KickMembers],
  ['MentionEveryone',   PermissionFlagsBits.MentionEveryone],
  ['ModerateMembers',   PermissionFlagsBits.ModerateMembers],
  ['ManageMessages',    PermissionFlagsBits.ManageMessages],
  ['ManageNicknames',   PermissionFlagsBits.ManageNicknames],
  ['ManageEvents',      PermissionFlagsBits.ManageEvents],
];

module.exports = {
  name : 'roleUpdate',
  once : false,

  async execute(client, oldRole, newRole) {
    const guild = newRole.guild;
    if (newRole.id !== guild.id) return;   // uniquement @everyone

    const added = DANGEROUS.filter(([, flag]) =>
      newRole.permissions.has(flag, false) && !oldRole.permissions.has(flag, false)
    );
    if (!added.length) return;

    _handle(client, guild, oldRole, newRole, added).catch(err =>
      errorHandler.handle(err, { source: 'antieverypermGuard', guildId: guild.id })
    );
  },
};

async function _handle(client, guild, oldRole, newRole, added) {
  if (!core.isEnabled(guild.id, 'antieverypermEnabled')) return;

  const result = await countGuard(client, guild, {
    prefix    : 'antieveryperm',
    auditType : AuditLogEvent.RoleUpdate,
    targetId  : newRole.id,
    label     : 'Antieveryoneperm déclenché',
    detail    : `Permissions ajoutées à @everyone : ${added.map(([n]) => n).join(', ')}`,
  });

  if (!result?.cfg.antieverypermRestore) return;

  // On retire uniquement les permissions dangereuses ajoutées (les autres changements restent).
  let perms = newRole.permissions;
  for (const [, flag] of added) perms = perms.remove(flag);
  const ok = await newRole.setPermissions(perms, 'Antiraid - antieveryoneperm restauration').then(() => true).catch(() => false);
  if (ok) core.record(guild.id, 'restore', 'antieveryperm', result.entry.executor.id, `permissions retirées : ${added.map(([n]) => n).join(', ')}`);
}
