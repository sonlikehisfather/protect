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
const { generateTowerImage } = require('../../utils/towerImage');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

const DIFFICULTIES = {
  easy:   { tiles: 4, bombs: 1, mult: 1.5,  label: 'Easy',   color: 0x57F287, floors: 5 },
  medium: { tiles: 3, bombs: 1, mult: 2,    label: 'Medium', color: 0x5865F2, floors: 5 },
  hard:   { tiles: 2, bombs: 1, mult: 3,    label: 'Hard',   color: 0xED4245, floors: 5 },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function floorMult(diff, floor) {
  return parseFloat(Math.pow(diff.mult, floor).toFixed(2));
}

function pickBombs(numTiles, numBombs) {
  const bombs = new Set();
  while (bombs.size < numBombs) bombs.add(Math.floor(Math.random() * numTiles));
  return bombs;
}

exports.help = {
  name       : 'tower',
  description: 'Tower ・ grimpe la tour en evitant les bombes, encaisse quand tu veux !',
  use        : 'tower <mise|all> [easy|medium|hard]',
  usage      : 'tower 1000 medium',
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
    return embed.replyError(message, 'Tu dois parier un montant valide. Usage : `+tower <mise|all> [easy|medium|hard]`');
  }

  const limitErr = checkCasinoLimits(message, 'tower', amount);
  if (limitErr) return embed.replyError(message, limitErr);

  if (user.coins < amount)
    return embed.replyError(message, `Tu n'as pas assez de coins. Solde : **${embed.fmtCoins(user.coins)}** coins`);

  setCooldown(guildId, userId, 'tower');

  let diffKey = (args[1] || 'medium').toLowerCase();
  if (!DIFFICULTIES[diffKey]) diffKey = 'medium';
  let diff = DIFFICULTIES[diffKey];

  let currentFloor = 0;
  let finished = false;
  let floorBombs = pickBombs(diff.tiles, diff.bombs);
  let allFloorBombs = [floorBombs];
  let betDeducted = false;

  const deductBet = () => {
    if (betDeducted) return;
    betDeducted = true;
    db.removeCasinoCoins(guildId, userId, amount, 'spend');
    db.recordPendingBet(guildId, userId, amount, 'tower');
  };

  const refundBet = () => {
    if (!betDeducted) return;
    betDeducted = false;
    db.refundCasinoBet(guildId, userId, amount);
    db.clearPendingBet(guildId, userId, 'tower');
  };

  const buildSelect = (dk) => {
    const d = DIFFICULTIES[dk];
    if (V2_AVAILABLE) {
      const c = new ContainerBuilder().setAccentColor(d.color);
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ▲ Tower\n\n> Mise : **${embed.fmtCoins(amount)}** coins\n` +
        `> **${d.label}** ・ ${d.tiles} tuiles ・ ${d.bombs} bombe\n\n` +
        `Multiplicateur par etage : **×${d.mult}**\n` +
        `Gain max (sommet) : **${embed.fmtCoins(Math.floor(amount * floorMult(d, d.floors)))}** coins\n\n` +
        `Choisis ta difficulte :`
      ));
      c.addSeparatorComponents(new SeparatorBuilder());
      c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tower:easy').setLabel('Easy').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('tower:medium').setLabel('Medium').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tower:hard').setLabel('Hard').setStyle(ButtonStyle.Danger),
      ));
      c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tower:start').setLabel('COMMENCER').setStyle(ButtonStyle.Secondary),
      ));
      return { components: [c], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
    }
    return {
      content: `▲ Tower\nMise : ${embed.fmtCoins(amount)} coins\n${d.label} ・ ${d.tiles} tuiles ・ ${d.bombs} bombe\nGain max : ${embed.fmtCoins(Math.floor(amount * floorMult(d, d.floors)))} coins\n\nChoisis la difficulte :`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('tower:easy').setLabel('Easy').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('tower:medium').setLabel('Medium').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('tower:hard').setLabel('Hard').setStyle(ButtonStyle.Danger),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('tower:start').setLabel('COMMENCER').setStyle(ButtonStyle.Secondary),
        ),
      ],
    };
  };

  const buildPlaying = (revealedFloor = -1, revealedBombs = null, revealedPick = -1) => {
    const FLOORS = diff.floors;
    const curMult = floorMult(diff, currentFloor + 1);
    const potentialWin = Math.floor(amount * curMult);
    const cashoutVal = currentFloor > 0 ? Math.floor(amount * floorMult(diff, currentFloor)) : 0;

    let text = `## ▲ Tower\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ **${diff.label}**\n` +
      `> Etage : **${currentFloor + 1}/${FLOORS}** ・ ×${curMult} ・ Gain potentiel : **${embed.fmtCoins(potentialWin)}** coins\n`;

    const rows = [];

    for (let f = FLOORS - 1; f >= 0; f--) {
      const isCurrent = f === currentFloor;
      const isPassed = f < currentFloor;

      if (isCurrent) {
        const tileBtns = [];
        for (let t = 0; t < diff.tiles; t++) {
          let label = `T${t + 1}`;
          let style = ButtonStyle.Secondary;
          let disabled = false;

          if (revealedFloor === f) {
            disabled = true;
            if (revealedBombs && revealedBombs.has(t)) {
              label = 'BOMBE';
              style = ButtonStyle.Danger;
            } else {
              label = 'SAFE';
              style = ButtonStyle.Success;
            }
          }

          tileBtns.push(
            new ButtonBuilder()
              .setCustomId(`tower:pick:${t}`)
              .setLabel(label)
              .setStyle(style)
              .setDisabled(disabled)
          );
        }

        tileBtns.push(
          new ButtonBuilder()
            .setCustomId('tower:cashout')
            .setLabel(currentFloor === 0 ? 'X' : `${embed.fmtCoins(cashoutVal)}`)
            .setStyle(currentFloor === 0 ? ButtonStyle.Danger : ButtonStyle.Success)
        );

        rows.push(new ActionRowBuilder().addComponents(...tileBtns));
      } else if (isPassed) {
        const tileBtns = [];
        for (let t = 0; t < diff.tiles; t++) {
          tileBtns.push(
            new ButtonBuilder()
              .setCustomId(`tower:done:${f}:${t}`)
              .setLabel('✓')
              .setStyle(ButtonStyle.Success)
              .setDisabled(true)
          );
        }
        rows.push(new ActionRowBuilder().addComponents(...tileBtns));
      } else {
        const tileBtns = [];
        for (let t = 0; t < diff.tiles; t++) {
          tileBtns.push(
            new ButtonBuilder()
              .setCustomId(`tower:locked:${f}:${t}`)
              .setLabel('—')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
          );
        }
        rows.push(new ActionRowBuilder().addComponents(...tileBtns));
      }
    }

    if (V2_AVAILABLE) {
      const c = new ContainerBuilder().setAccentColor(diff.color);
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
      c.addSeparatorComponents(new SeparatorBuilder());
      for (const row of rows) c.addActionRowComponents(row);
      return { components: [c], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
    }

    return { content: text, components: rows };
  };

  const buildResult = async (won, finalFloor, finalMult, cashedOut) => {
    let winAmount = 0;
    if (cashedOut && finalFloor > 0) winAmount = Math.floor(amount * finalMult);
    else if (won) winAmount = Math.floor(amount * finalMult);

    const netGain = winAmount - amount;
    if (winAmount > 0) db.addCasinoCoins(guildId, userId, winAmount, 'win');
    db.clearPendingBet(guildId, userId, 'tower');
    const finalCoins = db.getCasinoUser(guildId, userId).coins;

    const xpGain = netGain > 0 ? Math.max(15, Math.floor(netGain / 500) + 15) : 10;
    db.addXp(guildId, userId, xpGain);

    sendCasinoLog(message.guild, cfg, 'logChannelGames', {
      icon  : netGain > 0 ? '✸' : '↺',
      title : 'Tower',
      color : netGain > 0 ? 0x57F287 : 0xED4245,
      user  : userId,
      lines : [
        `Mise : **${embed.fmtCoins(amount)}** coins ・ Difficulte : **${diff.label}**`,
        `Etage atteint : **${finalFloor + 1}/${diff.floors}** → ×${finalMult}`,
        netGain > 0 ? `Gagne **+${embed.fmtCoins(netGain)}** coins` : `Perdu **-${embed.fmtCoins(Math.abs(netGain))}** coins`,
        `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
      ],
    });

    let towerImage = null;
    try {
      towerImage = await generateTowerImage({
        diffKey, floors: diff.floors, tiles: diff.tiles,
        currentFloor: finalFloor, floorBombs, allFloorBombs, revealedFloor: -1, revealedPick: -1,
        gameOver: true, won, cashedOut, amount, winAmount, netGain, finalCoins,
      });
    } catch (e) {
      console.error('[TOWER] Image error:', e?.message, e?.stack);
    }

    if (towerImage) {
      if (V2_AVAILABLE) {
        const container = new ContainerBuilder().setAccentColor(netGain > 0 ? 0x57F287 : 0xED4245);
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://tower_result.png')));
        return { components: [container], flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(towerImage, { name: 'tower_result.png' })], allowedMentions: { parse: [] } };
      }
      return {
        embeds: [embed.build(guildId, null, {
          title: '▲ Tower', image: 'attachment://tower_result.png',
          description: `${diff.label} ・ ${netGain > 0 ? 'Gagne' : 'Perdu'} ・ Solde : ${embed.fmtCoins(finalCoins)} coins`,
          color: netGain > 0 ? '#57F287' : '#ED4245', timestamp: false,
        })],
        files: [new AttachmentBuilder(towerImage, { name: 'tower_result.png' })],
        components: [],
      };
    }

    const FLOORS = diff.floors;
    const rows = [];
    for (let f = FLOORS - 1; f >= 0; f--) {
      const tileBtns = [];
      for (let t = 0; t < diff.tiles; t++) {
        let label = '—';
        let style = ButtonStyle.Secondary;
        if (f < finalFloor || (f === finalFloor && won)) {
          label = '✓';
          style = ButtonStyle.Success;
        } else if (f === finalFloor && !won) {
          label = '✕';
          style = ButtonStyle.Danger;
        }
        tileBtns.push(new ButtonBuilder().setCustomId(`tower:end:${f}:${t}`).setLabel(label).setStyle(style).setDisabled(true));
      }
      rows.push(new ActionRowBuilder().addComponents(...tileBtns));
    }

    let resultLine;
    if (cashedOut && finalFloor > 0) resultLine = `> ✸ **Encaisse !** Etage ${finalFloor} ・ ×${finalMult} → **+${embed.fmtCoins(netGain)}** coins`;
    else if (won) resultLine = `> ✸ **Sommet atteint !** ×${finalMult} → **+${embed.fmtCoins(netGain)}** coins`;
    else resultLine = `> ‼ **Bombe !** Etage ${finalFloor + 1} → **-${embed.fmtCoins(amount)}** coins`;

    let text = `## ▲ Tower\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ **${diff.label}**\n\n` +
      `### Resultat\n${resultLine}\n> Solde : **${embed.fmtCoins(finalCoins)}** coins`;

    if (V2_AVAILABLE) {
      const c = new ContainerBuilder().setAccentColor(netGain > 0 ? 0x57F287 : 0xED4245);
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
      c.addSeparatorComponents(new SeparatorBuilder());
      for (const row of rows) c.addActionRowComponents(row);
      return { components: [c], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
    }

    return { content: text, components: rows };
  };

  let currentDiffKey = diffKey;
  const sent = await message.reply(buildSelect(currentDiffKey)).catch(() => null);
  if (!sent) return;

  deductBet();
  let playing = false;

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId.startsWith('tower:'),
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
      diff = DIFFICULTIES[action];
      await i.deferUpdate().catch(() => {});
      return sent.edit(buildSelect(currentDiffKey)).catch(() => {});
    }

    if (action === 'start' && !playing) {
      playing = true;
      currentFloor = 0;
      floorBombs = pickBombs(diff.tiles, diff.bombs);
      allFloorBombs = [floorBombs];
      await i.deferUpdate().catch(() => {});
      return sent.edit(buildPlaying()).catch(() => {});
    }

    if (action === 'cashout' && playing) {
      playing = false;
      finished = true;

      if (currentFloor === 0) {
        await i.deferUpdate().catch(() => {});
        refundBet();
        const finalCoins = db.getCasinoUser(guildId, userId).coins;
        sendCasinoLog(message.guild, cfg, 'logChannelGames', {
          icon  : '↺',
          title : 'Tower',
          color : 0xFEE75C,
          user  : userId,
          lines : [
            `Mise : **${embed.fmtCoins(amount)}** coins`,
            `Remboursement : **${embed.fmtCoins(amount)}** coins`,
            `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
          ],
        });
        if (V2_AVAILABLE) {
          const c = new ContainerBuilder().setAccentColor(0xED4245);
          c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## ▲ Tower\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ Annule\n> Solde : **${embed.fmtCoins(finalCoins)}** coins`
          ));
          return sent.edit({ components: [c], flags: COMPONENTS_V2_FLAG }).catch(() => {});
        }
        return sent.edit({ content: `▲ Tower annule. Solde : ${embed.fmtCoins(finalCoins)} coins`, components: [] }).catch(() => {});
      }

      const cashMult = floorMult(diff, currentFloor);
      await i.deferUpdate().catch(() => {});
      await new Promise(r => setTimeout(r, 100));
      return sent.edit(await buildResult(true, currentFloor, cashMult, true)).catch(() => {});
    }

    if (action === 'pick' && playing) {
      const tileIdx = parseInt(parts[2]);
      if (isNaN(tileIdx) || tileIdx < 0 || tileIdx >= diff.tiles) return i.deferUpdate().catch(() => {});

      await i.deferUpdate().catch(() => {});

      if (floorBombs.has(tileIdx)) {
        playing = false;
        finished = true;
        await sent.edit(buildPlaying(currentFloor, floorBombs, tileIdx)).catch(() => {});
        await sleep(1500);
        return sent.edit(await buildResult(false, currentFloor, floorMult(diff, currentFloor + 1), false)).catch(() => {});
      }

      await sent.edit(buildPlaying(currentFloor, floorBombs, tileIdx)).catch(() => {});

      currentFloor++;

      if (currentFloor >= diff.floors) {
        playing = false;
        finished = true;
        await sleep(1000);
        return sent.edit(await buildResult(true, diff.floors - 1, floorMult(diff, diff.floors), false)).catch(() => {});
      }

      floorBombs = pickBombs(diff.tiles, diff.bombs);
      allFloorBombs.push(floorBombs);
      await sleep(600);
      return sent.edit(buildPlaying()).catch(() => {});
    }
  });

  collector.on('end', async () => {
    if (!finished) {
      playing = false;
      finished = true;
      if (currentFloor > 0) {
        const cashMult = floorMult(diff, currentFloor);
        await sent.edit(await buildResult(true, currentFloor, cashMult, true)).catch(() => {});
      } else {
        refundBet();
        const finalCoins = db.getCasinoUser(guildId, userId).coins;
        sendCasinoLog(message.guild, cfg, 'logChannelGames', {
          icon  : '↺',
          title : 'Tower',
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
            `## ▲ Tower\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ **Expiré**\n> Remboursement : **${embed.fmtCoins(amount)}** coins\n> Solde : **${embed.fmtCoins(finalCoins)}** coins`
          ));
          await sent.edit({ components: [c], flags: COMPONENTS_V2_FLAG }).catch(() => {});
        } else {
          await sent.edit({ content: `▲ Tower expiré. Remboursement de ${embed.fmtCoins(amount)} coins. Solde : ${embed.fmtCoins(finalCoins)} coins`, components: [] }).catch(() => {});
        }
      }
    }
  });
};
