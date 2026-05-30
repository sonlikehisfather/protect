'use strict';


const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../core/database');

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
  const guildId = message.guild.id;

  const guildConfig = require('../../core/database').getGuildConfig(guildId);
  const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
  const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
  const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  let playerHand = [drawCard(), drawCard()];
  let dealerHand = [drawCard(), drawCard()];

  let playerDone = false;
  let gameOver = false;

  function buildEmbed(status = '') {
    const playerVal = handValue(playerHand);
    const bust = playerVal > 21;

    let title = '🎰 Blackjack — Ton tour';
    if (bust) title = '💥 BUST ! Tu as dépassé 21 !';
    else if (gameOver) title = '🎰 PARTIE TERMINÉE';
    else if (status) title = status;

    const dealerDisplay = gameOver
      ? formatHand(dealerHand)
      : `🎴 ${dealerHand[0]} + ? (total caché)`;

    return embed.build(guildId, null, {
      title  : title,
      description: bust ? '**Perdu !** Tu as dépassé 21.' : undefined,
      fields : [
        { name: '🎮 Toi', value: formatHand(playerHand), inline: true },
        { name: '🎩 Croupier', value: dealerDisplay, inline: true },
      ],
      color  : bust ? '#ED4245' : gameOver ? (handValue(playerHand) > handValue(dealerHand) && handValue(playerHand) <= 21 ? '#57F287' : '#ED4245') : '#FFD700',
      timestamp: false,
    });
  }

  function buildButtons() {
    if (gameOver || handValue(playerHand) > 21) return [];
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('bj:hit')
          .setLabel('Tirer 🃏')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('bj:stand')
          .setLabel('Rester ✋')
          .setStyle(ButtonStyle.Success)
      ),
    ];
  }

  const sent = await message.reply({
    embeds: [
      embed.build(guildId, null, {
        title  : '🎰 Blackjack — Nouvelle partie',
        description: '**Règle :** Fais **21** ou approche-toi le plus possible sans dépasser !\n\n🎮 **Ton tour** — 2 cartes distribuées',
        fields : [
          { name: '🎮 Toi', value: formatHand(playerHand), inline: true },
          { name: '🎩 Croupier', value: `🎴 ${dealerHand[0]} + ?`, inline: true },
        ],
        color  : '#FFD700',
        timestamp: false,
      }),
    ],
    components: buildButtons(),
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (!sent) return;

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId.startsWith('bj:') && i.user.id === message.author.id,
    time: 120_000,
  });

  collector.on('collect', async interaction => {
    if (interaction.user.id !== message.author.id) {
      return interaction.reply({
        embeds: [embed.build(guildId, '❌ Ce n\'est pas ta partie !', { color: '#ED4245', timestamp: false })],
        flags: 64,
      }).catch(() => {});
    }

    if (interaction.customId === 'bj:hit') {
      const newCard = drawCard();
      playerHand.push(newCard);

      if (handValue(playerHand) > 21) {
        gameOver = true;
        playerDone = true;
        collector.stop('bust');
        return;
      }

      await interaction.update({
        embeds: [buildEmbed(`🃏 Nouvelle carte : **${newCard}**`)],
        components: buildButtons(),
      }).catch(() => {});
    } else {
      playerDone = true;

      while (handValue(dealerHand) < 17) {
        dealerHand.push(drawCard());
      }
      gameOver = true;
      collector.stop('done');
    }
  });

  collector.on('end', async (_, reason) => {
    const pVal = handValue(playerHand);
    const dVal = handValue(dealerHand);

    let resultTitle, resultDesc, resultColor, resultEmoji;

    if (reason === 'bust' || pVal > 21) {
      resultTitle = ' BUST ! PERDU';
      resultEmoji = '💥';
      resultDesc = `Tu as **${pVal}** — Tu dépasses 21 !\nLe croupier gagne.`;
      resultColor = '#ED4245';
    } else if (dVal > 21) {
      resultTitle = ' VICTOIRE !';
      resultEmoji = '🎉';
      resultDesc = `Le croupier a **${dVal}** et bust !\nTu gagnes avec **${pVal}** !`;
      resultColor = '#57F287';
    } else if (pVal > dVal) {
      resultTitle = ' VICTOIRE !';
      resultEmoji = '🎉';
      resultDesc = `**${pVal}** (toi) > **${dVal}** (croupier)\nTu bats le croupier !`;
      resultColor = '#57F287';
    } else if (pVal < dVal) {
      resultTitle = ' DÉFAITE';
      resultEmoji = '😢';
      resultDesc = `**${pVal}** (toi) < **${dVal}** (croupier)\nLe croupier gagne.`;
      resultColor = '#ED4245';
    } else {
      resultTitle = ' ÉGALITÉ';
      resultEmoji = '🤝';
      resultDesc = `**${pVal}** partout !\nMatch nul.`;
      resultColor = '#F1C40F';
    }

    await sent.edit({
      embeds: [
        embed.build(guildId, null, {
          title  : `${resultEmoji} ${resultTitle}`,
          description: resultDesc,
          fields : [
            { name: '🎮 Score final', value: `Toi ・ **${pVal}**`, inline: true },
            { name: '🎩 Croupier', value: `・ **${dVal}**`, inline: true },
          ],
          color  : resultColor,
          timestamp: false,
        }),
      ],
      components: [],
    }).catch(() => {});
  });

  if (deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};
