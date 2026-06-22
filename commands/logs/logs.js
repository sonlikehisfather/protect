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
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SectionBuilder === 'function' &&
                           typeof SeparatorBuilder === 'function';

const LOG_TYPE_TO_CONFIG_KEY = {
  modlog       : 'modLogChannel',
  joinlog      : 'joinLogChannel',
  leavelog     : 'leaveLogChannel',
  messagelog   : 'messageLogChannel',
  voicelog     : 'voiceLogChannel',
  boostlog     : 'boostLogChannel',
  rolelog      : 'roleLogChannel',
  raidlog      : 'raidLogChannel',
  errorlog     : 'errorLogChannel',
  invitelog    : 'inviteLogChannel',
  levellog     : 'levelLogChannel',
  channellog   : 'channelLogChannel',
  serverlog    : 'serverLogChannel',
  emojilog     : 'emojiLogChannel',
  ticketlog    : 'ticketLogChannel',
};

const SETUP_CHANNELS = [
  // Général
  { id: 'gen:boost',    label: 'Boost',      configKey: 'boostLogChannel' },
  { id: 'gen:message',  label: 'Message',    configKey: 'messageLogChannel' },
  { id: 'gen:mod',      label: 'Modération', configKey: 'modLogChannel' },
  { id: 'gen:raid',     label: 'Raid',       configKey: 'raidLogChannel' },
  // Membres
  { id: 'mem:join',     label: 'Arrivée',    configKey: 'joinLogChannel' },
  { id: 'mem:leave',    label: 'Départ',     configKey: 'leaveLogChannel' },
  { id: 'mem:invite',   label: 'Invite',     configKey: 'inviteLogChannel' },
  { id: 'mem:level',    label: 'Level',      configKey: 'levelLogChannel' },
  // Structure
  { id: 'str:channel',  label: 'Salon',      configKey: 'channelLogChannel' },
  { id: 'str:role',     label: 'Rôle',       configKey: 'roleLogChannel' },
  { id: 'str:server',   label: 'Serveur',    configKey: 'serverLogChannel' },
  { id: 'str:emoji',    label: 'Emoji',      configKey: 'emojiLogChannel' },
  { id: 'str:ticket',   label: 'Ticket',     configKey: 'ticketLogChannel' },
  { id: 'str:voice',    label: 'Vocal',      configKey: 'voiceLogChannel' },
  { id: 'gen:error',    label: 'Erreur',     configKey: 'errorLogChannel' },
];

