'use strict';

const store    = require('../store');
const messages = require('../messages');
const logger   = require('../logger');
const { LEVELS } = require('../config');
const { resolveMember } = require('../target');

module.exports = {
  name          : 'follow',
  description : "Te déplace automatiquement avec la personne suivie.",
  minRank       : LEVELS.SYS,
  usage         : '=follow <@membre|id>',
  needsBotPerms : ['MoveMembers'],

  async run({ message, args, reply }) {
    const guildId    = message.guild.id;
    const followerId = message.author.id;

    if (!args[0]) return reply(messages.usage('=follow <@membre|id>'));

    const member = await resolveMember(message, args[0]);
    if (!member) return reply(messages.targetNotFound());
    if (member.user.bot) return reply(messages.targetIsBot());
    if (member.id === followerId) return reply(messages.targetIsSelf());

    const current = store.getFollow(guildId, followerId);

    if (current) {
      /* Même cible : le follow s'arrête. Autre cible : on suit déjà quelqu'un. */
      if (current.targetId === member.id) {
        store.removeFollow(guildId, followerId);
        logger.send(message.guild, 'follow', {
          title  : `FOLLOW · ${messages.logActions.followOff}`,
          fields : [
            [messages.logLabels.executor, logger.user(followerId)],
            [messages.logLabels.target,   logger.user(member.id)],
          ],
        });
        return reply(messages.followStopped(member.id));
      }

      return reply(messages.followAlready(current.targetId));
    }

    store.setFollow(guildId, followerId, member.id);

    /* Les deux en vocal, dans des salons différents : le bot te rejoint tout de suite. */
    const targetChannelId = member.voice?.channelId;
    const myVoice = message.member.voice;
    if (targetChannelId && myVoice?.channelId && myVoice.channelId !== targetChannelId) {
      await myVoice.setChannel(targetChannelId, 'VoiceMaster : follow').catch(() => {});
    }

    logger.send(message.guild, 'follow', {
      title  : `FOLLOW · ${messages.logActions.followOn}`,
      fields : [
        [messages.logLabels.executor, logger.user(followerId)],
        [messages.logLabels.target,   logger.user(member.id)],
      ],
    });

    return reply(messages.followStarted(member.id));
  },
};
