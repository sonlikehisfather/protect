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

const RED_NUMBERS   = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
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
  const guildId     = message.guild.id;
  const guildConfig = db.getGuildConfig(guildId);
  const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
  const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
  const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

  if (deleteCmd) await message.delete().catch(() => {});

  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('roulette:red').setLabel('🔴 Rouge').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('roulette:black').setLabel('⚫ Noir').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('roulette:green').setLabel('🟢 Zéro').setStyle(ButtonStyle.Success),
  );

  const _buildV2 = (state, extra = {}) => {
    const container = new ContainerBuilder();
    if (state === 'pick') {
      container
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          '## 🎰 Roulette Casino\n\nPlace ton pari et tente ta chance !\n\n> 🔴 **Rouge** — ×2\n> ⚫ **Noir** — ×2\n> 🟢 **Zéro** — ×14 Jackpot',
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(1))
        .addActionRowComponents(btnRow);
    } else if (state === 'spinning') {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🎰 La roulette tourne…\n\nMise placée sur **${extra.choiceText}**`,
      ));
    } else {
      const { win, multiplier, xpGain, emoji, colorName, choiceMise, resultNum } = extra;
      const verdict = win ? `✔ **TU AS GAGNÉ** × ${multiplier}` : '✖ **PERDU**';
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `## 🎰 ${resultNum === 0 ? '🟢 JACKPOT !' : `${emoji} ${resultNum}`}`,
        ``,
        `${verdict}`,
        `✨ +${xpGain} XP`,
        ``,
        `**Numéro** : ${emoji} ${colorName}`,
        `**Mise** : ${choiceMise}`,
        `**Gain** : ${win ? `×${multiplier}` : '×0'}`,
      ].join('\n')));
    }
    return { components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
  };

  const sent = V2_AVAILABLE
    ? await message.reply(_buildV2('pick')).catch(() => null)
    : await message.reply({
        embeds: [embed.build(guildId, null, {
          title: '🎰 ROULETTE CASINO',
          description: 'Place ton pari !\n\n> 🔴 **Rouge** ×2\n> ⚫ **Noir** ×2\n> 🟢 **Zéro** ×14',
          color: '#FFD700', timestamp: false,
        })],
        components: [btnRow],
        allowedMentions: { parse: [] },
      }).catch(() => null);

  if (!sent) return;

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId.startsWith('roulette:') && i.user.id === message.author.id,
    time: 60_000,
  });

  collector.on('collect', async interaction => {
    if (interaction.user.id !== message.author.id) {
      return interaction.reply({ content: "Ce n'est pas ta partie !", flags: 64 }).catch(() => {});
    }
    collector.stop('done');
    await interaction.deferUpdate().catch(() => {});

    const choice     = interaction.customId.split(':')[1];
    const choiceText = choice === 'red' ? '🔴 Rouge' : choice === 'black' ? '⚫ Noir' : '🟢 Zéro';

    if (V2_AVAILABLE) await sent.edit(_buildV2('spinning', { choiceText })).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));

    const resultNum = Math.floor(Math.random() * 37);
    let colorName, emoji;
    if (resultNum === 0)                       { colorName = 'VERT';  emoji = '🟢'; }
    else if (RED_NUMBERS.includes(resultNum))  { colorName = 'ROUGE'; emoji = '🔴'; }
    else                                       { colorName = 'NOIR';  emoji = '⚫'; }

    const win = (choice === 'red' && RED_NUMBERS.includes(resultNum)) ||
                (choice === 'black' && BLACK_NUMBERS.includes(resultNum)) ||
                (choice === 'green' && resultNum === 0);
    const multiplier = choice === 'green' ? 14 : 2;
    const xpGain     = win ? (multiplier === 14 ? 200 : 50) : 10;
    db.addXp(guildId, message.author.id, xpGain);

    if (V2_AVAILABLE) {
      await sent.edit(_buildV2('result', { win, multiplier: win ? multiplier : 0, xpGain, emoji, colorName, choiceMise: choiceText, resultNum })).catch(() => {});
    } else {
      await sent.edit({
        embeds: [embed.build(guildId, null, {
          title: resultNum === 0 ? '🟢 JACKPOT' : `${emoji} ${resultNum}`,
          description: `${win ? '✔ GAGNÉ' : '✖ PERDU'}${win ? ` ×${multiplier}` : ''}\n✨ +${xpGain} XP`,
          fields: [
            { name: '🎲 Numéro', value: `${emoji} ${colorName}`,                                           inline: true },
            { name: '💰 Mise',   value: choiceText,                                                         inline: true },
            { name: win ? '🎉 Gain' : '💸 Perte', value: win ? `×${multiplier}` : '×0',                  inline: true },
          ],
          color: win ? '#57F287' : '#ED4245', timestamp: false,
        })],
        components: [],
      }).catch(() => {});
    }
  });

  collector.on('end', (_, reason) => {
    if (reason === 'done') return;
    if (V2_AVAILABLE) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## 🎰 Roulette\n\nTemps écoulé — aucune mise effectuée.'),
      );
      sent.edit({ components: [container], flags: COMPONENTS_V2_FLAG }).catch(() => {});
    } else {
      sent.edit({ components: [] }).catch(() => {});
    }
  });

  if (deleteReply) embed.scheduleDelete(sent, deleteDelay);
};
