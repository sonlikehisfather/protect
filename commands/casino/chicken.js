'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
const { checkCasinoChannel, checkCasinoLimits, setCooldown, sendCasinoLog } = require('./casino');
const { generateChickenImage, DIFFS, laneMultVal, laneMultDisplay, pickCars, LANES, COLS } = require('../../utils/chickenImage');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

const sleep = ms => new Promise(r => setTimeout(r, ms));

exports.help = {
  name       : 'chicken',
  description: 'Chicken Crossing ・ traverse la route en evitant les voitures !',
  use        : 'chicken <mise|all> [easy|medium|hard]',
  usage      : 'chicken 1000 medium',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const userId  = message.author.id;

  const chErr = checkCasinoChannel(message);
  if (chErr) return embed.replyError(message, chErr);

  if (!db.isCasinoEnabled(guildId)) return embed.replyError(message, 'Le casino n\'est pas active.');

  const user = db.getCasinoUser(guildId, userId);
  const cfg  = db.getCasinoConfig(guildId);

  let amount;
  if (args[0] && args[0].toLowerCase() === 'all') amount = user.coins;
  else amount = parseInt(args[0]);

  if (!amount || amount < 1) {
    if (args[0] && args[0].toLowerCase() === 'all')
      return embed.replyError(message, `Tu n'as aucun coin a parier. Solde : **${embed.fmtCoins(user.coins)}** coins`);
    return embed.replyError(message, 'Tu dois parier un montant valide. Usage : `+chicken <mise|all> [easy|medium|hard]`');
  }

  const limitErr = checkCasinoLimits(message, 'chicken', amount);
  if (limitErr) return embed.replyError(message, limitErr);

  if (user.coins < amount)
    return embed.replyError(message, `Tu n'as pas assez de coins. Solde : **${embed.fmtCoins(user.coins)}** coins`);

  setCooldown(guildId, userId, 'chicken');

  const startTime = Date.now();

  let diffKey = (args[1] || 'medium').toLowerCase();
  if (!DIFFS[diffKey]) diffKey = 'medium';
  let diff = DIFFS[diffKey];
  const numCols = diff.cols || COLS;

  let currentLane = 0;
  let chickenCol = Math.floor(numCols / 2);
  let finished = false;
  let betDeducted = false;
  let crashedCol = -1;
  let crashedLane = -1;

  let allLaneCars = [];
  for (let l = 0; l < LANES; l++) {
    allLaneCars.push(pickCars(numCols, diff.cars));
  }

  const deductBet = () => {
    if (betDeducted) return;
    betDeducted = true;
    db.removeCasinoCoins(guildId, userId, amount, 'spend');
    db.recordPendingBet(guildId, userId, amount, 'chicken');
  };

  const refundBet = () => {
    if (!betDeducted) return;
    betDeducted = false;
    db.refundCasinoBet(guildId, userId, amount);
    db.clearPendingBet(guildId, userId, 'chicken');
  };

  const curMult = () => laneMultVal(diffKey, currentLane + 1);
  const cashoutVal = () => currentLane > 0 ? Math.floor(amount * laneMultVal(diffKey, currentLane)) : 0;
  const potentialWin = () => Math.floor(amount * curMult());

  const buildPlayingPanel = async () => {
    let img = null;
    try {
      img = await generateChickenImage({
        diffKey, currentLane, chickenCol, allLaneCars,
        gameOver: false, won: false, cashedOut: false,
        amount, winAmount: 0, netGain: 0,
        finalCoins: db.getCasinoUser(guildId, userId).coins,
        crashedCol: -1, crashedLane: -1,
      });
    } catch (e) {
      console.error('[CHICKEN] Image error:', e?.message, e?.stack);
    }

    const canLeft = chickenCol > 0;
    const canRight = chickenCol < numCols - 1;
    const cashLabel = currentLane === 0 ? 'X' : `${embed.fmtCoins(cashoutVal())}`;

    const rows = [];
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('chicken:left').setLabel('◄ GAUCHE').setStyle(ButtonStyle.Secondary).setDisabled(!canLeft),
      new ButtonBuilder().setCustomId('chicken:up').setLabel('▲ AVANCER').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('chicken:right').setLabel('DROITE ►').setStyle(ButtonStyle.Secondary).setDisabled(!canRight),
    ));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('chicken:cashout').setLabel(`CASH OUT`).setStyle(currentLane === 0 ? ButtonStyle.Danger : ButtonStyle.Success),
    ));

    if (img && V2_AVAILABLE) {
      const c = new ContainerBuilder();
      c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://chicken_game.png')));
      c.addSeparatorComponents(new SeparatorBuilder());
      for (const row of rows) c.addActionRowComponents(row);
      return { components: [c], flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(img, { name: 'chicken_game.png' })], allowedMentions: { parse: [] } };
    }

    const text = `## ~ Chicken Crossing\n> Route ${currentLane + 1}/${LANES} ・ x${curMult().toFixed(2)} ・ Potentiel : ${embed.fmtCoins(potentialWin())} coins`;
    if (img) {
      return {
        embeds: [embed.build(guildId, null, {
          title: '~ Chicken Crossing', image: 'attachment://chicken_game.png',
          description: text + diff.accent.replace('#', ''), timestamp: false,
        })],
        files: [new AttachmentBuilder(img, { name: 'chicken_game.png' })],
        components: rows,
      };
    }
    return { content: text, components: rows };
  };

  const buildCrashPanel = async () => {
    let img = null;
    try {
      img = await generateChickenImage({
        diffKey, currentLane, chickenCol, allLaneCars,
        gameOver: true, won: false, cashedOut: false,
        amount, winAmount: 0, netGain: -amount,
        finalCoins: db.getCasinoUser(guildId, userId).coins,
        crashedCol, crashedLane,
      });
    } catch (e) {
      console.error('[CHICKEN] Crash image error:', e?.message, e?.stack);
    }

    if (img && V2_AVAILABLE) {
      const c = new ContainerBuilder();
      c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://chicken_crash.png')));
      return { components: [c], flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(img, { name: 'chicken_crash.png' })], allowedMentions: { parse: [] } };
    }
    return {
      embeds: [embed.build(guildId, null, {
        title: '~ Chicken Crossing - CRASH', image: 'attachment://chicken_crash.png',
        description: `Route ${crashedLane + 1} ・ -${embed.fmtCoins(amount)} coins`, timestamp: false,
      })],
      files: [new AttachmentBuilder(img, { name: 'chicken_crash.png' })],
      components: [],
    };
  };

  const buildResult = async (won, cashedOut) => {
    let winAmount = 0;
    if (cashedOut && currentLane > 0) winAmount = Math.floor(amount * laneMultVal(diffKey, currentLane));
    else if (won) winAmount = Math.floor(amount * laneMultVal(diffKey, LANES));

    const netGain = winAmount - amount;
    if (winAmount > 0) db.addCasinoCoins(guildId, userId, winAmount, 'win');

    // Track game stats
    const gameDuration = Math.floor((Date.now() - startTime) / 1000);
    db.recordGameStat(guildId, userId, 'chicken', winAmount > amount ? 1 : 0, amount, winAmount > amount ? winAmount - amount : 0);
    db.addPlaytime(guildId, userId, gameDuration);
    db.clearPendingBet(guildId, userId, 'chicken');
    const finalCoins = db.getCasinoUser(guildId, userId).coins;

    const xpGain = netGain > 0 ? Math.max(15, Math.floor(netGain / 500) + 15) : 10;
    db.addXp(guildId, userId, xpGain);

    sendCasinoLog(message.guild, cfg, 'logChannelGames', {
      icon  : netGain > 0 ? '~' : 'X',
      title : 'Chicken Crossing',

      user  : userId,
      lines : [
        `Mise : **${embed.fmtCoins(amount)}** coins ・ **${diff.label}**`,
        `Route atteinte : **${currentLane + 1}/${LANES}** → x${cashedOut ? laneMultDisplay(diffKey, currentLane) : (won ? laneMultDisplay(diffKey, LANES) : '0')}`,
        netGain > 0 ? `Gagne **+${embed.fmtCoins(netGain)}** coins` : `Perdu **-${embed.fmtCoins(Math.abs(netGain))}** coins`,
        `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
      ],
    });

    let img = null;
    try {
      img = await generateChickenImage({
        diffKey, currentLane: won ? LANES - 1 : currentLane, chickenCol, allLaneCars,
        gameOver: true, won, cashedOut,
        amount, winAmount, netGain, finalCoins,
        crashedCol: -1, crashedLane: -1,
      });
    } catch (e) {
      console.error('[CHICKEN] Result image error:', e?.message, e?.stack);
    }

    if (img && V2_AVAILABLE) {
      const c = new ContainerBuilder();
      c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://chicken_result.png')));
      return { components: [c], flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(img, { name: 'chicken_result.png' })], allowedMentions: { parse: [] } };
    }
    return {
      embeds: [embed.build(guildId, null, {
        title: '~ Chicken Crossing', image: 'attachment://chicken_result.png',
        description: `${diff.label} ・ ${netGain > 0 ? 'Gagne' : 'Perdu'} ・ Solde : ${embed.fmtCoins(finalCoins)} coins`,
        timestamp: false,
      })],
      files: [new AttachmentBuilder(img, { name: 'chicken_result.png' })],
      components: [],
    };
  };

  const buildSelect = (dk) => {
    const d = DIFFS[dk];
    if (V2_AVAILABLE) {
      const c = new ContainerBuilder();
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ~ Chicken Crossing\n\n` +
        `> Mise : **${embed.fmtCoins(amount)}** coins\n` +
        `> **${d.label}** ・ ${d.cars} voiture(s) par route\n\n` +
        `Multiplicateur par route : **x${d.mult}**\n` +
        `Gain max (sommet) : **${embed.fmtCoins(Math.floor(amount * laneMultVal(dk, LANES)))}** coins\n\n` +
        `Le poulet doit traverser ${LANES} routes en evitant les voitures.\n` +
        `Deplace-toi avec GAUCHE / DROITE et AVANCER pour monter.\n\n` +
        `Choisis ta difficulte :`
      ));
      c.addSeparatorComponents(new SeparatorBuilder());
      c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('chicken:easy').setLabel('Easy').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('chicken:medium').setLabel('Medium').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('chicken:hard').setLabel('Hard').setStyle(ButtonStyle.Danger),
      ));
      c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('chicken:start').setLabel('COMMENCER').setStyle(ButtonStyle.Secondary),
      ));
      return { components: [c], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
    }
    return {
      content: `~ Chicken Crossing\nMise : ${embed.fmtCoins(amount)} coins\n${d.label} ・ ${d.cars} voiture(s)/route\nGain max : ${embed.fmtCoins(Math.floor(amount * laneMultVal(dk, LANES)))} coins\n\nChoisis la difficulte :`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('chicken:easy').setLabel('Easy').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('chicken:medium').setLabel('Medium').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('chicken:hard').setLabel('Hard').setStyle(ButtonStyle.Danger),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('chicken:start').setLabel('COMMENCER').setStyle(ButtonStyle.Secondary),
        ),
      ],
    };
  };

  let currentDiffKey = diffKey;
  const sent = await message.reply(buildSelect(currentDiffKey)).catch(() => null);
  if (!sent) return;

  deductBet();
  let playing = false;

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId.startsWith('chicken:'),
    time: 180_000,
  });

  collector.on('collect', async i => {
    if (i.user.id !== userId)
      return i.reply({ content: "Ce n'est pas ta partie !", flags: MessageFlags.Ephemeral }).catch(() => {});
    if (finished) return i.deferUpdate().catch(() => {});

    const parts = i.customId.split(':');
    const action = parts[1];

    if (action === 'easy' || action === 'medium' || action === 'hard') {
      currentDiffKey = action;
      diffKey = action;
      diff = DIFFS[action];
      await i.deferUpdate().catch(() => {});
      return sent.edit(buildSelect(currentDiffKey)).catch(() => {});
    }

    if (action === 'start' && !playing) {
      playing = true;
      currentLane = 0;
      chickenCol = Math.floor(numCols / 2);
      allLaneCars = [];
      for (let l = 0; l < LANES; l++) {
        allLaneCars.push(pickCars(numCols, diff.cars));
      }
      await i.deferUpdate().catch(() => {});
      return sent.edit(await buildPlayingPanel()).catch(() => {});
    }

    if (action === 'cashout' && playing) {
      playing = false;
      finished = true;

      if (currentLane === 0) {
        await i.deferUpdate().catch(() => {});
        refundBet();
        const finalCoins = db.getCasinoUser(guildId, userId).coins;
        sendCasinoLog(message.guild, cfg, 'logChannelGames', {
          icon  : '↺',
          title : 'Chicken Crossing',

          user  : userId,
          lines : [
            `Mise : **${embed.fmtCoins(amount)}** coins`,
            `Remboursement : **${embed.fmtCoins(amount)}** coins`,
            `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
          ],
        });
        if (V2_AVAILABLE) {
          const c = new ContainerBuilder();
          c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## ~ Chicken Crossing\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ Annule\n> Solde : **${embed.fmtCoins(finalCoins)}** coins`
          ));
          return sent.edit({ components: [c], flags: COMPONENTS_V2_FLAG }).catch(() => {});
        }
        return sent.edit({ content: `~ Chicken Crossing annule. Solde : ${embed.fmtCoins(finalCoins)} coins`, components: [] }).catch(() => {});
      }

      await i.deferUpdate().catch(() => {});
      await sleep(200);
      return sent.edit(await buildResult(true, true)).catch(() => {});
    }

    if (action === 'left' && playing) {
      if (chickenCol > 0) chickenCol--;
      await i.deferUpdate().catch(() => {});
      return sent.edit(await buildPlayingPanel()).catch(() => {});
    }

    if (action === 'right' && playing) {
      if (chickenCol < numCols - 1) chickenCol++;
      await i.deferUpdate().catch(() => {});
      return sent.edit(await buildPlayingPanel()).catch(() => {});
    }

    if (action === 'up' && playing) {
      await i.deferUpdate().catch(() => {});

      const laneData = allLaneCars[currentLane];
      if (laneData && laneData.positions.has(chickenCol)) {
        playing = false;
        finished = true;
        crashedCol = chickenCol;
        crashedLane = currentLane;
        await sent.edit(await buildCrashPanel()).catch(() => {});
        await sleep(2000);
        return sent.edit(await buildResult(false, false)).catch(() => {});
      }

      currentLane++;

      if (currentLane >= LANES) {
        playing = false;
        finished = true;
        await sleep(500);
        return sent.edit(await buildResult(true, false)).catch(() => {});
      }

      return sent.edit(await buildPlayingPanel()).catch(() => {});
    }
  });

  collector.on('end', async () => {
    if (!finished) {
      playing = false;
      finished = true;
      if (currentLane > 0) {
        await sent.edit(await buildResult(true, true)).catch(() => {});
      } else {
        refundBet();
        const finalCoins = db.getCasinoUser(guildId, userId).coins;
        sendCasinoLog(message.guild, cfg, 'logChannelGames', {
          icon  : '↺',
          title : 'Chicken Crossing',

          user  : userId,
          lines : [
            `Mise : **${embed.fmtCoins(amount)}** coins`,
            `Remboursement : **${embed.fmtCoins(amount)}** coins (expiré)`,
            `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
          ],
        });
        if (V2_AVAILABLE) {
          const c = new ContainerBuilder();
          c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## ~ Chicken Crossing\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ **Expiré**\n> Remboursement : **${embed.fmtCoins(amount)}** coins\n> Solde : **${embed.fmtCoins(finalCoins)}** coins`
          ));
          await sent.edit({ components: [c], flags: COMPONENTS_V2_FLAG }).catch(() => {});
        } else {
          await sent.edit({ content: `~ Chicken Crossing expiré. Remboursement de ${embed.fmtCoins(amount)} coins. Solde : ${embed.fmtCoins(finalCoins)} coins`, components: [] }).catch(() => {});
        }
      }
    }
  });
};
