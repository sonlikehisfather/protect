'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? null;
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder === 'function' &&
  typeof TextDisplayBuilder === 'function'
);

exports.help = {
  name        : 'coinflip',
  description : 'Lance une pièce (pile ou face).',
  use         : 'coinflip',
  usage       : 'coinflip',
  aliases     : ['pf', 'pileface', 'coin'],
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

  const btnPile = new ButtonBuilder()
    .setCustomId('coinflip:pile')
    .setLabel('Pile')
    .setEmoji('👤')
    .setStyle(ButtonStyle.Primary);

  const btnFace = new ButtonBuilder()
    .setCustomId('coinflip:face')
    .setLabel('Face')
    .setEmoji('⚡')
    .setStyle(ButtonStyle.Primary);

  let sent;

  // V2 désactivé car interaction.update avec embeds ne marche pas sur messages V2
  if (false && V2_AVAILABLE) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('# 🪙 Pile ou Face'),
      new TextDisplayBuilder().setContent('Choisis ton côté :'),
    );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(btnPile, btnFace));

    sent = await message.reply({
      flags: COMPONENTS_V2_FLAG,
      components: [container],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  } else {
    const row = new ActionRowBuilder().addComponents(btnPile, btnFace);
    sent = await message.reply({
      embeds: [
        embed.build(guildId, null, {
          title  : '🪙 Pile ou Face',
          description: 'Choisis ton côté :',
          color  : '#F1C40F',
          timestamp: false,
        }),
      ],
      components: [row],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  if (!sent) return;

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId === 'coinflip:pile' || i.customId === 'coinflip:face',
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

    const choice = interaction.customId === 'coinflip:pile' ? 'pile' : 'face';
    const result = Math.random() < 0.5 ? 'pile' : 'face';
    const win = choice === result;

    const emoji = result === 'pile' ? '👤' : '⚡';
    const winEmoji = win ? '✅' : '❌';

    // XP : Gagné = 30 XP, Perdu = 10 XP
    const xpGain = win ? 30 : 10;
    db.addXp(guildId, message.author.id, xpGain);

    await interaction.update({
      embeds: [
        embed.build(guildId, null, {
          title  : '🪙 Pile ou Face',
          fields : [
            { name: 'Ton choix',  value: choice.toUpperCase(), inline: true },
            { name: 'Résultat',   value: `${emoji} ${result.toUpperCase()}`, inline: true },
            { name: 'Résultat',   value: win ? `${winEmoji} Tu as gagné ! (+${xpGain} XP)` : `${winEmoji} Tu as perdu... (+${xpGain} XP)`, inline: false },
          ],
          color  : win ? '#57F287' : '#ED4245',
          timestamp: false,
        }),
      ],
      components: [],
    }).catch(() => {});
  });

  collector.on('end', (_, reason) => {
    if (reason !== 'time') return;
    sent.edit({ components: [] }).catch(() => {});
  });

  if (deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};
