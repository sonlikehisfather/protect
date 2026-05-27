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
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');
const config = require('../../config.json');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? null;
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder    === 'function' &&
  typeof TextDisplayBuilder  === 'function' &&
  typeof SeparatorBuilder    === 'function'
);

function _hexToInt(hex) {
  try {
    const m = String(hex || '').replace(/^#/, '').match(/^[0-9a-fA-F]{6}$/);
    return m ? parseInt(m[0], 16) : 0x2f3136;
  } catch { return 0x2f3136; }
}

const PANEL_IDLE_MS = 120_000;
const PANEL_TIME_MS = 300_000;

const DEFAULT_VC_CONFIG = {
  title      : '{guild} - Statistiques',
  description:
    'Membre : **{members}**\n' +
    'En ligne : **{online}**\n' +
    'En vocal : **{voice}**\n' +
    'En stream : **{stream}**\n' +
    'Boost : **{boost}**',
  color     : null,
  thumbnail : '{icon}',
  image     : null,
  footer    : null,
};

module.exports = {
  help: {
    name        : 'vc',
    description : 'Affiche les statistiques du serveur.',
    use         : 'vc [config]',
    usage       : 'vc [config]',
    aliases     : ['statvc', 'statsvc'],
    category    : 'owner',
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

    const guildConfig = db.getGuildConfig(guildId) || {};

    const deleteCmd   = Boolean(guildConfig?.autoDeleteStatsCmds);
    const deleteReply = Boolean(guildConfig?.autoDeleteStatsReplies);
    const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);
    const prefix      = guildConfig?.prefix ?? config.prefix ?? '+';

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const sub = args[0]?.toLowerCase();

    if (sub === 'config') {
      if (!perms.isBuyer(message.author.id) && !perms.isGlobalOwner(message.author.id)) {
        return _sendError(
          message,
          "Vous n'avez pas la permission de configurer cet embed.",
          deleteReply,
          deleteDelay
        );
      }

      return _openConfigPanel(client, message, guildConfig, prefix, deleteReply, deleteDelay);
    }

    const state = _stateFromConfig(guildConfig);

    return message.channel.send({
      embeds          : [_buildStatsEmbed(client, guild, guildId, state)],
      allowedMentions : { parse: [] },
    }).catch(() => null);
  },
};

