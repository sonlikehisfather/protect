'use strict';

const { AttachmentBuilder } = require('discord.js');
const db = require('../../core/database');
const embed = require('../../utils/embed');

exports.help = {
  name: 'analytics',
  description: 'Affiche tes statistiques detaillees du casino',
  use: 'analytics',
  usage: 'analytics',
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

  const allGameStats = db.getAllGameStats(guildId, userId);
  const games = {};

  if (allGameStats && allGameStats.length > 0) {
    for (const stat of allGameStats) {
      games[stat.game] = {
        wins: stat.wins || 0,
        losses: stat.losses || 0,
        totalBet: stat.totalBet || 0,
        totalWon: stat.totalWon || 0,
      };
    }
  }

  const totalBetSum = allGameStats?.reduce((sum, s) => sum + (s.totalBet || 0), 0) || 0;
  const totalWonSum = allGameStats?.reduce((sum, s) => sum + (s.totalWon || 0), 0) || 0;

  const stats = {
    totalGamesWon: user.totalGamesWon || 0,
    totalGamesLost: user.totalGamesLost || 0,
    totalBet: totalBetSum || user.totalSpent || 0,
    totalWon: totalWonSum || user.totalWon || 0,
    games,
  };

  try {
    const { generateAnalyticsImage } = require('../../utils/analyticsImage');
    const buffer = await generateAnalyticsImage(message.member.displayName, stats, '#5865F2');
    const attachment = new AttachmentBuilder(buffer, { name: 'analytics.png' });
    return message.reply({ files: [attachment], allowedMentions: { parse: [] } }).catch(() => {});
  } catch (err) {
    console.error('[Analytics] Erreur:', err);
    return embed.replyError(message, 'Impossible de generer l\'image analytics.');
  }
};
