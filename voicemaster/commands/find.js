'use strict';

const messages = require('../messages');
const embed    = require('../../utils/embed');
const { LEVELS } = require('../config');
const { resolveMember } = require('../target');

module.exports = {
  name    : 'find',
  description : "Indique dans quel vocal se trouve un membre.",
  minRank : LEVELS.OWNER,
  usage   : '=find <@membre|id>',

  async run({ message, args, reply }) {
    if (!args[0]) return reply(messages.usage('=find <@membre|id>'));

    const member = await resolveMember(message, args[0]);
    if (!member) return reply(messages.targetNotFound());

    const channel = member.voice?.channel ?? null;

    const text = channel
      ? messages.findLocated(member.id, channel.id)
      : messages.findAbsent(member.id);

    return embed.reply(message, text, { timestamp: false });
  },
};