async function _openConfigPanel(client, message, guildConfig, prefix, deleteReply, deleteDelay) {
  const guild   = message.guild;
  const guildId = guild.id;
  const state   = _stateFromConfig(guildConfig);

  const panel = await message.channel.send(
    _buildPanelPayload(client, guild, guildId, state)
  ).catch(() => null);

  if (!panel) {
    return _sendError(
      message,
      'Impossible d\'ouvrir le panel vc.',
      deleteReply,
      deleteDelay
    );
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

    if (busy && id !== 'vc:close') {
      return _ephemeral(interaction, guildId, 'Une modification est déjà en cours.');
    }

    if (id === 'vc:close') {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      return;
    }

    if (id === 'vc:title') {
      busy = true;
      const modalId = `vc:title:${interaction.id}`;
      const shown = await interaction.showModal(
        _buildModal(modalId, 'Titre', [
          _input('title', 'Titre de l\'embed', TextInputStyle.Short, {
            value: state.title || '', required: false,
            maxLength: 256, placeholder: '{guild} - Statistiques',
          }),
        ])
      ).then(() => true).catch(() => false);
      busy = false;
      if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

      const submit = await _awaitOwnModal(interaction, modalId);
      if (!submit) return _refresh(panel, client, guild, guildId, state);
      busy = true;

      const title = submit.fields.getTextInputValue('title').trim();
      state.title = _cleanText(title, 256);
      _saveState(guildId, state);

      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(panel, client, guild, guildId, state);
    }

    if (id === 'vc:desc') {
      busy = true;
      const modalId = `vc:desc:${interaction.id}`;
      const shown = await interaction.showModal(
        _buildModal(modalId, 'Description', [
          _input('description', 'Description de l\'embed', TextInputStyle.Paragraph, {
            value: state.description || '', required: true,
            maxLength: 4000, placeholder: 'Membre : **{members}**\\nEn ligne : **{online}**',
          }),
        ])
      ).then(() => true).catch(() => false);
      busy = false;
      if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

      const submit = await _awaitOwnModal(interaction, modalId);
      if (!submit) return _refresh(panel, client, guild, guildId, state);
      busy = true;

      const description = submit.fields.getTextInputValue('description').trim();
      if (!description) {
        await _modalError(submit, guildId, 'La description ne peut pas etre vide.');
        busy = false;
        return _refresh(panel, client, guild, guildId, state);
      }

      state.description = _cleanText(description, 4000).replace(/\\n/g, '\n');
      _saveState(guildId, state);

      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(panel, client, guild, guildId, state);
    }

    if (id === 'vc:color') {
      busy = true;
      const modalId = `vc:color:${interaction.id}`;
      const shown = await interaction.showModal(
        _buildModal(modalId, 'Couleur de l\'embed', [
          _input('color', 'Couleur hex', TextInputStyle.Short, {
            value: state.color || '', required: false,
            maxLength: 20, placeholder: '#2f3136 ou reset',
          }),
        ])
      ).then(() => true).catch(() => false);
      busy = false;
      if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

      const submit = await _awaitOwnModal(interaction, modalId);
      if (!submit) return _refresh(panel, client, guild, guildId, state);
      busy = true;

      const raw = submit.fields.getTextInputValue('color').trim();
      if (!raw || ['reset', 'default', 'none', 'off'].includes(raw.toLowerCase())) {
        state.color = null;
      } else {
        const color = _normalizeHexColor(raw);
        if (!color) {
          await _modalError(submit, guildId, 'Couleur invalide. Exemple : `#5865F2`.');
          busy = false;
          return _refresh(panel, client, guild, guildId, state);
        }
        state.color = color;
      }

      _saveState(guildId, state);
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(panel, client, guild, guildId, state);
    }

    if (id === 'vc:thumb') {
      busy = true;
      const modalId = `vc:thumb:${interaction.id}`;
      const shown = await interaction.showModal(
        _buildModal(modalId, 'Thumbnail', [
          _input('thumbnail', 'guild, bot, none ou URL', TextInputStyle.Short, {
            value: state.thumbnail || '', required: false,
            maxLength: 512, placeholder: 'guild',
          }),
        ])
      ).then(() => true).catch(() => false);
      busy = false;
      if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

      const submit = await _awaitOwnModal(interaction, modalId);
      if (!submit) return _refresh(panel, client, guild, guildId, state);
      busy = true;

      const raw = submit.fields.getTextInputValue('thumbnail').trim();
      const value = _normalizeMediaValue(raw);
      if (value === false) {
        await _modalError(submit, guildId, 'Thumbnail invalide. Utilisez `guild`, `bot`, `none` ou une URL.');
        busy = false;
        return _refresh(panel, client, guild, guildId, state);
      }

      state.thumbnail = value;
      _saveState(guildId, state);
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(panel, client, guild, guildId, state);
    }

    if (id === 'vc:image') {
      busy = true;
      const modalId = `vc:image:${interaction.id}`;
      const shown = await interaction.showModal(
        _buildModal(modalId, 'Image', [
          _input('image', 'none ou URL', TextInputStyle.Short, {
            value: state.image || '', required: false,
            maxLength: 512, placeholder: 'none',
          }),
        ])
      ).then(() => true).catch(() => false);
      busy = false;
      if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

      const submit = await _awaitOwnModal(interaction, modalId);
      if (!submit) return _refresh(panel, client, guild, guildId, state);
      busy = true;

      const raw = submit.fields.getTextInputValue('image').trim();
      const value = _normalizeMediaValue(raw);
      if (value === false) {
        await _modalError(submit, guildId, 'Image invalide. Utilisez `none` ou une URL.');
        busy = false;
        return _refresh(panel, client, guild, guildId, state);
      }

      state.image = value;
      _saveState(guildId, state);
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(panel, client, guild, guildId, state);
    }

    if (id === 'vc:footer') {
      busy = true;
      const modalId = `vc:footer:${interaction.id}`;
      const shown = await interaction.showModal(
        _buildModal(modalId, 'Footer', [
          _input('footer', 'Texte du footer', TextInputStyle.Short, {
            value: state.footer || '', required: false,
            maxLength: 2048, placeholder: 'reset pour retirer',
          }),
        ])
      ).then(() => true).catch(() => false);
      busy = false;
      if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

      const submit = await _awaitOwnModal(interaction, modalId);
      if (!submit) return _refresh(panel, client, guild, guildId, state);
      busy = true;

      const raw = submit.fields.getTextInputValue('footer').trim();
      if (!raw || ['reset', 'none', 'off'].includes(raw.toLowerCase())) {
        state.footer = null;
      } else {
        state.footer = _cleanText(raw, 2048);
      }

      _saveState(guildId, state);
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(panel, client, guild, guildId, state);
    }

    if (id === 'vc:preview') {
      return interaction.reply({
        embeds          : [_buildStatsEmbed(client, guild, guildId, state)],
        flags           : 64,
        allowedMentions : { parse: [] },
      }).catch(() => {});
    }

    if (id === 'vc:reset') {
      Object.assign(state, { ...DEFAULT_VC_CONFIG });
      _saveState(guildId, state);
      await interaction.deferUpdate().catch(() => {});
      return _refresh(panel, client, guild, guildId, state);
    }

    await interaction.deferUpdate().catch(() => {});
  });

  collector.on('end', async (_, reason) => {
    embed.clearPrivateInteraction(panel);
    if (reason === 'closed') return;

    if (V2_AVAILABLE) {
      try {
        const ro = _buildReadOnlyV2(state);
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


function _buildPanelPayload(client, guild, guildId, state) {
  if (V2_AVAILABLE) {
    try {
      const payload = _buildV2(client, guild, guildId, state);
      if (payload) return payload;
    } catch {}
  }
  return _buildLegacy(client, guild, guildId, state);
}

function _buildV2(client, guild, guildId, state) {
  const accent    = _hexToInt(state.color || embed.getGuildColor(guildId) || '#2f3136');
  const container = new ContainerBuilder().setAccentColor(accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Configuration VC'),
  );

  const titleLine = state.title ? `\`${_truncate(state.title, 80)}\`` : '`Aucun`';
  const descLine  = `\`${_truncate(state.description, 120)}\``;
  const colorLine = state.color ? `\`${state.color}\`` : '`Couleur serveur`';
  const thumbLine = `\`${state.thumbnail || 'none'}\``;
  const imgLine   = `\`${state.image || 'none'}\``;
  const footLine  = state.footer ? `\`${_truncate(state.footer, 80)}\`` : '`Aucun`';

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `> **Titre** ${titleLine}\n` +
      `> **Description** ${descLine}\n` +
      `> **Couleur** ${colorLine}\n` +
      `> **Thumbnail** ${thumbLine}\n` +
      `> **Image** ${imgLine}\n` +
      `> **Footer** ${footLine}`
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vc:title').setLabel('Titre').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc:desc').setLabel('Description').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc:color').setLabel('Couleur').setStyle(ButtonStyle.Secondary),
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vc:thumb').setLabel('Thumbnail').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc:image').setLabel('Image').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc:footer').setLabel('Footer').setStyle(ButtonStyle.Secondary),
    ),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '-# Variables : `{guild}` `{members}` `{online}` `{voice}` `{stream}` `{boost}`'
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vc:preview').setLabel('Preview').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('vc:reset').setLabel('Reset').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('vc:close').setLabel('\u2716').setStyle(ButtonStyle.Secondary),
    ),
  );


  return {
    flags           : COMPONENTS_V2_FLAG,
    components      : [container],
    allowedMentions : { parse: [] },
  };
}

