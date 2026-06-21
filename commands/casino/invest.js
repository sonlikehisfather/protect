'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const db = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

exports.help = {
  name: 'invest',
  description: 'Investis des coins pour des gains passifs quotidiens',
  use: 'invest <montant>',
  usage: 'invest 100000',
  category: 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const userId = message.author.id;

  const cfg = db.getCasinoConfig(guildId);
  if (!cfg?.enabled) {
    return embed.replyError(message, 'Le casino n\'est pas active.');
  }

  const user = db.getCasinoUser(guildId, userId);
  if (!user) {
    return embed.replyError(message, 'Tu n\'as pas de profil casino.');
  }

  if (!args[0]) {
    return embed.replyError(message, 'Usage: `+invest <montant>`');
  }

  const amount = parseInt(args[0]);
  if (isNaN(amount) || amount <= 0) {
    return embed.replyError(message, 'Le montant doit etre un nombre positif.');
  }

  const minInvest = cfg.investmentMin || 10000;
  const maxInvest = cfg.investmentMax || 1000000;

  if (amount < minInvest) {
    return embed.replyError(message, `Montant minimum: **${embed.fmtCoins(minInvest)}** coins`);
  }

  if (amount > maxInvest) {
    return embed.replyError(message, `Montant maximum: **${embed.fmtCoins(maxInvest)}** coins`);
  }

  if (user.coins < amount) {
    return embed.replyError(message, `Solde insuffisant. Tu as: **${embed.fmtCoins(user.coins)}** coins`);
  }

  const rate = cfg.investmentRate || 0.05;
  const claimCooldown = cfg.investmentClaimCooldown || 86400;
  const existingInvest = db.getInvestment(guildId, userId);

  if (existingInvest) {
    db.updateInvestmentAmount(guildId, userId, existingInvest.amount + amount);
  } else {
    db.addInvestment(guildId, userId, amount, rate);
  }

  db.removeCasinoCoins(guildId, userId, amount, 'invest');

  const totalInvested = (existingInvest?.amount || 0) + amount;
  const gainPerClaim = Math.floor(totalInvested * rate);
  const claimsPerDay = 86400 / claimCooldown;
  const dailyGain = Math.floor(gainPerClaim * claimsPerDay);
  const weeklyGain = dailyGain * 7;
  const monthlyGain = dailyGain * 30;
  const newBalance = user.coins - amount;

  const claimHours = claimCooldown / 3600;
  const claimLabel = claimHours >= 24 ? `${Math.floor(claimHours / 24)}j` : `${Math.floor(claimHours)}h`;

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Investissement

` +
      `Montant investi : **${embed.fmtCoins(amount)}** coins
` +
      `Total investi : **${embed.fmtCoins(totalInvested)}** coins

` +
      `Taux d'interet : **${(rate * 100).toFixed(1)}%** par claim
` +
      `Periode de claim : **${claimLabel}**
` +
      `Gains par claim : **+${embed.fmtCoins(gainPerClaim)}** coins

` +
      `Gains quotidiens : **+${embed.fmtCoins(dailyGain)}** coins
` +
      `Gains hebdomadaires : **+${embed.fmtCoins(weeklyGain)}** coins
` +
      `Gains mensuels : **+${embed.fmtCoins(monthlyGain)}** coins

` +
      `Nouveau solde : **${embed.fmtCoins(newBalance)}** coins
` +
      `-# Utilise \`+claims\` pour reclamer tes gains`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  return embed.reply(message,
    `investi : ${embed.fmtCoins(amount)} coins\nTotal: ${embed.fmtCoins(totalInvested)} coins\n\nGains/${claimLabel}: +${embed.fmtCoins(gainPerClaim)}\nGains/jour: +${embed.fmtCoins(dailyGain)} | Gains/semaine: +${embed.fmtCoins(weeklyGain)} | Gains/mois: +${embed.fmtCoins(monthlyGain)}\n\nsolde : ${embed.fmtCoins(newBalance)}\n\nUtilise +claims pour reclamer tes gains`,
    { title: 'Investissement', color: '#57F287' }
  );
};
