'use strict';

const store    = require('../store');
const messages = require('../messages');
const logger   = require('../logger');
const { replyWithFooter } = require('../footerReply');
const { LEVELS } = require('../config');
const { resolveManagedPv } = require('../pvContext');

module.exports = {
  name    : 'all',
  description : "Autorise tous les membres présents dans ton vocal privé.",
  minRank : LEVELS.OWNER,
  usage   : '=all',

  async run({ message, level, reply }) {
    const guild = message.guild;

    const ctx = resolveManagedPv(message, level);
    if (ctx.error) return reply(ctx.error);

    const present = ctx.channel.members.filter(m => !m.user.bot && m.id !== ctx.pv.ownerId);
    if (!present.size) return reply(messages.channelEmpty());

    for (const member of present.values()) {
      store.addAccess(guild.id, ctx.channel.id, member.id);
    }

    logger.send(guild, 'acces', {
      title  : `ACCES · ${messages.logActions.accessAll}`,
      fields : [
        [messages.logLabels.executor, logger.user(message.author.id)],
        [messages.logLabels.channel,  logger.channel(ctx.channel.id)],
        [messages.logLabels.count,    String(present.size)],
      ],
    });

    const headline = messages.allGiven(present.size, ctx.channel.id);
    const total    = messages.allTotal(store.countAccess(guild.id, ctx.channel.id));

    return replyWithFooter(message, 'all', headline, total);
  },
};