function _buildReadOnlyV2(state) {
  const accent    = _hexToInt(state.color || '#2f3136');
  const container = new ContainerBuilder().setAccentColor(accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Configuration VC'),
  );

  const titleLine = state.title ? `\`${_truncate(state.title, 80)}\`` : '`Aucun`';
  const descLine  = `\`${_truncate(state.description, 120)}\``;
  const colorLine = state.color ? `\`${state.color}\`` : '`Couleur serveur`';
  const thumbLine = `\`${state.thumbnail || 'none'}\``;
  const imgLine   = `\`${state.image || 'none'}\``;
  const footLine  = state.footer ? `\`${_truncate(state.footer, 80)}\`` : '`Aucun`';

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `> **Titre** ${titleLine}\n` +
      `> **Description** ${descLine}\n` +
      `> **Couleur** ${colorLine}\n` +
      `> **Thumbnail** ${thumbLine}\n` +
      `> **Image** ${imgLine}\n` +
      `> **Footer** ${footLine}`
    ),
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

function _buildLegacy(client, guild, guildId, state) {
  const stats = _getStats(client, guild);

  const desc =
    `**Titre** : ${state.title ? `\`${_truncate(state.title, 120)}\`` : '`Aucun`'}\n` +
    `**Description** : \`${_truncate(state.description, 220)}\`\n` +
    `**Couleur** : ${state.color ? `\`${state.color}\`` : '`Couleur serveur`'}\n` +
    `**Thumbnail** : \`${state.thumbnail || 'none'}\`\n` +
    `**Image** : \`${state.image || 'none'}\`\n` +
    `**Footer** : ${state.footer ? `\`${_truncate(state.footer, 120)}\`` : '`Aucun`'}\n\n` +
    `Apercu : \`{guild}\`=${_truncate(stats.guild, 30)} \`{members}\`=${stats.members} ` +
    `\`{online}\`=${stats.online} \`{voice}\`=${stats.voice} \`{boost}\`=${stats.boost}`;

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vc:title').setLabel('Titre').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc:desc').setLabel('Description').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc:color').setLabel('Couleur').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vc:thumb').setLabel('Thumbnail').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc:image').setLabel('Image').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc:footer').setLabel('Footer').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vc:preview').setLabel('Preview').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('vc:reset').setLabel('Reset').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('vc:close').setLabel('\u2716').setStyle(ButtonStyle.Secondary),
    ),
  ];

  return {
    embeds          : [new EmbedBuilder().setTitle('Configuration VC').setColor(state.color || embed.getGuildColor(guildId) || '#2f3136').setDescription(desc)],
    components      : rows,
    allowedMentions : { parse: [] },
  };
}

