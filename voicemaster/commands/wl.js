'use strict';

const store    = require('../store');
const messages = require('../messages');
const logger   = require('../logger');
const { LEVELS } = require('../config');
const { resolveMember } = require('../target');

module.exports = {
  name    : 'wl',
  description : "Ajoute ou retire un membre de la whitelist Voicemaster (accès à =ui et =vc).",
  minRank : LEVELS.OWNER,
  usage   : '=wl <@membre|id>',

  async run({ message, args, reply }) {
    const guildId = message.guild.id;

    if (!args[0]) return reply(messages.usage('=wl <@membre|id>'));

    const member = await resolveMember(message, args[0]);
    if (!member) return reply(messages.targetNotFound());
    if (member.user.bot) return reply(messages.targetIsBot());

    const wasWl = store.isWl(guildId, member.id);

    if (wasWl) store.removeWl(guildId, member.id);
    else store.addWl(guildId, member.id);

    logger.send(message.guild, 'wl', {
      title  : `WL · ${wasWl ? messages.logActions.remove : messages.logActions.add}`,
      fields : [
        [messages.logLabels.executor, logger.user(message.author.id)],
        [messages.logLabels.target,   logger.user(member.id)],
      ],
    });

    return reply(wasWl ? messages.wlRemoved(member.id) : messages.wlAdded(member.id));
  },
};
