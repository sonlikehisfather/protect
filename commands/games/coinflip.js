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

exports.help = {
  name        : 'coinflip',
  description : 'Lance une pièce (pile ou face).',
  use         : 'coinflip',
  usage       : 'coinflip',
  aliases     : ['pf', 'pileface', 'coin'],
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
    new ButtonBuilder().setCustomId('coinflip:pile').setLabel('Pile').setEmoji('👤').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('coinflip:face').setLabel('Face').setEmoji('⚡').setStyle(ButtonStyle.Primary),
  );

  const _buildV2 = (state, extra = {}) => {
    const container = new ContainerBuilder();
    if (state === 'pick') {
      container
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🪙 Pile ou Face\n\nChoisis ton côté :'))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(1))
        .addActionRowComponents(btnRow);
    } else {
      const { choice, result, win, xpGain } = extra;
      const emoji   = result === 'pile' ? '👤' : '⚡';
      const verdict = win ? `✔ Gagné ! (+${xpGain} XP)` : `× Perdu... (+${xpGain} XP)`;
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🪙 Pile ou Face\n\n**Ton choix** : ${choice.toUpperCase()}\n**Résultat** : ${emoji} ${result.toUpperCase()}\n\n${verdict}`,
      ));
    }
    return { components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
  };

  const sent = V2_AVAILABLE
    ? await message.reply(_buildV2('pick')).catch(() => null)
    : await message.reply({
        embeds: [embed.build(guildId, null, { title: '🪙 Pile ou Face', description: 'Choisis ton côté :', color: '#F1C40F', timestamp: false })],
        components: [btnRow],
        allowedMentions: { parse: [] },
      }).catch(() => null);

  if (!sent) return;

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId === 'coinflip:pile' || i.customId === 'coinflip:face',
    time: 60_000,
  });

  collector.on('collect', async interaction => {
    if (interaction.user.id !== message.author.id) {
      return interaction.reply({ content: "Ce n'est pas ta partie !", flags: 64 }).catch(() => {});
    }
    collector.stop('done');
    await interaction.deferUpdate().catch(() => {});

    const choice  = interaction.customId === 'coinflip:pile' ? 'pile' : 'face';
    const result  = Math.random() < 0.5 ? 'pile' : 'face';
    const win     = choice === result;
    const xpGain  = win ? 30 : 10;
    db.addXp(guildId, message.author.id, xpGain);

    if (V2_AVAILABLE) {
      await sent.edit(_buildV2('result', { choice, result, win, xpGain })).catch(() => {});
    } else {
      const emoji    = result === 'pile' ? '👤' : '⚡';
      const winEmoji = win ? '✔' : '×';
      await sent.edit({
        embeds: [embed.build(guildId, null, {
          title: '🪙 Pile ou Face',
          fields: [
            { name: 'Ton choix', value: choice.toUpperCase(),                                                                  inline: true  },
            { name: 'Résultat',  value: `${emoji} ${result.toUpperCase()}`,                                                    inline: true  },
            { name: 'Score',     value: `${winEmoji} ${win ? `Gagné ! (+${xpGain} XP)` : `Perdu... (+${xpGain} XP)`}`,       inline: false },
          ],
          color: win ? '#57F287' : '#ED4245', timestamp: false,
        })],
        components: [],
      }).catch(() => {});
    }
  });

  collector.on('end', (_, reason) => {
    if (reason === 'done') return;
    sent.edit({ components: [] }).catch(() => {});
  });

  if (deleteReply) embed.scheduleDelete(sent, deleteDelay);
};
