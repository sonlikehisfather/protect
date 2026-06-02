'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SectionBuilder === 'function' &&
                           typeof SeparatorBuilder === 'function';

const COUNTER_TYPES = [
  { id: 'members',      label: 'Membres',           emoji: '👥', format: '👥 Membres・{count}' },
  { id: 'online',       label: 'En ligne',          emoji: '🟢', format: '🟢 En ligne・{count}' },
  { id: 'voice',        label: 'En vocal',          emoji: '🔊', format: '🔊 En vocal・{count}' },
  { id: 'channels',     label: 'Salons',            emoji: '#️⃣', format: '#️⃣ Salons・{count}' },
  { id: 'textchannels', label: 'Salons textuels',   emoji: '📝', format: '📝 Textuels・{count}' },
  { id: 'voicechannels',label: 'Salons vocaux',     emoji: '🎙️', format: '🎙️ Vocaux・{count}' },
  { id: 'threads',      label: 'Fils',              emoji: '🧵', format: '🧵 Fils・{count}' },
  { id: 'boosts',       label: 'Boosts',            emoji: '💎', format: '💎 Boosts・{count}' },
  { id: 'boostlevel',   label: 'Niveau boost',      emoji: '🏆', format: '🏆 Niveau・{count}' },
  { id: 'emojis',       label: 'Emojis',            emoji: '😀', format: '😀 Emojis・{count}' },
];

const COUNTER_TYPE_TO_CONFIG_KEY = {};
for (const c of COUNTER_TYPES) {
  COUNTER_TYPE_TO_CONFIG_KEY[c.id] = `counter${c.id.charAt(0).toUpperCase() + c.id.slice(1)}Channel`;
}

