'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  AttachmentBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { checkCasinoChannel, checkCasinoLimits, setCooldown, sendCasinoLog } = require('./casino');
const { generateRussianImage, MAX_CHAMBER, MULTIPLIERS } = require('../../utils/russianImage');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

const sleep = ms => new Promise(r => setTimeout(r, ms));

exports.help = {
  name       : 'russian',
  description: 'Roulette russe ・ survis pour multiplier ta mise, cash out ou risque tout !',
  use        : 'russian <mise|all>',
  usage      : 'russian 1000',
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

  const user = db.getCasinoUser(guildId, userId);
  const cfg = db.getCasinoConfig(guildId);

  let amount;
  if (args[0] && args[0].toLowerCase() === 'all') {
    amount = user.coins;
    if (cfg.limitRussianMax > 0) amount = Math.min(amount, cfg.limitRussianMax);
  } else {
    amount = parseInt(args[0]);
  }
  if (!amount || amount < 1) {
    if (args[0] && args[0].toLowerCase() === 'all')
      return embed.replyError(message, `Tu n'as aucun coin a parier. Solde : **${embed.fmtCoins(user.coins)}** coins`);
    return embed.replyError(message, 'Tu dois parier un montant valide. Usage : `+russian <mise|all>`');
  }

  const limitErr = checkCasinoLimits(message, 'russian', amount);
  if (limitErr) return embed.replyError(message, limitErr);

  if (user.coins < amount) {
    return embed.replyError(message, `Tu n'as pas assez de coins. Solde : **${embed.fmtCoins(user.coins)}** coins`);
  }

  setCooldown(guildId, userId, 'russian');

  const startTime = Date.now();

  let betDeducted = false;
  const deductBet = () => {
    if (betDeducted) return;
    betDeducted = true;
    db.removeCasinoCoins(guildId, userId, amount, 'spend');
    db.recordPendingBet(guildId, userId, amount, 'russian');
  };
  const refundBet = () => {
    if (!betDeducted) return;
    betDeducted = false;
    db.refundCasinoBet(guildId, userId, amount);
    db.clearPendingBet(guildId, userId, 'russian');
  };

  const bulletPos = Math.floor(Math.random() * MAX_CHAMBER);
  let currentPos = 0;
  let pulled = 0;
  let alive = true;
  let finished = false;

  const buildPanel = async (state) => {
    const mult = MULTIPLIERS[pulled] ?? MULTIPLIERS[MULTIPLIERS.length - 1];
    let winAmount = 0;
    let netGain = 0;
    const finalCoins = db.getCasinoUser(guildId, userId).coins;

    if (state === 'dead') {
      winAmount = 0;
      netGain = -amount;
    } else if (state === 'cashout') {
      winAmount = Math.floor(amount * (MULTIPLIERS[pulled - 1] ?? 1));
      netGain = winAmount - amount;
    } else if (state === 'maxsurvived') {
      winAmount = Math.floor(amount * MULTIPLIERS[pulled]);
      netGain = winAmount - amount;
    } else {
      winAmount = Math.floor(amount * mult);
    }

    let img = null;
    try {
      img = await generateRussianImage({
        state, pulled, amount, winAmount, netGain, finalCoins,
        bulletPos, currentPos,
      });
    } catch (e) {
      console.error('[RUSSIAN] Image error:', e?.message, e?.stack);
    }

    const accentColor = state === 'dead' ? 0xED4245 : (state === 'cashout' || state === 'maxsurvived') ? 0x57F287 : 0xFEE75C;

    if (img && V2_AVAILABLE) {
      const container = new ContainerBuilder().setAccentColor(accentColor);
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://russian_game.png')));

      if (state === 'playing') {
        container.addSeparatorComponents(new SeparatorBuilder());
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('russian:pull').setLabel('TIRER').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('russian:cashout').setLabel('CASH OUT').setStyle(ButtonStyle.Success).setDisabled(pulled === 0),
        ));
      }

      return { components: [container], flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(img, { name: 'russian_game.png' })], allowedMentions: { parse: [] } };
    }

    if (img) {
      const rows = state === 'playing' ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('russian:pull').setLabel('TIRER').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('russian:cashout').setLabel('CASH OUT').setStyle(ButtonStyle.Success).setDisabled(pulled === 0),
      )] : [];

      const desc = state === 'dead'
        ? `PAN ! Tu es mort. -${embed.fmtCoins(amount)} coins`
        : state === 'cashout'
        ? `Cash out ! +${embed.fmtCoins(netGain)} coins (x${(MULTIPLIERS[pulled - 1] ?? 1).toFixed(2)})`
        : state === 'maxsurvived'
        ? `Survivant ! +${embed.fmtCoins(netGain)} coins (x${mult.toFixed(2)})`
        : `Tir ${pulled}/${MAX_CHAMBER - 1} ・ x${mult.toFixed(2)} ・ Potentiel : ${embed.fmtCoins(winAmount)} coins`;

      return {
        embeds: [embed.build(guildId, null, {
          title: '◉ Roulette Russe', image: 'attachment://russian_game.png',
          description: desc, color: '#' + accentColor.toString(16).padStart(6, '0'), timestamp: false,
        })],
        files: [new AttachmentBuilder(img, { name: 'russian_game.png' })],
        components: rows,
      };
    }

    const chamberDisplay = Array.from({ length: MAX_CHAMBER }, (_, i) => i < pulled ? '○' : '◉').join(' ');
    let text = `◉ Roulette Russe\nChambre : ${chamberDisplay}\nMise : ${embed.fmtCoins(amount)} coins\nTir(s) survécu(s) : ${pulled} / ${MAX_CHAMBER - 1}\n`;

    if (state === 'playing') {
      text += `Gain potentiel : ${embed.fmtCoins(winAmount)} coins (x${mult})`;
      return { content: text, components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('russian:pull').setLabel('TIRER').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('russian:cashout').setLabel('CASH OUT').setStyle(ButtonStyle.Success).setDisabled(pulled === 0),
      )] };
    } else if (state === 'dead') {
      text += `\n‼ PAN ! Tu es mort.\nPerte : -${embed.fmtCoins(amount)} coins\nSolde : ${embed.fmtCoins(finalCoins)} coins`;
      return { content: text, components: [] };
    } else if (state === 'cashout') {
      text += `\n✓ Cash out ! +${embed.fmtCoins(netGain)} coins (x${(MULTIPLIERS[pulled - 1] ?? 1).toFixed(2)})\nSolde : ${embed.fmtCoins(finalCoins)} coins`;
      return { content: text, components: [] };
    } else if (state === 'maxsurvived') {
      text += `\n✓ Survivant ! +${embed.fmtCoins(netGain)} coins (x${mult.toFixed(2)})\nSolde : ${embed.fmtCoins(finalCoins)} coins`;
      return { content: text, components: [] };
    }
  };

  const sent = await message.reply(await buildPanel('playing')).catch(() => null);
  if (!sent) return;

  deductBet();

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId === 'russian:pull' || i.customId === 'russian:cashout',
    time: 60_000,
  });

  collector.on('collect', async i => {
    if (i.user.id !== userId) {
      return i.reply({ content: "Ce n'est pas ta partie !", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (finished) return i.deferUpdate().catch(() => {});

    if (i.customId === 'russian:cashout' && pulled > 0) {
      finished = true;
      await i.deferUpdate().catch(() => {});
      await sleep(200);
      collector.stop('cashout');
      return;
    }

    await i.deferUpdate().catch(() => {});

    if (i.customId === 'russian:pull') {
      const isBullet = currentPos === bulletPos;
      currentPos++;
      pulled++;

      if (isBullet) {
        alive = false;
        finished = true;
        await sent.edit(await buildPanel('dead')).catch(() => {});
        const deadDuration = Math.floor((Date.now() - startTime) / 1000);
        db.recordGameStat(guildId, userId, 'russian', 0, amount, 0);
        db.addPlaytime(guildId, userId, deadDuration);
        collector.stop('dead');
        return;
      }

      if (pulled >= MAX_CHAMBER - 1) {
        finished = true;
        const winAmount = Math.floor(amount * MULTIPLIERS[pulled]);
        db.addCasinoCoins(guildId, userId, winAmount, 'win');
        await sent.edit(await buildPanel('maxsurvived')).catch(() => {});
        collector.stop('maxsurvived');
        return;
      }

      await sent.edit(await buildPanel('playing')).catch(() => {});
    }
  });

  collector.on('end', async (_, reason) => {
    if (finished && reason !== 'timeout' && reason !== 'cashout') return;

    let state, winAmount = 0;

    if (reason === 'cashout' || (reason === 'timeout' && pulled > 0)) {
      finished = true;
      state = 'cashout';
      winAmount = Math.floor(amount * (MULTIPLIERS[pulled - 1] ?? 1));
      db.addCasinoCoins(guildId, userId, winAmount, 'win');
      db.clearPendingBet(guildId, userId, 'russian');
      const gameDuration = Math.floor((Date.now() - startTime) / 1000);
      db.recordGameStat(guildId, userId, 'russian', 1, amount, winAmount);
      db.addPlaytime(guildId, userId, gameDuration);
    } else if (reason === 'timeout') {
      refundBet();
      const finalCoins = db.getCasinoUser(guildId, userId).coins;
      sendCasinoLog(message.guild, cfg, 'logChannelGames', {
        icon  : '↺',
        title : 'Roulette Russe',
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
          `## ◉ Roulette Russe\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ **Expiré**\n> Remboursement : **${embed.fmtCoins(amount)}** coins\n> Solde : **${embed.fmtCoins(finalCoins)}** coins`
        ));
        await sent.edit({ components: [c], flags: COMPONENTS_V2_FLAG }).catch(() => {});
      } else {
        await sent.edit({ content: `◉ Roulette Russe expiré. Remboursement de ${embed.fmtCoins(amount)} coins. Solde : ${embed.fmtCoins(finalCoins)} coins`, components: [] }).catch(() => {});
      }
      return;
    } else {
      return;
    }

    const finalCoins = db.getCasinoUser(guildId, userId).coins;
    const netGain = winAmount - amount;

    const xpGain = netGain > 0 ? Math.max(20, Math.floor(netGain / 500) + 20) : 15;
    db.addXp(guildId, userId, xpGain);

    sendCasinoLog(message.guild, cfg, 'logChannelGames', {
      icon  : netGain > 0 ? '✸' : '↺',
      title : 'Roulette Russe',
      color : netGain > 0 ? 0x57F287 : 0xED4245,
      user  : userId,
      lines : [
        `Mise : **${embed.fmtCoins(amount)}** coins`,
        `Tir(s) survécu(s) : **${pulled}** / ${MAX_CHAMBER - 1}`,
        netGain > 0
          ? `Gagne **+${embed.fmtCoins(netGain)}** coins (x${(MULTIPLIERS[pulled - 1] ?? 1).toFixed(1)})`
          : `Perdu **-${embed.fmtCoins(amount)}** coins`,
        `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
      ],
    });

    await sent.edit(await buildPanel(state)).catch(() => {});
  });
};
