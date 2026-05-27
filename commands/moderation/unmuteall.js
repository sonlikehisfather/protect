'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const logger = require('../../utils/logger');

const CONFIRM_IDLE_MS = 60_000;
const CONFIRM_TIME_MS = 120_000;

module.exports = {
  help: {
    name        : 'unmuteall',
    description : 'Supprime tous les mutes actifs sur le serveur.',
    usage       : 'unmuteall',
    aliases     : [],
  },

  async run(client, message) {

    const guild   = message.guild;
    const guildId = guild.id;

    const config = db.getGuildConfig(guildId);

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
          'Es-tu sûr de vouloir démuter TOUS les membres mute du serveur ? Cette action est irréversible.',
          {
            title     : 'Confirmer unmuteall',
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
      if (interaction.customId === 'local:unmuteall:cancel') {
        collector.stop('cancelled');
        await interaction.update({
          embeds: [
            embed.build(
              guildId,
              'Action annulée.',
              { title: 'Unmuteall annulé', timestamp: false }
            )
          ],
          components: [_buildConfirmRow(true)],
        }).catch(() => {});
        return;
      }

      if (interaction.customId !== 'local:unmuteall:confirm') {
        return interaction.deferUpdate().catch(() => {});
      }

      collector.stop('confirmed');
      await interaction.deferUpdate().catch(() => {});
      await confirmMessage.edit({ components: [_buildConfirmRow(true)] }).catch(() => {});

      await _runUnmuteAll(client, message, guild, guildId, config, deleteReply, deleteDelay);
    });

    collector.on('end', async (_, reason) => {
      embed.clearPrivateInteraction(confirmMessage);
      if (reason === 'confirmed' || reason === 'cancelled') return;
      await confirmMessage.edit({ components: [_buildConfirmRow(true)] }).catch(() => {});
      if (deleteReply) embed.scheduleDelete(confirmMessage, deleteDelay);
    });

  },
};

async function _runUnmuteAll(client, message, guild, guildId, config, deleteReply, deleteDelay) {


  const muteRoleId = config?.muteRoleId ?? null;


  const userIdsToProcess = new Set();

  for (const entry of db.getTempRolesByGuild(guildId)) {
    userIdsToProcess.add(entry.userId);
  }

  for (const uid of db.getActiveSanctionUserIdsByType(guildId, 'mute')) {
    userIdsToProcess.add(uid);
  }

  let unmutedCount = 0;

  for (const userId of userIdsToProcess) {

    const member = await guild.members
      .fetch(userId)
      .catch(() => null);


    const cleanupDb = () => {
      if (muteRoleId) {
        db.removeTempRole(guildId, userId, muteRoleId);
      }
      db.expireMuteSanctions(guildId, userId);
    };

    if (!member) {
      cleanupDb();
      continue;
    }

    try {

      let didUnmute = false;

      if (member.communicationDisabledUntilTimestamp) {
        const ok = await member.timeout(null, 'unmuteall')
          .then(() => true)
          .catch(() => false);

        if (ok) didUnmute = true;
      }

      if (muteRoleId && member.roles.cache.has(muteRoleId)) {
        const ok = await member.roles.remove(muteRoleId, 'unmuteall')
          .then(() => true)
          .catch(() => false);

        if (ok) didUnmute = true;
      }

      if (didUnmute) unmutedCount++;

      cleanupDb();

    }

    catch (err) {

      if (err?.code !== 10062 && err?.code !== 40060) {
        console.error(err);
      }

    }

    await _wait(500);

  }


  const sujet     = unmutedCount > 1 ? 'membres' : 'membre';
  const verbe     = unmutedCount > 1 ? 'ont' : 'a';
  const participe = unmutedCount > 1 ? 'démutés' : 'démuté';

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `**${unmutedCount}** ${sujet} ${verbe} été ${participe}.`,
        { timestamp: false }
      )
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }

  const e = embed.sanction(guildId, {
    type        : 'unmuteall',
    moderatorTag: message.author.tag,
    reason      : 'Suppression globale des mutes',
  });

  await logger.send(client, guildId, 'modlog', e);
}

function _buildConfirmRow(disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:unmuteall:confirm')
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:unmuteall:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
