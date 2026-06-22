'use strict';

const {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
  AttachmentBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = require('discord.js');
const embed = require('../../utils/embed');
const db    = require('../../core/database');
const { checkCasinoChannel, checkCasinoLimits, setCooldown } = require('./casino');
const { generateRouletteImage } = require('../../utils/rouletteImage');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

// European roulette: 0-36 (37 numbers)
const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const TOTAL = 37;

// ── Probability → cote mapping (detailed tier table) ──
// Each tier: [min% (inclusive), cote]
// Evaluated top-down: first tier where p% >= min% wins
const COTE_TIERS = [
  [95, 1.05],
  [90, 1.1 ],
  [85, 1.15],
  [80, 1.2 ],
  [75, 1.3 ],
  [70, 1.4 ],
  [65, 1.5 ],
  [60, 1.6 ],
  [55, 1.8 ],
  [50, 1.9 ],
  [45, 2.0 ],
  [40, 2.3 ],
  [35, 2.6 ],
  [30, 3.0 ],
  [25, 3.5 ],
  [20, 4.0 ],
  [17, 4.5 ],
  [14, 5.0 ],
  [12, 5.5 ],
  [10, 6.0 ],
  [ 8, 6.5 ],
  [ 7, 7.0 ],
  [ 6, 7.5 ],
  [ 5, 8.0 ],
  [ 4, 8.5 ],
  [ 3, 9.5 ],
  [ 0, 10  ],
];

function _probToCote(p) {
  const pct = p * 100;
  for (const [minPct, cote] of COTE_TIERS) {
    if (pct >= minPct) return cote;
  }
  return 10;
}

// ── Parse bet choice ──
// Returns { type, numbers:Set, label, prob, cote } or null if invalid
function _parseChoice(raw) {
  const input = raw.trim().toLowerCase();

  // Color
  if (input === 'rouge' || input === 'red' || input === 'r') {
    const nums = new Set([...RED_NUMBERS]);
    return { type: 'color', numbers: nums, label: 'Rouge', prob: nums.size / TOTAL, cote: _probToCote(nums.size / TOTAL) };
  }
  if (input === 'noir' || input === 'black' || input === 'n') {
    const nums = new Set();
    for (let i = 1; i <= 36; i++) if (!RED_NUMBERS.has(i)) nums.add(i);
    return { type: 'color', numbers: nums, label: 'Noir', prob: nums.size / TOTAL, cote: _probToCote(nums.size / TOTAL) };
  }
  if (input === 'vert' || input === 'green' || input === 'v' || input === '0') {
    return { type: 'color', numbers: new Set([0]), label: 'Vert (0)', prob: 1 / TOTAL, cote: _probToCote(1 / TOTAL) };
  }

  // Parity
  if (input === 'pair' || input === 'even' || input === 'p') {
    const nums = new Set();
    for (let i = 2; i <= 36; i += 2) nums.add(i);
    return { type: 'parity', numbers: nums, label: 'Pair', prob: nums.size / TOTAL, cote: _probToCote(nums.size / TOTAL) };
  }
  if (input === 'impair' || input === 'odd' || input === 'i') {
    const nums = new Set();
    for (let i = 1; i <= 35; i += 2) nums.add(i);
    return { type: 'parity', numbers: nums, label: 'Impair', prob: nums.size / TOTAL, cote: _probToCote(nums.size / TOTAL) };
  }

  // Dozens
  if (input === '1-12' || input === 'premiere' || input === 'première' || input === 't1') {
    const nums = new Set();
    for (let i = 1; i <= 12; i++) nums.add(i);
    return { type: 'dozen', numbers: nums, label: '1-12', prob: nums.size / TOTAL, cote: _probToCote(nums.size / TOTAL) };
  }
  if (input === '13-24' || input === 't2') {
    const nums = new Set();
    for (let i = 13; i <= 24; i++) nums.add(i);
    return { type: 'dozen', numbers: nums, label: '13-24', prob: nums.size / TOTAL, cote: _probToCote(nums.size / TOTAL) };
  }
  if (input === '25-36' || input === 't3') {
    const nums = new Set();
    for (let i = 25; i <= 36; i++) nums.add(i);
    return { type: 'dozen', numbers: nums, label: '25-36', prob: nums.size / TOTAL, cote: _probToCote(nums.size / TOTAL) };
  }

  // Range: X-Y (e.g. 24-32)
  const rangeMatch = input.match(/^(\d+)\s*[-/]\s*(\d+)$/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1]);
    const hi = parseInt(rangeMatch[2]);
    if (lo >= 0 && hi <= 36 && lo <= hi) {
      const nums = new Set();
      for (let i = lo; i <= hi; i++) nums.add(i);
      return { type: 'range', numbers: nums, label: `${lo}-${hi}`, prob: nums.size / TOTAL, cote: _probToCote(nums.size / TOTAL) };
    }
  }

  // Single number
  const num = parseInt(input);
  if (!isNaN(num) && num >= 0 && num <= 36) {
    return { type: 'number', numbers: new Set([num]), label: String(num), prob: 1 / TOTAL, cote: _probToCote(1 / TOTAL) };
  }

  return null;
}

