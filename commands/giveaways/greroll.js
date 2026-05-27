'use strict';

const embed     = require('../../utils/embed');
const giveaways = require('../../modules/giveaways');
const db        = require('../../core/database');
const perms     = require('../../utils/permissions');


const REROLL_COOLDOWN_MS = 10_000;
const _rerollCooldowns   = new Map();

exports.help = {
  name       : 'greroll',
  description: 'Reroll un giveaway terminé.',
  usage      : 'greroll <messageId>',
};

exports.run = async (client, message, args) => {
  const guildId   = message.guild.id;
  const messageId = args[0];

  if (!perms.check(message, 'giveaway')) return;

  const now  = Date.now();
  const last = _rerollCooldowns.get(message.author.id) ?? 0;
  if (now - last < REROLL_COOLDOWN_MS) {
    const remaining = Math.ceil((REROLL_COOLDOWN_MS - (now - last)) / 1000);
    return embed.replyError(message, `Patientez encore ${remaining}s avant un autre reroll.`);
  }
  _rerollCooldowns.set(message.author.id, now);

  if (!messageId) return embed.replyError(message, 'Précisez l\'ID du message du giveaway.');

  const gw = db.getGiveaway(messageId);
  if (!gw || gw.guildId !== guildId) return embed.replyError(message, 'Giveaway introuvable.');

  const result = await giveaways.reroll(client, gw.id);
  if (!result.success) return embed.replyError(message, result.message);

  const channel = await client.channels.fetch(result.channelId).catch(() => null);
  const target  = channel ?? message.channel;

  const originalMsg = await target.messages.fetch(messageId).catch(() => null);

  const e = embed.build(guildId, null, {
    title : `🎉 Nouveau tirage - ${result.prize}`,
    fields: [{ name: 'Gagnant(s)', value: result.winners.map(id => `<@${id}>`).join(', ') }],
  });

  if (originalMsg) {
    await originalMsg.reply({
      embeds         : [e],
      allowedMentions: { parse: [], repliedUser: false },
    }).catch(() => target.send({
      embeds         : [e],
      allowedMentions: { parse: [] },
    }));
  } else {
    await target.send({
      embeds         : [e],
      allowedMentions: { parse: [] },
    });
  }
};
