'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name        : 'prefix',
  description : 'Changer le préfixe du bot sur le serveur.',
  usage       : 'prefix <préfixe>',
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

  const newPrefix = args[0]?.trim();

  if (!newPrefix) {
    const sent = await embed.replyError(
      message,
      'Précisez un nouveau préfixe.\nExemple : `prefix !`'
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (newPrefix.length > 5) {
    const sent = await embed.replyError(
      message,
      'Le préfixe ne peut pas dépasser **5** caractères.'
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }


  if (/[\s@#`]/.test(newPrefix)) {
    const sent = await embed.replyError(
      message,
      'Le préfixe ne peut pas contenir d\'espaces, `@`, `#` ou `` ` ``.'
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }


  if (newPrefix === config?.prefix) {
    const sent = await embed.replyError(
      message,
      `Le préfixe \`${newPrefix}\` est déjà utilisé sur ce serveur.`
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  db.setGuildConfig(guildId, 'prefix', newPrefix);

  const sent = await embed.reply(
    message,
    `Préfixe du serveur défini sur \`${newPrefix}\`.`
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};
