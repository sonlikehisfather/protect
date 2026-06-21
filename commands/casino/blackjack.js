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
const { checkCasinoChannel, getGameCoteInfo, checkCasinoLimits, setCooldown } = require('./casino');
const { generateBlackjackImage } = require('../../utils/blackjackImage');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

const CARDS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 10, 'Q': 10, 'K': 10, 'A': 11 };

function drawCard() {
  return CARDS[Math.floor(Math.random() * CARDS.length)];
}

function handValue(hand) {
  let sum = hand.reduce((a, c) => a + VALUES[c], 0);
  let aces = hand.filter(c => c === 'A').length;
  while (sum > 21 && aces > 0) {
    sum -= 10;
    aces--;
  }
  return sum;
}

function formatHand(hand) {
  return hand.join(' ') + ` = **${handValue(hand)}**`;
}

exports.help = {
  name        : 'blackjack',
  description : 'Fais 21 ou bat le croupier sans dépasser !',
  use         : 'blackjack <montant>',
  usage       : 'blackjack 500',
  aliases     : ['bj', '21'],
  category    : 'casino',
  selfManaged : true,
};

exports.run = async (client, message, args) => {
  const guildId     = message.guild.id;
  const userId      = message.author.id;
  const chErr = checkCasinoChannel(message);
  if (chErr) return embed.replyError(message, chErr);

  // Validate bet amount
  const user = db.getCasinoUser(guildId, userId);
  const cfg = db.getCasinoConfig(guildId);
  let amount;
  if (args[0] && args[0].toLowerCase() === 'all') {
    amount = user.coins;
    if (cfg.limitBjMax > 0) amount = Math.min(amount, cfg.limitBjMax);
  } else {
    amount = parseInt(args[0]);
  }
  if (!amount || amount < 1) {
    if (args[0] && args[0].toLowerCase() === 'all')
      return embed.replyError(message, `Tu n'as aucun coin a parier. Solde : **${embed.fmtCoins(user.coins)}** coins`);
    return embed.replyError(message, 'Tu dois parier un montant valide. Usage : `+blackjack <montant|all>`');
  }

  const limitErr = checkCasinoLimits(message, 'blackjack', amount);
  if (limitErr) return embed.replyError(message, limitErr);

  if (user.coins < amount) {
    return embed.replyError(message, `Tu n'as pas assez de coins. Solde : **${embed.fmtCoins(user.coins)}** coins`);
  }

  setCooldown(guildId, userId, 'blackjack');

  let betDeducted = false;
  const deductBet = () => {
    if (betDeducted) return;
    betDeducted = true;
    db.removeCasinoCoins(guildId, userId, amount, 'spend');
    db.recordPendingBet(guildId, userId, amount, 'blackjack');
  };
  const refundBet = () => {
    if (!betDeducted) return;
    betDeducted = false;
    db.refundCasinoBet(guildId, userId, amount);
    db.clearPendingBet(guildId, userId, 'blackjack');
  };
  const { cote, bonuses } = getGameCoteInfo(guildId, message.member, 'blackjack');

  const guildConfig = db.getGuildConfig(guildId);
  const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
  const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
  const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

  if (deleteCmd) await message.delete().catch(() => {});

  let playerHand = [drawCard(), drawCard()];
  let dealerHand = [drawCard(), drawCard()];
  let gameOver   = false;

  const _btnRow = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj:hit').setLabel('Tirer 🃏').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj:stand').setLabel('Rester ✋').setStyle(ButtonStyle.Success),
  );

  const _buildV2 = async (status = '') => {
    const pVal = handValue(playerHand);
    const bust = pVal > 21;
    const dealerDisp = gameOver ? formatHand(dealerHand) : `${dealerHand[0]} + ?`;
    const header = bust ? '## 💥 BUST' : gameOver ? '## 🎰 Partie terminée' : `## 🎰 Blackjack${status ? ` ・ ${status}` : ''}`;
    const body = [header, '', `**🎮 Toi** : ${formatHand(playerHand)}`, `**🎩 Croupier** : ${dealerDisp}`].join('\n');

    let imageBuffer = null;
    try {
      imageBuffer = await generateBlackjackImage({
        playerHand, dealerHand, gameOver, amount, finalCoins: db.getCasinoUser(guildId, userId).coins,
      });
    } catch (e) {
      console.error('[BJ] Image error:', e?.message);
    }

    const container = new ContainerBuilder();
    if (imageBuffer) {
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://bj_result.png')));
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    }
    if (!gameOver && !bust) {
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(1))
        .addActionRowComponents(_btnRow());
    }
    const payload = { components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
    if (imageBuffer) payload.files = [new AttachmentBuilder(imageBuffer, { name: 'bj_result.png' })];
    return payload;
  };

  const _buildLegacy = (status = '') => {
    const pVal       = handValue(playerHand);
    const bust       = pVal > 21;
    const dealerDisp = gameOver ? formatHand(dealerHand) : `🎴 ${dealerHand[0]} + ?`;
    return {
      embeds: [embed.build(guildId, null, {
        title : bust ? '💥 BUST !' : gameOver ? '🎰 Partie terminée' : `🎰 Blackjack${status ? ` ・ ${status}` : ` ・ Mise: ${amount}`}`,
        fields: [
          { name: '🎮 Toi',       value: formatHand(playerHand), inline: true },
          { name: '🎩 Croupier',  value: dealerDisp,             inline: true },
        ],
        color: bust ? '#ED4245' : '#FFD700', timestamp: false,
      })],
      components: (!gameOver && !bust) ? [_btnRow()] : [],
    };
  };

  const sent = V2_AVAILABLE
    ? await message.reply(await _buildV2()).catch(() => null)
    : await message.reply({ ..._buildLegacy(), allowedMentions: { parse: [] } }).catch(() => null);

  if (!sent) return;

  deductBet();

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId.startsWith('bj:') && i.user.id === message.author.id,
    time: 120_000,
  });

  collector.on('collect', async interaction => {
    if (interaction.user.id !== message.author.id) {
      return interaction.reply({ content: "Ce n'est pas ta partie !", flags: 64 }).catch(() => {});
    }
    await interaction.deferUpdate().catch(() => {});

    if (interaction.customId === 'bj:hit') {
      const newCard = drawCard();
      playerHand.push(newCard);
      if (handValue(playerHand) > 21) {
        gameOver = true;
        collector.stop('bust');
        return;
      }
      await sent.edit(V2_AVAILABLE ? await _buildV2(`🃏 +${newCard}`) : _buildLegacy(`+${newCard}`)).catch(() => {});
    } else {
      while (handValue(dealerHand) < 17) dealerHand.push(drawCard());
      gameOver = true;
      collector.stop('done');
    }
  });

  collector.on('end', async (_, reason) => {
    if (reason !== 'bust' && reason !== 'done') {
      refundBet();
      const finalCoins = db.getCasinoUser(guildId, userId).coins;
      const { sendCasinoLog } = require('./casino');
      sendCasinoLog(message.guild, cfg, 'logChannelGames', {
        icon  : '↺',
        title : 'Blackjack',
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
          `## 🎰 Blackjack\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ **Expiré**\n> Remboursement : **${embed.fmtCoins(amount)}** coins\n> Solde : **${embed.fmtCoins(finalCoins)}** coins`
        ));
        await sent.edit({ components: [c], flags: COMPONENTS_V2_FLAG }).catch(() => {});
      } else {
        await sent.edit({ content: `🎰 Blackjack expiré. Remboursement de ${embed.fmtCoins(amount)} coins. Solde : ${embed.fmtCoins(finalCoins)} coins`, components: [] }).catch(() => {});
      }
      return;
    }

    const pVal = handValue(playerHand);
    const dVal = handValue(dealerHand);

    let emoji, title, desc, win = false, push = false, gain;
    if (reason === 'bust' || pVal > 21) {
      emoji = '💥'; title = 'BUST ・ Perdu';
      desc  = `Tu as **${pVal}** ・ dépassé 21 ! Croupier gagne.\n▱ Mise Perdue: **${embed.fmtCoins(amount)}**`;
      win = false;
      gain = -amount;
    } else if (dVal > 21) {
      emoji = '🎉'; title = 'VICTOIRE !';
      win = true;
    } else if (pVal > dVal) {
      emoji = '🎉'; title = 'VICTOIRE !';
      win = true;
    } else if (pVal < dVal) {
      emoji = '😢'; title = 'DÉFAITE';
      desc  = `**${pVal}** (toi) < **${dVal}** (croupier)\n▱ Mise Perdue: **${embed.fmtCoins(amount)}**`;
      win = false;
      gain = -amount;
    } else {
      emoji = '🤝'; title = 'ÉGALITÉ';
      desc  = `**${pVal}** partout ・ match nul.\n▱ Mise remboursée: **${embed.fmtCoins(amount)}**`;
      win = false;
      push = true;
      gain = 0;
    }

    // Handle payout based on cote
    let finalCoins;
    if (win) {
      // Calculate win: return bet * cote (cote is total multiplier)
      const winAmount = Math.floor(amount * cote);
      db.addCasinoCoins(guildId, userId, winAmount, 'win');
      gain = winAmount - amount; // Net gain
      const bonusStr = bonuses.length ? ` ・ ${bonuses.join(', ')}` : '';
      desc = `Croupier **${dVal}** ・ Tu gagnes avec **${pVal}** !\n▱ Cote x${cote.toFixed(2)}${bonusStr}: **+${embed.fmtCoins(gain)}**`;
    } else if (push) {
      db.addCasinoCoins(guildId, userId, amount); // Return bet only
    }
    db.clearPendingBet(guildId, userId, 'blackjack');

    // XP gain: scaled by net gain for wins, fixed for losses
    const csCfg = db.getCasinoConfig(guildId);
    const baseXp = win ? (csCfg.xpBjWin ?? 50) : push ? (csCfg.xpBjPush ?? 5) : (csCfg.xpBjLoss ?? 15);
    const xpGain = win ? Math.max(baseXp, Math.floor(gain / 500) + baseXp) : baseXp;
    db.addXp(guildId, userId, xpGain);

    finalCoins = db.getCasinoUser(guildId, userId).coins;

    const { sendCasinoLog } = require('./casino');
    sendCasinoLog(message.guild, csCfg, 'logChannelGames', {
      icon  : win ? '✸' : push ? '◇' : '↺',
      title : 'Blackjack',
      color : win ? 0x57F287 : push ? 0xFEE75C : 0xED4245,
      user  : userId,
      lines : [
        `Mise : **${embed.fmtCoins(amount)}** coins`,
        `Joueur : **${pVal}** ・ Croupier : **${dVal}**`,
        win
          ? `Gagne **+${embed.fmtCoins(gain)}** coins (x${cote.toFixed(2)})`
          : push
            ? `Egalite ・ mise remboursee`
            : `Perdu **-${embed.fmtCoins(amount)}** coins`,
        `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
      ],
    });

    let resultImage = null;
    try {
      resultImage = await generateBlackjackImage({
        playerHand, dealerHand, gameOver: true, win, push, bust: reason === 'bust' || pVal > 21,
        amount, finalCoins, cote, netGain: gain, bonuses,
      });
    } catch (e) {
      console.error('[BJ] Final image error:', e?.message);
    }

    if (resultImage) {
      if (V2_AVAILABLE) {
        const container = new ContainerBuilder().setAccentColor(win ? 0x57F287 : push ? 0xFEE75C : 0xED4245);
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://bj_result.png')));
        await sent.edit({
          components: [container],
          flags: COMPONENTS_V2_FLAG,
          files: [new AttachmentBuilder(resultImage, { name: 'bj_result.png' })],
        }).catch(() => {});
      } else {
        await sent.edit({
          embeds: [embed.build(guildId, null, {
            title: `${emoji} ${title}`, description: desc,
            image: 'attachment://bj_result.png',
            fields: [
              { name: '💰 Solde', value: `**${embed.fmtCoins(finalCoins)}** coins`, inline: false },
            ],
            color: win ? '#57F287' : push ? '#F1C40F' : '#ED4245',
            timestamp: false,
          })],
          files: [new AttachmentBuilder(resultImage, { name: 'bj_result.png' })],
          components: [],
        }).catch(() => {});
      }
    } else if (V2_AVAILABLE) {
      const body = [
        `## ${emoji} ${title}`,
        ``,
        desc,
        ``,
        `**🎮 Toi** : ${formatHand(playerHand)}`,
        `**🎩 Croupier** : ${formatHand(dealerHand)}`,
        ``,
        `▱ Solde : **${embed.fmtCoins(finalCoins)}**`,
      ].join('\n');
      const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
      await sent.edit({ components: [container], flags: COMPONENTS_V2_FLAG }).catch(() => {});
    } else {
      await sent.edit({
        embeds: [embed.build(guildId, null, {
          title: `${emoji} ${title}`, description: desc,
          fields: [
            { name: '🎮 Toi', value: `${formatHand(playerHand)}`, inline: true },
            { name: '🎩 Croupier', value: `${formatHand(dealerHand)}`, inline: true },
            { name: '💰 Solde', value: `**${embed.fmtCoins(finalCoins)}** coins`, inline: false },
          ],
          color: pVal > dVal || dVal > 21 ? '#57F287' : pVal === dVal ? '#F1C40F' : '#ED4245',
          timestamp: false,
        })],
        components: [],
      }).catch(() => {});
    }
  });

  if (deleteReply) embed.scheduleDelete(sent, deleteDelay);
};
