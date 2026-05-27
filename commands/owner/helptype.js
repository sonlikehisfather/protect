'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const TYPES = ['button', 'select', 'hybrid'];

module.exports = {
  help: {
    name        : 'helptype',
    description : 'Change le mode de navigation du menu help.',
    use         : 'helptype <button/select/hybrid>',
    usage       : 'helptype <button/select/hybrid>',
    aliases     : ['helpstyle'],
    category    : 'owner',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const type = args[0]?.toLowerCase();

    if (!type) {
      const current = TYPES.includes(config?.helpType)
        ? config.helpType
        : 'hybrid';

      return _reply(
        message,
        `Mode actuel du help : \`${current}\`.\nModes disponibles : \`button\`, \`select\`, \`hybrid\`.`,
        deleteReply,
        deleteDelay
      );
    }

    if (!TYPES.includes(type)) {
      return _error(
        message,
        `Type invalide. Utilisation : \`${message.prefix || '+'}helptype <button/select/hybrid>\``,
        deleteReply,
        deleteDelay
      );
    }

    db.setGuildConfig(guildId, 'helpType', type);

    return _reply(
      message,
      `Mode de navigation du help défini sur \`${type}\`.`,
      deleteReply,
      deleteDelay
    );
  },
};

async function _reply(message, content, deleteReply, deleteDelay) {
  const sent = await embed.reply(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _error(message, content, deleteReply, deleteDelay) {
  const sent = await embed.replyError(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
