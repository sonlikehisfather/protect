'use strict';

/**
 * VoiceMaster - fabrique des commandes bascule de rang (=ow, =sys, =sys+).
 * Règles :
 *  - sys+ : seul le principal peut l'ajouter ou le retirer
 *  - sys, owner : Sys+ et plus
 *  - un Sys+ ne peut pas être modifié par un autre qu'un principal
 *  - le principal n'est jamais modifiable
 *  - sans argument : liste paginée des membres du rang
 */

const store    = require('./store');
const ranks    = require('./ranks');
const messages = require('./messages');
const logger   = require('./logger');
const { LEVELS, LEVEL_NAMES, STORED_RANKS } = require('./config');
const { resolveMember } = require('./target');
const { sendRankList }  = require('./rankList');

function createRankToggle({ name, rank, minRank, description }) {
  const label = LEVEL_NAMES[STORED_RANKS[rank]];

  return {
    name,
    description,
    minRank,
    usage: `=${name} [@membre|id]`,

    async run({ message, args, reply }) {
      const guildId = message.guild.id;
      const actorId = message.author.id;

      if (!args[0]) {
        const ids = rank === 'sys+'
          ? store.listSysPlus()
          : store.listStoredRank(guildId, rank);
        return sendRankList(message, `Liste · ${label} Voicemaster`, ids);
      }

      const member = await resolveMember(message, args[0]);
      if (!member) return reply(messages.targetNotFound());
      if (member.user.bot) return reply(messages.targetIsBot());

      const targetId = member.id;

      if (ranks.isPrincipal(targetId)) return reply(messages.principalLocked());

      if (!ranks.canGrantStoredRank(guildId, actorId, rank)) {
        return reply(messages.noRank());
      }

      /* Sys+ : rang global, géré à part des rangs par serveur. */
      if (rank === 'sys+') {
        if (store.isSysPlus(targetId)) {
          store.removeSysPlus(targetId);
          return reply(messages.rankRemoved(member.id, label));
        }
        store.addSysPlus(targetId);
        return reply(messages.rankAdded(member.id, label));
      }

      if (store.isSysPlus(targetId)) {
        if (!ranks.isPrincipal(actorId)) {
          return reply(messages.cannotEditRank(LEVEL_NAMES[LEVELS.SYS_PLUS]));
        }
        return reply(messages.removeSysPlusFirst());
      }

      const current = store.getStoredRank(guildId, targetId);

      const removing = current === rank;

      if (removing) store.removeStoredRank(guildId, targetId);
      else store.setStoredRank(guildId, targetId, rank);

      logger.send(message.guild, name, {
        title  : `${name.toUpperCase()} · ${removing ? messages.logActions.remove : messages.logActions.add}`,
        fields : [
          [messages.logLabels.executor, logger.user(actorId)],
          [messages.logLabels.target,   logger.user(targetId)],
        ],
      });

      return reply(removing ? messages.rankRemoved(member.id, label) : messages.rankAdded(member.id, label));
    },
  };
}

module.exports = { createRankToggle };
