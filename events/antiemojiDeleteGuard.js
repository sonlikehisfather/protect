'use strict';

const { AuditLogEvent } = require('discord.js');
const errorHandler = require('../utils/errorHandler');
const { countGuard } = require('../utils/antiraidModules');

module.exports = {
  name : 'emojiDelete',
  once : false,

  async execute(client, emoji) {
    const guild = emoji.guild;
    try {
      await countGuard(client, guild, {
        prefix    : 'antiemoji',
        auditType : AuditLogEvent.EmojiDelete,
        targetId  : emoji.id,
        item      : emoji.id,
        label     : 'Antiemoji - suppression déclenchée',
        detail    : `Emoji : ${emoji.name} (${emoji.id})`,
      });
    } catch (err) {
      errorHandler.handle(err, { source: 'antiemojiDeleteGuard', guildId: guild.id });
    }
  },
};
