'use strict';

const { ChannelType } = require('discord.js');

const store    = require('../store');
const ranks    = require('../ranks');
const messages = require('../messages');
const logger   = require('../logger');
const { LEVELS } = require('../config');
const { replyWithFooter } = require('../footerReply');

const L = messages.logLabels;

/** Mélange de Fisher-Yates (copie, ne modifie pas le tableau d'origine). */
function _shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

module.exports = {
  name          : 'bringcc',
  description   : "Répartit au hasard les membres de votre vocal dans les salons vocaux d'une catégorie.",
  minRank       : LEVELS.SYS_PLUS,
  usage         : '=bringcc <id_categorie>',
  needsVoice    : true,
  needsBotPerms : ['MoveMembers'],

  async run({ message, args, level, reply }) {
    const guild   = message.guild;
    const actorId = message.author.id;

    if (!args[0]) return reply(messages.usage('=bringcc <id_categorie>'));

    const categoryId = args[0].replace(/[<#>]/g, '');
    const category   = guild.channels.cache.get(categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      return reply(messages.bringBadCategory());
    }

    /* Salons vocaux de la catégorie, hors salons pv (le guard y déconnecterait du monde). */
    const targets = [...guild.channels.cache.values()]
      .filter(c => c.parentId === category.id && c.isVoiceBased())
      .filter(c => !store.getPvByChannel(guild.id, c.id));

    if (!targets.length) return reply(messages.bringNoChannels());

    const startedAt = Date.now();
    const source    = message.member.voice.channel;
    const everyone  = [...source.members.values()].filter(m => !m.user.bot);

    /* Les membres de rang supérieur au tien ne sont jamais déplacés. */
    const movable = [];
    let ignored = 0;
    for (const member of everyone) {
      if (member.id !== actorId && ranks.getLevel(guild.id, member.id) > level) {
        ignored++;
        continue;
      }
      movable.push(member);
    }

    /* Mélange puis distribution à tour de rôle : au hasard mais équilibré. */
    const shuffledMembers  = _shuffle(movable);
    const shuffledChannels = _shuffle(targets);

    let placed = 0;
    let moved  = 0;
    let failed = 0;
    const used = new Set();

    for (let i = 0; i < shuffledMembers.length; i++) {
      const member  = shuffledMembers[i];
      const channel = shuffledChannels[i % shuffledChannels.length];

      try {
        if (member.voice.channelId !== channel.id) {
          await member.voice.setChannel(channel, `VoiceMaster : bringcc par ${actorId}`);
          moved++;
        }
        placed++;
        used.add(channel.id);
      } catch {
        failed++;
      }
    }

    const fields = [
      [L.executor, logger.user(actorId)],
      [L.source,   logger.channel(source.id)],
      [L.category, logger.channel(category.id)],
      [L.members,  String(everyone.length)],
      [L.moved,    String(moved)],
      [L.failed,   String(failed)],
    ];
    if (ignored) fields.push([L.ignored, String(ignored)]);
    fields.push([L.duration, logger.duration(Date.now() - startedAt)]);
    logger.send(guild, 'bringcc', { title: 'BRINGCC', fields });

    return replyWithFooter(
      message,
      'bringcc',
      messages.bringHeadline(category.id, placed, used.size),
      messages.bringFooter(actorId, ignored + failed)
    );
  },
};
