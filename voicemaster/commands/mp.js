'use strict';

const messages = require('../messages');
const logger   = require('../logger');
const { LEVELS } = require('../config');
const { resolveMember } = require('../target');

const MAX_LENGTH = 1800;

/** Traduit une erreur Discord d'envoi de DM en raison lisible. */
function _dmFailureReason(err) {
  switch (err?.code) {
    case 50007: return messages.mpClosed();
    case 50001: return messages.mpNoAccess();
    case 40003: return messages.mpRateLimit();
    default   : return messages.mpUnknown(err?.message);
  }
}

module.exports = {
  name    : 'mp',
  description : "Envoie un message privé à un membre.",
  minRank : LEVELS.OWNER,
  usage   : '=mp <@membre|id> <message>',

  async run({ message, args, reply }) {
    if (args.length < 2) return reply(messages.usage('=mp <@membre|id> <message>'));

    const member = await resolveMember(message, args[0]);
    if (!member) return reply(messages.targetNotFound());
    if (member.user.bot) return reply(messages.targetIsBot());

    /* Le texte est pris tel quel dans le message d'origine, après la cible. */
    const targetIndex = message.content.indexOf(args[0]);
    let text = message.content.slice(targetIndex + args[0].length).trim();
    if (/^".*"$/s.test(text)) text = text.slice(1, -1).trim();

    if (!text) return reply(messages.usage('=mp <@membre|id> <message>'));
    if (text.length > MAX_LENGTH) return reply(messages.mpTooLong(MAX_LENGTH));

    try {
      await member.send({
        content         : `Message de <@${message.author.id}>\n${text}`,
        allowedMentions : { parse: [], users: [message.author.id] },
      });
    } catch (err) {
      return reply(_dmFailureReason(err));
    }

    logger.send(message.guild, 'mp', {
      title  : 'MP',
      fields : [
        [messages.logLabels.executor, logger.user(message.author.id)],
        [messages.logLabels.target,   logger.user(member.id)],
        [messages.logLabels.message,  logger.text(text)],
      ],
    });

    return reply(messages.mpSent(member.id));
  },
};
