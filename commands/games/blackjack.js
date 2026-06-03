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
  description : 'Blackjack 21 — Fais 21 ou bat le croupier sans dépasser !',
  use         : 'blackjack',
  usage       : 'blackjack',
  aliases     : ['bj', '21'],
  category    : 'games',
};

exports.run = async (client, message, args) => {
  const guildId     = message.guild.id;
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

  const _buildV2 = (status = '') => {
    const pVal         = handValue(playerHand);
    const bust         = pVal > 21;
    const dealerDisp   = gameOver ? formatHand(dealerHand) : `🎴 ${dealerHand[0]} + ? (caché)`;
    const header       = bust ? '## 💥 BUST — Tu as dépassé 21 !' : gameOver ? '## 🎰 Partie terminée' : `## 🎰 Blackjack${status ? ` — ${status}` : ' — Ton tour'}`;
    const body         = [`${header}`, ``, `**🎮 Toi** : ${formatHand(playerHand)}`, `**🎩 Croupier** : ${dealerDisp}`].join('\n');
    const container    = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    if (!gameOver && !bust) {
      container
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(1))
        .addActionRowComponents(_btnRow());
    }
    return { components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
  };

  const _buildLegacy = (status = '') => {
    const pVal       = handValue(playerHand);
    const bust       = pVal > 21;
    const dealerDisp = gameOver ? formatHand(dealerHand) : `🎴 ${dealerHand[0]} + ?`;
    return {
      embeds: [embed.build(guildId, null, {
        title : bust ? '💥 BUST !' : gameOver ? '🎰 Partie terminée' : `🎰 Blackjack${status ? ` — ${status}` : ''}`,
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
    ? await message.reply(_buildV2()).catch(() => null)
    : await message.reply({ ..._buildLegacy(), allowedMentions: { parse: [] } }).catch(() => null);

  if (!sent) return;

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
      await sent.edit(V2_AVAILABLE ? _buildV2(`🃏 +${newCard}`) : _buildLegacy(`+${newCard}`)).catch(() => {});
    } else {
      while (handValue(dealerHand) < 17) dealerHand.push(drawCard());
      gameOver = true;
      collector.stop('done');
    }
  });

  collector.on('end', async (_, reason) => {
    const pVal = handValue(playerHand);
    const dVal = handValue(dealerHand);

    let emoji, title, desc;
    if (reason === 'bust' || pVal > 21) {
      emoji = '💥'; title = 'BUST — PERDU';
      desc  = `Tu as **${pVal}** — dépassé 21 ! Croupier gagne.`;
    } else if (dVal > 21) {
      emoji = '🎉'; title = 'VICTOIRE !';
      desc  = `Croupier bust (**${dVal}**) — tu gagnes avec **${pVal}** !`;
    } else if (pVal > dVal) {
      emoji = '🎉'; title = 'VICTOIRE !';
      desc  = `**${pVal}** (toi) > **${dVal}** (croupier)`;
    } else if (pVal < dVal) {
      emoji = '😢'; title = 'DÉFAITE';
      desc  = `**${pVal}** (toi) < **${dVal}** (croupier)`;
    } else {
      emoji = '🤝'; title = 'ÉGALITÉ';
      desc  = `**${pVal}** partout — match nul.`;
    }

    if (V2_AVAILABLE) {
      const body = [
        `## ${emoji} ${title}`,
        ``,
        desc,
        ``,
        `**🎮 Toi** : ${formatHand(playerHand)}`,
        `**🎩 Croupier** : ${formatHand(dealerHand)}`,
      ].join('\n');
      const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
      await sent.edit({ components: [container], flags: COMPONENTS_V2_FLAG }).catch(() => {});
    } else {
      await sent.edit({
        embeds: [embed.build(guildId, null, {
          title: `${emoji} ${title}`, description: desc,
          fields: [
            { name: '🎮 Score', value: `Toi · **${pVal}**`,       inline: true },
            { name: '🎩 Croupier', value: `**${dVal}**`,           inline: true },
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