function _buildStatsEmbed(client, guild, guildId, state) {
  const stats = _getStats(client, guild);

  const title = _replaceVars(state.title, stats);
  const description = _replaceVars(state.description, stats);
  const footer = state.footer ? _replaceVars(state.footer, stats) : null;

  const e = new EmbedBuilder()
    .setColor(state.color || embed.getGuildColor(guildId) || '#2f3136')
    .setDescription(description.slice(0, 4096));

  if (title) {
    e.setTitle(title.slice(0, 256));
  }

  const thumbnail = _resolveMedia(state.thumbnail, stats);
  const image = _resolveMedia(state.image, stats);

  if (thumbnail) {
    e.setThumbnail(thumbnail);
  }

  if (image) {
    e.setImage(image);
  }

  if (footer) {
    e.setFooter({ text: footer.slice(0, 2048) });
  }

  return e;
}


function _getStats(client, guild) {
  const icon = guild.iconURL({ extension: 'png', size: 512 }) ||
    client.user.displayAvatarURL({ extension: 'png', size: 512 });

  const botIcon = client.user.displayAvatarURL({ extension: 'png', size: 512 });

  const totalMembers = Number(guild.memberCount || 0);

  const online = guild.presences?.cache
    ? guild.presences.cache.filter(presence => presence.status !== 'offline').size
    : 0;

  let voice = 0, stream = 0, muted = 0, deaf = 0, camera = 0;

  try {
    const states = guild.voiceStates?.cache;
    if (states) {
      for (const state of states.values()) {
        if (!state.channelId)    continue;
        if (!state.member)       continue;
        if (state.member.user.bot) continue;

        voice++;
        if (state.streaming)                     stream++;
        if (state.selfMute || state.serverMute)  muted++;
        if (state.selfDeaf || state.serverDeaf)  deaf++;
        if (state.selfVideo)                     camera++;
      }
    }
  } catch {}

  const boosts = Number(guild.premiumSubscriptionCount || 0);
  const now = Math.floor(Date.now() / 1000);

  return {
    guild   : guild.name,
    members : _formatNumber(totalMembers),
    online  : _formatNumber(online),
    voice   : _formatNumber(voice),
    stream  : _formatNumber(stream),
    muted   : _formatNumber(muted),
    deaf    : _formatNumber(deaf),
    camera  : _formatNumber(camera),
    boost   : _formatNumber(boosts),
    boosts  : _formatNumber(boosts),
    owner   : `<@${guild.ownerId}>`,
    channels: _formatNumber(guild.channels.cache.size),
    roles   : _formatNumber(guild.roles.cache.size),
    icon,
    botIcon,
    date    : `<t:${now}:d>`,
    time    : `<t:${now}:t>`,
  };
}

function _stateFromConfig(guildConfig) {
  const parsed = _safeJsonParse(guildConfig?.vcEmbedJson);

  return {
    ...DEFAULT_VC_CONFIG,
    ...(parsed && typeof parsed === 'object' ? parsed : {}),
  };
}

function _saveState(guildId, state) {
  db.setGuildConfig(guildId, 'vcEmbedJson', JSON.stringify({
    title      : state.title ?? DEFAULT_VC_CONFIG.title,
    description: state.description || DEFAULT_VC_CONFIG.description,
    color      : state.color || null,
    thumbnail  : state.thumbnail ?? DEFAULT_VC_CONFIG.thumbnail,
    image      : state.image || null,
    footer     : state.footer || null,
  }));
}

