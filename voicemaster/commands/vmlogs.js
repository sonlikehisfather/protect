'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} = require('discord.js');

const store    = require('../store');
const messages = require('../messages');
const embed    = require('../../utils/embed');
const { LEVELS, LOG_SECTIONS, LOG_TYPES } = require('../config');

/* Le préfixe "logs:" est ignoré par le gestionnaire global d'interactions (collector local). */
const ID = 'logs:vm';

const PER_PAGE   = 4;
const IDLE_MS    = 120_000;
const TOTAL_MS   = 300_000;

function _channelValue(entry) {
  return entry?.channelId ? `<#${entry.channelId}>` : 'Aucun';
}

function _buildShow(guild) {
  const entries = new Map(store.listLogEntries(guild.id).map(e => [e.type, e]));

  const lines = [];
  for (const section of LOG_SECTIONS) {
    lines.push(`**${section.label}**`);
    for (const type of LOG_TYPES.filter(t => t.section === section.id)) {
      const entry = entries.get(type.id);
      const state = entry?.channelId && !entry.enabled ? ' · désactivé' : '';
      lines.push(`${type.label} › ${_channelValue(entry)}${state}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

function _buildPanel(guild, state) {
  const entries = new Map(store.listLogEntries(guild.id).map(e => [e.type, e]));

  const types      = LOG_TYPES.filter(t => t.section === state.section);
  const totalPages = Math.max(1, Math.ceil(types.length / PER_PAGE));
  state.page       = Math.min(Math.max(0, state.page), totalPages - 1);

  const visible = types.slice(state.page * PER_PAGE, state.page * PER_PAGE + PER_PAGE);
  const section = LOG_SECTIONS.find(s => s.id === state.section);

  const sectionRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${ID}:section`)
      .setPlaceholder('Sélectionner une section')
      .addOptions(
        LOG_SECTIONS.map(s => ({ label: s.label, value: s.id, default: s.id === state.section }))
      )
  );

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Configuration des Logs Voicemaster'));
  container.addActionRowComponents(sectionRow);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`Section: **${section.label}**\nPage: **${state.page + 1}/${totalPages}**`)
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  visible.forEach((type, index) => {
    const entry    = entries.get(type.id);
    const hasValue = Boolean(entry?.channelId);
    const name     = hasValue ? (guild.channels.cache.get(entry.channelId)?.name ?? 'Inconnu') : 'Aucun';

    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`**${type.label}**\nSalon : ${_channelValue(entry)}`)
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`${ID}:reset:${type.id}`)
            .setLabel('Réinitialiser')
            .setStyle(hasValue ? ButtonStyle.Danger : ButtonStyle.Secondary)
            .setDisabled(!hasValue)
        )
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:select:${type.id}`)
          .setPlaceholder(`${type.label} • Salon : ${name}`)
          .setMinValues(1)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
    );

    if (index < visible.length - 1) container.addSeparatorComponents(new SeparatorBuilder());
  });

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${ID}:prev`).setLabel('←').setStyle(ButtonStyle.Secondary).setDisabled(state.page === 0),
      new ButtonBuilder().setCustomId(`${ID}:next`).setLabel('→').setStyle(ButtonStyle.Secondary).setDisabled(state.page >= totalPages - 1),
      new ButtonBuilder().setCustomId(`${ID}:close`).setLabel('✖').setStyle(ButtonStyle.Danger)
    )
  );

  const payload = { embeds: [], components: [container], allowedMentions: { parse: [] } };

  /* Le drapeau CV2 n'est envoyé qu'au premier envoi, pas aux modifications. */
  if (!state.sent) {
    payload.flags = MessageFlags.IsComponentsV2;
    state.sent = true;
  }

  return payload;
}

async function _openSetup(message, reply) {
  const guild    = message.guild;
  const authorId = message.author.id;
  const state    = { section: LOG_SECTIONS[0].id, page: 0, sent: false };

  const panel = await message.channel.send(_buildPanel(guild, state)).catch(() => null);
  if (!panel) return reply(messages.logsPanelFailed());

  embed.registerPrivateInteraction(panel, authorId, TOTAL_MS);

  const collector = panel.createMessageComponentCollector({
    filter : i => i.user.id === authorId && i.message.id === panel.id,
    idle   : IDLE_MS,
    time   : TOTAL_MS,
  });

  const refresh = () => panel.edit(_buildPanel(guild, state)).catch(() => {});

  collector.on('collect', async interaction => {
    const id = interaction.customId;

    if (id === `${ID}:close`) {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      return;
    }

    await interaction.deferUpdate().catch(() => {});

    if (id === `${ID}:section`) {
      const value = interaction.values?.[0];
      if (LOG_SECTIONS.some(s => s.id === value)) {
        state.section = value;
        state.page    = 0;
      }
      return refresh();
    }

    if (id === `${ID}:prev`) {
      state.page = Math.max(0, state.page - 1);
      return refresh();
    }

    if (id === `${ID}:next`) {
      state.page += 1;
      return refresh();
    }

    if (id.startsWith(`${ID}:select:`)) {
      const typeId    = id.slice(`${ID}:select:`.length);
      const channelId = interaction.values?.[0];
      if (LOG_TYPES.some(t => t.id === typeId) && channelId) {
        store.setLogChannel(guild.id, typeId, channelId);
      }
      return refresh();
    }

    if (id.startsWith(`${ID}:reset:`)) {
      const typeId = id.slice(`${ID}:reset:`.length);
      if (LOG_TYPES.some(t => t.id === typeId)) store.clearLogChannel(guild.id, typeId);
      return refresh();
    }
  });

  collector.on('end', async (_, reason) => {
    embed.clearPrivateInteraction(panel);
    if (reason === 'closed') return;
    await panel.edit({ components: [] }).catch(() => {});
  });
}

module.exports = {
  name        : 'vmlogs',
  description : 'Configure les salons de logs Voicemaster (setup, show, on, off).',
  aliases     : ['vmlog'],
  minRank     : LEVELS.SYS_PLUS,
  usage       : '=vmlogs <setup|show|on|off>',

  async run({ message, args, reply }) {
    const guild = message.guild;
    const sub   = String(args[0] ?? 'show').toLowerCase();

    if (sub === 'show' || sub === 'status') {
      return embed.reply(message, _buildShow(guild), { title: 'Logs Voicemaster', timestamp: false });
    }

    if (sub === 'setup') return _openSetup(message, reply);

    if (sub === 'off') {
      store.setAllLogsEnabled(guild.id, false);
      return reply(messages.logsOff());
    }

    if (sub === 'on') {
      store.setAllLogsEnabled(guild.id, true);
      return reply(messages.logsOn());
    }

    return reply(messages.usage('=vmlogs <setup|show|on|off>'));
  },
};
