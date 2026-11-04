'use strict';

const store    = require('../store');
const ranks    = require('../ranks');
const messages = require('../messages');
const logger   = require('../logger');
const { LEVELS } = require('../config');
const { resolveMember } = require('../target');

module.exports = {
  name          : 'menotte',
  description : "Menotte un membre dans un vocal, ou le libère.",
  minRank       : LEVELS.SYS,
  usage         : '=menotte <@membre|id> [id_salon]',
  needsBotPerms : ['MoveMembers'],

  async run({ message, args, level, reply }) {
    const guild   = message.guild;
    const actorId = message.author.id;

    if (!args[0]) return reply(messages.usage('=menotte <@membre|id> [id_salon]'));

    const member = await resolveMember(message, args[0]);
    if (!member) return reply(messages.targetNotFound());
    if (member.user.bot) return reply(messages.targetIsBot());
    if (member.id === actorId) return reply(messages.targetIsSelf());

    const existing = store.getCuff(guild.id, member.id);

    /* Sans salon : libère le membre menotté. */
    if (!args[1]) {
      if (!existing) return reply(messages.cuffNotCuffed(member.id));

      const cufferLevel = ranks.getLevel(guild.id, existing.byId);
      if (existing.byId !== actorId && level < cufferLevel) {
        return reply(messages.cuffReleaseDenied(existing.byId));
      }

      store.removeCuff(guild.id, member.id);
      logger.send(guild, 'menotte', {
        title  : `MENOTTE · ${messages.logActions.cuffOff}`,
        fields : [
          [messages.logLabels.executor, logger.user(actorId)],
          [messages.logLabels.target,   logger.user(member.id)],
          [messages.logLabels.channel,  logger.channel(existing.channelId)],
        ],
      });
      return reply(messages.cuffReleased(member.id));
    }

    const channelId = args[1].replace(/[<#>]/g, '');
    const channel   = guild.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) return reply(messages.pvBadChannel());

    if (existing) return reply(messages.cuffAlreadyCuffed(member.id, existing.byId));

    const own = store.getCuffByCuffer(guild.id, actorId);
    if (own) return reply(messages.cuffLimit(own.userId));

    const targetLevel = ranks.getLevel(guild.id, member.id);
    if (targetLevel >= level) return reply(messages.cuffHigherRank(targetLevel));

    store.setCuff(guild.id, member.id, channel.id, actorId);

    /* Déjà connecté ailleurs : le bot le ramène tout de suite. */
    if (member.voice?.channelId && member.voice.channelId !== channel.id) {
      await member.voice.setChannel(channel, `VoiceMaster : menotte par ${actorId}`).catch(() => {});
    }

    logger.send(guild, 'menotte', {
      title  : `MENOTTE · ${messages.logActions.cuffOn}`,
      fields : [
        [messages.logLabels.executor, logger.user(actorId)],
        [messages.logLabels.target,   logger.user(member.id)],
        [messages.logLabels.channel,  logger.channel(channel.id)],
      ],
    });

    return reply(messages.cuffSet(member.id, channel.id));
  },
};
