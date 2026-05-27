'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name        : 'autopublish',
  description : 'Activer ou désactiver la publication automatique des annonces.',
  usage       : 'autopublish <on|off>',
};

exports.run = async (client, message, args) => {

  if (!perms.check(message, exports.help.name)) return;

  const guildId = message.guild.id;
  const config  = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const state = args[0]?.toLowerCase();

  if (!state) {
    return _error(
      message,
      deleteReply,
      deleteDelay,
      'Utilisez `autopublish on` ou `autopublish off`.'
    );
  }

  if (!['on', 'off'].includes(state)) {
    return _error(
      message,
      deleteReply,
      deleteDelay,
      'Valeur invalide. Utilisez `on` ou `off`.'
    );
  }

  const enabled = state === 'on' ? 1 : 0;

  if (Number(config?.autopublishEnabled) === enabled) {

    return _error(
      message,
      deleteReply,
      deleteDelay,
      enabled
        ? 'La publication automatique est déjà activée.'
        : 'La publication automatique est déjà désactivée.'
    );
  }

  db.setGuildConfig(
    guildId,
    'autopublishEnabled',
    enabled
  );

  return _success(
    message,
    deleteReply,
    deleteDelay,
    enabled
      ? 'Publication automatique activée.'
      : 'Publication automatique désactivée.'
  );
};


async function _error(message, deleteReply, deleteDelay, text) {

  const sent = await embed.replyError(
    message,
    text
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }

}

async function _success(message, deleteReply, deleteDelay, text) {

  const sent = await embed.reply(
    message,
    text
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }

}
