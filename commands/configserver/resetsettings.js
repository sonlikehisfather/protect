'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name        : 'resetsettings',
  description : 'Réinitialiser les paramètres serveur du bot.',
  usage       : 'resetsettings',
};

function _buildConfirmRow(disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:resetsettings:confirm')
      .setLabel(' Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:resetsettings:cancel')
      .setLabel(' Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

exports.run = async (client, message) => {
  if (!perms.check(message, exports.help.name)) return;

  const guildId = message.guild.id;
  const config  = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const hasCustomPrefix = config?.prefix && config.prefix !== '+';
  const hasCustomColor  = Boolean(config?.color);
  const publicChannels  = db.getPublicChannels(guildId);

  if (!hasCustomPrefix && !hasCustomColor && !publicChannels.length) {
    const sent = await embed.replyError(
      message,
      'Aucun paramètre serveur personnalisé à réinitialiser.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  const summary = [];
  if (hasCustomPrefix)         summary.push(`Préfixe : \`${config.prefix}\` → \`+\``);
  if (hasCustomColor)          summary.push('Couleur d\'embed personnalisée');
  if (publicChannels.length)   summary.push(`**${publicChannels.length}** salon(s) public(s)`);

  const confirmMessage = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `Les éléments suivants seront réinitialisés :\n• ${summary.join('\n• ')}\n\nCette action est irréversible.`,
        {
          title    : 'Confirmer la réinitialisation des paramètres',
          timestamp: false,
        }
      ),
    ],
    components      : [_buildConfirmRow(false)],
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!confirmMessage) return;

  embed.registerPrivateInteraction(confirmMessage, message.author.id, 120_000);

  const collector = confirmMessage.createMessageComponentCollector({
    filter : interaction =>
      interaction.user.id === message.author.id &&
      interaction.message.id === confirmMessage.id,
    idle   : 60_000,
    time   : 120_000,
  });

  collector.on('collect', async interaction => {
    if (interaction.customId === 'local:resetsettings:cancel') {
      collector.stop('cancelled');
      await interaction.update({
        embeds: [
          embed.build(guildId, 'Action annulée. Aucun paramètre n\'a été modifié.', {
            title    : 'Réinitialisation annulée',
            timestamp: false,
          }),
        ],
        components: [_buildConfirmRow(true)],
      }).catch(() => {});
      return;
    }

    if (interaction.customId !== 'local:resetsettings:confirm') {
      return interaction.deferUpdate().catch(() => {});
    }

    collector.stop('confirmed');
    await interaction.deferUpdate().catch(() => {});

    db.setGuildConfig(guildId, 'prefix', '+');
    db.setGuildConfig(guildId, 'color', null);

    for (const entry of publicChannels) {
      const id = typeof entry === 'string' ? entry : entry?.channelId;
      if (id) db.removePublicChannel(guildId, id);
    }

    await confirmMessage.edit({
      embeds: [
        embed.build(guildId, 'Les paramètres serveur ont été réinitialisés.', {
          timestamp: false,
        }),
      ],
      components: [_buildConfirmRow(true)],
    }).catch(() => {});

    if (deleteReply) {
      embed.scheduleDelete(confirmMessage, deleteDelay);
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(confirmMessage);
    if (reason === 'confirmed' || reason === 'cancelled') return;
    confirmMessage.edit({
      components: [_buildConfirmRow(true)],
    }).catch(() => {});
  });
};
