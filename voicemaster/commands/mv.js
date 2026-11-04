'use strict';

const store    = require('../store');
const ranks    = require('../ranks');
const messages = require('../messages');
const logger   = require('../logger');
const { LEVELS } = require('../config');
const { replyWithFooter } = require('../footerReply');
const { resolveMember } = require('../target');

module.exports = {
  name          : 'mv',
  description : "Déplace un membre dans ton vocal.",
  minRank       : LEVELS.OWNER,
  usage         : '=mv <@membre|id>',
  needsVoice    : true,
  needsBotPerms : ['MoveMembers'],

  async run({ message, args, level, reply }) {
    const guild   = message.guild;
    const actorId = message.author.id;

    if (!args[0]) return reply(messages.usage('=mv <@membre|id>'));

    const target = await resolveMember(message, args[0]);
    if (!target) return reply(messages.targetNotFound());
    if (target.user.bot) return reply(messages.targetIsBot());

    const channel = message.member.voice.channel;

    if (!target.voice?.channelId) return reply(messages.targetNotInVoice());
    if (target.voice.channelId === channel.id) return reply(messages.moveAlready(target.id));

    const targetLevel = ranks.getLevel(guild.id, target.id);
    const allowed = store.hasWlmv(guild.id, target.id, actorId);
    if (targetLevel > level && !allowed) return reply(messages.moveHigherRank(targetLevel));

    /* Si le salon est pv, la cible reçoit l'accès (sinon le bot la déconnecterait). */
    const pv = store.getPvByChannel(guild.id, channel.id);
    if (pv) {
      const ownerLevel = ranks.getLevel(guild.id, pv.ownerId);
      if (pv.ownerId !== actorId && level < ownerLevel) {
        return reply(messages.pvHigherRank(ownerLevel));
      }
      store.addAccess(guild.id, channel.id, target.id);
    }

    const fromId = target.voice.channelId;

    try {
      await target.voice.setChannel(channel, `VoiceMaster : =mv par ${actorId}`);
    } catch {
      return reply(messages.moveFailed());
    }

    logger.send(guild, 'mv', {
      title  : 'MV',
      fields : [
        [messages.logLabels.executor, logger.user(actorId)],
        [messages.logLabels.target,   logger.user(target.id)],
        [messages.logLabels.from,     logger.channel(fromId)],
        [messages.logLabels.channel,  logger.channel(channel.id)],
      ],
    });

    return replyWithFooter(
      message,
      'mv',
      messages.moveHeadline(target.id, fromId, channel.id),
      messages.moveBy(actorId)
    );
  },
};