exports.help = {
  name        : 'roulette',
  description : 'Roulette européenne ・ parie sur une couleur, une plage ou un numéro.',
  use         : 'roulette <mise> <choix>',
  usage       : 'roulette 500 noir\nroulette 1000 24-32\nroulette 2000 17',
  aliases     : ['rl', 'roue'],
  category    : 'casino',
  selfManaged : true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const userId  = message.author.id;

  const chErr = checkCasinoChannel(message);
  if (chErr) return embed.replyError(message, chErr);

  const user = db.getCasinoUser(guildId, userId);
  const cfg = db.getCasinoConfig(guildId);
  let amount;
  if (args[0] && args[0].toLowerCase() === 'all') {
    amount = user.coins;
    if (cfg.limitRlMax > 0) amount = Math.min(amount, cfg.limitRlMax);
  } else {
    amount = parseInt(args[0]);
  }
  if (!amount || amount < 1) {
    if (args[0] && args[0].toLowerCase() === 'all')
      return embed.replyError(message, `Tu n'as aucun coin a parier. Solde : **${embed.fmtCoins(user.coins)}** coins`);
    return embed.replyError(message, 'Tu dois parier un montant valide. Usage : `roulette <mise|all> <choix>`');
  }

  const limitErr = checkCasinoLimits(message, 'roulette', amount);
  if (limitErr) return embed.replyError(message, limitErr);

  if (user.coins < amount) {
    return embed.replyError(message, `Tu n'as pas assez de coins. Solde : **${embed.fmtCoins(user.coins)}** coins`);
  }

  const choiceRaw = args.slice(1).join(' ').trim();
  if (!choiceRaw) {
    return embed.replyError(message,
      'Tu dois choisir sur quoi parier.\n' +
      'Exemples : `roulette 500 noir`, `roulette 1000 24-32`, `roulette 2000 17`\n' +
      'Options : rouge, noir, vert, pair, impair, 1-12, 13-24, 25-36, X-Y, ou un numéro (0-36)'
    );
  }

  const choice = _parseChoice(choiceRaw);
  if (!choice) {
    return embed.replyError(message,
      `Choix invalide : \`${choiceRaw}\`\n` +
      'Options : rouge, noir, vert, pair, impair, 1-12, 13-24, 25-36, X-Y, ou un numéro (0-36)'
    );
  }

  setCooldown(guildId, userId, 'roulette');

  const startTime = Date.now();
  db.removeCasinoCoins(guildId, userId, amount, 'spend');
  let betDeducted = true;
  const refundBet = () => {
    if (!betDeducted) return;
    betDeducted = false;
    db.refundCasinoBet(guildId, userId, amount);
  };

  const { cote, bonuses } = require('./casino').getGameCoteInfo(guildId, message.member, 'coinflip');
  const guildConfig   = db.getGuildConfig(guildId);
  const deleteCmd     = Boolean(guildConfig?.autoDeleteInfoCmds);
  const deleteReply   = Boolean(guildConfig?.autoDeleteInfoReplies);
  const deleteDelay   = Number(guildConfig?.autoDeleteDelay ?? 5);

  if (deleteCmd) await message.delete().catch(() => {});

  // Spin
  const result = Math.floor(Math.random() * TOTAL); // 0-36
  const isRed   = RED_NUMBERS.has(result);
  const isBlack = result !== 0 && !isRed;
  const colorTag = result === 0 ? 'VERT' : (isRed ? 'ROUGE' : 'NOIR');
  const colorDot = result === 0 ? '◆' : (isRed ? '●' : '○');

  const win      = choice.numbers.has(result);
  const winAmount = win ? Math.floor(amount * choice.cote) : 0;
  const netGain  = win ? winAmount - amount : -amount;

  const gameDuration = Math.floor((Date.now() - startTime) / 1000);
  if (win) {
    db.addCasinoCoins(guildId, userId, winAmount, 'win');
  }
  db.recordGameStat(guildId, userId, 'roulette', win ? 1 : 0, amount, win ? winAmount : 0);
  db.addPlaytime(guildId, userId, gameDuration);

  const baseXp  = win ? (cfg.xpRlWin ?? 40) : (cfg.xpRlLoss ?? 15);
  const xpGain  = win ? Math.max(baseXp, Math.floor(netGain / 500) + baseXp) : baseXp;
  db.addXp(guildId, userId, xpGain);
  const finalUser = db.getCasinoUser(guildId, userId);

  // Log to games channel (V2)
  if (cfg.logChannelGames) {
    const { sendCasinoLog } = require('./casino');
    sendCasinoLog(message.guild, cfg, 'logChannelGames', {
      icon  : win ? '✸' : '↺',
      title : 'Roulette',

      user  : userId,
      lines : [
        `Mise : **${embed.fmtCoins(amount)}** coins sur **${choice.label}** (x${choice.cote})`,
        `Résultat : **${result}** ${colorTag}`,
        win
          ? `※ **+${embed.fmtCoins(netGain)}** coins (x${choice.cote})`
          : `× **-${embed.fmtCoins(amount)}** coins`,
      ],
    });
  }

  const verdict = win
    ? `✔ GAGNÉ ! (+${embed.fmtCoins(netGain)} coins)`
    : `× Perdu... (-${embed.fmtCoins(amount)} coins)`;

  let imageBuffer = null;
  try {
    imageBuffer = await generateRouletteImage({
      result, choice, win, winAmount, amount, netGain, finalCoins: finalUser.coins, bonuses,
    });
  } catch (e) {
    console.error('[ROULETTE] Image generation error:', e?.message, e?.stack);
  }

  if (imageBuffer) {
    if (V2_AVAILABLE) {
      const container = new ContainerBuilder();
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://roulette_result.png')));
      return message.reply({
        components: [container],
        flags: COMPONENTS_V2_FLAG,
        files: [new AttachmentBuilder(imageBuffer, { name: 'roulette_result.png' })],
        allowedMentions: { parse: [] },
      }).then(sent => {
        if (deleteReply) embed.scheduleDelete(sent, deleteDelay);
      }).catch(() => {
        refundBet();
        const { sendCasinoLog } = require('./casino');
        sendCasinoLog(message.guild, cfg, 'logChannelGames', {
          icon  : '↺',
          title : 'Roulette',

          user  : userId,
          lines : [
            `Mise : **${embed.fmtCoins(amount)}** coins`,
            `Remboursement : **${embed.fmtCoins(amount)}** coins (erreur d'envoi)`,
            `Solde : **${embed.fmtCoins(db.getCasinoUser(guildId, userId).coins)}** coins`,
          ],
        });
      });
    }
    return message.reply({
      embeds: [embed.build(message.guild?.id, null, {
        title: '◉ Roulette',
        description: `Mise : ${embed.fmtCoins(amount)} sur ${choice.label} (x${choice.cote})\n` +
          `Résultat : ${result} ${colorTag}\n` +
          `${verdict}\nSolde : ${embed.fmtCoins(finalUser.coins)}`,
        image: 'attachment://roulette_result.png',
        timestamp: false,
      })],
      files: [new AttachmentBuilder(imageBuffer, { name: 'roulette_result.png' })],
      allowedMentions: { parse: [], repliedUser: false },
    }).then(sent => {
      if (deleteReply) embed.scheduleDelete(sent, deleteDelay);
    }).catch(() => {
      refundBet();
      const { sendCasinoLog } = require('./casino');
      sendCasinoLog(message.guild, cfg, 'logChannelGames', {
        icon  : '↺',
        title : 'Roulette',

        user  : userId,
        lines : [
          `Mise : **${embed.fmtCoins(amount)}** coins`,
          `Remboursement : **${embed.fmtCoins(amount)}** coins (erreur d'envoi)`,
          `Solde : **${embed.fmtCoins(db.getCasinoUser(guildId, userId).coins)}** coins`,
        ],
      });
    });
  }

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ◉ Roulette\n\n` +
      `**Ta mise** : ${embed.fmtCoins(amount)} coins sur **${choice.label}**\n` +
      `**Cote** : x${choice.cote} (${(choice.prob * 100).toFixed(1)}% de chance)\n\n` +
      `**Résultat** : ${colorDot} **${result}** ${colorTag}\n\n` +
      `${verdict}\n` +
      `▱ Solde : **${embed.fmtCoins(finalUser.coins)}** coins`
    ));
    return message.reply({
      components      : [container],
      flags           : COMPONENTS_V2_FLAG,
      allowedMentions : { parse: [] },
    }).then(sent => {
      if (deleteReply) embed.scheduleDelete(sent, deleteDelay);
    }).catch(() => {
      refundBet();
      const { sendCasinoLog } = require('./casino');
      sendCasinoLog(message.guild, cfg, 'logChannelGames', {
        icon  : '↺',
        title : 'Roulette',

        user  : userId,
        lines : [
          `Mise : **${embed.fmtCoins(amount)}** coins`,
          `Remboursement : **${embed.fmtCoins(amount)}** coins (erreur d'envoi)`,
          `Solde : **${embed.fmtCoins(db.getCasinoUser(guildId, userId).coins)}** coins`,
        ],
      });
    });
  }

  return embed.reply(message,
    `Mise : ${embed.fmtCoins(amount)} sur ${choice.label} (x${choice.cote})\n` +
    `Résultat : ${result} ${colorTag}\n` +
    `${verdict}\nSolde : ${embed.fmtCoins(finalUser.coins)}`,
    { title: '◉ Roulette' }
  ).then(sent => {
    if (deleteReply) embed.scheduleDelete(sent, deleteDelay);
  }).catch(() => {
    refundBet();
    const { sendCasinoLog } = require('./casino');
    sendCasinoLog(message.guild, cfg, 'logChannelGames', {
      icon  : '↺',
      title : 'Roulette',

      user  : userId,
      lines : [
        `Mise : **${embed.fmtCoins(amount)}** coins`,
        `Remboursement : **${embed.fmtCoins(amount)}** coins (erreur d'envoi)`,
        `Solde : **${embed.fmtCoins(db.getCasinoUser(guildId, userId).coins)}** coins`,
      ],
    });
  });
};
