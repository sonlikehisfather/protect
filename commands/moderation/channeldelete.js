'use strict';

const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'channeldelete',
    description : 'Supprime un salon avec confirmation.',
    usage       : 'cdelete [id/mention]',
    aliases     : ['cdelete', 'cdel'],
    permission  : {
      level           : 'owner',
      label           : 'Moderation',
      discord         : ['ManageChannels'],
      targetProtection: false,
      bypass          : ['buyer', 'globalOwner'],
    },
  },

  async run(client, message, args) {
    if (!perms.check(message, 'channeldelete')) return;

    const config     = db.getGuildConfig(message.guild.id);
    const deleteCmd  = Boolean(config?.autoDeleteModCmds);
    const deleteReply= Boolean(config?.autoDeleteModReplies);
    const deleteDelay= config?.autoDeleteDelay ?? 5;
    const targetChannel = args[0]
      ? message.mentions.channels.first() || message.guild.channels.cache.get(args[0])
      : message.channel;

    if (!targetChannel) {
      const sent = await embed.replyError(message, 'Salon introuvable. Vérifiez l\'ID ou la mention.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!targetChannel.deletable) {
      const sent = await embed.replyError(message, 'Je ne peux pas supprimer ce salon.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cdelete:confirm:${targetChannel.id}`)
        .setLabel('✓')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`cdelete:cancel:${targetChannel.id}`)
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Secondary)
    );

    const confirmMsg = await message.reply({
      embeds: [embed.build(message.guild.id, `Êtes-vous sûr de vouloir supprimer le salon **${targetChannel.name}** ?`, { timestamp: false })],
      components: [confirmRow],
      allowedMentions: { parse: [], repliedUser: false },
    }).catch(() => null);

    if (!confirmMsg) return;

    const collector = confirmMsg.createMessageComponentCollector({
      filter: i => i.user.id === message.author.id,
      time: 60_000,
      max: 1,
    });

    const currentChannelId = message.channel.id;

    collector.on('collect', async interaction => {
      if (interaction.customId.startsWith('cdelete:confirm:')) {
        await interaction.deferUpdate().catch(() => {});

        const deletedName = targetChannel.name;
        const isSameChannel = targetChannel.id === currentChannelId;
        await targetChannel.delete(`Supprimé par ${message.author.tag}`).catch(() => {});

        if (!isSameChannel) {
          await interaction.editReply({
            embeds: [embed.build(message.guild.id, `✓ Salon **${deletedName}** supprimé.`, { timestamp: false })],
            components: [],
          }).catch(() => {});
          if (deleteReply) embed.scheduleDelete(confirmMsg, deleteDelay);
        }
      } else {
        await interaction.deferUpdate().catch(() => {});
        await interaction.editReply({
          embeds: [embed.build(message.guild.id, '\u2716 Suppression annulée.', { timestamp: false })],
          components: [],
        }).catch(() => {});
        if (deleteReply) embed.scheduleDelete(confirmMsg, deleteDelay);
      }
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') {
        confirmMsg.edit({
          content: '⏱ Temps écoulé, suppression annulée.',
          components: [],
        }).catch(() => {});
        if (deleteReply) embed.scheduleDelete(confirmMsg, deleteDelay);
      }
    });

    if (deleteCmd) embed.scheduleDelete(message, deleteDelay);
  },
};
