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

const db = require('../../core/database');
const embed = require('../../utils/embed');

function _pad(value) {
  return String(value).padStart(2, '0');
}

function _formatDate(day, month) {
  return `${_pad(day)}/${_pad(month)}`;
}

function _formatCountdown(day, month) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  let next = new Date(Date.UTC(currentYear, month - 1, day, 0, 0, 0));
  if (next.getTime() <= now.getTime()) {
    next = new Date(Date.UTC(currentYear + 1, month - 1, day, 0, 0, 0));
  }

  const diffDays = Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 86_400_000));
  return `${diffDays} jour${diffDays > 1 ? 's' : ''}`;
}

function _nextBirthdayTimestamp(day, month) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  let next = new Date(Date.UTC(currentYear, month - 1, day, 0, 0, 0));
  if (next.getTime() <= now.getTime()) {
    next = new Date(Date.UTC(currentYear + 1, month - 1, day, 0, 0, 0));
  }

  return Math.floor(next.getTime() / 1000);
}

function _parseBirthday(value) {
  if (!value) return null;
  const parts = value.trim().split(/[\/\-.]/g);
  if (parts.length !== 2) return null;
  const day = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isInteger(day) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12) return null;
  const maxDay = new Date(2020, month, 0).getDate();
  if (day < 1 || day > maxDay) return null;
  return { day, month };
}

module.exports = {
  help: {
    name        : 'birthday',
    description : 'Enregistre ou affiche votre anniversaire dans le serveur.',
    usage       : 'birthday <JJ/MM> | birthday delete',
    aliases     : ['anniversaire', 'anniv'],
    category    : 'general',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;
    const config = db.getGuildConfig(guildId);
    const deleteCmd = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const targetBirthday = db.getBirthday(guildId, message.author.id);
    const hasBirthday = Boolean(targetBirthday);
    const action = args[0]?.toLowerCase();

    if (action === 'delete' || action === 'remove') {
      if (!hasBirthday) {
        const sent = await embed.replyError(message, 'Aucun anniversaire enregistré à supprimer.');
        if (deleteReply && sent) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      db.deleteBirthday(guildId, message.author.id);
      const sent = await embed.reply(message, 'Votre anniversaire a été supprimé.');
      if (deleteReply && sent) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let birthday = targetBirthday;

    if (args.length > 0) {
      const parsed = _parseBirthday(args[0]);
      if (!parsed) {
        const sent = await embed.replyError(message, 'Format invalide. Utilisez `JJ/MM`, par exemple `24/12`.');
        if (deleteReply && sent) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      birthday = db.setBirthday(guildId, message.author.id, parsed.month, parsed.day, null);
      const sent = await embed.reply(message, `Anniversaire enregistré pour le **${_formatDate(parsed.day, parsed.month)}**.`);
      if (deleteReply && sent) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const buildPayload = (disabled = false) => {
      const row = db.getBirthday(guildId, message.author.id);
      const title = 'Anniversaire';
      const lines = [];

      if (row) {
        const nextBirthdayTs = _nextBirthdayTimestamp(row.day, row.month);
        lines.push(`Votre anniversaire est le **${_formatDate(row.day, row.month)}**.`);
        lines.push(`Prochain anniversaire dans **${_formatCountdown(row.day, row.month)}**.`);
        lines.push(`Date・<t:${nextBirthdayTs}:D> (<t:${nextBirthdayTs}:R>)`);
      } else {
        lines.push('Aucun anniversaire enregistré.');
        lines.push('Utilisez `birthday <JJ/MM>` pour l\'enregistrer.');
      }

      const container = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent([`## ${title}`, '', ...lines].join('\n'))
        )
        .addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('bd:refresh')
              .setLabel('Actualiser')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(disabled),
            new ButtonBuilder()
              .setCustomId('bd:delete')
              .setLabel('Supprimer')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(disabled || !row),
            new ButtonBuilder()
              .setCustomId('bd:close')
              .setLabel('✖')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(disabled),
          )
        );

      return {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      };
    };

    const sent = await message.reply(buildPayload()).catch(() => null);
    if (!sent) return;

    embed.registerPrivateInteraction(sent, message.author.id);

    const collector = sent.createMessageComponentCollector({
      filter: i => i.user.id === message.author.id,
      idle: 300_000,
      time: 900_000,
    });

    collector.on('collect', async (interaction) => {
      try {
        if (interaction.customId === 'bd:close') {
          await interaction.deferUpdate().catch(() => {});
          embed.clearPrivateInteraction(sent);
          collector.stop('closed');
          await message.delete().catch(() => {});
          return sent.delete().catch(() => {});
        }

        if (interaction.customId === 'bd:delete') {
          await interaction.deferUpdate().catch(() => {});
          db.deleteBirthday(guildId, message.author.id);
          return sent.edit(buildPayload());
        }

        if (interaction.customId === 'bd:refresh') {
          await interaction.deferUpdate().catch(() => {});
          return sent.edit(buildPayload());
        }
      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error('[birthday] interaction error:', err.message);
        }
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(sent);
      if (reason === 'closed') return;
      sent.edit(buildPayload(true)).catch(() => {});
    });

    if (deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};
