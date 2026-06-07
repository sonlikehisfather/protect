'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');

const db = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'streak',
    description : 'Affiche votre série d\'activité quotidienne et la met à jour.',
    usage       : 'streak',
    aliases     : [],
    category    : 'general',
  },

  async run(client, message) {
    const guildId = message.guild.id;
    const config = db.getGuildConfig(guildId);
    const deleteCmd = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const buildPayload = (disabled = false) => {
      const row = db.updateStreak(message.author.id, guildId);
      const streak = row?.streak ?? 0;
      const lastDate = row?.lastDate ?? 'inconnue';
      const content = [
        `## Série actuelle`,
        '',
        `**${streak}** jour${streak > 1 ? 's' : ''} d\'activité consécutifs.`,
        `Dernière activité enregistrée : **${lastDate}**.`,
        '',
        `Appuyez sur Actualiser pour confirmer votre série ou refaites la commande demain pour l\'augmenter.`,
      ].join('\n');

      const container = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(content)
        )
        .addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('st:refresh')
              .setLabel('Actualiser')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(disabled),
            new ButtonBuilder()
              .setCustomId('st:close')
              .setLabel('✖')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(disabled),
          )
        );

      return {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      };
    };

    const sent = await message.reply(buildPayload()).catch(() => null);
    if (!sent) return;

    embed.registerPrivateInteraction(sent, message.author.id);

    const collector = sent.createMessageComponentCollector({
      filter: i => i.user.id === message.author.id,
      idle: 300_000,
      time: 900_000,
    });

    collector.on('collect', async (interaction) => {
      try {
        if (interaction.customId === 'st:close') {
          await interaction.deferUpdate().catch(() => {});
          embed.clearPrivateInteraction(sent);
          collector.stop('closed');
          await message.delete().catch(() => {});
          return sent.delete().catch(() => {});
        }

        if (interaction.customId === 'st:refresh') {
          await interaction.deferUpdate().catch(() => {});
          return sent.edit(buildPayload()).catch(() => {});
        }
      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error('[streak] interaction error:', err.message);
        }
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(sent);
      if (reason === 'closed') return;
      sent.edit(buildPayload(true)).catch(() => {});
    });

    if (deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};
