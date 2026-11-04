'use strict';

const store    = require('../store');
const messages = require('../messages');
const { LEVELS } = require('../config');
const { resolveMember } = require('../target');

module.exports = {
  name    : 'wlmv',
  description : "Autorise un membre à te déplacer avec =mv.",
  minRank : LEVELS.SYS,
  usage   : '=wlmv <@membre|id>',

  async run({ message, args, reply }) {
    const guildId = message.guild.id;
    const ownerId = message.author.id;

    if (!args[0]) return reply(messages.usage('=wlmv <@membre|id>'));

    const member = await resolveMember(message, args[0]);
    if (!member) return reply(messages.targetNotFound());
    if (member.user.bot) return reply(messages.targetIsBot());
    if (member.id === ownerId) return reply(messages.targetIsSelf());

    if (store.hasWlmv(guildId, ownerId, member.id)) {
      store.removeWlmv(guildId, ownerId, member.id);
      return reply(messages.wlmvRemoved(member.id));
    }

    store.addWlmv(guildId, ownerId, member.id);
    return reply(messages.wlmvAdded(member.id));
  },
};
