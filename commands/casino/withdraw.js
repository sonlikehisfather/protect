'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const db = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

exports.help = {
  name: 'withdraw',
  description: 'Retire ton capital investi (avec pénalité)',
  use: 'withdraw',
  usage: 'withdraw',
  category: 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const userId = message.author.id;

  const cfg = db.getCasinoConfig(guildId);
  if (!cfg?.enabled) {
    return embed.replyError(message, 'Le casino n\'est pas activé.');
  }

  const invest = db.getInvestment(guildId, userId);
  if (!invest || invest.amount <= 0) {
    return embed.replyError(message, 'Tu n\'as aucun investissement actif.');
  }

  const casino = require('../casino/casino');
  const cdErr = casino.checkCasinoLimits(message, 'withdraw');
  if (cdErr) return embed.replyError(message, cdErr);

  const penalty = cfg.withdrawalPenalty ?? 0.1;
  const penaltyAmount = Math.floor(invest.amount * penalty);
  const returned = invest.amount - penaltyAmount;

  db.removeInvestment(guildId, userId);
  db.addCasinoCoins(guildId, userId, returned, 'withdraw');
  casino.setCooldown(guildId, userId, 'withdraw');

  const user = db.getCasinoUser(guildId, userId);
  const pctLabel = `${(penalty * 100).toFixed(0)}%`;

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Retrait d'investissement\n\n` +
      `Capital retiré : **${embed.fmtCoins(invest.amount)}** coins\n` +
      `Pénalité (${pctLabel}) : **-${embed.fmtCoins(penaltyAmount)}** coins\n\n` +
      `Reçu: **+${embed.fmtCoins(returned)}** coins\n` +
      `Nouveau solde : **${embed.fmtCoins(user?.coins ?? 0)}** coins`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  return embed.reply(message,
    `Capital: ${embed.fmtCoins(invest.amount)} | Pénalité (${pctLabel}): -${embed.fmtCoins(penaltyAmount)}\nReçu: +${embed.fmtCoins(returned)} | solde : ${embed.fmtCoins(user?.coins ?? 0)}`,
    { title: 'Retrait investissement' }
  );
};
