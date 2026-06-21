'use strict';

const { AttachmentBuilder, MessageFlags } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const { levelFromXp } = require('../../modules/levels');
const { getRankFromLevel, getPrestigeInfo } = require('./casino');

exports.help = {
  name       : 'showprofil',
  description: 'Afficher la carte de profil casino d\'un membre.',
  use        : 'showprofil <@user/ID>',
  usage      : 'showprofil @user',
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

  const member = message.guild.members.cache.get(target.id) ?? await message.guild.members.fetch(target.id).catch(() => null);
  if (!member) {
    return embed.replyError(message, 'Membre introuvable sur ce serveur.');
  }

  const user        = db.getCasinoUser(guildId, target.id);
  const levelData   = db.getLevel(guildId, target.id);
  const levelConfig = db.getGuildConfig(guildId);
  const realLevel   = levelConfig?.levelCumul ? levelFromXp(levelData.xp) : levelData.level;
  const rank        = getRankFromLevel(realLevel);
  const equipped    = db.getEquippedItemDetails(guildId, target.id);

  try {
    const { generateProfileCard } = require('../../utils/profileCard');
    const buffer = await generateProfileCard(member, user, realLevel, levelData, rank, equipped);
    const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
    return message.reply({ files: [attachment], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[SHOWPROFIL] Error generating card:', err?.message);
    return embed.replyError(message, 'Erreur lors de la generation de la carte de profil.');
  }
};
