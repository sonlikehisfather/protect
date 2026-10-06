'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  ModalBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const {
  COMPONENTS_V2_FLAG,
  canUseFivem,
  getDeletePolicy,
  getModuleConfig,
  setTextConfig,
  setActivePresence,
  wrapByMode,
  reply,
  replyError,
} = require('./_shared');

const PANEL_IDLE_MS = 180_000;
const PANEL_TIME_MS = 600_000;

module.exports = {
  help: {
    name        : 'presence',
    description : 'Ouvrir le createur de presence FiveM (OP / mission).',
    usage       : 'presence',
    aliases     : ['fpresence'],
    category    : 'fivem',
  },

  async run(client, message) {
    const guild = message.guild;
    const guildId = guild.id;

    if (!canUseFivem(message, module.exports.help.name)) {
      return replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.", module.exports.help.name);
    }

    const del = getDeletePolicy(guildId);
    if (del.deleteCmd) await message.delete().catch(() => {});

    const state = {
      title       : 'Operation FiveM',
      description : 'Nouvelle presence en cours.',
      type        : 'OP',
    };

    const panel = await message.channel.send(_panelPayload(guildId, state, false)).catch(() => null);
    if (!panel) return replyError(message, 'Impossible d\'ouvrir le menu presence.', module.exports.help.name);

    let busy = false;

    const collector = panel.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id && i.message.id === panel.id,
      idle   : PANEL_IDLE_MS,
      time   : PANEL_TIME_MS,
    });

    collector.on('collect', async interaction => {
      const id = interaction.customId;

      if (busy && id !== 'fp:close') {
        await interaction.deferUpdate().catch(() => {});
        return;
      }

      if (id === 'fp:close') {
        collector.stop('closed');
        await interaction.deferUpdate().catch(() => {});
        await panel.delete().catch(() => {});
        return;
      }

      if (id === 'fp:type') {
        state.type = state.type === 'OP' ? 'Mission' : 'OP';
        await interaction.deferUpdate().catch(() => {});
        await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
        return;
      }

      if (id === 'fp:title') {
        busy = true;
        const ok = await _handleModal(interaction, 'Titre presence', 'title', state.title, 100, v => {
          state.title = v || state.title;
        });
        busy = false;
        if (!ok) return;
        await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
        return;
      }

      if (id === 'fp:desc') {
        busy = true;
        const ok = await _handleModal(interaction, 'Description presence', 'description', state.description, 1800, v => {
          if (v) state.description = v.replace(/\\n/g, '\n');
        }, TextInputStyle.Paragraph);
        busy = false;
        if (!ok) return;
        await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
        return;
      }

      if (id === 'fp:publish') {
        busy = true;

        const liveCfg = getModuleConfig(guildId);
        const mentionRoleIds = liveCfg.presenceMentionRoles || [];

        const targetInfo = await _resolvePublishTarget(guild, liveCfg, state.type);
        if (!targetInfo.ok) {
          busy = false;
          await interaction.reply({ content: targetInfo.error, flags: 64 }).catch(() => {});
          return;
        }

        const targetChannel = targetInfo.channel;

        const mentionText = mentionRoleIds.length
          ? mentionRoleIds.map(roleId => `<@&${roleId}>`).join(' ')
          : '';

        const payload = _publishPayload(guildId, state, message.author.id);
        payload.allowedMentions = { roles: mentionRoleIds, users: [], parse: [] };
        if (mentionText) payload.content = mentionText;

        const sent = await targetChannel.send(payload).catch(() => null);
        if (!sent) {
          busy = false;
          await interaction.reply({ content: 'Impossible de publier la presence.', flags: 64 }).catch(() => {});
          return;
        }

        await sent.react('✅').catch(() => {});
        await sent.react('❌').catch(() => {});
        await sent.react('⏳').catch(() => {});

        setActivePresence(guildId, {
          channelId      : sent.channel.id,
          messageId      : sent.id,
          title          : state.title,
          type           : state.type,
          slot           : targetInfo.slot,
          mentionRoleIds : [...mentionRoleIds],
          createdBy      : message.author.id,
          createdAt      : Date.now(),
        });

        if (targetInfo.slot === 'mission1') {
          setTextConfig(guildId, 'fivemMission1MessageId', sent.id);
        }

        collector.stop('published');
        await interaction.deferUpdate().catch(() => {});
        await panel.edit(_panelPayload(guildId, state, true)).catch(() => {});
        await reply(message, `Presence creee dans <#${sent.channel.id}>.`, { timestamp: false }, module.exports.help.name);
        busy = false;
        return;
      }

      await interaction.deferUpdate().catch(() => {});
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'closed' || reason === 'published') return;
      await panel.edit(_panelPayload(guildId, state, true)).catch(() => {});
    });
  },
};

