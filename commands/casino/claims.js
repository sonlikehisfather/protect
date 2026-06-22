'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const db = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

exports.help = {
  name: 'claims',
  description: 'Reclame tes gains d\'investissement',
  use: 'claims',
  usage: 'claims',
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

  const investment = db.getInvestment(guildId, userId);
  if (!investment) {
    return embed.replyError(message, 'Tu n\'as pas d\'investissement actif.');
  }

  const now = Math.floor(Date.now() / 1000);
  const claimCooldown = cfg.investmentClaimCooldown || 86400;
  const lastClaim = investment.lastClaim || 0;
  const remaining = (lastClaim + claimCooldown) - now;

  if (remaining > 0) {
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    return embed.replyError(message, `Prochain claim disponible dans **${timeStr}**`);
  }

  const rate = investment.rate || cfg.investmentRate || 0.05;
  const gainAmount = Math.floor(investment.amount * rate);

  db.claimInvestment(guildId, userId, gainAmount);

  const updatedUser = db.getCasinoUser(guildId, userId);

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Gains Investissement

` +
      `Montant investi : **${embed.fmtCoins(investment.amount)}** coins
` +
      `Taux d'interet : **${(rate * 100).toFixed(1)}%**

` +
      `Gains reclames: **+${embed.fmtCoins(gainAmount)}** coins

` +
      `Nouveau solde : **${embed.fmtCoins(updatedUser.coins)}** coins`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  return embed.reply(message,
    `Gains reclames: +${embed.fmtCoins(gainAmount)} coins\n\nsolde : ${embed.fmtCoins(updatedUser.coins)}`,
    { title: 'Gains Investissement' }
  );
};
