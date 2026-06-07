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
  name       : 'bl',
  description: 'Gérer la blacklist globale.',
  use        : 'bl [@membre/ID] [raison]',
  usage      : 'bl [@membre/ID] [raison]',
  aliases    : ['blacklist'],

};

exports.run = async (client, message, args) => {

  const authorId = message.author.id;
  const guildId  = message.guild.id;


  if (
    !perms.isBuyer(authorId) &&
    !perms.isOwner(guildId, authorId)
  ) {

    return embed.replyError(
      message,
      'Permission refusée.'
    );

  }


  if (!args[0]) {

    return _showList(message);

  }


  if (
    args[0].toLowerCase() === 'clear'
  ) {

    if (!perms.isBuyer(authorId)) {

      return embed.replyError(
        message,
        'Commande réservée au buyer.'
      );

    }

    if (args[1]?.toLowerCase() !== 'confirm') {

      return embed.replyError(
        message,
        'Confirme avec : +bl clear confirm'
      );

    }

    db.clearBlacklist();

    return embed.reply(
      message,
      'Blacklist vidée.'
    );

  }

  const target =
    message.mentions.users.first()
    ?? await client.users
      .fetch(args[0])
      .catch(() => null);

  if (!target) {

    return embed.replyError(
      message,
      'Utilisateur introuvable.'
    );

  }

  if (target.id === client.user.id) {
    return embed.replyError(
      message,
      'Impossible de blacklister le bot.'
    );
  }

  if (perms.isProtected(target.id, message.guild.id, null)) {

    return embed.replyError(
      message,
      'Impossible de blacklister un compte protégé.'
    );

  }

  const reason =
    args.slice(1).join(' ')
    || 'Aucune raison fournie';

  const existing =
    db.getBlacklistEntry(target.id);

  if (existing) {

    return embed.replyError(
      message,
      `${target.globalName ?? target.username} est déjà blacklisté.`
    );

  }

  const panel =
    await message.channel.send({
      embeds: [
        embed.build(
          message.guild.id,
          `Cible : <@${target.id}> (\`${target.id}\`)\n` +
          `Raison : ${reason}\n\n` +
          `Cette action va blacklister ce membre globalement et tenter de le bannir de tous les serveurs du bot.`,
          {
            title: 'Confirmer blacklist globale',
            timestamp: false
          }
        )
      ],
      components: [_buildConfirmRow(false)]
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
    if (interaction.customId === 'local:bl:cancel') {
      collector.stop('cancelled');
      await interaction.update({
        embeds: [
          embed.build(message.guild.id, 'Action annulée.', {
            title: 'Blacklist annulée',
            timestamp: false
          })
        ],
        components: [_buildConfirmRow(true)]
      }).catch(() => {});
      return;
    }

    if (interaction.customId === 'local:bl:confirm') {
      confirmed = true;
      collector.stop('confirmed');
      await interaction.deferUpdate().catch(() => {});
    }
  });

  await new Promise(resolve => collector.on('end', resolve));
  embed.clearPrivateInteraction(panel);

  if (!confirmed) {
    await panel.edit({
      components: [_buildConfirmRow(true)]
    }).catch(() => {});
    return;
  }

  db.addBlacklist(
    target.id,
    reason,
    authorId
  );

  await panel.edit({
    components: [_buildConfirmRow(true)]
  }).catch(() => {});

  let banned = 0;

  for (const guild of client.guilds.cache.values()) {

    await guild.members
      .ban(
        target.id,
        {
          reason:
            `Blacklist - ${reason}`
        }
      )
      .then(() => banned++)
      .catch(() => {});

    await _wait(300);

  }

  return embed.reply(
    message,
    `${target.globalName ?? target.username} ajouté à la blacklist globale. Banni de ${banned} serveur(s).`
  );

};

async function _showList(message) {

  const list =
    db.getBlacklist();

  if (!list.length) {

    return embed.reply(
      message,
      'Blacklist vide.'
    );

  }

  const lines =
    list
      .slice(0, 15)
      .map((e, i) => {

        const date =
          `<t:${e.addedAt}:d>`;

        return `${i + 1}. <@${e.userId}> - ${e.reason ?? 'Aucune raison'} (${date})`;

      });

  return embed.reply(
    message,
    null,
    {
      title : 'Blacklist globale',
      fields: [
        {
          name : `${list.length} membre(s)`,
          value: lines.join('\n').slice(0, 1000)
        }
      ],
      timestamp: false
    }
  );

}

function _buildConfirmRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:bl:confirm')
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:bl:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
