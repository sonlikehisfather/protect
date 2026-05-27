'use strict';

const embed     = require('../../utils/embed');
const giveaways = require('../../modules/giveaways');
const db        = require('../../core/database');
const perms     = require('../../utils/permissions');

exports.help = {
  name       : 'gend',
  description: 'Terminer un giveaway en cours.',
  usage      : 'gend <messageId>',
};

exports.run = async (client, message, args) => {
  const guildId   = message.guild.id;
  const messageId = args[0];

  if (!perms.check(message, 'giveaway')) return;

  if (!messageId) return embed.replyError(message, 'Précisez l\'ID du message du giveaway.');

  const gw = db.getGiveaway(messageId);
  if (!gw || gw.guildId !== guildId) return embed.replyError(message, 'Giveaway introuvable.');
  if (gw.ended) return embed.replyError(message, 'Ce giveaway est déjà terminé.');

  await message.delete().catch(() => {});
  await giveaways.end(client, gw.id);

  const _gendCfg   = db.getGuildConfig(guildId);
  const _gendDelay = _gendCfg?.autoDeleteDelay ?? 3;

  const confirm = await message.channel.send({
    embeds: [embed.build(guildId, 'Giveaway terminé.')],
  }).catch(() => null);

  if (confirm) embed.scheduleDelete(confirm, _gendDelay);
};
