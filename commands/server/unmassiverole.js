'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const CONFIRM_IDLE_MS = 60_000;
const CONFIRM_TIME_MS = 120_000;

module.exports = {
  help: {
    name        : 'unmassiverole',
    description : 'Retire un rôle à tous les membres ou aux membres ayant un rôle précis.',
    usage       : 'unmassiverole [rôle source] <rôle à retirer>',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'unmassiverole')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas la permission de gérer les rôles.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!args.length) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}unmassiverole [rôle source] <rôle à retirer>\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let sourceRole = null;
    let targetRole = null;

    if (args.length === 1) {
      targetRole = await _resolveRole(guild, args[0]);
    } else {
      sourceRole = await _resolveRole(guild, args[0]);
      targetRole = await _resolveRole(guild, args[1]);
    }

    if (!targetRole) {
      const sent = await embed.replyError(
        message,
        'Rôle à retirer introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (args.length >= 2 && !sourceRole) {
      const sent = await embed.replyError(
        message,
        'Rôle source introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (targetRole.id === guild.id) {
      const sent = await embed.replyError(
        message,
        'Vous ne pouvez pas retirer le rôle everyone.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (targetRole.managed) {
      const sent = await embed.replyError(
        message,
        'Vous ne pouvez pas retirer un rôle géré par une intégration.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (targetRole.position >= me.roles.highest.position) {
      const sent = await embed.replyError(
        message,
        'Je ne peux pas retirer ce rôle car il est supérieur ou égal à mon rôle le plus haut.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (
      message.member.id !== guild.ownerId &&
      targetRole.position >= message.member.roles.highest.position
    ) {
      const sent = await embed.replyError(
        message,
        'Vous ne pouvez pas retirer un rôle supérieur ou égal à votre rôle le plus haut.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (guild.members.cache.size < guild.memberCount)
      await guild.members.fetch().catch(() => null);

    let members = guild.members.cache.filter(member =>
      !member.user.bot &&
      member.roles.cache.has(targetRole.id) &&
      !perms.isProtected(member.id, guildId, member)
    );

    if (sourceRole) {
      members = members.filter(member => member.roles.cache.has(sourceRole.id));
    }

    const protectedCount = guild.members.cache.filter(member =>
      !member.user.bot &&
      member.roles.cache.has(targetRole.id) &&
      perms.isProtected(member.id, guildId, member) &&
      (!sourceRole || member.roles.cache.has(sourceRole.id))
    ).size;

    if (!members.size) {
      const sent = await embed.replyError(
        message,
        'Aucun membre éligible trouvé.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }


    const confirmText =
      `**Rôle**\n${targetRole}\n\n` +
      (sourceRole ? `**Rôle source**\n${sourceRole}\n\n` : '') +
      `**Membres éligibles**\n\`${members.size}\`` +
      (protectedCount ? `\n\n**Protégés**\n\`${protectedCount}\`` : '') +
      `\n\nCette action est non annulable.`;

    const confirmMessage = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          confirmText,
          {
            title    : 'Confirmer unmassiverole',
            timestamp: false,
          }
        ),
      ],
      components      : [_buildConfirmRow('unmassiverole', false)],
      allowedMentions : { parse: [] },
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
      if (interaction.customId === 'local:unmassiverole:cancel') {
        collector.stop('cancelled');
        await interaction.update({
          embeds: [
            embed.build(
              guildId,
              'Action annulée.',
              { title: 'Unmassiverole annulé', timestamp: false }
            ),
          ],
          components: [_buildConfirmRow('unmassiverole', true)],
        }).catch(() => {});
        return;
      }

      if (interaction.customId !== 'local:unmassiverole:confirm') {
        return interaction.deferUpdate().catch(() => {});
      }

      collector.stop('confirmed');
      await interaction.deferUpdate().catch(() => {});
      await confirmMessage.edit({
        components: [_buildConfirmRow('unmassiverole', true)],
      }).catch(() => {});

      await _runUnmassiveRole(
        message, guild, guildId,
        members, sourceRole, targetRole, protectedCount,
        deleteReply, deleteDelay,
      );
    });

    collector.on('end', async (_, reason) => {
      embed.clearPrivateInteraction(confirmMessage);
      if (reason === 'confirmed' || reason === 'cancelled') return;
      await confirmMessage.edit({
        components: [_buildConfirmRow('unmassiverole', true)],
      }).catch(() => {});
      if (deleteReply) embed.scheduleDelete(confirmMessage, deleteDelay);
    });
  },
};

async function _runUnmassiveRole(message, guild, guildId, members, sourceRole, targetRole, protectedCount, deleteReply, deleteDelay) {
  const pending = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `Retrait du rôle ${targetRole} en cours sur \`${members.size}\` membre(s).`,
        {
          title     : 'Unmassiverole en cours',
          timestamp : false,
        }
      ),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  let success = 0;
  let failed  = 0;

  for (const member of members.values()) {
    const ok = await member.roles.remove(
      targetRole,
      `Unmassiverole par ${message.author.username}`
    ).then(() => true).catch(() => false);

    if (ok) success++; else failed++;

    await _wait(750);
  }

  const text =
    `**Rôle retiré**\n` +
    `${targetRole}\n\n` +
    (sourceRole ? `**Rôle source**\n${sourceRole}\n\n` : '') +
    `**Membres éligibles**\n` +
    `\`${members.size}\`\n\n` +
    `**Protégés**\n` +
    `\`${protectedCount}\`\n\n` +
    `**Succès**\n` +
    `\`${success}\`\n\n` +
    `**Échecs**\n` +
    `\`${failed}\``;

  if (pending) {
    await pending.edit({
      embeds: [
        embed.build(
          guildId,
          text,
          {
            title     : 'Unmassiverole terminé',
            timestamp : false,
          }
        ),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => {});

    if (deleteReply) embed.scheduleDelete(pending, deleteDelay);
  } else {
    const sent = await embed.reply(
      message,
      text,
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  }
}

function _buildConfirmRow(scope, disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`local:${scope}:confirm`)
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`local:${scope}:cancel`)
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

async function _resolveRole(guild, query) {
  if (!query || typeof query !== 'string') return null;

  const clean = query.replace(/[<@&>]/g, '');

  if (/^\d{17,20}$/.test(clean)) {
    return guild.roles.cache.get(clean) ??
      await guild.roles.fetch(clean).catch(() => null);
  }

  const lower = query.toLowerCase();

  return guild.roles.cache.find(role =>
    role.name.toLowerCase() === lower
  ) ?? null;
}

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
