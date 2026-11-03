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
      await countGuard(client, guild, {
        prefix    : 'antikick',
        auditType : AuditLogEvent.MemberKick,
        targetId  : member.id,
        item      : member.id,
        label     : 'Antikick déclenché',
        detail    : `Dernière cible : <@${member.id}> (${member.id})`,
      });
    } catch (err) {
      errorHandler.handle(err, { source: 'antikickGuard', guildId: guild.id });
    }
  },
};
