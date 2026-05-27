'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');
const config = require('../../config.json');

const MAX_DM_LENGTH = 1900;

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? null;
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder    === 'function' &&
  typeof TextDisplayBuilder  === 'function' &&
  typeof SeparatorBuilder    === 'function'
);

const PANEL_IDLE_MS = 120_000;
const PANEL_TIME_MS = 300_000;

const MP_TYPES = [
  { key: 'modDmWarn',    label: 'Warn'    },
  { key: 'modDmKick',    label: 'Kick'    },
  { key: 'modDmBan',     label: 'Ban'     },
  { key: 'modDmTempban', label: 'Tempban' },
  { key: 'modDmMute',    label: 'Mute'    },
  { key: 'modDmUnmute',  label: 'Unmute'  },
];

const TPL_KEYS = {
  global  : 'modDmTemplateGlobal',
  warn    : 'modDmTemplateWarn',
  kick    : 'modDmTemplateKick',
  ban     : 'modDmTemplateBan',
  tempban : 'modDmTemplateTempban',
  mute    : 'modDmTemplateMute',
  unmute  : 'modDmTemplateUnmute',
};

const MODE_KEYS = {
  global  : 'modDmModeGlobal',
  warn    : 'modDmModeWarn',
  kick    : 'modDmModeKick',
  ban     : 'modDmModeBan',
  tempban : 'modDmModeTempban',
  mute    : 'modDmModeMute',
  unmute  : 'modDmModeUnmute',
};

const TPL_OPTIONS = [
  { value: 'global',  label: 'Global',  emoji: '\uD83C\uDF10' },
  { value: 'warn',    label: 'Warn',    emoji: '\u26A0\uFE0F' },
  { value: 'kick',    label: 'Kick',    emoji: '\uD83D\uDC5F' },
  { value: 'ban',     label: 'Ban',     emoji: '\uD83D\uDD28' },
  { value: 'tempban', label: 'Tempban', emoji: '\u23F3' },
  { value: 'mute',    label: 'Mute',    emoji: '\uD83D\uDD07' },
  { value: 'unmute',  label: 'Unmute',  emoji: '\uD83D\uDD0A' },
];

const VARIABLES_HELP = [
  '`{user}` - Tag du membre sanctionne',
  '`{user.mention}` - Mention du membre',
  '`{user.id}` - ID du membre',
  '`{raison}` - Raison de la sanction',
  '`{durée}` - Duree (mute/tempban uniquement)',
  '`{serveur}` - Nom du serveur',
  '`{serveur.id}` - ID du serveur',
  '`{type}` - Type de sanction',
  '`{modérateur}` - Tag du moderateur',
  '`{modérateur.mention}` - Mention du moderateur',
  '`{modérateur.id}` - ID du moderateur',
].join('\n');

function _hexToInt(hex) {
  try {
    const m = String(hex || '').replace(/^#/, '').match(/^[0-9a-fA-F]{6}$/);
    return m ? parseInt(m[0], 16) : 0x2f3136;
  } catch { return 0x2f3136; }
}

module.exports = {
  help: {
    name        : 'mp',
    description : 'Envoie un MP à un membre via le bot.',
    use         : 'mp <membre/id> <message>',
    usage       : 'mp <membre/id> <message>',
    aliases     : ['dm', 'mpsettings', 'dmsettings'],
    category    : 'owner',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const guildConfig = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
    const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
    const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);
    const prefix      = guildConfig?.prefix ?? config.prefix ?? '+';

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const invoked = _getInvokedName(message, prefix).toLowerCase();

    if (['mpsettings', 'dmsettings'].includes(invoked)) {
      return _handleSettings(client, message, guildId);
    }

    const action = args[0]?.toLowerCase();

    if (['settings', 'setting', 'config', 'configuration'].includes(action)) {
      return _handleSettings(client, message, guildId);
    }

    if (!args.length) {
      return _usage(message, guildId, guildConfig, deleteReply, deleteDelay, prefix);
    }

    return _sendDm(client, message, args, deleteReply, deleteDelay, prefix);
  },
};

