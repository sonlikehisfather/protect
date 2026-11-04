'use strict';

const store    = require('../store');
const ranks    = require('../ranks');
const messages = require('../messages');
const logger   = require('../logger');
const { LEVELS, LEVEL_NAMES } = require('../config');
const { replyWithFooter } = require('../footerReply');

const L = messages.logLabels;
const A = messages.logActions;

module.exports = {
  name          : 'pv',
  description   : 'Rend ton vocal privé ou public. Les intrus sont déconnectés.',
  minRank       : LEVELS.OWNER,
  usage         : '=pv [id_salon]',
  needsBotPerms : ['MoveMembers'],

  async run({ message, args, level, reply }) {
    const guild   = message.guild;
    const actorId = message.author.id;

    let channel = null;

    if (args[0]) {
      if (level < LEVELS.SYS) return reply(messages.pvOwnerNoRemote());

      const id = args[0].replace(/[<#>]/g, '');
      channel = guild.channels.cache.get(id);
      if (!channel || !channel.isVoiceBased()) return reply(messages.pvBadChannel());
    } else {
      channel = message.member.voice?.channel ?? null;
      if (!channel) return reply(messages.needVoice());
    }

    const existing = store.getPvByChannel(guild.id, channel.id);

    if (existing) {
      const ownerLevel = ranks.getLevel(guild.id, existing.ownerId);

      if (level < ownerLevel && existing.ownerId !== actorId) {
        logger.send(guild, 'pv', {
          title  : `PV · ${A.pvRefused}`,
          fields : [
            [L.executor, logger.user(actorId)],
            [L.channel,  logger.channel(channel.id)],
            [L.reason,   messages.logPvRefused(existing.ownerId, LEVEL_NAMES[ownerLevel])],
          ],
        });
        return reply(messages.pvLockedByHigher(ownerLevel));
      }

      store.removePv(guild.id, channel.id);
      logger.send(guild, 'pv', {
        title  : `PV · ${A.pvOff}`,
        fields : [[L.executor, logger.user(actorId)], [L.channel, logger.channel(channel.id)]],
      });
      return reply(messages.pvOff(channel.id));
    }

    const own = store.getPvByOwner(guild.id, actorId);
    if (own) return reply(messages.pvAlready(own.channelId));

    store.setPv(guild.id, channel.id, actorId, level);
    logger.send(guild, 'pv', {
      title  : `PV · ${A.pvOn}`,
      fields : [[L.executor, logger.user(actorId)], [L.channel, logger.channel(channel.id)]],
    });

    return replyWithFooter(
      message,
      'pv',
      messages.pvOnHeadline(channel.id, actorId),
      messages.pvOnFooter()
    );
  },
};
