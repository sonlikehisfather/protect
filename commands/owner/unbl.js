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

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

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
  const guildId  = message.guild.id;

  if (
    !perms.isBuyer(authorId) &&
    !perms.isOwner(guildId, authorId)
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

  const _v2Panel = (text, disabled = false) => {
    if (V2_AVAILABLE) {
      try {
        const container = new ContainerBuilder().setAccentColor(0x57F287);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        container.addActionRowComponents(_buildConfirmRow(disabled));
        return { embeds: [], components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
      } catch {}
    }
    return {
      embeds: [embed.build(message.guild.id, text.replace(/^##[^\n]*\n/, ''), { title: 'Unblacklist globale', timestamp: false })],
      components: [_buildConfirmRow(disabled)],
      allowedMentions: { parse: [] },
    };
  };

  const confirmText =
    `## Unblacklist globale\n\n` +
    `**Cible** › <@${target.id}> \`${target.id}\`\n\n` +
    `-# Cette action retirera ce membre de la blacklist et tentera de le débannir de tous les serveurs du bot.`;

  const panel = await message.channel.send(_v2Panel(confirmText, false)).catch(() => null);

  if (!panel) {
    return embed.replyError(message, 'Impossible de demander la confirmation.');
  }

  embed.registerPrivateInteraction(panel, message.author.id, 120_000);

  const collector = panel.createMessageComponentCollector({
    filter: i => i.user.id === message.author.id && i.message.id === panel.id,
    idle  : 60_000,
    time  : 120_000,
  });

  let confirmed = false;

  collector.on('collect', async interaction => {
    if (interaction.customId === 'local:unbl:cancel') {
      collector.stop('cancelled');
      const cancelText = `## Annulé\n\n-# Action annulée par <@${message.author.id}>.`;
      await interaction.update(_v2Panel(cancelText, true)).catch(() => {});
      return;
    }
    if (interaction.customId === 'local:unbl:confirm') {
      confirmed = true;
      collector.stop('confirmed');
      await interaction.deferUpdate().catch(() => {});
    }
  });

  await new Promise(resolve => collector.on('end', resolve));
  embed.clearPrivateInteraction(panel);

  if (!confirmed) {
    await panel.edit(_v2Panel(confirmText, true)).catch(() => {});
    return;
  }

  db.removeBlacklist(target.id);

  let unbanned = 0;

  for (const guild of client.guilds.cache.values()) {
    const ok = await guild.bans.remove(target.id, 'Blacklist retirée')
      .then(() => true)
      .catch(() => false);
    if (ok) unbanned++;
    await _wait(300);
  }

  const doneText =
    `## Unblacklist appliquée\n\n` +
    `**Membre** › <@${target.id}> \`${target.id}\`\n` +
    `**Débanni de** › ${unbanned} serveur(s)\n\n` +
    `-# <t:${Math.floor(Date.now() / 1000)}:f>`;

  if (V2_AVAILABLE) {
    try {
      const container = new ContainerBuilder().setAccentColor(0x57F287);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(doneText));
      await panel.edit({ embeds: [], components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    } catch {}
  }

  return embed.reply(message, `<@${target.id}> retiré de la blacklist. Débanni de ${unbanned} serveur(s).`);
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