async function _handleSettings(client, message, guildId) {
  const guildConfig = db.getGuildConfig(guildId);

  const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
  const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

  const state = _stateFromConfig(guildConfig);

  const panel = await message.channel.send(
    _buildPanelPayload(guildId, state)
  ).catch(() => null);

  if (!panel) {
    return embed.replyError(
      message,
      'Impossible d\'ouvrir le panel MP settings.',
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

    if (busy && id !== 'local:mp:close') {
      return _ephemeral(interaction, guildId, 'Une modification est déjà en cours.');
    }

    if (id === 'local:mp:close') {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      return;
    }

    if (id === 'local:mp:global') {
      busy = true;
      const newVal = state.enabled ? 0 : 1;
      state.enabled = !state.enabled;
      db.setGuildConfig(guildId, 'modDmEnabled', newVal);
      await interaction.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(panel, guildId, state);
    }

    if (id.startsWith('local:mp:toggle:')) {
      busy = true;
      const dbKey = id.slice('local:mp:toggle:'.length);
      const type  = MP_TYPES.find(t => t.key === dbKey);
      if (!type) {
        busy = false;
        await interaction.deferUpdate().catch(() => {});
        return;
      }
      const current = Boolean(state.types[dbKey]);
      const newVal  = current ? 0 : 1;
      state.types[dbKey] = !current;
      db.setGuildConfig(guildId, dbKey, newVal);
      await interaction.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(panel, guildId, state);
    }


    if (id === 'local:mp:tpl:open') {
      state.view    = 'tpl';
      state.tplType = 'global';
      await interaction.deferUpdate().catch(() => {});
      return _refresh(panel, guildId, state);
    }

    if (id === 'local:mp:tpl:back') {
      state.view = 'main';
      await interaction.deferUpdate().catch(() => {});
      return _refresh(panel, guildId, state);
    }

    if (id === 'local:mp:tpl:select') {
      const sel = interaction.values?.[0];
      if (sel && TPL_KEYS[sel]) {
        state.tplType = sel;
      }
      await interaction.deferUpdate().catch(() => {});
      return _refresh(panel, guildId, state);
    }

    if (id === 'local:mp:tpl:vars') {
      return interaction.reply({
        embeds: [embed.build(guildId, `**Variables disponibles**\n${VARIABLES_HELP}`, { timestamp: false })],
        flags : 64,
      }).catch(() => {});
    }

    if (id === 'local:mp:tpl:reset') {
      busy = true;
      const dbKey = TPL_KEYS[state.tplType];
      if (!dbKey) {
        busy = false;
        await interaction.deferUpdate().catch(() => {});
        return;
      }
      db.setGuildConfig(guildId, dbKey, null);
      state.templates[state.tplType] = null;
      await interaction.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(panel, guildId, state);
    }

    if (id === 'local:mp:tpl:mode') {
      busy = true;
      const modeKey = MODE_KEYS[state.tplType];
      if (!modeKey) {
        busy = false;
        await interaction.deferUpdate().catch(() => {});
        return;
      }
      const currentMode = state.tplModes[state.tplType] ?? 1;
      const newMode     = currentMode === 1 ? 0 : 1;
      db.setGuildConfig(guildId, modeKey, newMode);
      state.tplModes[state.tplType] = newMode;
      await interaction.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(panel, guildId, state);
    }

    if (id === 'local:mp:tpl:edit') {
      busy = true;
      const dbKey   = TPL_KEYS[state.tplType];
      const modalId = `local:mp:tpl:modal:${interaction.id}`;
      const current = state.templates[state.tplType] ?? '';

      const input = new TextInputBuilder()
        .setCustomId('tpl')
        .setLabel('Template du message')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(2000)
        .setPlaceholder('Laisser vide pour utiliser le message par defaut.');

      if (current) input.setValue(String(current).slice(0, 2000));

      const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(`Template ${state.tplType}`.slice(0, 45))
        .addComponents(new ActionRowBuilder().addComponents(input));

      const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
      busy = false;

      if (!shown) {
        return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');
      }

      const submit = await interaction.awaitModalSubmit({
        filter : i => i.customId === modalId && i.user.id === interaction.user.id,
        time   : 120_000,
      }).catch(() => null);

      if (!submit) return;

      busy = true;
      const value = submit.fields.getTextInputValue('tpl').trim();

      if (!value) {
        db.setGuildConfig(guildId, dbKey, null);
        state.templates[state.tplType] = null;
      } else {
        db.setGuildConfig(guildId, dbKey, value);
        state.templates[state.tplType] = value;
      }

      await submit.deferUpdate().catch(() => {});
      busy = false;
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
}


function _stateFromConfig(cfg) {
  const types = {};
  for (const t of MP_TYPES) {
    types[t.key] = Number(cfg?.[t.key] ?? 1) === 1;
  }

  const templates = {};
  for (const [k, dbKey] of Object.entries(TPL_KEYS)) {
    templates[k] = cfg?.[dbKey] ?? null;
  }

  const tplModes = {};
  for (const [k, dbKey] of Object.entries(MODE_KEYS)) {
    tplModes[k] = Number(cfg?.[dbKey] ?? 1) === 1 ? 1 : 0;
  }

  return {
    enabled   : Number(cfg?.modDmEnabled ?? 1) === 1,
    types,
    templates,
    tplModes,
    view      : 'main',
    tplType   : 'global',
    baseColor : cfg?.color || '#2f3136',
  };
}


function _buildPanelPayload(guildId, state) {
  if (state.view === 'tpl') {
    if (V2_AVAILABLE) {
      try {
        const payload = _buildTplV2(guildId, state);
        if (payload) return payload;
      } catch {}
    }
    return _buildTplLegacy(guildId, state);
  }

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
    new TextDisplayBuilder().setContent('## Configuration des MPs automatiques'),
  );

  const globalLine = state.enabled ? '`Activé`' : '`Désactivé`';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `> **État global** ${globalLine}\n` +
      `-# Lorsque désactivé, aucun MP n'est envoyé, peu importe les toggles par type.`
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  const lines = MP_TYPES.map(t => {
    const status = state.types[t.key] ? '`Activé`' : '`Désactivé`';
    return `> **${t.label}** ${status}`;
  }).join('\n');

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**Toggles par type**\n${lines}`),
  );

  const buildToggleBtn = (t) => new ButtonBuilder()
    .setCustomId(`local:mp:toggle:${t.key}`)
    .setLabel(t.label)
    .setStyle(state.types[t.key] ? ButtonStyle.Success : ButtonStyle.Danger);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      buildToggleBtn(MP_TYPES[0]),
      buildToggleBtn(MP_TYPES[1]),
      buildToggleBtn(MP_TYPES[2]),
    ),
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      buildToggleBtn(MP_TYPES[3]),
      buildToggleBtn(MP_TYPES[4]),
      buildToggleBtn(MP_TYPES[5]),
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());


  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:mp:global')
        .setLabel(state.enabled ? 'Désactiver tout' : 'Activer tout')
        .setStyle(state.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('local:mp:tpl:open')
        .setEmoji('\uD83D\uDD27')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:mp:close')
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


function _buildTplV2(guildId, state) {
  const accent    = _hexToInt(state.baseColor);
  const container = new ContainerBuilder().setAccentColor(accent);

  const tplType  = state.tplType in TPL_KEYS ? state.tplType : 'global';
  const current  = state.templates?.[tplType];
  const mode     = state.tplModes?.[tplType] ?? 1;
  const option   = TPL_OPTIONS.find(o => o.value === tplType) ?? TPL_OPTIONS[0];

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Messages automatiques en MP'),
  );

  const preview = current
    ? '```\n' + String(current).slice(0, 500).replace(/```/g, '\u200b``\u200b`\u200b') + (current.length > 500 ? '\n...' : '') + '\n```'
    : '`Aucun - message par defaut`';

  const modeLabel = mode === 1 ? '`Embed`' : '`Texte`';

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `> **Type** \`${option.label}\`\n` +
      `> **Mode** ${modeLabel}\n` +
      `> **Template actuel**\n${preview}\n` +
      `-# Vide ou Reset = comportement par defaut. Utilisez Variables pour la liste.`
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  const select = new StringSelectMenuBuilder()
    .setCustomId('local:mp:tpl:select')
    .setPlaceholder('Choisir un type a editer')
    .addOptions(
      TPL_OPTIONS.map(o =>
        new StringSelectMenuOptionBuilder()
          .setLabel(o.label)
          .setValue(o.value)
          .setEmoji(o.emoji)
          .setDefault(o.value === tplType),
      ),
    );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(select),
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:mp:tpl:edit')
        .setLabel('Modifier')
        .setEmoji('\u270F\uFE0F')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('local:mp:tpl:mode')
        .setLabel(mode === 1 ? 'Embed' : 'Texte')
        .setEmoji(mode === 1 ? '\uD83D\uDCE6' : '\uD83D\uDCC4')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:mp:tpl:reset')
        .setLabel('Reset')
        .setEmoji('\uD83D\uDDD1\uFE0F')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!current),
      new ButtonBuilder()
        .setCustomId('local:mp:tpl:vars')
        .setLabel('Variables')
        .setEmoji('\u2754')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:mp:tpl:back')
        .setLabel('Retour')
        .setEmoji('\u2B05\uFE0F')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return {
    flags           : COMPONENTS_V2_FLAG,
    components      : [container],
    allowedMentions : { parse: [] },
  };
}

function _buildTplLegacy(guildId, state) {
  const tplType = state.tplType in TPL_KEYS ? state.tplType : 'global';
  const current = state.templates?.[tplType];
  const mode    = state.tplModes?.[tplType] ?? 1;
  const option  = TPL_OPTIONS.find(o => o.value === tplType) ?? TPL_OPTIONS[0];

  const preview = current
    ? '```\n' + String(current).slice(0, 500) + (current.length > 500 ? '\n...' : '') + '\n```'
    : '`Aucun - message par defaut`';

  const desc =
    `**Type** : \`${option.label}\`\n` +
    `**Mode** : ${mode === 1 ? '`Embed`' : '`Texte`'}\n\n` +
    `**Template actuel**\n${preview}`;

  const select = new StringSelectMenuBuilder()
    .setCustomId('local:mp:tpl:select')
    .setPlaceholder('Choisir un type a editer')
    .addOptions(
      TPL_OPTIONS.map(o =>
        new StringSelectMenuOptionBuilder()
          .setLabel(o.label)
          .setValue(o.value)
          .setEmoji(o.emoji)
          .setDefault(o.value === tplType),
      ),
    );

  const rows = [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:mp:tpl:edit')
        .setLabel('Modifier')
        .setEmoji('\u270F\uFE0F')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('local:mp:tpl:mode')
        .setLabel(mode === 1 ? 'Embed' : 'Texte')
        .setEmoji(mode === 1 ? '\uD83D\uDCE6' : '\uD83D\uDCC4')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:mp:tpl:reset')
        .setLabel('Reset')
        .setEmoji('\uD83D\uDDD1\uFE0F')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!current),
      new ButtonBuilder()
        .setCustomId('local:mp:tpl:vars')
        .setLabel('Variables')
        .setEmoji('\u2754')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:mp:tpl:back')
        .setLabel('Retour')
        .setEmoji('\u2B05\uFE0F')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return {
    embeds          : [new EmbedBuilder().setTitle('Messages automatiques en MP').setColor(state.baseColor).setDescription(desc)],
    components      : rows,
    allowedMentions : { parse: [] },
  };
}

function _buildReadOnlyV2(guildId, state) {
  const accent    = _hexToInt(state.baseColor);
  const container = new ContainerBuilder().setAccentColor(accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Configuration des MPs automatiques'),
  );

  const globalLine = state.enabled ? '`Activé`' : '`Désactivé`';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`> **État global** ${globalLine}`),
  );

  const lines = MP_TYPES.map(t => {
    const status = state.types[t.key] ? '`Activé`' : '`Désactivé`';
    return `> **${t.label}** ${status}`;
  }).join('\n');

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**Toggles par type**\n${lines}`),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('-# Panel expire'),
  );

  return {
    flags           : COMPONENTS_V2_FLAG,
    components      : [container],
    allowedMentions : { parse: [] },
  };
}

function _buildLegacy(guildId, state) {
  const desc =
    `**État global** : ${state.enabled ? 'Activé' : 'Désactivé'}\n\n` +
    `**Toggles par type**\n` +
    MP_TYPES.map(t => `**${t.label}** : ${state.types[t.key] ? 'Activé' : 'Désactivé'}`).join('\n');

  const buildToggleBtn = (t) => new ButtonBuilder()
    .setCustomId(`local:mp:toggle:${t.key}`)
    .setLabel(t.label)
    .setStyle(state.types[t.key] ? ButtonStyle.Success : ButtonStyle.Danger);

  const rows = [
    new ActionRowBuilder().addComponents(
      buildToggleBtn(MP_TYPES[0]),
      buildToggleBtn(MP_TYPES[1]),
      buildToggleBtn(MP_TYPES[2]),
    ),
    new ActionRowBuilder().addComponents(
      buildToggleBtn(MP_TYPES[3]),
      buildToggleBtn(MP_TYPES[4]),
      buildToggleBtn(MP_TYPES[5]),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:mp:global')
        .setLabel(state.enabled ? 'Désactiver tout' : 'Activer tout')
        .setStyle(state.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('local:mp:tpl:open')
        .setEmoji('\uD83D\uDD27')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:mp:close')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return {
    embeds          : [new EmbedBuilder().setTitle('Configuration des MPs automatiques').setColor(state.baseColor).setDescription(desc)],
    components      : rows,
    allowedMentions : { parse: [] },
  };
}

async function _refresh(panel, guildId, state) {
  return panel.edit(_buildPanelPayload(guildId, state)).catch(() => {});
}

async function _ephemeral(interaction, guildId, content) {
  return interaction.reply({
    embeds: [embed.build(guildId, content, { color: '#ED4245', timestamp: false })],
    flags: 64,
  }).catch(() => {});
}

async function _sendDm(client, message, args, deleteReply, deleteDelay, prefix) {
  const targetQuery = args[0];
  const content = args.slice(1).join(' ').trim();

  if (!targetQuery || !content) {
    return _sendError(
      message,
      `Utilisation : \`${prefix}mp <membre/id> <message>\``,
      deleteReply,
      deleteDelay
    );
  }

  if (content.length > MAX_DM_LENGTH) {
    return _sendError(
      message,
      `Le message ne peut pas dépasser ${MAX_DM_LENGTH} caractères.`,
      deleteReply,
      deleteDelay
    );
  }

  const target = await _resolveUser(client, message.guild, targetQuery);

  if (!target) {
    return _sendError(
      message,
      'Membre ou utilisateur introuvable.',
      deleteReply,
      deleteDelay
    );
  }

  if (target.bot) {
    return _sendError(
      message,
      'Vous ne pouvez pas envoyer un MP à un bot.',
      deleteReply,
      deleteDelay
    );
  }

  if (target.id === message.author.id) {
    return _sendError(
      message,
      'Vous ne pouvez pas vous envoyer un MP via le bot.',
      deleteReply,
      deleteDelay
    );
  }

  const sent = await target.send({
    content,
    allowedMentions: { parse: [] },
  }).then(() => true).catch((err) => {
    console.error('[mp] Impossible d\'envoyer le MP :', err?.message ?? err);
    return false;
  });

  if (!sent) {
    return _sendError(
      message,
      "Impossible d'envoyer le MP. L'utilisateur a peut-être ses messages privés fermés.",
      deleteReply,
      deleteDelay
    );
  }

  return _sendReply(
    message,
    `MP envoyé à \`${target.tag || target.id}\`.`,
    deleteReply,
    deleteDelay
  );
}

