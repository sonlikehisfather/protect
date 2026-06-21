'use strict';

const { ContainerBuilder, MessageFlags, SeparatorBuilder, TextDisplayBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { checkCasinoLimits, setCooldown } = require('./casino');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

const COOLDOWN = 24 * 60 * 60;


exports.help = {
  name       : 'daily',
  description: 'Recupere votre bonus quotidien de coins et tirages.',
  use        : 'daily',
  usage      : 'daily',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const userId  = message.author.id;

  if (!db.isCasinoEnabled(guildId)) {
    return embed.replyError(message, 'Le casino n\'est pas active.');
  }

  const limitErr = checkCasinoLimits(message, 'daily');
  if (limitErr) return embed.replyError(message, limitErr);

  const cfg       = db.getCasinoConfig(guildId);
  const cdSecs    = 24 * 60 * 60;
  const now       = Math.floor(Date.now() / 1000);
  const lastDaily = db.getLastDaily(guildId, userId);
  const remaining = (lastDaily + cdSecs) - now;

  if (remaining > 0) {
    const hours   = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    return embed.replyError(message, `Daily disponible dans **${timeStr}**`);
  }

  const dMin = cfg.dailyMin ?? 0;
  const dMax = cfg.dailyMax ?? 0;
  const coinsAwarded = (dMin > 0 && dMax >= dMin)
    ? Math.floor(Math.random() * (dMax - dMin + 1)) + dMin
    : cfg.dailyCoins;

  db.addCasinoCoins(guildId, userId, coinsAwarded, 'win');
  db.addCasinoDraws(guildId, userId, cfg.dailyDraws);
  db.setLastDaily(guildId, userId, now);

  const user = db.getCasinoUser(guildId, userId);

  // Log to gains channel (V2)
  const { sendCasinoLog } = require('./casino');
  sendCasinoLog(message.guild, cfg, 'logChannelGains', {
    icon  : '✸',
    title : 'Daily',
    color : 0x57F287,
    user  : userId,
    lines : [
      `※ **+${embed.fmtCoins(coinsAwarded)}** coins`,
      `◆ **+${cfg.dailyDraws}** tirage${cfg.dailyDraws !== 1 ? 's' : ''}`,
    ],
  });

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ✸ Daily

` +
      `※ **+${embed.fmtCoins(coinsAwarded)}** coins
` +
      `◆ **+${cfg.dailyDraws}** tirage${cfg.dailyDraws !== 1 ? 's' : ''}

` +
      `▱ Solde : **${embed.fmtCoins(user.coins)}** coins
` +
      `▱ Tirages : **${user.draws}**`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  return embed.reply(message,
    `+${embed.fmtCoins(coinsAwarded)} coins\n+${cfg.dailyDraws} tirage(s)\n\nSolde : ${embed.fmtCoins(user.coins)} | Tirages : ${user.draws}`,
    { title: '✸ Daily', color: '#57F287' }
  );
};
