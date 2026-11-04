'use strict';

const store    = require('../store');
const ranks    = require('../ranks');
const messages = require('../messages');
const logger   = require('../logger');
const { LEVELS } = require('../config');
const { resolveMember } = require('../target');

const L = messages.logLabels;

module.exports = {
  name          : 'join',
  description   : "Te déplace dans un vocal ou auprès d'un membre (refusé si privé par un rang supérieur).",
  minRank       : LEVELS.OWNER,
  usage         : '=join <@membre|id_membre|id_salon>',
  needsVoice    : true,
  needsBotPerms : ['MoveMembers'],

  async run({ message, args, level, reply }) {
    const guild   = message.guild;
    const actorId = message.author.id;

    if (!args[0]) return reply(messages.usage('=join <@membre|id_membre|id_salon>'));

    const raw       = args[0];
    const cleaned   = raw.replace(/[<@!#>]/g, '');
    const isMention = /^<@!?\d+>$/.test(raw);

    let channel = null;
    let target  = null;

    /* Un ID de salon vocal prime ; sinon la cible est un membre (mention ou ID). */
    const byId = !isMention ? guild.channels.cache.get(cleaned) : null;

    if (byId) {
      if (!byId.isVoiceBased()) return reply(messages.pvBadChannel());
      channel = byId;
    } else {
      target = await resolveMember(message, raw);
      if (!target) return reply(messages.joinNotFound());
      if (target.id === actorId) return reply(messages.targetIsSelf());
      if (!target.voice?.channelId) return reply(messages.targetNotInVoice());
      channel = target.voice.channel;
    }

    if (message.member.voice.channelId === channel.id) return reply(messages.joinAlready());

    const pv = store.getPvByChannel(guild.id, channel.id);
    if (pv) {
      const ownerLevel = ranks.getLevel(guild.id, pv.ownerId);
      if (level < ownerLevel) return reply(messages.joinHigherPv(ownerLevel));
    }

    const fromId = message.member.voice.channelId;

    try {
      await message.member.voice.setChannel(channel, 'VoiceMaster : =join');
    } catch {
      return reply(messages.joinFailed());
    }

    const fields = [[L.executor, logger.user(actorId)]];
    if (target) fields.push([L.target, logger.user(target.id)]);
    fields.push([L.from, logger.channel(fromId)], [L.to, logger.channel(channel.id)]);
    logger.send(guild, 'join', { title: 'JOIN', fields });

    return reply(messages.joinDone(fromId, channel.id));
  },
};
