'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? null;
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder    === 'function' &&
  typeof TextDisplayBuilder  === 'function' &&
  typeof SeparatorBuilder    === 'function'
);

const PANEL_IDLE_MS = 120_000;
const PANEL_TIME_MS = 300_000;

function _hexToInt(hex) {
  try {
    const m = String(hex || '').replace(/^#/, '').match(/^[0-9a-fA-F]{6}$/);
    return m ? parseInt(m[0], 16) : 0x2f3136;
  } catch { return 0x2f3136; }
}

module.exports = {
  help: {
    name        : 'suggestionconfig',
    description : 'Configure le système de suggestions.',
    use         : 'suggestionconfig',
    usage       : 'suggestionconfig',
    aliases     : ['suggestconfig', 'suggestcfg'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const state = _stateFromConfig(config);

    const panel = await message.channel.send(
      _buildPanelPayload(guildId, state)
    ).catch(() => null);

    if (!panel) {
      return embed.replyError(
        message,
        'Impossible d\'ouvrir le panel suggestions.',
        { timestamp: false }
      ).catch(() => {});
    }

    embed.registerPrivateInteraction(panel, message.author.id, PANEL_TIME_MS);

    let busy = false;

    const collector = panel.createMessageComponentCollector({
      filter : interaction =>
        interaction.user.id === message.author.id &&
        interaction.message.id === panel.id,
      idle   : PANEL_IDLE_MS,
      time   : PANEL_TIME_MS,
    });

    collector.on('collect', async interaction => {
      const id = interaction.customId;

      if (busy && id !== 'sc:close') {
        return _ephemeral(interaction, guildId, 'Une modification est déjà en cours.');
      }

      if (id === 'sc:close') {
        collector.stop('closed');
        embed.clearPrivateInteraction(panel);
        await interaction.deferUpdate().catch(() => {});
        await panel.delete().catch(() => {});
        return;
      }

      if (id === 'sc:toggle') {
        if (!state.enabled && !state.pendingChannelId) {
          return _ephemeral(interaction, guildId, 'Définissez d\'abord un salon d\'attente.');
        }
        state.enabled = !state.enabled;
        db.setGuildConfig(guildId, 'suggestionEnabled', state.enabled ? 1 : 0);
        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state);
      }

      if (id === 'sc:pending') {
        busy = true;
        const modalId = `sc:pending:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(modalId, 'Salon attente', [
            _input('pending', 'Salon textuel', TextInputStyle.Short, {
              value: state.pendingChannelId ? `<#${state.pendingChannelId}>` : '',
              required: false, maxLength: 100, placeholder: '#salon, ID ou reset',
            }),
          ])
        ).then(() => true).catch(() => false);
        busy = false;
        if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

        const submit = await _awaitOwnModal(interaction, modalId);
        if (!submit) return _refresh(panel, guildId, state);
        busy = true;

        const value = submit.fields.getTextInputValue('pending').trim();

        if (!value || ['reset', 'off', 'none'].includes(value.toLowerCase())) {
          state.pendingChannelId = null;
          state.enabled = false;
          db.setGuildConfig(guildId, 'suggestionPendingChannel', null);
          db.setGuildConfig(guildId, 'suggestionEnabled', 0);
          await submit.deferUpdate().catch(() => {});
          busy = false;
          return _refresh(panel, guildId, state);
        }

        const channel = await _resolveTextChannel(guild, value);
        if (!channel) {
          await _modalError(submit, guildId, 'Salon textuel introuvable ou invalide.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        state.pendingChannelId = channel.id;
        db.setGuildConfig(guildId, 'suggestionPendingChannel', channel.id);
        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state);
      }

      if (id === 'sc:validated') {
        busy = true;
        const modalId = `sc:validated:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(modalId, 'Salon validées', [
            _input('validated', 'Salon textuel', TextInputStyle.Short, {
              value: state.validatedChannelId ? `<#${state.validatedChannelId}>` : '',
              required: false, maxLength: 100, placeholder: '#salon, ID ou reset',
            }),
          ])
        ).then(() => true).catch(() => false);
        busy = false;
        if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

        const submit = await _awaitOwnModal(interaction, modalId);
        if (!submit) return _refresh(panel, guildId, state);
        busy = true;

        const value = submit.fields.getTextInputValue('validated').trim();

        if (!value || ['reset', 'off', 'none'].includes(value.toLowerCase())) {
          state.validatedChannelId = null;
          db.setGuildConfig(guildId, 'suggestionValidatedChannel', null);
          await submit.deferUpdate().catch(() => {});
          busy = false;
          return _refresh(panel, guildId, state);
        }

        const channel = await _resolveTextChannel(guild, value);
        if (!channel) {
          await _modalError(submit, guildId, 'Salon textuel introuvable ou invalide.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        state.validatedChannelId = channel.id;
        db.setGuildConfig(guildId, 'suggestionValidatedChannel', channel.id);
        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state);
      }

      if (id === 'sc:log') {
        busy = true;
        const modalId = `sc:log:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(modalId, 'Salon logs suggestions', [
            _input('log', 'Salon textuel', TextInputStyle.Short, {
              value: state.logChannelId ? `<#${state.logChannelId}>` : '',
              required: false, maxLength: 100, placeholder: '#salon, ID ou reset',
            }),
          ])
        ).then(() => true).catch(() => false);
        busy = false;
        if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

        const submit = await _awaitOwnModal(interaction, modalId);
        if (!submit) return _refresh(panel, guildId, state);
        busy = true;

        const value = submit.fields.getTextInputValue('log').trim();

        if (!value || ['reset', 'off', 'none'].includes(value.toLowerCase())) {
          state.logChannelId = null;
          db.setGuildConfig(guildId, 'suggestionLogChannel', null);
          await submit.deferUpdate().catch(() => {});
          busy = false;
          return _refresh(panel, guildId, state);
        }

        const channel = await _resolveTextChannel(guild, value);
        if (!channel) {
          await _modalError(submit, guildId, 'Salon textuel introuvable ou invalide.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        state.logChannelId = channel.id;
        db.setGuildConfig(guildId, 'suggestionLogChannel', channel.id);
        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state);
      }

      if (id === 'sc:reset') {
        state.enabled            = false;
        state.pendingChannelId   = null;
        state.validatedChannelId = null;
        state.logChannelId       = null;

        db.setGuildConfig(guildId, 'suggestionEnabled', 0);
        db.setGuildConfig(guildId, 'suggestionPendingChannel', null);
        db.setGuildConfig(guildId, 'suggestionValidatedChannel', null);
        db.setGuildConfig(guildId, 'suggestionLogChannel', null);

        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state);
      }

      await interaction.deferUpdate().catch(() => {});
    });

    collector.on('end', async (_, reason) => {
      embed.clearPrivateInteraction(panel);
      if (reason === 'closed') return;

      if (V2_AVAILABLE) {
        try {
          const ro = _buildReadOnlyV2(guildId, state);
          await panel.edit(ro).catch(() => {});
        } catch {
          await panel.edit({ components: [] }).catch(() => {});
        }
      } else {
        await panel.edit({ components: [] }).catch(() => {});
      }

      if (deleteReply) {
        embed.scheduleDelete(panel, deleteDelay);
      }
    });
  },
};


