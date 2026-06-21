'use strict';

const { ContainerBuilder, MessageFlags, SeparatorBuilder, TextDisplayBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { checkCasinoChannel, checkCasinoLimits, setCooldown } = require('./casino');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

const JACKPOT_COST_DEFAULT = 1000;

exports.help = {
  name       : 'jackpot',
  description: 'Tente ta chance pour remporter la cagnotte du jackpot.',
  use        : 'jackpot',
  usage      : 'jackpot',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const userId  = message.author.id;

  if (!db.isCasinoEnabled(guildId)) {
    return embed.replyError(message, 'Le casino n\'est pas actif.');
  }

  const chErr = checkCasinoChannel(message);
  if (chErr) return embed.replyError(message, chErr);

  const cfg = db.getCasinoConfig(guildId);
  const jackpotCost = cfg.jackpotCost || JACKPOT_COST_DEFAULT;

  const user = db.getCasinoUser(guildId, userId);
  if (user.coins < jackpotCost) {
    return embed.replyError(message, `Tu n'as pas assez de coins. Cout : **${embed.fmtCoins(jackpotCost)}** coins. Solde : **${embed.fmtCoins(user.coins)}**`);
  }

  const { amount: jackpotAmount, number: jackpotNumber } = db.getJackpot(guildId);
  const guess = Math.floor(Math.random() * 1000) + 1;

  db.addCasinoCoins(guildId, userId, -jackpotCost, 'spend');
  db.addToJackpot(guildId, jackpotCost);

  const won = guess === jackpotNumber;

  const { sendCasinoLog } = require('./casino');

  if (won) {
    const winnings = jackpotAmount + jackpotCost;
    db.addCasinoCoins(guildId, userId, winnings, 'win');
    db.resetJackpot(guildId);

    sendCasinoLog(message.guild, cfg, 'logChannelGains', {
      icon  : '◆',
      title : 'Jackpot Gagné ! ',
      color : 0xFFD700,
      user  : userId,
      lines : [
        `Numero gagnant : **${jackpotNumber}**`,
        `Cagnotte : **${embed.fmtCoins(winnings)}** coins`,
        `Solde : ${embed.fmtCoins(db.getCasinoUser(guildId, userId).coins)} coins`,
      ],
    });

    if (V2_AVAILABLE) {
      const container = new ContainerBuilder().setAccentColor(0xFFD700);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## Jackpot Gagné !  !\n\n` +
        `> Numero tire : **${guess}** ・ Numero gagnant : **${jackpotNumber}**\n` +
        `> Cagnotte remportee : **${embed.fmtCoins(winnings)}** coins\n\n` +
        `> Nouveau solde : **${embed.fmtCoins(db.getCasinoUser(guildId, userId).coins)}** coins`
      ));
      return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
    }

    return embed.reply(message,
      `Jackpot Gagné !  !\nNumero : ${guess}\nCagnotte : ${embed.fmtCoins(winnings)} coins\nSolde : ${embed.fmtCoins(db.getCasinoUser(guildId, userId).coins)}`,
      { title: '◆ Jackpot', color: '#FFD700' }
    );
  }

  const newAmount = jackpotAmount + jackpotCost;
  const distance = Math.abs(guess - jackpotNumber);

  sendCasinoLog(message.guild, cfg, 'logChannelGains', {
    icon  : '◇',
    title : 'Jackpot rate',
    color : 0xED4245,
    user  : userId,
    lines : [
      `Numero tire : **${guess}** (a ${distance} du numero gagnant)`,
      `Cagnotte : **${embed.fmtCoins(newAmount)}** coins`,
    ],
  });

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().setAccentColor(0xED4245);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Jackpot rate\n\n` +
      `> Numero tire : **${guess}**\n` +
      `> Tu etais a **${distance}** du numero gagnant\n\n` +
      `> Cagnotte actuelle : **${embed.fmtCoins(newAmount)}** coins\n` +
      `> -${embed.fmtCoins(jackpotCost)} coins ajoutes a la cagnotte`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  return embed.reply(message,
    `Jackpot rate\nNumero tire : ${guess} (a ${distance} du bon numero)\nCagnotte : ${embed.fmtCoins(newAmount)} coins\n-${embed.fmtCoins(jackpotCost)} coins`,
    { title: '◆ Jackpot', color: '#ED4245' }
  );
};
