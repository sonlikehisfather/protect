'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const MAX_CONTENT_LENGTH = 2000;

function extractRawSayContent(message, prefix, args) {
  const raw = String(message.content || '').trimStart();
  if (!raw.startsWith(prefix)) {
    return args.join(' ').trim();
  }

  const withoutPrefix = raw.slice(prefix.length);
  const firstWsIndex  = withoutPrefix.search(/\s/);

  if (firstWsIndex === -1) return '';

  return withoutPrefix.slice(firstWsIndex + 1).trim();
}

module.exports = {
  help: {
    name        : 'say',
    description : 'Fait dire un message au bot.',
    usage       : 'say <message>',
    aliases     : [],
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

    const config      = db.getGuildConfig(guildId);
    const deleteDelay = config?.autoDeleteDelay ?? 5;
    const prefix      = config?.prefix || '+';
    const content     = extractRawSayContent(message, prefix, args);

    if (!content) {
      const sent = await embed.replyError(
        message,
        'Vous devez fournir un message.',
        { timestamp: false }
      ).catch(() => null);

      if (sent) embed.scheduleDelete(sent, deleteDelay);
      return;
    }


    if (content.length > MAX_CONTENT_LENGTH) {
      const sent = await embed.replyError(
        message,
        `Le message est trop long (${content.length}/${MAX_CONTENT_LENGTH} caractères).`,
        { timestamp: false }
      ).catch(() => null);

      if (sent) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    await message.delete().catch(() => {});
    await message.channel.send({
      content,
      allowedMentions: { parse: [] },
    }).catch(() => null);
  },
};
