'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const embed = require('../../utils/embed');
const db    = require('../../core/database');
const { checkCasinoChannel, checkCasinoLimits, setCooldown, sendCasinoLog } = require('./casino');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

const ROWS  = 12;
const SLOTS = ROWS + 1;
const ANIM_DELAY = 600;

const MULTIPLIERS = {
  low:    [2, 1.8, 1.6, 1.4, 1.2, 1, 0.5, 1, 1.2, 1.4, 1.6, 1.8, 2],
  medium: [7, 3.5, 2, 1.5, 1, 0.5, 0.2, 0.5, 1, 1.5, 2, 3.5, 7],
  high:   [12, 5, 2, 1, 0.5, 0.3, 0.1, 0.3, 0.5, 1, 2, 5, 12],
};

const RISK_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

const CELL_W = 4;
const TOTAL_W = SLOTS * CELL_W;

const padCenter = (s, w = CELL_W) => {
  const total = w - s.length;
  if (total <= 0) return s;
  const left = Math.floor(total / 2);
  return ' '.repeat(left) + s + ' '.repeat(total - left);
};

function buildGrid(path, currentRow, finalSlot, mults) {
  const lines = [];

  for (let r = 0; r < ROWS; r++) {
    const numPegs = r + 1;
    const pegsW = numPegs * CELL_W;
    const pad = Math.floor((TOTAL_W - pegsW) / 2);
    let row = ' '.repeat(pad);
    for (let p = 0; p < numPegs; p++) {
      const showBall = r <= currentRow;
      const ballPos = path[r] ?? 0;
      if (showBall && p === ballPos) {
        row += padCenter('●');
      } else {
        row += padCenter('·');
      }
    }
    lines.push(row);
  }

  let slotsLine = '';
  for (let i = 0; i < SLOTS; i++) {
    const m = mults[i];
    let s;
    if (currentRow >= ROWS && i === finalSlot) {
      s = `[×${m}]`;
    } else {
      s = `×${m}`;
    }
    slotsLine += padCenter(s);
  }

  return '```\n' + lines.join('\n') + '\n\n' + slotsLine + '\n```';
}

