'use strict';

const { AuditLogEvent } = require('discord.js');
const errorHandler = require('../utils/errorHandler');
const { countGuard } = require('../utils/antiraidModules');

module.exports = {
  name : 'guildMemberRemove',
  once : false,

  async execute(client, member) {
    const guild = member.guild;
    try {
      // Un prune retire beaucoup de membres : une seule sanction par entrée d'audit (dedupeByEntry).
      await countGuard(client, guild, {
        prefix    : 'antiprune',
        auditType : AuditLogEvent.MemberPrune,
        targetId  : null,
        dedupeByEntry : true,
        label     : 'Antiprune déclenché',
        detail    : 'Prune de membres détecté.',
      });
    } catch (err) {
      errorHandler.handle(err, { source: 'antipruneGuard', guildId: guild.id });
    }
  },
};
