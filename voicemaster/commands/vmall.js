'use strict';

const ranks    = require('../ranks');
const messages = require('../messages');
const logger   = require('../logger');
const { LEVELS } = require('../config');
const { replyWithFooter } = require('../footerReply');

const L = messages.logLabels;

module.exports = {
  name          : 'vmall',
  description   : 'Déplace tous les membres de ton vocal vers un autre salon.',
  minRank       : LEVELS.SYS,
  usage         : '=vmall <id_salon>',
  needsVoice    : true,
  needsBotPerms : ['MoveMembers'],

  async run({ message, args, level, reply }) {
    const guild   = message.guild;
    const actorId = message.author.id;

    if (!args[0]) return reply(messages.usage('=vmall <id_salon>'));

    const targetId = args[0].replace(/[<#>]/g, '');
    const target   = guild.channels.cache.get(targetId);
    if (!target || !target.isVoiceBased()) return reply(messages.pvBadChannel());

    const source = message.member.voice.channel;
    if (source.id === target.id) return reply(messages.vmallSame());

    const startedAt = Date.now();
    const members   = [...source.members.values()].filter(m => !m.user.bot);

    let moved   = 0;
    let failed  = 0;
    let ignored = 0;

    for (const member of members) {
      /* Un membre de rang supérieur au tien n'est jamais déplacé. */
      if (member.id !== actorId && ranks.getLevel(guild.id, member.id) > level) {
        ignored++;
        continue;
      }

      try {
        await member.voice.setChannel(target, `VoiceMaster : vmall par ${actorId}`);
        moved++;
      } catch {
        failed++;
      }
    }

    const fields = [
      [L.executor, logger.user(actorId)],
      [L.source,   logger.channel(source.id)],
      [L.dest,     logger.channel(target.id)],
      [L.members,  String(members.length)],
      [L.moved,    String(moved)],
      [L.failed,   String(failed)],
    ];
    if (ignored) fields.push([L.ignored, String(ignored)]);
    fields.push([L.duration, logger.duration(Date.now() - startedAt)]);
    logger.send(guild, 'vmall', { title: 'VMALL', fields });

    return replyWithFooter(
      message,
      'vmall',
      messages.vmallHeadline(source.id, target.id),
      messages.vmallFooter(moved, ignored + failed)
    );
  },
};
