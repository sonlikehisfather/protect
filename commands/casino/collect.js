'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { checkCasinoChannel, checkCasinoLimits, setCooldown } = require('./casino');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

const COLLECT_COOLDOWN = 60 * 60;


exports.help = {
  name       : 'collect',
  description: 'Collecte vos gains d\'activite vocale.',
  use        : 'collect',
  usage      : 'collect',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const userId  = message.author.id;

  const chErr = checkCasinoChannel(message);
  if (chErr) return embed.replyError(message, chErr);

  if (!db.isCasinoEnabled(guildId)) {
    return embed.replyError(message, 'Le casino n\'est pas actif.');
  }

  const limitErr = checkCasinoLimits(message, 'collect');
  if (limitErr) return embed.replyError(message, limitErr);

  const cfg          = db.getCasinoConfig(guildId);
  const cdSecs       = cfg.cooldownCollect || COLLECT_COOLDOWN;
  const now          = Math.floor(Date.now() / 1000);
  const lastCollect  = db.getLastCollect(guildId, userId);
  const remaining    = (lastCollect + cdSecs) - now;

  if (remaining > 0) {
    const minutes = Math.ceil(remaining / 60);
    return embed.replyError(message, `Collect disponible dans **${minutes} min**`);
  }

  const user = db.getCasinoUser(guildId, userId);
  const vocMinutes = user.vocMinutes ?? 0;

  if (vocMinutes < 1) {
    return embed.replyError(message, 'Aucun temps vocal à collecter. Reviens après avoir passé du temps en vocal.');
  }

  const member = message.guild.members.cache.get(userId);
  const isPublic = member?.voice?.channel?.name?.toLowerCase().includes('public') ||
                   member?.voice?.channel?.name?.toLowerCase().includes('general');
  const multiplier = isPublic ? cfg.publicVocMultiplier : 1;

  // Bonus rate: collect gives extra coins on top of auto-attributed gains
  const bonusRate = cfg.collectBonusRate ?? 0.5;
  const coinsPerMin = cfg.coinsPerVocMin ?? 0;
  const drawsPerMin = (cfg.drawsPerVocHour ?? 0) / 60;

  const coinsEarned = Math.floor(vocMinutes * coinsPerMin * bonusRate * multiplier);
  const drawsEarned = Math.floor(vocMinutes * drawsPerMin * bonusRate * multiplier);

  if (coinsEarned > 0) {
    db.addCasinoCoins(guildId, userId, coinsEarned, 'win');
  }
  if (drawsEarned > 0) {
    db.addCasinoDraws(guildId, userId, drawsEarned);
  }

  db.setLastCollect(guildId, userId, now);
  db.resetVocMinutes(guildId, userId);

  const updated = db.getCasinoUser(guildId, userId);

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ✸ Collect

` +
      `▱ **${vocMinutes} min** en vocal${isPublic ? ` *(x${multiplier} public)*` : ''}

` +
      `※ **+${embed.fmtCoins(coinsEarned)}** coins *(bonus x${bonusRate})*
` +
      `◆ **+${drawsEarned}** tirage${drawsEarned !== 1 ? 's' : ''}

` +
      `▱ Solde : **${embed.fmtCoins(updated.coins)}** coins
` +
      `▱ Tirages : **${updated.draws}**`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  return embed.reply(message,
    `${vocMinutes} min vocal${isPublic ? ` (x${multiplier} public)` : ''}\n\n+${embed.fmtCoins(coinsEarned)} coins (bonus x${bonusRate})\n+${drawsEarned} tirage(s)\n\nSolde : ${embed.fmtCoins(updated.coins)} | Tirages : ${updated.draws}`,
    { title: '✸ Collect', color: '#57F287' }
  );
};
