'use strict';

const { AttachmentBuilder } = require('discord.js');
const db = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const { getRankFromLevel } = require('./casino');

exports.help = {
  name: 'compare',
  description: 'Compare tes stats avec un autre joueur',
  use: 'compare <@user>',
  usage: 'compare @Alice',
  category: 'casino',
  selfManaged: true,
};

const RANK_COLORS = {
  'Master': '#FF00FF', 'Prestige 3': '#00FFFF', 'Prestige 2': '#FFD700',
  'Prestige 1': '#FF6B6B', 'Absolu': '#FFD700', 'Suprême': '#FF6B6B',
  'Céleste': '#A8E6CF', 'Transcendant': '#2ECC71', 'Divin': '#16A085',
  'Immortel': '#1ABC9C', 'Mythique': '#C0392B', 'Légende': '#E74C3C',
  'Champion': '#E67E22', 'Grand Maître': '#F39C12', 'Maître': '#F1C40F',
  'Élite': '#9B59B6', 'Expert': '#8E44AD', 'Vétéran': '#3498DB',
  'Aguerri': '#2980B9', 'Expérimenté': '#2471A3', 'Avisé': '#1A5276',
  'Confirmé': '#5D6D7E', 'Régulier': '#717D7E', 'Apprenti': '#808B96',
  'Novice': '#95A5A6',
};

function buildUserData(member, casinoUser, levelData, levelConfig) {
  const { levelFromXp } = require('../../modules/levels');
  const realLevel = levelConfig?.levelCumul ? levelFromXp(levelData.xp) : levelData.level;
  const rank = getRankFromLevel(realLevel);
  const color = RANK_COLORS[rank.name] ?? '#5865F2';

  const allStats = db.getAllGameStats(member.guild.id, member.id);
  const games = {};
  let totalBet = 0, totalWon = 0;
  for (const s of (allStats || [])) {
    games[s.game] = { wins: s.wins || 0, losses: s.losses || 0, totalBet: s.totalBet || 0, totalWon: s.totalWon || 0 };
    totalBet += s.totalBet || 0;
    totalWon += s.totalWon || 0;
  }

  return { member, casinoUser, rank: rank.name, color, games, totalBet, totalWon };
}

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const userId = message.author.id;

  const isAllowed = perms.isBuyer(userId) || perms.isOwner(guildId, userId) || db.isCasinoManager(guildId, userId);
  if (!isAllowed) {
    return embed.replyError(message, 'Tu dois etre gerant casino, owner ou buyer pour utiliser cette commande.');
  }

  const cfg = db.getCasinoConfig(guildId);
  if (!cfg?.enabled) {
    return embed.replyError(message, 'Le casino n\'est pas active.');
  }

  let targetId = null;
  if (message.mentions.users.size > 0) {
    targetId = message.mentions.users.first().id;
  } else if (args[0]) {
    targetId = args[0].replace(/[<@!>]/g, '');
  } else {
    return embed.replyError(message, 'Usage: `+compare @user`');
  }

  const casinoUser1 = db.getCasinoUser(guildId, userId);
  const casinoUser2 = db.getCasinoUser(guildId, targetId);
  if (!casinoUser1 || !casinoUser2) {
    return embed.replyError(message, 'L\'un des deux profils n\'existe pas.');
  }

  let member2 = null;
  try {
    member2 = await message.guild.members.fetch(targetId);
  } catch {
    return embed.replyError(message, 'Impossible de trouver cet utilisateur sur le serveur.');
  }

  const levelConfig = db.getGuildConfig(guildId);
  const userData1 = buildUserData(message.member, casinoUser1, db.getLevel(guildId, userId), levelConfig);
  const userData2 = buildUserData(member2, casinoUser2, db.getLevel(guildId, targetId), levelConfig);

  try {
    const { generateCompareImage } = require('../../utils/compareImage');
    const buffer = await generateCompareImage(userData1, userData2);
    const attachment = new AttachmentBuilder(buffer, { name: 'compare.png' });
    return message.reply({ files: [attachment], allowedMentions: { parse: [] } }).catch(() => {});
  } catch (err) {
    console.error('[Compare] Erreur:', err);
    return embed.replyError(message, 'Impossible de generer l\'image de comparaison.');
  }
};