function _replaceVars(text, stats) {
  return String(text || '')
    .replace(/{guild}/gi, stats.guild)
    .replace(/{members}/gi, stats.members)
    .replace(/{online}/gi, stats.online)
    .replace(/{voice}/gi, stats.voice)
    .replace(/{vocal}/gi, stats.voice)
    .replace(/{stream}/gi, stats.stream)
    .replace(/{muted}/gi, stats.muted)
    .replace(/{deaf}/gi, stats.deaf)
    .replace(/{camera}/gi, stats.camera)
    .replace(/{VocalMembersCount}/gi,     stats.voice)
    .replace(/{StreamingMembersCount}/gi, stats.stream)
    .replace(/{MutedMembersCount}/gi,     stats.muted)
    .replace(/{DeafMembersCount}/gi,      stats.deaf)
    .replace(/{CameraMembersCount}/gi,    stats.camera)
    .replace(/{boost}/gi, stats.boost)
    .replace(/{boosts}/gi, stats.boosts)
    .replace(/{owner}/gi, stats.owner)
    .replace(/{channels}/gi, stats.channels)
    .replace(/{roles}/gi, stats.roles)
    .replace(/{date}/gi, stats.date)
    .replace(/{time}/gi, stats.time);
}

function _resolveMedia(value, stats) {
  const raw = String(value || '').trim();

  if (!raw || ['none', 'off', 'null'].includes(raw.toLowerCase())) {
    return null;
  }

  if (['guild', 'server', 'icon', '{icon}'].includes(raw.toLowerCase())) {
    return stats.icon;
  }

  if (['bot', 'boticon', '{bot}', '{boticon}'].includes(raw.toLowerCase())) {
    return stats.botIcon;
  }

  if (_isValidUrl(raw)) {
    return raw;
  }

  return null;
}

function _normalizeMediaValue(value) {
  const raw = String(value || '').trim();

  if (!raw || ['none', 'off', 'reset', 'null'].includes(raw.toLowerCase())) {
    return null;
  }

  if (['guild', 'server', 'icon', '{icon}'].includes(raw.toLowerCase())) {
    return '{icon}';
  }

  if (['bot', 'boticon', '{bot}', '{boticon}'].includes(raw.toLowerCase())) {
    return '{boticon}';
  }

  if (_isValidUrl(raw)) {
    return raw;
  }

  return false;
}

function _normalizeHexColor(input) {
  const value = String(input || '').trim();

  if (/^#?[0-9a-fA-F]{6}$/.test(value)) {
    return value.startsWith('#') ? value : `#${value}`;
  }

  return null;
}

function _isValidUrl(input) {
  try {
    const url = new URL(String(input));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function _safeJsonParse(raw) {
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function _cleanText(value, max) {
  return String(value || '')
    .replace(/@everyone/gi, '@ everyone')
    .replace(/@here/gi, '@ here')
    .slice(0, max);
}

function _formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function _buildModal(customId, title, inputs) {
  const modal = new ModalBuilder()
    .setCustomId(customId.slice(0, 100))
    .setTitle(title.slice(0, 45));

  modal.addComponents(inputs.map(input =>
    new ActionRowBuilder().addComponents(input)
  ));

  return modal;
}

function _input(customId, label, style, options = {}) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 45))
    .setStyle(style)
    .setRequired(Boolean(options.required));

  if (options.value) {
    input.setValue(String(options.value).slice(0, options.maxLength || 4000));
  }

  if (options.placeholder) {
    input.setPlaceholder(options.placeholder.slice(0, 100));
  }

  if (options.maxLength) {
    input.setMaxLength(options.maxLength);
  }

  return input;
}

async function _awaitOwnModal(interaction, customId) {
  try {
    return await interaction.awaitModalSubmit({
      filter: i =>
        i.customId === customId &&
        i.user.id === interaction.user.id,
      time: 120_000,
    });
  } catch {
    return null;
  }
}

async function _refresh(panel, client, guild, guildId, state) {
  return panel.edit(_buildPanelPayload(client, guild, guildId, state)).catch(() => {});
}

async function _ephemeral(interaction, guildId, content) {
  return interaction.reply({
    embeds: [
      embed.build(guildId, content, {
        color    : '#ED4245',
        timestamp: false,
      }),
    ],
    flags: 64,
  }).catch(() => {});
}

async function _modalError(submit, guildId, content) {
  return submit.reply({
    embeds: [
      embed.build(guildId, content, {
        color    : '#ED4245',
        timestamp: false,
      }),
    ],
    flags: 64,
  }).catch(() => {});
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

function _truncate(value, max) {
  const text = String(value || '');
  const cut  = text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
  return embed.breakLongTokens(cut);
}