async function _resolveUser(client, guild, query) {
  const raw = String(query || '').trim();

  if (!raw) return null;

  const mention = raw.match(/^<@!?(\d{17,20})>$/);
  const id = mention?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);

  if (id) {
    const member = guild.members.cache.get(id)
      ?? await guild.members.fetch(id).catch(() => null);

    if (member?.user) return member.user;

    return client.users.cache.get(id)
      ?? await client.users.fetch(id).catch(() => null);
  }

  const normalized = _normalize(raw);

  const exactMember = guild.members.cache.find(member =>
    _normalize(member.user.username) === normalized ||
    _normalize(member.displayName) === normalized ||
    _normalize(member.user.tag) === normalized
  );

  if (exactMember?.user) return exactMember.user;

  if (normalized.length < 2) return null;

  const partialMember = guild.members.cache.find(member =>
    _normalize(member.user.username).includes(normalized) ||
    _normalize(member.displayName).includes(normalized)
  );

  return partialMember?.user ?? null;
}

function _parseToggle(value) {
  const raw = String(value || '').toLowerCase();

  if (['on', 'enable', 'enabled', 'true', 'yes', 'oui', '1'].includes(raw)) return true;
  if (['off', 'disable', 'disabled', 'false', 'no', 'non', '0'].includes(raw)) return false;

  return null;
}

function _normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function _getInvokedName(message, prefix) {
  const content = String(message.content || '');

  if (content.startsWith(prefix)) {
    return content
      .slice(prefix.length)
      .trim()
      .split(/\s+/)[0] || module.exports.help.name;
  }

  return module.exports.help.name;
}

async function _usage(message, guildId, guildConfig, deleteReply, deleteDelay, prefix) {
  const current = Number(guildConfig?.modDmEnabled ?? 1) === 1 ? 'Activé' : 'Désactivé';

  return _sendError(
    message,
    `Utilisation :\n` +
    `\`${prefix}mp <membre/id> <message>\`\n` +
    `\`${prefix}mp settings\`\n` +
    `\`${prefix}mp settings <on/off>\`\n\n` +
    `MP automatiques du bot : \`${current}\`.`,
    deleteReply,
    deleteDelay
  );
}

async function _sendReply(message, content, deleteReply, deleteDelay) {
  const sent = await embed.reply(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _sendError(message, content, deleteReply, deleteDelay) {
  const sent = await embed.replyError(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
