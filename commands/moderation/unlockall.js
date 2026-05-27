'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');

const CONFIRM_IDLE_MS = 60_000;
const CONFIRM_TIME_MS = 120_000;

module.exports = {
  help: {
    name        : 'unlockall',
    description : 'Déverrouille tous les salons du serveur.',
    usage       : 'unlockall',
    aliases     : [],
  },

  async run(client, message) {

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteLockReplies ?? config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const confirmMessage = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          'Es-tu sûr de vouloir déverrouiller TOUS les salons du serveur ? Cette action est irréversible.',
          {
            title     : 'Confirmer unlockall',
            timestamp : false,
          }
        )
      ],
      components: [_buildConfirmRow(false)],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (!confirmMessage) return;

    embed.registerPrivateInteraction(confirmMessage, message.author.id, CONFIRM_TIME_MS);

    const collector = confirmMessage.createMessageComponentCollector({
      filter: interaction =>
        interaction.user.id === message.author.id &&
        interaction.message.id === confirmMessage.id,
      idle: CONFIRM_IDLE_MS,
      time: CONFIRM_TIME_MS,
    });

    collector.on('collect', async interaction => {
      if (interaction.customId === 'local:unlockall:cancel') {
        collector.stop('cancelled');
        await interaction.update({
          embeds: [
            embed.build(
              guildId,
              'Action annulée.',
              { title: 'Unlockall annulé', timestamp: false }
            )
          ],
          components: [_buildConfirmRow(true)],
        }).catch(() => {});
        return;
      }

      if (interaction.customId !== 'local:unlockall:confirm') {
        return interaction.deferUpdate().catch(() => {});
      }

      collector.stop('confirmed');
      await interaction.deferUpdate().catch(() => {});
      await confirmMessage.edit({ components: [_buildConfirmRow(true)] }).catch(() => {});

      await _runUnlockAll(message, guild, guildId, deleteReply, deleteDelay);
    });

    collector.on('end', async (_, reason) => {
      embed.clearPrivateInteraction(confirmMessage);
      if (reason === 'confirmed' || reason === 'cancelled') return;
      await confirmMessage.edit({ components: [_buildConfirmRow(true)] }).catch(() => {});
      if (deleteReply) embed.scheduleDelete(confirmMessage, deleteDelay);
    });

  },
};

async function _runUnlockAll(message, guild, guildId, deleteReply, deleteDelay) {
  const everyone = guild.roles.everyone;
  let unlockedCount = 0;

  for (const channel of guild.channels.cache.values()) {

    if (!isLockable(channel)) continue;

    const edited = isTextChannel(channel)
      ? await channel.permissionOverwrites
          .edit(everyone, { SendMessages: null })
          .catch(() => null)
      : await channel.permissionOverwrites
          .edit(everyone, { Connect: null })
          .catch(() => null);

    if (edited) unlockedCount++;

    await _wait(300);
  }

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `**${unlockedCount}** salon(s) ont été déverrouillé(s).`,
        { timestamp: false }
      )
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

function _buildConfirmRow(disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:unlockall:confirm')
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:unlockall:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function isTextChannel(channel) {
  return channel.type === ChannelType.GuildText
      || channel.type === ChannelType.GuildAnnouncement;
}

function isVoiceChannel(channel) {
  return channel.type === ChannelType.GuildVoice
      || channel.type === ChannelType.GuildStageVoice;
}

function isLockable(channel) {
  return isTextChannel(channel) || isVoiceChannel(channel);
}

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
