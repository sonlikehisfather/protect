'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

exports.help = {
  name       : 'clearprofil',
  description: 'Reset complet du profil casino d\'un utilisateur.',
  use        : 'clearprofil <@user/ID>',
  usage      : 'clearprofil @user',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const authorId = message.author.id;

  const permAllowed = perms.isBuyer(authorId) || perms.isOwner(guildId, authorId);
  if (!permAllowed) {
    const isManager = db.isCasinoManager(guildId, authorId);
    if (!isManager) {
      return embed.replyError(message, 'Tu dois etre gerant casino, owner ou buyer pour utiliser cette commande.');
    }
  }

  const target = message.mentions.users.first()
    || message.guild.members.cache.get(args[0])?.user
    || await client.users.fetch(args[0]).catch(() => null);
  if (!target) {
    return embed.replyError(message, 'Utilisateur invalide. Mention ou ID requis.');
  }

  const cfg = db.getCasinoConfig(guildId);
  const targetUser = db.getCasinoUser(guildId, target.id);
  const levelData = db.getLevel(guildId, target.id);
  const { levelFromXp } = require('../../modules/levels');
  const levelConfig = db.getGuildConfig(guildId);
  const realLevel = levelConfig?.levelCumul ? levelFromXp(levelData.xp) : (levelData.level ?? 0);
  const coins = targetUser.coins ?? 0;
  const draws = targetUser.draws ?? 0;
  const xp = levelData.xp ?? 0;

  db.resetCasinoUser(guildId, target.id);
  db.resetXp(guildId, target.id);
  db.removeInvestment(guildId, target.id);

  const { sendCasinoLog } = require('./casino');
  sendCasinoLog(message.guild, cfg, 'logChannelGains', {
    icon  : '×',
    title : 'Clear Profil',

    user  : target.id,
    lines : [
      `× Profil remis a zero`,
      `> Coins: ${embed.fmtCoins(coins)} ・ Tirages: ${draws} ・ Niveau: ${realLevel} ・ XP: ${embed.fmtCoins(xp)}`,
      `> par <@${authorId}>`,
    ],
  });

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## × Clear Profil\n\n× Profil de <@${target.id}> remis a zero.\n` +
      `> Coins: ~~${embed.fmtCoins(coins)}~~ → **0**\n` +
      `> Tirages: ~~${draws}~~ → **0**\n` +
      `> Niveau: ~~${realLevel}~~ → **0**\n` +
      `> XP: ~~${embed.fmtCoins(xp)}~~ → **0** ・ Inventaire: vide`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  return embed.reply(message,
    `Profil de <@${target.id}> remis a zero.\nCoins: ${embed.fmtCoins(coins)} → 0\nTirages: ${draws} → 0\nNiveau: ${realLevel} → 0\nXP: ${embed.fmtCoins(xp)} → 0\nInventaire: vide`,
    { title: '× Clear Profil' }
  );
};