exports.help = {
  name        : 'counters',
  description : 'Configurer les compteurs de statistiques (salons vocaux avec noms dynamiques).',
  usage       : 'counters <setup|show|off>',
  use         : 'counters <setup|show|off>',
  aliases     : ['counter', 'compteurs'],
  category    : 'server',
  permission  : {
    level           : 'owner',
    label           : 'Server',
    discord         : ['ManageChannels'],
    targetProtection: false,
    bypass          : ['buyer', 'globalOwner'],
  },
  subcommands : [
    {
      name        : 'counters setup',
      description : 'Ouvre l\'interface de configuration des compteurs.',
      usage       : 'counters setup',
      category    : 'server',
    },
    {
      name        : 'counters show',
      description : 'Affiche la configuration actuelle des compteurs.',
      usage       : 'counters show',
      category    : 'server',
    },
    {
      name        : 'counters off',
      description : 'Désactive tous les compteurs.',
      usage       : 'counters off',
      category    : 'server',
    },
  ],
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;

  if (!perms.check(message, exports.help.name)) {
    return;
  }

  const sub = String(args[0] || '').toLowerCase();

  const config = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  if (!sub || sub === 'show' || sub === 'status') {
    const sent = await message.channel.send({
      embeds: [_buildStatusEmbed(guildId, db.getGuildConfig(guildId))],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (sub === 'setup') {
    return _handleSetup(client, message, deleteReply, deleteDelay);
  }

  if (sub === 'off') {
    const currentConfig = db.getGuildConfig(guildId) || {};
    const backup = {};
    for (const key of Object.values(COUNTER_TYPE_TO_CONFIG_KEY)) {
      if (currentConfig[key]) {
        backup[key] = currentConfig[key];
      }
    }
    db.setGuildConfig(guildId, '_countersBackup', JSON.stringify(backup));

    for (const key of Object.values(COUNTER_TYPE_TO_CONFIG_KEY)) {
      db.setGuildConfig(guildId, key, null);
    }

    const sent = await embed.reply(
      message,
      'Tous les compteurs ont été désactivés. Les salons ne seront plus mis à jour.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  const sent = await embed.replyError(
    message,
    'Commande invalide. Utilisez : `counters setup`, `counters show`, `counters off`.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};

async function _handleSetup(client, message, deleteReply, deleteDelay) {
  const guild   = message.guild;
  const guildId = guild.id;

  const config = db.getGuildConfig(guildId);

  const state = {
    guildId,
    page     : 0,
    config   : config || {},
  };

  const panel = await message.channel.send(
    V2_AVAILABLE ? _buildV2Panel(state, client) : _buildPanel(state)
  ).catch(() => null);

  if (!panel) {
    const sent = await embed.replyError(
      message,
      'Impossible d\'ouvrir le panel de configuration des compteurs.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  embed.registerPrivateInteraction(panel, message.author.id, 300_000);

  const collector = panel.createMessageComponentCollector({
    filter : interaction =>
      interaction.user.id === message.author.id &&
      interaction.message.id === panel.id,
    idle   : 300_000,
    time   : 300_000,
  });

  collector.on('collect', async interaction => {
    const id = interaction.customId;

    if (id === 'counters:close') {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      await message.delete().catch(() => {});
      return;
    }

    if (id === 'counters:page:prev') {
      await interaction.deferUpdate().catch(() => {});
      state.config = db.getGuildConfig(guildId) || {};
      state.page   = Math.max(0, Number(state.page || 0) - 1);
      await panel.edit(V2_AVAILABLE ? _buildV2Panel(state, client) : _buildPanel(state)).catch(() => {});
      return;
    }

    if (id === 'counters:page:next') {
      await interaction.deferUpdate().catch(() => {});
      const perPage = V2_AVAILABLE ? 4 : 2;
      const maxPage = Math.max(0, Math.ceil(COUNTER_TYPES.length / perPage) - 1);
      state.config = db.getGuildConfig(guildId) || {};
      state.page   = Math.min(maxPage, Number(state.page || 0) + 1);
      await panel.edit(V2_AVAILABLE ? _buildV2Panel(state, client) : _buildPanel(state)).catch(() => {});
      return;
    }

    if (id.startsWith('counters:select:')) {
      await interaction.deferUpdate().catch(() => {});
      const counterId = id.replace('counters:select:', '');
      const channelId = Array.isArray(interaction.values) ? interaction.values[0] : null;

      const mapping = COUNTER_TYPES.find(c => c.id === counterId);
      if (!mapping || !channelId) {
        return;
      }

      db.setGuildConfig(guildId, COUNTER_TYPE_TO_CONFIG_KEY[counterId], channelId);

      state.config = db.getGuildConfig(guildId) || {};
      await panel.edit(V2_AVAILABLE ? _buildV2Panel(state, client) : _buildPanel(state)).catch(() => {});
      return;
    }

    if (id.startsWith('counters:reset:') && !id.includes(':confirm:') && !id.includes(':cancel:')) {
      const counterId = id.replace('counters:reset:', '');
      const mapping = COUNTER_TYPES.find(c => c.id === counterId);

      if (!mapping) {
        return;
      }

      db.setGuildConfig(guildId, COUNTER_TYPE_TO_CONFIG_KEY[counterId], null);

      await interaction.deferUpdate().catch(() => {});

      state.config = db.getGuildConfig(guildId) || {};
      await panel.edit(V2_AVAILABLE ? _buildV2Panel(state, client) : _buildPanel(state)).catch(() => {});
      return;
    }

    if (id.startsWith('counters:auto:')) {
      const counterId = id.replace('counters:auto:', '');
      const mapping = COUNTER_TYPES.find(c => c.id === counterId);

      if (!mapping) {
        return;
      }

      try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;

        const channelName = mapping.format.replace('{count}', '0');
        
        const newChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildVoice,
          permissionOverwrites: [
            {
              id: guild.id,
              deny: [PermissionFlagsBits.Connect],
            },
            {
              id: client.user.id,
              allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels],
            },
          ],
        });

        db.setGuildConfig(guildId, COUNTER_TYPE_TO_CONFIG_KEY[counterId], newChannel.id);

        await interaction.followUp({
          content: `✓ Salon créé : ${newChannel} pour **${mapping.label}**`,
          flags: 64,
        }).catch(() => {});
      } catch (err) {
        console.error('[Counters] Erreur création salon auto:', err);
        await interaction.followUp({
          content: `\u2716 Erreur lors de la création du salon : ${err.message}`,
          flags: 64,
        }).catch(() => {});
      }

      state.config = db.getGuildConfig(guildId) || {};
      await panel.edit(V2_AVAILABLE ? _buildV2Panel(state, client) : _buildPanel(state)).catch(() => {});
      return;
    }
  });

  collector.on('end', async (_, reason) => {
    embed.clearPrivateInteraction(panel);
    if (reason === 'closed') return;
    await panel.edit({ components: [] }).catch(() => {});
    if (deleteReply) embed.scheduleDelete(panel, deleteDelay);
  });
}

function _buildV2Panel(state, client) {
  const { guildId, config } = state;

  const getChannelName = (channelId) => {
    if (!channelId) return 'Aucun';
    const channel = client.channels.cache.get(channelId);
    return channel?.name || 'Inconnu';
  };

  const perPage = 4;
  const totalPages = Math.max(1, Math.ceil(COUNTER_TYPES.length / perPage));
  const currentPage = Math.min(Math.max(0, Number(state.page || 0)), totalPages - 1);
  state.page = currentPage;
  const visibleCounters = COUNTER_TYPES.slice(
    currentPage * perPage,
    currentPage * perPage + perPage
  );

  const description = `**Configuration des compteurs**\nLes compteurs se mettent à jour automatiquement toutes les 30 secondes.\n\nPage: **${currentPage + 1}/${totalPages}**`;

  try {
    const accent = _hexToInt(embed.getGuildColor(guildId));
    const container = new ContainerBuilder().setAccentColor(accent);

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## 📊 Compteurs de statistiques'),
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(description),
    );
    container.addSeparatorComponents(new SeparatorBuilder());

    for (let i = 0; i < visibleCounters.length; i++) {
      const counter = visibleCounters[i];
      const configKey = COUNTER_TYPE_TO_CONFIG_KEY[counter.id];
      const channelId = config?.[configKey];
      const value = channelId ? `<#${channelId}>` : 'Aucun';

      const hasValue = Boolean(channelId);
      const actionButton = hasValue
        ? new ButtonBuilder()
            .setCustomId(`counters:reset:${counter.id}`)
            .setLabel('Réinitialiser')
            .setStyle(ButtonStyle.Danger)
        : new ButtonBuilder()
            .setCustomId(`counters:auto:${counter.id}`)
            .setLabel('Auto')
            .setStyle(ButtonStyle.Success);

      const preview = counter.format.replace('{count}', '0');

      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`**${counter.emoji} ${counter.label}**\n🏷️ Salon : ${value}\n\`${preview}\``),
          )
          .setButtonAccessory(actionButton),
      );

      const channelName = getChannelName(channelId);
      const selectRow = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`counters:select:${counter.id}`)
          .setPlaceholder(`${counter.label} • Salon : ${channelName}`)
          .setMinValues(1)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildVoice)
      );

      container.addActionRowComponents(selectRow);

      if (i < visibleCounters.length - 1) {
        container.addSeparatorComponents(new SeparatorBuilder());
      }
    }

    container.addSeparatorComponents(new SeparatorBuilder());
    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('counters:page:prev').setLabel('\u25C0').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
      new ButtonBuilder().setCustomId('counters:page:next').setLabel('\u25B6').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages - 1),
      new ButtonBuilder().setCustomId('counters:close').setLabel('\u2716').setStyle(ButtonStyle.Danger)
    );
    container.addActionRowComponents(navRow);

    const payload = {
      embeds          : [],
      components      : [container],
      allowedMentions : { parse: [] },
    };

    if (!state._initialSent) {
      payload.flags = COMPONENTS_V2_FLAG;
      state._initialSent = true;
    }

    return payload;
  } catch {
    return _buildPanel(state);
  }
}

