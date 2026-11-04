'use strict';

const store    = require('../store');
const messages = require('../messages');
const embed    = require('../../utils/embed');
const { LEVELS } = require('../config');

const MAX_LISTED = 100;

module.exports = {
  name    : 'pvinfo',
  description : "Affiche le propriétaire et les accès d'un salon privé.",
  minRank : LEVELS.OWNER,
  usage   : '=pvinfo <id_salon|#salon>',

  async run({ message, args, reply }) {
    const guild = message.guild;

    if (!args[0]) return reply(messages.usage('=pvinfo <id_salon|#salon>'));

    const channelId = args[0].replace(/[<#>]/g, '');
    const channel   = guild.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) return reply(messages.pvBadChannel());

    const pv = store.getPvByChannel(guild.id, channel.id);
    if (!pv) return reply(messages.notPv());

    const access  = store.listAccess(guild.id, channel.id);
    const listed  = access.slice(0, MAX_LISTED).map(id => `<@${id}>`);
    const hidden  = access.length - listed.length;

    const text = [
      messages.pvInfoChannel(channel.id),
      messages.pvInfoOwner(pv.ownerId),
      messages.pvInfoAccess(listed, access.length, hidden),
    ].join('\n');

    return embed.reply(message, text, {
      title     : messages.pvInfoTitle(),
      timestamp : false,
    });
  },
};