function _stateFromConfig(config) {
  return {
    enabled            : Number(config?.suggestionEnabled) === 1,
    pendingChannelId   : config?.suggestionPendingChannel || config?.suggestionChannel || null,
    validatedChannelId : config?.suggestionValidatedChannel || null,
    logChannelId       : config?.suggestionLogChannel || null,
    baseColor          : config?.color || '#2f3136',
  };
}


function _buildPanelPayload(guildId, state) {
  if (V2_AVAILABLE) {
    try {
      const payload = _buildV2(guildId, state);
      if (payload) return payload;
    } catch {}
  }
  return _buildLegacy(guildId, state);
}

function _buildV2(guildId, state) {
  const accent    = _hexToInt(state.baseColor);
  const container = new ContainerBuilder().setAccentColor(accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Suggestions'),
  );

  const statusLine    = state.enabled ? '`Activé`' : '`Désactivé`';
  const pendingLine   = state.pendingChannelId ? `\`<#${state.pendingChannelId}>\`` : '`Aucun`';
  const validatedLine = state.validatedChannelId ? `\`<#${state.validatedChannelId}>\`` : '`Aucun`';
  const logLine       = state.logChannelId ? `\`<#${state.logChannelId}>\`` : '`Aucun`';

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `> **État** ${statusLine}\n` +
      `> **Salon attente** ${pendingLine}\n` +
      `> **Salon validées** ${validatedLine}\n` +
      `> **Salon logs** ${logLine}`
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sc:toggle')
        .setLabel(state.enabled ? 'Désactiver' : 'Activer')
        .setStyle(state.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('sc:pending')
        .setLabel('Salon attente')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('sc:validated')
        .setLabel('Salon validées')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('sc:log')
        .setLabel('Salon logs')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sc:reset')
        .setLabel('Réinitialiser')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('sc:close')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Secondary),
    ),
  );


  return {
    flags           : COMPONENTS_V2_FLAG,
    components      : [container],
    allowedMentions : { parse: [] },
  };
}

