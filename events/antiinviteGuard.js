'use strict';

const { AuditLogEvent } = require('discord.js');
const errorHandler = require('../utils/errorHandler');
const { countGuard } = require('../utils/antiraidModules');
const core = require('../utils/antiraidCore');

module.exports = {
  name : 'inviteCreate',
  once : false,

  async execute(client, invite) {
    const guild = invite.guild?.id ? client.guilds.cache.get(invite.guild.id) : null;
    if (!guild) return;

    _handle(client, guild, invite).catch(err =>
      errorHandler.handle(err, { source: 'antiinviteGuard', guildId: guild.id })
    );
  },
};

async function _handle(client, guild, invite) {
  if (!core.isEnabled(guild.id, 'antiinviteEnabled')) return;

  // Une invitation créée par le bot (ex : bouton "Créer une invitation") est ignorée par countGuard.
  const result = await countGuard(client, guild, {
    prefix    : 'antiinvite',
    auditType : AuditLogEvent.InviteCreate,
    targetId  : null,
    item      : invite.code,
    label     : 'Antiinvite déclenché',
    detail    : `Dernière invitation : discord.gg/${invite.code}`,
  });

  if (!result?.cfg.antiinviteRestore) return;

  let deleted = 0;
  for (const code of new Set(result.items)) {
    if (await guild.invites.delete(code, 'Antiraid - antiinvite restauration').then(() => true).catch(() => false)) deleted++;
  }
  if (deleted) core.record(guild.id, 'restore', 'antiinvite', result.entry.executor.id, `${deleted} invitation(s) supprimée(s)`);
}
