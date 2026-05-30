'use strict';


const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../core/database');

const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const BLACK_NUMBERS = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];

exports.help = {
  name        : 'roulette',
  description : 'Roulette simple — mise sur Rouge, Noir ou 0.',
  use         : 'roulette',
  usage       : 'roulette',
  aliases     : ['roul', 'spin'],
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

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('roulette:red')
      .setLabel('\u200B')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('roulette:black')
      .setLabel('\u200B')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('roulette:green')
      .setLabel('\u200B')
      .setStyle(ButtonStyle.Primary)
  );

  const sent = await message.reply({
    embeds: [
      embed.build(guildId, null, {
        title  : '🎰 **ROULETTE CASINO**',
        description: 'Place ton pari et tente ta chance !\n\n> 🔴 **Rouge** ― Multiplicateur **×2**\n> ⚫ **Noir** ― Multiplicateur **×2**\n> 🟢 **Zéro** ― Jackpot **×14**',
        color  : '#FFD700',
        timestamp: false,
      }),
    ],
    components: [row],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (!sent) return;

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId.startsWith('roulette:') && i.user.id === message.author.id,
    time: 60_000,
  });

  collector.on('collect', async interaction => {
    if (interaction.user.id !== message.author.id) {
      return interaction.reply({
        embeds: [embed.build(guildId, 'Ce n\'est pas ta partie !', { color: '#ED4245', timestamp: false })],
        flags: 64,
      }).catch(() => {});
    }

    collector.stop();

    const choice = interaction.customId.split(':')[1];
    const choiceText = choice === 'red' ? '🔴 Rouge' : choice === 'black' ? '⚫ Noir' : '🟢 0';
    const choiceColor = choice === 'red' ? '#E74C3C' : choice === 'black' ? '#34495E' : '#27AE60';

    await interaction.update({
      embeds: [
        embed.build(guildId, null, {
          title  : '🎰 La roulette tourne...',
          description: `Mise placée sur **${choiceText}**`,
          color  : choiceColor,
          timestamp: false,
        }),
      ],
      components: [],
    }).catch(() => {});

    await new Promise(r => setTimeout(r, 2500));

    const result = Math.floor(Math.random() * 37);
    let colorName, emoji;

    if (result === 0) {
      colorName = 'VERT';
      emoji = '🟢';
    } else if (RED_NUMBERS.includes(result)) {
      colorName = 'ROUGE';
      emoji = '🔴';
    } else {
      colorName = 'NOIR';
      emoji = '⚫';
    }

    let win = false;
    let multiplier = 0;

    if (choice === 'red' && RED_NUMBERS.includes(result)) {
      win = true;
      multiplier = 2;
    } else if (choice === 'black' && BLACK_NUMBERS.includes(result)) {
      win = true;
      multiplier = 2;
    } else if (choice === 'green' && result === 0) {
      win = true;
      multiplier = 14;
    }

    // Calcul des XP
    let xpGain = 0;
    if (win) {
      xpGain = multiplier === 14 ? 200 : 50; // Jackpot = 200 XP, Normal = 50 XP
    } else {
      xpGain = 10; // Participation
    }
    db.addXp(guildId, message.author.id, xpGain);

    const resultTitle = result === 0 ? '🟢 **JACKPOT**' : `${emoji} **${result}**`;
    const resultSubtitle = win ? '✅ **TU AS GAGNÉ**' : '❌ **PERDU**';

    await sent.edit({
      embeds: [
        embed.build(guildId, null, {
          title  : resultTitle,
          description: `${resultSubtitle}${win ? ` ・ Multiplicateur **×${multiplier}**` : ''}\n✨ **+${xpGain} XP**`,
          fields : [
            { name: '🎲 Numéro', value: `${emoji} ${colorName}`, inline: true },
            { name: '💰 Mise', value: choice === 'red' ? '🔴 Rouge' : choice === 'black' ? '⚫ Noir' : '🟢 Zéro', inline: true },
            { name: win ? '🎉 Gain' : '💸 Perte', value: win ? `**×${multiplier}**` : '×0', inline: true },
          ],
          color  : win ? '#57F287' : '#ED4245',
          timestamp: false,
        }),
      ],
    }).catch(() => {});
  });

  collector.on('end', (_, reason) => {
    if (reason !== 'time') return;
    sent.edit({
      embeds: [
        embed.build(guildId, null, {
          title: 'Temps écoulé',
          description: 'Tu n\'as pas fait de mise à temps !',
          color: '#95A5A6',
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