exports.help = {
  name        : 'logs',
  description : 'Configurer les salons de logs.',
  usage       : 'logs <setup|show|off|on>',
  use         : 'logs <setup|show|off|on>',
  aliases     : ['log', 'setlog'],
  category    : 'logs',
  subcommands : [
    {
      name        : 'logs setup',
      description : 'Ouvre l\'interface de configuration des logs.',
      usage       : 'logs setup',
      category    : 'logs',
    },
    {
      name        : 'logs show',
      description : 'Affiche la configuration actuelle des logs.',
      usage       : 'logs show',
      category    : 'logs',
    },
    {
      name        : 'logs off',
      description : 'Désactive tous les salons de logs.',
      usage       : 'logs off',
      category    : 'logs',
    },
    {
      name        : 'logs on',
      description : 'Réactive tous les salons de logs précédemment configurés.',
      usage       : 'logs on',
      category    : 'logs',
    },
    {
      name        : 'logs doc',
      description : 'Documentation des logs disponibles.',
      usage       : 'logs doc',
      category    : 'logs',
    },
    {
      name        : 'logs ignore',
      description : 'Ignorer un salon du logging.',
      usage       : 'logs ignore #salon',
      category    : 'logs',
    },
    {
      name        : 'logs unignore',
      description : 'Retirer un salon de la liste des salons ignorés.',
      usage       : 'logs unignore #salon',
      category    : 'logs',
    },
    {
      name        : 'logs ignored',
      description : 'Lister les salons ignorés par les logs.',
      usage       : 'logs ignored',
      category    : 'logs',
    },
  ],
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;

  if (!perms.check(message, exports.help.name)) {
    return;
  }

  const sub = String(args[0] || '').toLowerCase();

  if (sub === 'doc') {
    const docCmd = require('./doc.js');
    return docCmd.run(client, message, args.slice(1));
  }

  if (sub === 'ignore' || sub === 'unignore' || sub === 'ignored') {
    return _handleIgnore(client, message, args, sub);
  }

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
    for (const key of Object.values(LOG_TYPE_TO_CONFIG_KEY)) {
      if (currentConfig[key]) {
        backup[key] = currentConfig[key];
      }
    }
    db.setGuildConfig(guildId, '_logsBackup', JSON.stringify(backup));

    for (const key of Object.values(LOG_TYPE_TO_CONFIG_KEY)) {
      db.setGuildConfig(guildId, key, null);
    }

    const sent = await embed.reply(
      message,
      'Tous les salons de logs ont été désactivés. Utilisez `logs on` pour les réactiver.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (sub === 'on') {
    const currentConfig = db.getGuildConfig(guildId) || {};
    const backupRaw = currentConfig._logsBackup;

    if (!backupRaw) {
      const sent = await embed.replyError(
        message,
        'Aucune sauvegarde trouvée. Utilisez `logs setup` pour configurer les logs.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    try {
      const backup = JSON.parse(backupRaw);
      let restoredCount = 0;

      for (const [key, value] of Object.entries(backup)) {
        if (Object.values(LOG_TYPE_TO_CONFIG_KEY).includes(key) && value) {
          db.setGuildConfig(guildId, key, value);
          restoredCount++;
        }
      }

      db.setGuildConfig(guildId, '_logsBackup', null);

      const sent = await embed.reply(
        message,
        `${restoredCount} salon(s) de logs réactivé(s).`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
    } catch {
      const sent = await embed.replyError(
        message,
        'Erreur lors de la restauration des logs.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
    }
    return;
  }

  const sent = await embed.replyError(
    message,
    'Commande invalide. Utilisez : `logs setup`, `logs show`, `logs off`, `logs on`, `logs ignore`, `logs unignore`, `logs ignored`.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};

async function _handleIgnore(client, message, args, sub) {
  const guildId = message.guild.id;

  if (sub === 'ignored') {
    const channelIds = db.getNoLogChannels(guildId);
    if (!channelIds.length) {
      return embed.reply(message, 'Aucun salon ignoré.', { timestamp: false });
    }
    const list = channelIds.map(id => `<#${id}>`).join('\n');
    return embed.reply(message, `Salons ignorés pour les logs :\n${list}`, { timestamp: false });
  }

  const rawArg = args[1];
  if (!rawArg) {
    return embed.replyError(
      message,
      `Utilisation : \`+logs ${sub} #salon\``,
      { timestamp: false }
    );
  }

  const channelId = rawArg.replace(/[<#>]/g, '');
  const channel = message.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) {
    return embed.replyError(message, 'Salon introuvable.', { timestamp: false });
  }

  if (sub === 'ignore') {
    db.addNoLogChannel(guildId, channel.id);
    return embed.reply(message, `<#${channel.id}> est maintenant ignoré par les logs.`, { timestamp: false });
  }

  if (sub === 'unignore') {
    db.removeNoLogChannel(guildId, channel.id);
    return embed.reply(message, `<#${channel.id}> n'est plus ignoré par les logs.`, { timestamp: false });
  }
}

async function _handleSetup(client, message, deleteReply, deleteDelay) {
  const guild   = message.guild;
  const guildId = guild.id;

  const config = db.getGuildConfig(guildId);

  const state = {
    guildId,
    category : 'general',
    page     : 0,
    config   : config || {},
  };

  const panel = await message.channel.send(
    V2_AVAILABLE ? _buildV2Panel(state, client) : _buildPanel(state)
  ).catch(() => null);

  if (!panel) {
    const sent = await embed.replyError(
      message,
      'Impossible d\'ouvrir le panel de configuration des logs.',
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
    idle   : 120_000,
    time   : 300_000,
  });

  collector.on('collect', async interaction => {
    const id = interaction.customId;

    if (id === 'logs:close') {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      await message.delete().catch(() => {});
      return;
    }

    await interaction.deferUpdate().catch(() => {});
    
    if (id === 'logs:category') {
      const value = interaction.values?.[0];
      if (value && ['general', 'members', 'structure'].includes(value)) {
        state.category = value;
        state.page     = 0;
        state.config   = db.getGuildConfig(guildId) || {};
      }
      await panel.edit(V2_AVAILABLE ? _buildV2Panel(state, client) : _buildPanel(state)).catch(() => {});
      return;
    }

    if (id === 'logs:page:prev') {
      state.config = db.getGuildConfig(guildId) || {};
      state.page   = Math.max(0, Number(state.page || 0) - 1);
      await panel.edit(V2_AVAILABLE ? _buildV2Panel(state, client) : _buildPanel(state)).catch(() => {});
      return;
    }

    if (id === 'logs:page:next') {
      const currentFields = [
        ...SETUP_CHANNELS.filter(r => r.id.startsWith(state.category === 'general' ? 'gen:' : state.category === 'members' ? 'mem:' : 'str:'))
      ];
      const perPage = V2_AVAILABLE && (state.category === 'members' || state.category === 'general' || state.category === 'structure') ? 4 : 2;
      const maxPage = Math.max(0, Math.ceil(currentFields.length / perPage) - 1);
      state.config = db.getGuildConfig(guildId) || {};
      state.page   = Math.min(maxPage, Number(state.page || 0) + 1);
      await panel.edit(V2_AVAILABLE ? _buildV2Panel(state, client) : _buildPanel(state)).catch(() => {});
      return;
    }

    if (id.startsWith('logs:select:')) {
      const fieldId = id.replace('logs:select:', '');
      const channelId = Array.isArray(interaction.values) ? interaction.values[0] : null;

      const mapping = SETUP_CHANNELS.find(row => row.id === fieldId);
      if (!mapping || !channelId) {
        return;
      }

      db.setGuildConfig(guildId, mapping.configKey, channelId);

      state.config = db.getGuildConfig(guildId) || {};
      await panel.edit(V2_AVAILABLE ? _buildV2Panel(state, client) : _buildPanel(state)).catch(() => {});
      return;
    }

    if (id.startsWith('logs:reset:')) {
      const fieldId = id.replace('logs:reset:', '');
      const mapping = SETUP_CHANNELS.find(row => row.id === fieldId);

      if (!mapping) {
        return;
      }

      db.setGuildConfig(guildId, mapping.configKey, null);

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
  const { guildId, category, config } = state;

  const getChannelName = (channelId) => {
    if (!channelId) return 'Aucun';
    const channel = client.channels.cache.get(channelId);
    return channel?.name || 'Inconnu';
  };

  const fieldsByCategory = {
    general: SETUP_CHANNELS.filter(r => r.id.startsWith('gen:')),
    members: SETUP_CHANNELS.filter(r => r.id.startsWith('mem:')),
    structure: SETUP_CHANNELS.filter(r => r.id.startsWith('str:')),
  };

  const currentFields = fieldsByCategory[category] || [];
  const fieldsPerPage = (category === 'members' || category === 'general' || category === 'structure') ? 4 : 2;
  const totalPages = Math.max(1, Math.ceil(currentFields.length / fieldsPerPage));
  const currentPage = Math.min(Math.max(0, Number(state.page || 0)), totalPages - 1);
  state.page = currentPage;
  const visibleFields = currentFields.slice(
    currentPage * fieldsPerPage,
    currentPage * fieldsPerPage + fieldsPerPage
  );

  const categories = [
    { id: 'general',  label: 'Général',   emoji: '📁' },
    { id: 'members',  label: 'Membres',   emoji: '👥' },
    { id: 'structure',label: 'Structure', emoji: '#️⃣' },
  ];

  const categoryRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('logs:category')
      .setPlaceholder('Sélectionner une section')
      .addOptions(
        categories.map(c => ({
          label   : c.label,
          value   : c.id,
          emoji   : c.emoji,
          default : c.id === category,
        }))
      )
  );

  const sectionName = category === 'general'
    ? 'Général'
    : category === 'members'
    ? 'Membres'
    : 'Structure';

  const description = `Section: **${sectionName}**\nPage: **${currentPage + 1}/${totalPages}**`;

  try {
    const accent = _hexToInt(embed.getGuildColor(guildId));
    const container = new ContainerBuilder().setAccentColor(accent);

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## Configuration des Logs'),
    );
    container.addActionRowComponents(categoryRow);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(description),
    );
    container.addSeparatorComponents(new SeparatorBuilder());

    for (let i = 0; i < visibleFields.length; i++) {
      const field = visibleFields[i];
      const value = config?.[field.configKey] ? `<#${config[field.configKey]}>` : 'Aucun';

      const hasValue = config?.[field.configKey];
      const resetButton = new ButtonBuilder()
        .setCustomId(`logs:reset:${field.id}`)
        .setLabel('Réinitialiser')
        .setStyle(hasValue ? ButtonStyle.Danger : ButtonStyle.Secondary)
        .setDisabled(!hasValue);

      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`**${field.label}**\n🏷️ Salon : ${value}`),
          )
          .setButtonAccessory(resetButton),
      );

      const channelName = getChannelName(config?.[field.configKey]);
      const selectRow = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`logs:select:${field.id}`)
          .setPlaceholder(`${field.label} • Salon : ${channelName}`)
          .setMinValues(1)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      );

      container.addActionRowComponents(selectRow);

      if (i < visibleFields.length - 1) {
        container.addSeparatorComponents(new SeparatorBuilder());
      }
    }

    container.addSeparatorComponents(new SeparatorBuilder());
    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('logs:page:prev').setLabel('\u2190').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
      new ButtonBuilder().setCustomId('logs:page:next').setLabel('\u2192').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages - 1),
      new ButtonBuilder().setCustomId('logs:close').setLabel('\u2716').setStyle(ButtonStyle.Danger)
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
  const { guildId, category, config } = state;

  const fieldsByCategory = {
    general: SETUP_CHANNELS.filter(r => r.id.startsWith('gen:')),
    members: SETUP_CHANNELS.filter(r => r.id.startsWith('mem:')),
    structure: SETUP_CHANNELS.filter(r => r.id.startsWith('str:')),
  };

  const currentFields = fieldsByCategory[category] || [];
  const fieldsPerPage = 2;
  const totalPages = Math.max(1, Math.ceil(currentFields.length / fieldsPerPage));
  const currentPage = Math.min(Math.max(0, Number(state.page || 0)), totalPages - 1);
  state.page = currentPage;
  const visibleFields = currentFields.slice(
    currentPage * fieldsPerPage,
    currentPage * fieldsPerPage + fieldsPerPage
  );

  const categories = [
    { id: 'general',  label: 'Général',   emoji: '📁' },
    { id: 'members',  label: 'Membres',   emoji: '👥' },
    { id: 'structure',label: 'Structure', emoji: '#️⃣' },
  ];

  const categoryRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('logs:category')
      .setPlaceholder('Sélectionner une section')
      .addOptions(
        categories.map(c => ({
          label   : c.label,
          value   : c.id,
          emoji   : c.emoji,
          default : c.id === category,
        }))
      )
  );

  const itemRows = [];

  for (let i = 0; i < visibleFields.length; i++) {
    const field = visibleFields[i];
    const value = config?.[field.configKey] ? `<#${config[field.configKey]}>` : 'Aucun';

    itemRows.push(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`logs:select:${field.id}`)
          .setPlaceholder(`${field.label} • Salon : ${value}`)
          .setMinValues(1)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
    );

    const resetRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`logs:reset:${field.id}`)
        .setLabel(`Réinitialiser ${field.label}`)
        .setStyle(ButtonStyle.Secondary)
    );

    if (i === 0) {
      resetRow.addComponents(
        new ButtonBuilder().setCustomId('logs:page:prev').setLabel('Précédent').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
        new ButtonBuilder().setCustomId('logs:page:next').setLabel('Suivant').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages - 1),
        new ButtonBuilder().setCustomId('logs:close').setLabel('Fermer').setStyle(ButtonStyle.Secondary)
      );
    }

    itemRows.push(resetRow);
  }

  const sectionName = category === 'general'
    ? 'Général'
    : category === 'members'
    ? 'Membres'
    : 'Structure';

  const lines = [];
  for (const field of visibleFields) {
    const value = config?.[field.configKey] ? `<#${config[field.configKey]}>` : 'Aucun';
    lines.push(`**${field.label}**`);
    lines.push(`🏷️ Salon : ${value}`);
    lines.push('────────────────────────');
  }

  const description = `Section: **${sectionName}**\nPage: **${currentPage + 1}/${totalPages}**`;

  return {
    embeds: [
      embed.build(guildId, description, {
        title     : 'Configuration des Logs',
        fields    : [{ name: 'Détails', value: lines.join('\n') }],
        timestamp: false,
      }),
    ],
    components      : [categoryRow, ...itemRows],
    allowedMentions : { parse: [] },
  };
}

function _hexToInt(hex) {
  const cleaned = String(hex || '').replace('#', '');
  const n = parseInt(cleaned, 16);
  return Number.isNaN(n) ? 0x2f3136 : n;
}

function _resolveTextChannel(message, raw) {
  const mentioned = message.mentions.channels.first();
  if (mentioned?.isTextBased?.()) return mentioned;

  const id = String(raw || '').replace(/[<#>]/g, '').trim();
  if (!id) return null;

  const byId = message.guild.channels.cache.get(id);
  if (!byId?.isTextBased?.()) return null;
  return byId;
}

function _buildStatusEmbed(guildId, config) {
  const fields = Object.entries(LOG_TYPE_TO_CONFIG_KEY).map(([type, key]) => ({
    name   : type,
    value  : config?.[key] ? `<#${config[key]}>` : '`Aucun`',
    inline : true,
  }));

  return embed.build(guildId, null, {
    title     : 'Configuration des logs',
    fields,
    timestamp : false,
  });
}