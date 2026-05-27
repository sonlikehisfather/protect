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
  name       : 'unbl',
  description: 'Retirer un membre de la blacklist globale.',
  use        : 'unbl <@membre/ID>',
  usage      : 'unbl <@membre/ID>',
  category   : 'owner',
};

exports.run = async (client, message, args) => {
  const authorId = message.author.id;

  if (
    !perms.isBuyer(authorId) &&
    !perms.isGlobalOwner(authorId)
  ) {
    return embed.replyError(message, 'Permission refusée.');
  }

  if (!args[0]) {
    return embed.replyError(message, 'Utilisation : `unbl <@membre/ID>`');
  }

  const target =
    message.mentions.users.first() ??
    await client.users.fetch(args[0]).catch(() => null);

  if (!target) {
    return embed.replyError(message, 'Utilisateur introuvable.');
  }

  const entry = db.getBlacklistEntry(target.id);

  if (!entry) {
    return embed.replyError(message, `${target.username} n'est pas dans la blacklist.`);
  }

  const panel = await message.channel.send({
    embeds: [
      embed.build(
        message.guild.id,
        `Cible : <@${target.id}> (\`${target.id}\`)\n\n` +
        'Cette action va retirer ce membre de la blacklist globale et tenter de le débannir de tous les serveurs du bot.',
        {
          title: 'Confirmer unblacklist globale',
          timestamp: false,
        }
      )
    ],
    components: [_buildConfirmRow(false)],
  }).catch(() => null);

  if (!panel) {
    return embed.replyError(message, 'Impossible de demander la confirmation.');
  }

  embed.registerPrivateInteraction(panel, message.author.id, 120000);

  const collector = panel.createMessageComponentCollector({
    filter: interaction =>
      interaction.user.id === message.author.id &&
      interaction.message.id === panel.id,
    idle: 60000,
    time: 120000,
  });

  let confirmed = false;

  collector.on('collect', async interaction => {
    if (interaction.customId === 'local:unbl:cancel') {
      collector.stop('cancelled');
      await interaction.update({
        embeds: [
          embed.build(message.guild.id, 'Action annulée.', {
            title: 'Unblacklist annulée',
            timestamp: false,
          })
        ],
        components: [_buildConfirmRow(true)],
      }).catch(() => {});
      return;
    }

    if (interaction.customId !== 'local:unbl:confirm') {
      return interaction.deferUpdate().catch(() => {});
    }

    confirmed = true;
    collector.stop('confirmed');
    await interaction.deferUpdate().catch(() => {});
  });

  await new Promise(resolve => collector.on('end', resolve));
  embed.clearPrivateInteraction(panel);

  if (!confirmed) {
    await panel.edit({
      components: [_buildConfirmRow(true)],
    }).catch(() => {});
    return;
  }

  await panel.edit({
    components: [_buildConfirmRow(true)],
  }).catch(() => {});

  db.removeBlacklist(target.id);

  let unbanned = 0;

  for (const guild of client.guilds.cache.values()) {
    const ok = await guild.bans.remove(target.id, 'Blacklist retirée')
      .then(() => true)
      .catch(() => false);

    if (ok) unbanned++;

    await _wait(300);
  }

  return embed.reply(
    message,
    `${target.tag ?? target.username} retiré de la blacklist globale. Débanni de ${unbanned} serveur(s).`
  );
};

function _buildConfirmRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:unbl:confirm')
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:unbl:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
