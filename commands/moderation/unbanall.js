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
    name        : 'unbanall',
    description : 'Supprime tous les bannissements du serveur.',
    usage       : 'unbanall',
    aliases     : [],
  },

  async run(client, message) {

    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'unbanall')) return;

    const config =
      db.getGuildConfig(guildId);

    const deleteCmd   =
      Boolean(config?.autoDeleteModCmds);

    const deleteReply =
      Boolean(config?.autoDeleteModReplies);

    const deleteDelay =
      config?.autoDeleteDelay ?? 5;

    if (deleteCmd)
      await message.delete().catch(() => {});

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me) {
      const sent =
        await embed.replyError(
          message,
          'Impossible de vérifier mes permissions.',
          { timestamp: false }
        ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(
          sent,
          deleteDelay
        );

      return;
    }


    if (
      !me.permissions.has(
        PermissionsBitField.Flags.BanMembers
      )
    ) {

      const sent =
        await embed.replyError(
          message,
          'Je n\'ai pas la permission de débannir des membres.',
          { timestamp: false }
        ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(
          sent,
          deleteDelay
        );

      return;

    }

    let bans;

    try {

      bans = await _fetchAllBans(guild);

    }

    catch {

      const sent =
        await embed.replyError(
          message,
          'Impossible de récupérer la liste des bannissements.',
          { timestamp: false }
        ).catch(() => null);

      if (sent && deleteReply)
        embed.scheduleDelete(
          sent,
          deleteDelay
        );

      return;

    }

    if (!bans.size) {

      const sent =
        await message.channel.send({
          embeds: [
            embed.build(
              guildId,
              'Aucun membre banni.',
              { timestamp: false }
            )
          ],
          allowedMentions: { parse: [] },
        });

      if (sent && deleteReply)
        embed.scheduleDelete(
          sent,
          deleteDelay
        );

      return;

    }

    const confirmMessage =
      await message.channel.send({
        embeds: [
          embed.build(
            guildId,
            `**Utilisateurs bannis**\n` +
            `\`${bans.size}\`\n\n` +
            `Cette action va débannir tous les membres actuellement bannis du serveur.`,
            {
              title     : 'Confirmer unbanall',
              timestamp : false
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
      if (interaction.customId === 'local:unbanall:cancel') {
        collector.stop('cancelled');

        await interaction.update({
          embeds: [
            embed.build(
              guildId,
              'Action annulée.',
              {
                title     : 'Unbanall annulé',
                timestamp : false
              }
            )
          ],
          components: [_buildConfirmRow(true)]
        }).catch(() => {});

        return;
      }

      if (interaction.customId !== 'local:unbanall:confirm') {
        return interaction.deferUpdate().catch(() => {});
      }

      collector.stop('confirmed');
      await interaction.deferUpdate().catch(() => {});

      await confirmMessage.edit({
        components: [_buildConfirmRow(true)]
      }).catch(() => {});

      await _runUnbanAll(
        client,
        message,
        guild,
        guildId,
        bans,
        deleteReply,
        deleteDelay
      );
    });

    collector.on('end', async (_, reason) => {
      embed.clearPrivateInteraction(confirmMessage);

      if (reason === 'confirmed' || reason === 'cancelled') return;

      await confirmMessage.edit({
        components: [_buildConfirmRow(true)]
      }).catch(() => {});

      if (deleteReply) {
        embed.scheduleDelete(confirmMessage, deleteDelay);
      }
    });

  },

};

async function _runUnbanAll(client, message, guild, guildId, bans, deleteReply, deleteDelay) {
  let unbannedCount = 0;
  let failedCount   = 0;

  for (const ban of bans.values()) {

    try {

      await guild.members.unban(
        ban.user.id,
        `Unbanall par ${message.author.tag}`
      );

      unbannedCount++;

      db.expireBanSanctions(
        guildId,
        ban.user.id
      );

      db.deleteTempBan(
        guildId,
        ban.user.id
      );

    }

    catch {

      failedCount++;
      continue;

    }


    await _wait(500);

  }

  const text =
    `**Utilisateurs bannis**\n` +
    `\`${bans.size}\`\n\n` +
    `**Débannis**\n` +
    `\`${unbannedCount}\`\n\n` +
    `**Échecs**\n` +
    `\`${failedCount}\``;

  const sent =
    await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          text,
          { timestamp: false }
        )
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

  if (sent && deleteReply)
    embed.scheduleDelete(
      sent,
      deleteDelay
    );

  const e =
    embed.log(guildId, 'Unbanall', [
      { name: 'Modérateur', value: `<@${message.author.id}> (${message.author.tag})`, inline: false },
      { name: 'Bans trouvés', value: `\`${bans.size}\``, inline: true },
      { name: 'Débannis', value: `\`${unbannedCount}\``, inline: true },
      { name: 'Échecs', value: `\`${failedCount}\``, inline: true },
    ]);

  await logger.send(
    client,
    guildId,
    'modlog',
    e
  );
}

function _buildConfirmRow(disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:unbanall:confirm')
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:unbanall:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function _wait(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}


async function _fetchAllBans(guild) {
  const MAX_PAGES = 50;
  const PAGE_LIMIT = 1000;
  const all = new Map();
  let after;

  for (let i = 0; i < MAX_PAGES; i++) {
    const opts = { limit: PAGE_LIMIT, cache: false };
    if (after) opts.after = after;

    const batch = await guild.bans.fetch(opts).catch(() => null);
    if (!batch || batch.size === 0) break;

    for (const [id, ban] of batch) all.set(id, ban);

    if (batch.size < PAGE_LIMIT) break;

    let maxId = after;
    for (const id of batch.keys()) {
      if (!maxId || BigInt(id) > BigInt(maxId)) maxId = id;
    }
    if (!maxId || maxId === after) break;
    after = maxId;
  }

  return all;
}
