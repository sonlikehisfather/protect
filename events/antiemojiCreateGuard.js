'use strict';

const { AuditLogEvent } = require('discord.js');
const errorHandler = require('../utils/errorHandler');
const { countGuard } = require('../utils/antiraidModules');

module.exports = {
  name : 'emojiCreate',
  once : false,

  async execute(client, emoji) {
    const guild = emoji.guild;
    try {
      await countGuard(client, guild, {
        prefix    : 'antiemoji',
        auditType : AuditLogEvent.EmojiCreate,
        targetId  : emoji.id,
        item      : emoji.id,
        label     : 'Antiemoji - création déclenchée',
        detail    : `Emoji : ${emoji.name} (${emoji.id})`,
      });
    } catch (err) {
      errorHandler.handle(err, { source: 'antiemojiCreateGuard', guildId: guild.id });
    }
  },
};
