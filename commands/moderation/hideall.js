'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
} = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');

const CONFIRM_IDLE_MS = 60_000;
const CONFIRM_TIME_MS = 120_000;

module.exports = {
  help: {
    name        : 'hideall',
    description : 'Cache tous les salons du serveur.',
    usage       : 'hideall',
    aliases     : [],
  },

  async run(client, message) {

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const confirmMessage = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          'Es-tu sûr de vouloir cacher TOUS les salons du serveur ? Cette action est irréversible.',
          {
            title     : 'Confirmer hideall',
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
      if (interaction.customId === 'local:hideall:cancel') {
        collector.stop('cancelled');
        await interaction.update({
          embeds: [
            embed.build(
              guildId,
              'Action annulée.',
              { title: 'Hideall annulé', timestamp: false }
            )
          ],
          components: [_buildConfirmRow(true)],
        }).catch(() => {});
        return;
      }

      if (interaction.customId !== 'local:hideall:confirm') {
        return interaction.deferUpdate().catch(() => {});
      }

      collector.stop('confirmed');
      await interaction.deferUpdate().catch(() => {});
      await confirmMessage.edit({ components: [_buildConfirmRow(true)] }).catch(() => {});

      await _runHideAll(message, guild, guildId, deleteReply, deleteDelay);
    });

    collector.on('end', async (_, reason) => {
      embed.clearPrivateInteraction(confirmMessage);
      if (reason === 'confirmed' || reason === 'cancelled') return;
      await confirmMessage.edit({ components: [_buildConfirmRow(true)] }).catch(() => {});
      if (deleteReply) embed.scheduleDelete(confirmMessage, deleteDelay);
    });

  },
};

async function _runHideAll(message, guild, guildId, deleteReply, deleteDelay) {
  const everyone = guild.roles.everyone;
  let hiddenCount = 0;

  for (const channel of guild.channels.cache.values()) {

    if (channel.id === message.channel.id) continue;
    if (!isViewableChannel(channel)) continue;

    const overwrite = channel.permissionOverwrites.cache.get(everyone.id);

    const alreadyHidden =
      overwrite?.deny.has(PermissionsBitField.Flags.ViewChannel);

    if (alreadyHidden) continue;

    const edited = await channel.permissionOverwrites
      .edit(everyone, { ViewChannel: false })
      .catch(() => null);

    if (edited) hiddenCount++;

    await _wait(300);
  }

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `**${hiddenCount}** salon(s) ont été caché(s).`,
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
      .setCustomId('local:hideall:confirm')
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:hideall:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function isViewableChannel(channel) {
  return [
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice,
    ChannelType.GuildAnnouncement
  ].includes(channel.type);
}

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