function _panelPayload(guildId, state, disabled) {
  const cfg = getModuleConfig(guildId);
  const targetHint = state.type === 'Mission'
    ? [
      `Mission 1 ・ ${cfg.presenceMission1ChannelId ? `<#${cfg.presenceMission1ChannelId}>` : 'Non configure'}`,
      `Mission 2 ・ ${cfg.presenceMission2ChannelId ? `<#${cfg.presenceMission2ChannelId}>` : 'Non configure'}`,
    ].join(' | ')
    : (cfg.presenceOpChannelId ? `<#${cfg.presenceOpChannelId}>` : 'Non configure');

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      '## Createur de presence FiveM',
      '',
      `Type ・ ${state.type}`,
      `Titre ・ ${state.title}`,
      `Destination ・ ${targetHint}`,
      `Roles ping ・ ${cfg.presenceMentionRoles.length ? cfg.presenceMentionRoles.map(id => `<@&${id}>`).join(', ') : 'Aucun'}`,
      '',
      state.description,
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fp:type').setLabel('Type').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('fp:title').setLabel('Titre').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('fp:desc').setLabel('Description').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fp:publish').setLabel('Valider').setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder().setCustomId('fp:close').setLabel('Fermer').setStyle(ButtonStyle.Danger).setDisabled(disabled),
      )
    );

  const raw = {
    components      : [container],
    flags           : COMPONENTS_V2_FLAG,
    embeds          : [],
    allowedMentions : { parse: [] },
  };

  return wrapByMode(guildId, raw, module.exports.help.name);
}

function _publishPayload(guildId, state, authorId) {
  const dateLabel = _formatFrDateTime(new Date());
  const safeTitle = (state.title || '').trim() || 'Presence';
  const displayTitle = `Presence du ${dateLabel}`;

  const description = [
    safeTitle,
    '',
    '### Reagissez avec',
    '✅ ・ Present',
    '❌ ・ Absent',
    '⏳ ・ Retard',
    '',
    'Reagissez selon votre presence.',
    '',
    `-# Type ${state.type} ・ Cree par <@${authorId}>`,
  ].join('\n');

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${displayTitle}`,
      description,
      `-# <t:${Math.floor(Date.now() / 1000)}:R>`,
    ].join('\n')));

  return wrapByMode(guildId, {
    components      : [container],
    flags           : COMPONENTS_V2_FLAG,
    embeds          : [],
    allowedMentions : { parse: [] },
  }, module.exports.help.name);
}

function _formatFrDateTime(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = String(date.getFullYear()).slice(-2);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${d}/${m}/${y} a ${hh}:${mm}`;
}

async function _handleModal(interaction, title, inputId, value, maxLength, apply, style = TextInputStyle.Short, required = true) {
  const modalId = `fp:modal:${inputId}:${interaction.id}`;

  const input = new TextInputBuilder()
    .setCustomId(inputId)
    .setLabel(title.slice(0, 45))
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(maxLength);

  const initialValue = String(value || '').slice(0, maxLength);
  if (initialValue) {
    input.setValue(initialValue);
  }

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(title.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        input
      )
    );

  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  if (!shown) return false;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 120_000,
  }).catch(() => null);

  if (!submit) return false;

  const data = submit.fields.getTextInputValue(inputId).trim();
  apply(data);
  await submit.deferUpdate().catch(() => {});
  return true;
}

async function _resolvePublishTarget(guild, cfg, type) {
  if (type !== 'Mission') {
    const opChannel = guild.channels.cache.get(cfg.presenceOpChannelId || cfg.presenceChannelId || '');
    if (!opChannel?.isTextBased?.()) {
      return { ok: false, error: 'Configure le salon OP avec fconfig.' };
    }
    return { ok: true, slot: 'op', channel: opChannel };
  }

  const mission1Id = cfg.presenceMission1ChannelId;
  const mission2Id = cfg.presenceMission2ChannelId;

  if (!mission1Id) {
    return { ok: false, error: 'Configure le salon Mission 1 avec fconfig.' };
  }

  const mission1Channel = guild.channels.cache.get(mission1Id);
  if (!mission1Channel?.isTextBased?.()) {
    return { ok: false, error: 'Salon Mission 1 invalide.' };
  }

  let mission1Busy = false;
  if (cfg.mission1MessageId) {
    const msg = await mission1Channel.messages.fetch(cfg.mission1MessageId).catch(() => null);
    if (msg) {
      mission1Busy = true;
    } else {
      setTextConfig(guild.id, 'fivemMission1MessageId', null);
    }
  }

  if (!mission1Busy) {
    return { ok: true, slot: 'mission1', channel: mission1Channel };
  }

  if (!mission2Id) {
    return { ok: false, error: 'Mission 1 est deja occupee. Configure Mission 2 dans fconfig.' };
  }

  const mission2Channel = guild.channels.cache.get(mission2Id);
  if (!mission2Channel?.isTextBased?.()) {
    return { ok: false, error: 'Salon Mission 2 invalide.' };
  }

  return { ok: true, slot: 'mission2', channel: mission2Channel };
}
