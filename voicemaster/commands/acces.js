'use strict';

const store    = require('../store');
const messages = require('../messages');
const logger   = require('../logger');
const { LEVELS } = require('../config');
const { replyWithFooter }  = require('../footerReply');
const { resolveMember }    = require('../target');
const { resolveManagedPv } = require('../pvContext');

const L = messages.logLabels;
const A = messages.logActions;

module.exports = {
  name        : 'acces',
  description : 'Autorise ou retire l\'accès d\'un membre à ton vocal privé.',
  aliases     : ['accès'],
  minRank     : LEVELS.OWNER,
  usage       : '=acces <@membre|id>',

  async run({ message, args, level, reply }) {
    if (!args[0]) return reply(messages.usage('=acces <@membre|id>'));

    const ctx = resolveManagedPv(message, level);
    if (ctx.error) return reply(ctx.error);

    const member = await resolveMember(message, args[0]);
    if (!member) return reply(messages.targetNotFound());
    if (member.user.bot) return reply(messages.targetIsBot());

    const guild   = message.guild;
    const guildId = guild.id;
    const channelId = ctx.channel.id;

    const hadAccess = store.hasAccess(guildId, channelId, member.id);

    if (hadAccess) store.removeAccess(guildId, channelId, member.id);
    else store.addAccess(guildId, channelId, member.id);

    logger.send(guild, 'acces', {
      title  : `ACCES · ${hadAccess ? A.remove : A.add}`,
      fields : [
        [L.executor, logger.user(message.author.id)],
        [L.target,   logger.user(member.id)],
        [L.channel,  logger.channel(channelId)],
      ],
    });

    return replyWithFooter(
      message,
      'acces',
      hadAccess
        ? messages.accessRemoved(member.id, channelId)
        : messages.accessGiven(member.id, channelId),
      messages.allTotal(store.countAccess(guildId, channelId))
    );
  },
};
