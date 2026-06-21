'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  AttachmentBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { checkCasinoChannel, checkCasinoLimits, setCooldown, sendCasinoLog } = require('./casino');
const { generateMineImage } = require('../../utils/mineImage');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

const GRID_SIZE = 5;
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
const SAFE_EMOJI = '◇';
const BOMB_EMOJI = '✸';
const HIDDEN_EMOJI = '■';

exports.help = {
  name       : 'mine',
  description: 'Mines ・ grille 5x5 avec des bombes, clique les cases sûres pour multiplier ta mise !',
  use        : 'mine <mise|all> [nb_bombes]',
  usage      : 'mine 1000 3',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const userId  = message.author.id;
  console.log(`[MINE] Start: guild=${guildId} user=${userId} args=${JSON.stringify(args)}`);

  const chErr = checkCasinoChannel(message);
  if (chErr) return embed.replyError(message, chErr);

  if (!db.isCasinoEnabled(guildId)) {
    return embed.replyError(message, 'Le casino n\'est pas actif.');
  }

  const user = db.getCasinoUser(guildId, userId);
  const cfg = db.getCasinoConfig(guildId);

  let amount;
  if (args[0] && args[0].toLowerCase() === 'all') {
    amount = user.coins;
    if (cfg.limitMineMax > 0) amount = Math.min(amount, cfg.limitMineMax);
  } else {
    amount = parseInt(args[0]);
  }
  if (!amount || amount < 1) {
    if (args[0] && args[0].toLowerCase() === 'all')
      return embed.replyError(message, `Tu n'as aucun coin a parier. Solde : **${embed.fmtCoins(user.coins)}** coins`);
    return embed.replyError(message, 'Tu dois parier un montant valide. Usage : `+mine <mise|all> [nb_bombes]`');
  }

  const limitErr = checkCasinoLimits(message, 'mine', amount);
  if (limitErr) return embed.replyError(message, limitErr);

  if (user.coins < amount) {
    return embed.replyError(message, `Tu n'as pas assez de coins. Solde : **${embed.fmtCoins(user.coins)}** coins`);
  }

  setCooldown(guildId, userId, 'mine');

  let bombCount = parseInt(args[1]);
  if (!bombCount || bombCount < 1) bombCount = cfg.limitMineBombs ?? 3;
  if (bombCount > 24) bombCount = 24;

  let betDeducted = false;
  const deductBet = () => {
    if (betDeducted) return;
    betDeducted = true;
    db.removeCasinoCoins(guildId, userId, amount, 'spend');
    db.recordPendingBet(guildId, userId, amount, 'mine');
  };
  const refundBet = () => {
    if (!betDeducted) return;
    betDeducted = false;
    db.refundCasinoBet(guildId, userId, amount);
    db.clearPendingBet(guildId, userId, 'mine');
  };

  const bombs = new Set();
  while (bombs.size < bombCount) {
    bombs.add(Math.floor(Math.random() * TOTAL_CELLS));
  }

  const revealed = new Set();
  let dead = false;
  let cashedOut = false;

  const HOUSE_EDGE = 0.95;
  const multiplier = (safeClicked) => {
    const safeTotal = TOTAL_CELLS - bombCount;
    let mult = 1;
    for (let i = 0; i < safeClicked; i++) {
      mult *= (TOTAL_CELLS - i) / (safeTotal - i);
    }
    return mult * HOUSE_EDGE;
  };

  const buildGridButtons = (disabled = false) => {
    const rows = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      const row = new ActionRowBuilder();
      for (let c = 0; c < GRID_SIZE; c++) {
        const idx = r * GRID_SIZE + c;
        const isRevealed = revealed.has(idx);
        const isBomb = bombs.has(idx);
        let label, style;

        if (isRevealed) {
          label = isBomb ? BOMB_EMOJI : SAFE_EMOJI;
          style = isBomb ? ButtonStyle.Danger : ButtonStyle.Success;
        } else {
          label = HIDDEN_EMOJI;
          style = ButtonStyle.Secondary;
        }

        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`mine:${idx}`)
            .setLabel(label)
            .setStyle(style)
            .setDisabled(disabled || isRevealed)
        );
      }
      rows.push(row);
    }
    return rows;
  };

  const buildV2 = (state) => {
    const safeClicked = revealed.size - (dead ? 1 : 0);
    const mult = multiplier(safeClicked);
    const potentialWin = Math.floor(amount * mult);
    const container = new ContainerBuilder().setAccentColor(
      state === 'dead' ? 0xED4245 : state === 'cashout' ? 0x57F287 : 0xFEE75C
    );

    let body = `## ■ Mines\n\n`;
    body += `> Mise : **${embed.fmtCoins(amount)}** coins ・ Bombes : **${bombCount}**\n`;
    body += `> Cases sûres : **${safeClicked}** / ${TOTAL_CELLS - bombCount}\n`;

    if (state === 'playing') {
      body += `> Gain potentiel : **${embed.fmtCoins(potentialWin)}** coins (x${mult.toFixed(2)})\n\n`;
      body += `-# Clique les cases pour révéler ・ CASH OUT pour encaisser.`;
    } else if (state === 'dead') {
      body += `\n> ‼ **BOMBE !** Tu as tout perdu.\n`;
      body += `> Perte : **-${embed.fmtCoins(amount)}** coins\n`;
      body += `> Solde : **${embed.fmtCoins(db.getCasinoUser(guildId, userId).coins)}** coins`;
    } else if (state === 'cashout') {
      const winAmount = Math.floor(amount * multiplier(revealed.size));
      body += `\n> ✓ **Cash out !** Tu repars avec **${embed.fmtCoins(winAmount)}** coins (x${multiplier(revealed.size).toFixed(2)})\n`;
      body += `> Solde : **${embed.fmtCoins(db.getCasinoUser(guildId, userId).coins)}** coins`;
    } else if (state === 'cleared') {
      body += `\n> ✓ **Grille cleared !** Toutes les cases sûres révélées.\n`;
      body += `> Gain : **${embed.fmtCoins(potentialWin)}** coins (x${mult.toFixed(2)})\n`;
      body += `> Solde : **${embed.fmtCoins(db.getCasinoUser(guildId, userId).coins)}** coins`;
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    if (state === 'playing') {
      const gridRows = buildGridButtons();
      for (const row of gridRows) container.addActionRowComponents(row);
      container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('mine:cashout').setLabel('CASH OUT').setStyle(ButtonStyle.Success),
      ));
    } else {
      const gridRows = buildGridButtons(true);
      for (const row of gridRows) container.addActionRowComponents(row);
    }

    return { components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
  };

  const buildLegacy = (state) => {
    const safeClicked = revealed.size - (dead ? 1 : 0);
    const mult = multiplier(safeClicked);
    const potentialWin = Math.floor(amount * mult);
    let text = `■ Mines\nMise : ${embed.fmtCoins(amount)} coins ・ Bombes : ${bombCount}\nCases sûres : ${safeClicked} / ${TOTAL_CELLS - bombCount}\n`;

    if (state === 'playing') {
      text += `Gain potentiel : ${embed.fmtCoins(potentialWin)} coins (x${mult.toFixed(2)})`;
      return { content: text, components: [...buildGridButtons(), new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('mine:cashout').setLabel('CASH OUT').setStyle(ButtonStyle.Success),
      )] };
    } else if (state === 'dead') {
      text += `\n‼ BOMBE ! Tu as tout perdu.\nPerte : -${embed.fmtCoins(amount)} coins\nSolde : ${embed.fmtCoins(db.getCasinoUser(guildId, userId).coins)} coins`;
      return { content: text, components: [...buildGridButtons(true)] };
    } else if (state === 'cashout') {
      const winAmount = Math.floor(amount * multiplier(revealed.size));
      text += `\n✓ Cash out ! Tu repars avec ${embed.fmtCoins(winAmount)} coins (x${multiplier(revealed.size).toFixed(2)})\nSolde : ${embed.fmtCoins(db.getCasinoUser(guildId, userId).coins)} coins`;
      return { content: text, components: [...buildGridButtons(true)] };
    } else if (state === 'cleared') {
      text += `\n✓ Grille cleared !\nGain : ${embed.fmtCoins(potentialWin)} coins (x${mult.toFixed(2)})\nSolde : ${embed.fmtCoins(db.getCasinoUser(guildId, userId).coins)} coins`;
      return { content: text, components: [...buildGridButtons(true)] };
    }
  };

  const sent = V2_AVAILABLE
    ? await message.reply(buildV2('playing')).catch((e) => { console.error('[MINE] Reply V2 error:', e?.message); return null; })
    : await message.reply(buildLegacy('playing')).catch((e) => { console.error('[MINE] Reply legacy error:', e?.message); return null; });

  if (!sent) { console.log(`[MINE] No sent message, aborting: user=${userId}`); return; }

  deductBet();
  console.log(`[MINE] Bet deducted: user=${userId} amount=${amount} bombs=${bombCount}`);

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId.startsWith('mine:'),
    time: 120_000,
  });

  collector.on('collect', async i => {
    try {
    console.log(`[MINE] Collect: user=${i.user.id} customId=${i.customId} revealed=${revealed.size}`);
    if (i.user.id !== userId) {
      return i.reply({ content: "Ce n'est pas ta partie !", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (i.customId === 'mine:cashout') {
      if (revealed.size > 0) {
        cashedOut = true;
        await i.deferUpdate().catch((e) => console.error('[MINE] deferUpdate cashout error:', e?.message));
        await new Promise(r => setTimeout(r, 100));
        collector.stop('cashout');
      } else {
        console.log(`[MINE] Cashout ignored: no reveals yet`);
      }
      return;
    }

    await i.deferUpdate().catch((e) => console.error('[MINE] deferUpdate error:', e?.message));

    const idx = parseInt(i.customId.split(':')[1]);
    if (isNaN(idx)) { console.log(`[MINE] Invalid idx: customId=${i.customId}`); return; }
    if (revealed.has(idx)) return;

    revealed.add(idx);
    console.log(`[MINE] Reveal: idx=${idx} isBomb=${bombs.has(idx)} revealed=${revealed.size}`);

    if (bombs.has(idx)) {
      dead = true;
      await new Promise(r => setTimeout(r, 100));
      collector.stop('dead');
      return;
    }

    if (revealed.size >= TOTAL_CELLS - bombCount) {
      const winAmount = Math.floor(amount * multiplier(revealed.size));
      db.addCasinoCoins(guildId, userId, winAmount, 'win');
      collector.stop('cleared');
      return;
    }

    if (V2_AVAILABLE) {
      await sent.edit(buildV2('playing')).catch((e) => console.error('[MINE] edit V2 playing error:', e?.message));
    } else {
      await sent.edit(buildLegacy('playing')).catch((e) => console.error('[MINE] edit legacy playing error:', e?.message));
    }
    } catch (e) {
      console.error('[MINE] Collect handler crash:', e?.message, e?.stack);
    }
  });

  collector.on('end', async (_, reason) => {
    console.log(`[MINE] End: reason=${reason} revealed=${revealed.size} dead=${dead} cashedOut=${cashedOut}`);
    let state, winAmount = 0;

    try {
    if (reason === 'dead') {
      state = 'dead';
      winAmount = 0;
      db.clearPendingBet(guildId, userId, 'mine');
    } else if (reason === 'cashout') {
      state = 'cashout';
      winAmount = Math.floor(amount * multiplier(revealed.size));
      db.addCasinoCoins(guildId, userId, winAmount, 'win');
      db.clearPendingBet(guildId, userId, 'mine');
    } else if (reason === 'cleared') {
      state = 'cleared';
      winAmount = Math.floor(amount * multiplier(revealed.size));
      db.clearPendingBet(guildId, userId, 'mine');
    } else if (revealed.size > 0) {
      state = 'cashout';
      winAmount = Math.floor(amount * multiplier(revealed.size));
      db.addCasinoCoins(guildId, userId, winAmount, 'win');
      db.clearPendingBet(guildId, userId, 'mine');
    } else {
      refundBet();
      const finalCoins = db.getCasinoUser(guildId, userId).coins;
      sendCasinoLog(message.guild, cfg, 'logChannelGames', {
        icon  : '↺',
        title : 'Mines',
        color : 0xFEE75C,
        user  : userId,
        lines : [
          `Mise : **${embed.fmtCoins(amount)}** coins`,
          `Remboursement : **${embed.fmtCoins(amount)}** coins (expiré)`,
          `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
        ],
      });
      if (V2_AVAILABLE) {
        const c = new ContainerBuilder().setAccentColor(0xFEE75C);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `## ■ Mines\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ **Expiré**\n> Remboursement : **${embed.fmtCoins(amount)}** coins\n> Solde : **${embed.fmtCoins(finalCoins)}** coins`
        ));
        await sent.edit({ components: [c], flags: COMPONENTS_V2_FLAG }).catch(() => {});
      } else {
        await sent.edit({ content: `■ Mines expiré. Remboursement de ${embed.fmtCoins(amount)} coins. Solde : ${embed.fmtCoins(finalCoins)} coins`, components: [] }).catch(() => {});
      }
      return;
    }

    const finalCoins = db.getCasinoUser(guildId, userId).coins;
    const netGain = winAmount - amount;
    const safeClickedFinal = reason === 'dead' ? revealed.size - 1 : revealed.size;
    const multFinal = multiplier(safeClickedFinal);

    const xpGain = netGain > 0 ? Math.max(15, Math.floor(netGain / 500) + 15) : 12;
    db.addXp(guildId, userId, xpGain);

    sendCasinoLog(message.guild, cfg, 'logChannelGames', {
      icon  : netGain > 0 ? '✸' : '↺',
      title : 'Mines',
      color : netGain > 0 ? 0x57F287 : 0xED4245,
      user  : userId,
      lines : [
        `Mise : **${embed.fmtCoins(amount)}** coins ・ Bombes : **${bombCount}**`,
        `Cases révélées : **${safeClickedFinal}** / ${TOTAL_CELLS - bombCount}`,
        netGain > 0
          ? `Gagne **+${embed.fmtCoins(netGain)}** coins (x${multFinal.toFixed(2)})`
          : `Perdu **-${embed.fmtCoins(amount)}** coins`,
        `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
      ],
    });

    let mineImage = null;
    try {
      mineImage = await generateMineImage({
        bombs, revealed, bombCount, amount, winAmount, finalCoins,
        state, safeClicked: safeClickedFinal, mult: multFinal,
        maxMult: multiplier(TOTAL_CELLS - bombCount),
      });
    } catch (e) {
      console.error('[MINE] Image error:', e?.message, e?.stack);
    }

    if (mineImage) {
      if (V2_AVAILABLE) {
        const container = new ContainerBuilder().setAccentColor(
          state === 'dead' ? 0xED4245 : 0x57F287
        );
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://mine_result.png')));
        await sent.edit({
          components: [container],
          flags: COMPONENTS_V2_FLAG,
          files: [new AttachmentBuilder(mineImage, { name: 'mine_result.png' })],
        }).catch((e) => console.error('[MINE] edit V2 image error:', e?.message));
      } else {
        await sent.edit({
          content: `■ Mines ・ ${state === 'dead' ? 'Perdu' : 'Cash Out'} ・ Solde : ${embed.fmtCoins(finalCoins)} coins`,
          files: [new AttachmentBuilder(mineImage, { name: 'mine_result.png' })],
          components: [...buildGridButtons(true)],
        }).catch((e) => console.error('[MINE] edit legacy image error:', e?.message));
      }
    } else {
      if (V2_AVAILABLE) {
        await sent.edit(buildV2(state)).catch((e) => console.error('[MINE] edit V2 end error:', e?.message));
      } else {
        await sent.edit(buildLegacy(state)).catch((e) => console.error('[MINE] edit legacy end error:', e?.message));
      }
    }
    } catch (e) {
      console.error('[MINE] End handler crash:', e?.message, e?.stack);
    }
  });
};