function _buildReadOnlyV2(guildId, state) {
  const accent    = _hexToInt(state.baseColor);
  const container = new ContainerBuilder().setAccentColor(accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Suggestions'),
  );

  const statusLine    = state.enabled ? '`Activé`' : '`Désactivé`';
  const pendingLine   = state.pendingChannelId ? `\`<#${state.pendingChannelId}>\`` : '`Aucun`';
  const validatedLine = state.validatedChannelId ? `\`<#${state.validatedChannelId}>\`` : '`Aucun`';
  const logLine       = state.logChannelId ? `\`<#${state.logChannelId}>\`` : '`Aucun`';

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `> **État** ${statusLine}\n` +
      `> **Salon attente** ${pendingLine}\n` +
      `> **Salon validées** ${validatedLine}\n` +
      `> **Salon logs** ${logLine}`
    ),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('-# Panel expiré'),
  );

  return {
    flags           : COMPONENTS_V2_FLAG,
    components      : [container],
    allowedMentions : { parse: [] },
  };
}

function _buildLegacy(guildId, state) {
  const desc =
    `**État** : ${state.enabled ? 'Activé' : 'Désactivé'}\n` +
    `**Salon attente** : ${state.pendingChannelId ? `<#${state.pendingChannelId}>` : 'Aucun'}\n` +
    `**Salon validées** : ${state.validatedChannelId ? `<#${state.validatedChannelId}>` : 'Aucun'}\n` +
    `**Salon logs** : ${state.logChannelId ? `<#${state.logChannelId}>` : 'Aucun'}`;

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sc:toggle')
        .setLabel(state.enabled ? 'Désactiver' : 'Activer')
        .setStyle(state.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('sc:pending')
        .setLabel('Salon attente')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('sc:validated')
        .setLabel('Salon validées')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('sc:log')
        .setLabel('Salon logs')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sc:reset')
        .setLabel('Réinitialiser')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('sc:close')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return {
    embeds          : [new EmbedBuilder().setTitle('Suggestions').setColor(state.baseColor).setDescription(desc)],
    components      : rows,
    allowedMentions : { parse: [] },
  };
}


async function _refresh(panel, guildId, state) {
  return panel.edit(_buildPanelPayload(guildId, state)).catch(() => {});
}

async function _resolveTextChannel(guild, query) {
  if (!query) return null;
  const raw = String(query).trim();
  const mention = raw.match(/^<#(\d{17,20})>$/);
  const id = mention?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);

  if (id) {
    const ch = guild.channels.cache.get(id)
      ?? await guild.channels.fetch(id).catch(() => null);
    if (ch && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)) {
      return ch;
    }
    return null;
  }

  const normalized = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^#/, '').trim();
  const found = guild.channels.cache.find(ch =>
    [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type) &&
    ch.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === normalized
  );
  return found ?? null;
}

function _buildModal(customId, title, inputs) {
  const modal = new ModalBuilder()
    .setCustomId(customId.slice(0, 100))
    .setTitle(title.slice(0, 45));
  modal.addComponents(inputs.map(i => new ActionRowBuilder().addComponents(i)));
  return modal;
}

function _input(customId, label, style, options = {}) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 45))
    .setStyle(style)
    .setRequired(Boolean(options.required));

  if (options.value)       input.setValue(String(options.value).slice(0, options.maxLength || 4000));
  if (options.placeholder) input.setPlaceholder(options.placeholder.slice(0, 100));
  if (options.maxLength)   input.setMaxLength(options.maxLength);

  return input;
}

async function _awaitOwnModal(interaction, customId) {
  try {
    return await interaction.awaitModalSubmit({
      filter: i => i.customId === customId && i.user.id === interaction.user.id,
      time: 120_000,
    });
  } catch { return null; }
}

async function _ephemeral(interaction, guildId, content) {
  return interaction.reply({
    embeds: [embed.build(guildId, content, { color: '#ED4245', timestamp: false })],
    flags: 64,
  }).catch(() => {});
}

async function _modalError(submit, guildId, content) {
  return submit.reply({
    embeds: [embed.build(guildId, content, { color: '#ED4245', timestamp: false })],
    flags: 64,
  }).catch(() => {});
}
