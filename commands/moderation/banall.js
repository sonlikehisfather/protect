'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const logger = require('../../utils/logger');
const perms  = require('../../utils/permissions');

const CONFIRM_IDLE_MS = 60_000;
const CONFIRM_TIME_MS = 120_000;

module.exports = {

  help: {
    name              : 'banall',
    description       : 'Bannit tous les membres du serveur (hors protégés). Réservé aux buyers.',
    usage             : 'banall [raison]',
    aliases           : [],
    category          : 'moderation',
    defaultPermission : 'buyer',
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.isBuyer(message.author.id)) {
      return embed.replyError(message, 'Commande réservée au buyer.', { timestamp: false });
    }

    const reason = args.join(' ').trim() || 'Aucune raison fournie';

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me || !me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return embed.replyError(message, 'Je n’ai pas la permission de bannir des membres.', { timestamp: false });
    }

    const members = await guild.members.fetch().catch(() => null);
    if (!members) {
      return embed.replyError(message, 'Impossible de récupérer la liste des membres.', { timestamp: false });
    }

    const targets = members.filter(m => _isTargetable(m, me, guildId, message.author.id));
    const skipped = members.size - targets.size;

    if (!targets.size) {
      return embed.replyError(message, 'Aucun membre ne peut être banni.', { timestamp: false });
    }

    const confirmMessage = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `**Membres à bannir**\n\`${targets.size}\`\n\n` +
          `**Ignorés (protégés, bots, non bannables)**\n\`${skipped}\`\n\n` +
          `**Raison**\n${reason}\n\n` +
          `Cette action va bannir tous les membres listés ci-dessus.`,
          { title: 'Confirmer banall', timestamp: false }
        ),
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
      if (interaction.customId === 'local:banall:cancel') {
        collector.stop('cancelled');
        await interaction.update({
          embeds: [embed.build(guildId, 'Action annulée.', { title: 'Banall annulé', timestamp: false })],
          components: [_buildConfirmRow(true)],
        }).catch(() => {});
        return;
      }

      if (interaction.customId !== 'local:banall:confirm') {
        return interaction.deferUpdate().catch(() => {});
      }

      collector.stop('confirmed');
      await interaction.deferUpdate().catch(() => {});
      await confirmMessage.edit({ components: [_buildConfirmRow(true)] }).catch(() => {});

      await _runBanAll(client, message, guild, guildId, targets, me, reason);
    });

    collector.on('end', async (_, endReason) => {
      embed.clearPrivateInteraction(confirmMessage);
      if (endReason === 'confirmed' || endReason === 'cancelled') return;
      await confirmMessage.edit({ components: [_buildConfirmRow(true)] }).catch(() => {});
    });
  },
};

function _isTargetable(member, me, guildId, authorId) {
  if (member.id === authorId || member.id === me.id) return false;
  if (member.user.bot) return false;
  if (member.id === member.guild.ownerId) return false;
  if (perms.isProtected(member.id, guildId, member)) return false;
  if (!member.bannable) return false;
  if (member.roles.highest.position >= me.roles.highest.position) return false;
  return true;
}

async function _runBanAll(client, message, guild, guildId, targets, me, reason) {
  let bannedCount = 0;
  let failedCount = 0;
  let skippedLate = 0;

  for (const member of targets.values()) {
    // Re-vérifie au moment de l'exécution (protections ajoutées entre-temps).
    if (!_isTargetable(member, me, guildId, message.author.id)) {
      skippedLate++;
      continue;
    }

    try {
      await guild.members.ban(member.id, {
        reason: `Banall par ${message.author.tag} - ${reason}`,
      });
      bannedCount++;

      try {
        db.addSanction(guildId, member.id, message.author.id, 'ban', `Banall - ${reason}`, null);
      } catch {}
    } catch {
      failedCount++;
    }

    await _wait(500);
  }

  const text =
    `**Membres ciblés**\n\`${targets.size}\`\n\n` +
    `**Bannis**\n\`${bannedCount}\`\n\n` +
    `**Ignorés**\n\`${skippedLate}\`\n\n` +
    `**Échecs**\n\`${failedCount}\``;

  await embed.sendEmbed(message.channel, guildId, text, {
    title: 'Banall terminé',
    timestamp: false,
    allowedMentions: { parse: [] },
  }).catch(() => {});

  const e = embed.log(guildId, 'Banall', [
    { name: 'Modérateur', value: `<@${message.author.id}> (${message.author.tag})`, inline: false },
    { name: 'Raison', value: reason, inline: false },
    { name: 'Bannis', value: `\`${bannedCount}\``, inline: true },
    { name: 'Échecs', value: `\`${failedCount}\``, inline: true },
  ]);

  await logger.send(client, guildId, 'modlog', e);
}

function _buildConfirmRow(disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:banall:confirm')
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:banall:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