exports.help = {
  name       : 'plinko',
  description: 'Plinko ・ la balle tombe a travers les clous, atterris sur le meilleur multiplicateur !',
  use        : 'plinko <mise|all> [low|medium|high]',
  usage      : 'plinko 1000 medium',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const userId  = message.author.id;

  const chErr = checkCasinoChannel(message);
  if (chErr) return embed.replyError(message, chErr);

  if (!db.isCasinoEnabled(guildId)) {
    return embed.replyError(message, 'Le casino n\'est pas active.');
  }

  const user = db.getCasinoUser(guildId, userId);
  const cfg  = db.getCasinoConfig(guildId);

  let amount;
  if (args[0] && args[0].toLowerCase() === 'all') {
    amount = user.coins;
  } else {
    amount = parseInt(args[0]);
  }
  if (!amount || amount < 1) {
    if (args[0] && args[0].toLowerCase() === 'all')
      return embed.replyError(message, `Tu n'as aucun coin a parier. Solde : **${embed.fmtCoins(user.coins)}** coins`);
    return embed.replyError(message, 'Tu dois parier un montant valide. Usage : `+plinko <mise|all> [low|medium|high]`');
  }

  const limitErr = checkCasinoLimits(message, 'plinko', amount);
  if (limitErr) return embed.replyError(message, limitErr);

  if (user.coins < amount) {
    return embed.replyError(message, `Tu n'as pas assez de coins. Solde : **${embed.fmtCoins(user.coins)}** coins`);
  }

  setCooldown(guildId, userId, 'plinko');

  const startTime = Date.now();

  let risk = (args[1] || 'medium').toLowerCase();
  if (!MULTIPLIERS[risk]) risk = 'medium';

  let betDeducted = false;
  const deductBet = () => {
    if (betDeducted) return;
    betDeducted = true;
    db.removeCasinoCoins(guildId, userId, amount, 'spend');
  };
  const refundBet = () => {
    if (!betDeducted) return;
    betDeducted = false;
    db.refundCasinoBet(guildId, userId, amount);
  };

  const buildSelect = (currentRisk) => {
    const mults = MULTIPLIERS[currentRisk];
    let slotsLine = '';
    for (let i = 0; i < SLOTS; i++) {
      const m = mults[i];
      const bold = m >= 5 ? '**' : '';
      slotsLine += `${bold}×${m}${bold} `;
    }

    if (V2_AVAILABLE) {
      const container = new ContainerBuilder().setAccentColor(0x5865F2);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ◉ Plinko\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ Risque : **${RISK_LABELS[currentRisk]}**\n\nChoisis ton niveau de risque puis lance la balle !`
      ));
      container.addSeparatorComponents(new SeparatorBuilder());
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Multiplicateurs\n${slotsLine}`));
      container.addSeparatorComponents(new SeparatorBuilder());
      container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('plinko:low').setLabel('Low').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('plinko:medium').setLabel('Medium').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('plinko:high').setLabel('High').setStyle(ButtonStyle.Danger),
      ));
      container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('plinko:drop').setLabel('LACHER LA BALLE').setStyle(ButtonStyle.Secondary),
      ));
      return { components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
    }

    return {
      content: `◉ Plinko\nMise : ${embed.fmtCoins(amount)} coins ・ Risque : ${RISK_LABELS[currentRisk]}\n\nMultiplicateurs : ${mults.map(m => '×' + m).join(' ')}\n\nChoisis le risque puis lance la balle !`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('plinko:low').setLabel('Low').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('plinko:medium').setLabel('Medium').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('plinko:high').setLabel('High').setStyle(ButtonStyle.Danger),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('plinko:drop').setLabel('LACHER LA BALLE').setStyle(ButtonStyle.Secondary),
        ),
      ],
    };
  };

  const buildAnimFrame = (path, currentRow, finalSlot, mults) => {
    const grid = buildGrid(path, currentRow, finalSlot, mults);
    const header = `## ◉ Plinko\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ Risque : **${RISK_LABELS[risk]}**\n`;

    if (V2_AVAILABLE) {
      const container = new ContainerBuilder().setAccentColor(0x5865F2);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header + '\n' + grid));
      return { components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
    }

    return { content: `◉ Plinko\nMise : ${embed.fmtCoins(amount)} coins ・ Risque : ${RISK_LABELS[risk]}\n\n${grid}`, components: [] };
  };

  const buildResult = async (path, finalSlot, mults) => {
    const finalMult = mults[finalSlot];
    const winAmount = Math.floor(amount * finalMult);
    const netGain = winAmount - amount;

    if (winAmount > 0) db.addCasinoCoins(guildId, userId, winAmount, 'win');

    // Track game stats
    const gameDuration = Math.floor((Date.now() - startTime) / 1000);
    db.recordGameStat(guildId, userId, 'plinko', netGain > 0 ? 1 : 0, amount, netGain > 0 ? netGain : 0);
    db.addPlaytime(guildId, userId, gameDuration);
    const finalCoins = db.getCasinoUser(guildId, userId).coins;

    const xpGain = netGain > 0 ? Math.max(15, Math.floor(netGain / 500) + 15) : 10;
    db.addXp(guildId, userId, xpGain);

    sendCasinoLog(message.guild, cfg, 'logChannelGames', {
      icon  : netGain > 0 ? '✸' : '↺',
      title : 'Plinko',
      color : netGain > 0 ? 0x57F287 : 0xED4245,
      user  : userId,
      lines : [
        `Mise : **${embed.fmtCoins(amount)}** coins ・ Risque : **${RISK_LABELS[risk]}**`,
        `Slot : **${finalSlot + 1}/${SLOTS}** → ×${finalMult}`,
        netGain > 0 ? `Gagne **+${embed.fmtCoins(netGain)}** coins` : `Perdu **-${embed.fmtCoins(Math.abs(netGain))}** coins`,
        `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
      ],
    });

    try {
      const { generatePlinkoImage } = require('../../utils/plinkoImage');
      const { AttachmentBuilder } = require('discord.js');
      const buffer = await generatePlinkoImage({
        path, finalSlot, mults, risk,
        amount, winAmount, netGain, finalCoins,
        riskLabel: RISK_LABELS[risk],
      });
      const attachment = new AttachmentBuilder(buffer, { name: 'plinko.png' });
      return { files: [attachment], components: [], allowedMentions: { parse: [] } };
    } catch (imgErr) {
      console.error('[Plinko] Image error:', imgErr?.message);
      const grid = buildGrid(path, ROWS, finalSlot, mults);
      const slotDisplay = mults.map((m, i) => i === finalSlot ? `**[×${m}]**` : `×${m}`).join(' ');
      let resultLine;
      if (netGain > 0) resultLine = `> ✸ **Gagne !** ×${finalMult} → **+${embed.fmtCoins(netGain)}** coins`;
      else if (netGain === 0) resultLine = `> = **Egalite.** ×${finalMult} → **${embed.fmtCoins(winAmount)}** coins`;
      else resultLine = `> ‼ **Perdu.** ×${finalMult} → **-${embed.fmtCoins(Math.abs(netGain))}** coins`;
      const header = `## ◉ Plinko\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ Risque : **${RISK_LABELS[risk]}**\n`;
      if (V2_AVAILABLE) {
        const container = new ContainerBuilder().setAccentColor(netGain > 0 ? 0x57F287 : netGain === 0 ? 0xFEE75C : 0xED4245);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
          header + '\n' + grid + '\n\n### Resultat\n' + slotDisplay + '\n\n' + resultLine + '\n> Solde : **' + embed.fmtCoins(finalCoins) + '** coins'
        ));
        return { components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
      }
      return { content: `◉ Plinko\n${netGain >= 0 ? 'Gagne' : 'Perdu'} ×${finalMult} | Solde : ${embed.fmtCoins(finalCoins)} coins`, components: [] };
    }
  };

  let currentRisk = risk;
  const sent = await message.reply(buildSelect(currentRisk)).catch(() => null);
  if (!sent) return;

  deductBet();
  let animating = false;

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId.startsWith('plinko:'),
    time: 120_000,
  });

  collector.on('collect', async i => {
    if (i.user.id !== userId) {
      return i.reply({ content: "Ce n'est pas ta partie !", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (animating) return i.deferUpdate().catch(() => {});

    const action = i.customId.split(':')[1];

    if (action === 'low' || action === 'medium' || action === 'high') {
      currentRisk = action;
      await i.deferUpdate().catch(() => {});
      return sent.edit(buildSelect(currentRisk)).catch(() => {});
    }

    if (action === 'drop') {
      animating = true;
      await i.deferUpdate().catch(() => {});

      risk = currentRisk;
      const mults = MULTIPLIERS[risk];

      const path = [];
      let pos = 0;
      for (let r = 0; r < ROWS; r++) {
        if (Math.random() < 0.5) pos++;
        path.push(pos);
      }
      const finalSlot = pos;

      collector.stop('dropped');

      for (let r = 0; r <= ROWS; r++) {
        await sent.edit(buildAnimFrame(path, r, finalSlot, mults)).catch(() => {});
        if (r < ROWS) await sleep(ANIM_DELAY);
      }

      await sleep(ANIM_DELAY);
      await sent.edit(await buildResult(path, finalSlot, mults)).catch(() => {});
    }
  });

  collector.on('end', async (_, reason) => {
    if (reason !== 'dropped' && !animating) {
      refundBet();
      const finalCoins = db.getCasinoUser(guildId, userId).coins;
      sendCasinoLog(message.guild, cfg, 'logChannelGames', {
        icon  : '↺',
        title : 'Plinko',
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
          `## ◉ Plinko\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ **Expiré**\n> Remboursement : **${embed.fmtCoins(amount)}** coins\n> Solde : **${embed.fmtCoins(finalCoins)}** coins`
        ));
        await sent.edit({ components: [c], flags: COMPONENTS_V2_FLAG }).catch(() => {});
      } else {
        await sent.edit({ content: `◉ Plinko expiré. Remboursement de ${embed.fmtCoins(amount)} coins. Solde : ${embed.fmtCoins(finalCoins)} coins`, components: [] }).catch(() => {});
      }
    }
  });
};