function _buildPanel(state) {
  const { guildId, config } = state;

  const perPage = 2;
  const totalPages = Math.max(1, Math.ceil(COUNTER_TYPES.length / perPage));
  const currentPage = Math.min(Math.max(0, Number(state.page || 0)), totalPages - 1);
  state.page = currentPage;
  const visibleCounters = COUNTER_TYPES.slice(
    currentPage * perPage,
    currentPage * perPage + perPage
  );

  const itemRows = [];

  for (let i = 0; i < visibleCounters.length; i++) {
    const counter = visibleCounters[i];
    const configKey = COUNTER_TYPE_TO_CONFIG_KEY[counter.id];
    const channelId = config?.[configKey];
    const value = channelId ? `<#${channelId}>` : 'Aucun';

    const preview = counter.format.replace('{count}', '0');

    itemRows.push(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`counters:select:${counter.id}`)
          .setPlaceholder(`${counter.emoji} ${counter.label} • ${value}`)
          .setMinValues(1)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildVoice)
      )
    );

    const hasValue = Boolean(channelId);
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`counters:auto:${counter.id}`)
        .setLabel('🆕 Auto')
        .setStyle(ButtonStyle.Success)
        .setDisabled(hasValue),
      new ButtonBuilder()
        .setCustomId(`counters:reset:${counter.id}`)
        .setLabel(`Réinitialiser ${counter.label}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasValue)
    );

    if (i === 0) {
      buttonRow.addComponents(
        new ButtonBuilder().setCustomId('counters:page:prev').setLabel('Précédent').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
        new ButtonBuilder().setCustomId('counters:page:next').setLabel('Suivant').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages - 1),
        new ButtonBuilder().setCustomId('counters:close').setLabel('Fermer').setStyle(ButtonStyle.Secondary)
      );
    }

    itemRows.push(buttonRow);
  }

  const lines = [];
  for (const counter of visibleCounters) {
    const configKey = COUNTER_TYPE_TO_CONFIG_KEY[counter.id];
    const channelId = config?.[configKey];
    const value = channelId ? `<#${channelId}>` : 'Aucun';
    const preview = counter.format.replace('{count}', '0');
    lines.push(`**${counter.emoji} ${counter.label}**`);
    lines.push(`🏷️ Salon : ${value}`);
    lines.push(`\`${preview}\``);
    lines.push('────────────────────────');
  }

  const description = `Les compteurs se mettent à jour toutes les 30 secondes.\nPage: **${currentPage + 1}/${totalPages}**`;

  return {
    embeds: [
      embed.build(guildId, description, {
        title     : 'Configuration des compteurs',
        fields    : [{ name: 'Détails', value: lines.join('\n') }],
        timestamp: false,
      }),
    ],
    components      : itemRows,
    allowedMentions : { parse: [] },
  };
}

function _hexToInt(hex) {
  const cleaned = String(hex || '').replace('#', '');
  const n = parseInt(cleaned, 16);
  return Number.isNaN(n) ? 0x2f3136 : n;
}

function _buildStatusEmbed(guildId, config) {
  const fields = COUNTER_TYPES.map(counter => {
    const configKey = COUNTER_TYPE_TO_CONFIG_KEY[counter.id];
    return {
      name   : `${counter.emoji} ${counter.label}`,
      value  : config?.[configKey] ? `<#${config[configKey]}>` : '`Désactivé`',
      inline : true,
    };
  });

  return embed.build(guildId, 'Les compteurs se mettent à jour automatiquement toutes les 30 secondes.', {
    title     : 'Configuration des compteurs',
    fields,
    timestamp : false,
  });
}
