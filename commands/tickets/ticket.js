'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  EmbedBuilder,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorBuilder,
  MessageFlags,
  ComponentType,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? null;
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder === 'function' &&
  typeof TextDisplayBuilder === 'function' &&
  typeof SectionBuilder === 'function'
);

const db    = require('../../core/database');
const TIMEOUTS = require('../../utils/interactionTimeouts');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const { parseJsonArray: _parseJsonArray } = require('../../utils/parseJsonArray.js');

exports.help = {
  name       : 'ticket',
  description: 'Configurer le système de tickets.',
  use        : 'ticket <settings|new|list|panel|option|send|delete> ...',
};

exports.run = async (client, message, args) => {


  if (!perms.check(message, exports.help.name)) return;

  const sub     = args[0]?.toLowerCase();
  const guildId = message.guild.id;

  const config = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  if (!sub) return _sendHelp(message);

  switch (sub) {

    case 'settings':
    case 'setting':
    case 'config':
    case 'configs':
      return _openTicketSettingsEntry(client, message);

    case 'new':
      return _handleNew(message, args.slice(1));

    case 'list':
      return _handleList(message);

    case 'panel': {
      const panelId = Number.parseInt(args[1], 10);

      if (!panelId) {
        return embed.replyError(
          message,
          'Identifiant de panel requis.\nExemple : `ticket panel 1`'
        );
      }

      return _openPanelConfig(client, message, panelId);
    }

    case 'option': {
      const optionId = Number.parseInt(args[1], 10);

      if (!optionId) {
        return embed.replyError(
          message,
          'Identifiant d’option requis.\nExemple : `ticket option 2`'
        );
      }

      const opt = db.getTicketOption(optionId);
      if (!opt) {
        return embed.replyError(message, 'Option introuvable.');
      }

      const linkedPanel = db.getTicketPanel(opt.panelId);
      if (!linkedPanel || linkedPanel.guildId !== guildId) {
        return embed.replyError(message, 'Le panel lié à cette option est introuvable.');
      }

      return _openOptionConfig(client, message, optionId);
    }

    case 'send': {
      const panelId = Number.parseInt(args[1], 10);

      if (!panelId) {
        return embed.replyError(
          message,
          'Identifiant de panel requis.\nExemple : `ticket send 1`'
        );
      }

      const sendArgs = args.slice(2);
      return _handleSend(client, message, panelId, sendArgs);
    }

    case 'preview': {
      const panelId = Number.parseInt(args[1], 10);

      if (!panelId) {
        return embed.replyError(
          message,
          'Identifiant de panel requis.\nExemple : `ticket preview 1`'
        );
      }

      return _handlePreview(client, message, panelId);
    }

    case 'delete': {
      const target = args[1]?.toLowerCase();

      if (!target) {
        return embed.replyError(
          message,
          'Précise quoi supprimer.\nExemples : `ticket delete 1` ou `ticket delete all`'
        );
      }

      if (target === 'all') {
        return _handleDeleteAll(message);
      }

      const panelId = Number.parseInt(args[1], 10);

      if (!panelId) {
        return embed.replyError(
          message,
          'Identifiant de panel invalide.\nExemple : `ticket delete 1`'
        );
      }

      return _handleDeleteOne(message, panelId);
    }

    case 'logchannel': {
      const channel = _resolveTextChannel(message, args[1]);

      if (!channel) {
        return embed.replyError(
          message,
          `Utilisation : \`${message.prefix || '+'}ticket logchannel #salon\``
        );
      }

      if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        return embed.replyError(
          message,
          'Le salon doit être un salon textuel.'
        );
      }


      const me = message.guild.members.me
        ?? await message.guild.members.fetchMe().catch(() => null);
      const botPerms = me ? channel.permissionsFor(me) : null;

      if (
        !botPerms?.has('ViewChannel') ||
        !botPerms?.has('SendMessages') ||
        !botPerms?.has('EmbedLinks')
      ) {
        return embed.replyError(
          message,
          `Je n'ai pas les permissions nécessaires dans <#${channel.id}> : Voir le salon, Envoyer des messages, Intégrer des liens.`
        );
      }

      db.setGuildConfig(guildId, 'ticketLogChannel', channel.id);

      return embed.reply(
        message,
        `Salon de log global des formulaires défini sur <#${channel.id}>.`
      );
    }

    case 'rating': {
      const sub2 = args[1]?.toLowerCase();

      if (sub2 === 'off') {
        db.setGuildConfig(guildId, 'ticketRatingEnabled', 0);
        return embed.reply(message, 'Système d\'évaluation des tickets désactivé.');
      }

      if (sub2 === 'on') {
        db.setGuildConfig(guildId, 'ticketRatingEnabled', 1);
        return embed.reply(message, 'Système d\'évaluation des tickets activé (les évaluations sont envoyées en DM).');
      }

      const channel = _resolveTextChannel(message, args[1]);
      if (!channel) {
        return embed.replyError(
          message,
          `Utilisation :\n\`+ticket rating #salon\` → définir le salon\n\`+ticket rating on\` → activer (DM)\n\`+ticket rating off\` → désactiver`
        );
      }

      if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        return embed.replyError(message, 'Le salon doit être un salon textuel.');
      }

      const me = message.guild.members.me ?? await message.guild.members.fetchMe().catch(() => null);
      const botPerms = me ? channel.permissionsFor(me) : null;
      if (!botPerms?.has('ViewChannel') || !botPerms?.has('SendMessages') || !botPerms?.has('EmbedLinks')) {
        return embed.replyError(message, `Je n'ai pas les permissions nécessaires dans <#${channel.id}>.`);
      }

      db.setGuildConfig(guildId, 'ticketRatingChannel', channel.id);
      db.setGuildConfig(guildId, 'ticketRatingEnabled', 1);
      return embed.reply(message, `Salon des évaluations défini sur <#${channel.id}>.`);
    }

    default:
      return _sendHelp(message);
  }
};


async function _openTicketSettingsEntry(client, message) {
  const guildId = message.guild.id;
  const panels  = db.getTicketPanels(guildId);

  if (panels.length === 1) {
    return _openPanelConfig(client, message, panels[0].id);
  }

  if (!panels.length) {
    return _renderTicketSettingsEmpty(client, message);
  }

  return _renderTicketSettingsSelector(client, message, panels);
}

async function _renderTicketSettingsEmpty(client, message) {
  const guildId = message.guild.id;


  return embed.reply(
    message,
    'Aucun panel ticket configuré.\nUtilisez `+ticket new #salon select` pour en créer un.',
    {
      title     : 'Paramètres des tickets',
      timestamp : false,
    },
  );
}

async function _renderTicketSettingsSelector(client, message, panels, existingSent = null) {
  const guildId = message.guild.id;

  if (panels.length === 1 && !existingSent) {
    return _openPanelConfig(client, message, panels[0].id);
  }

  const visible = panels.slice(0, 25);
  const more    = panels.length - visible.length;

  const description = more > 0
    ? `Choisissez le panel à configurer.\n25 premiers affichés (${more} non affiché${more > 1 ? 's' : ''}).`
    : 'Choisissez le panel à configurer.';

  const e = embed.build(guildId, description, {
    title     : 'Paramètres des tickets',
    timestamp : false,
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId('tp_settings_select')
    .setPlaceholder('Choisir un panel')
    .addOptions(visible.map((p, idx) => ({
      label       : `Panel ${idx + 1}`.slice(0, 100),
      value       : String(p.id),
      description : `${p.panelType === 'select' ? 'Sélecteur' : 'Boutons'} · ${p.messageId ? 'Envoyé' : 'Non envoyé'}`.slice(0, 100),
      emoji       : '🎫',
    })));

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tp_settings_close').setLabel('Fermer').setStyle(ButtonStyle.Secondary),
  );

  const selectorPayload = {
    embeds          : [e],
    components      : [new ActionRowBuilder().addComponents(select), closeRow],
    allowedMentions : { parse: [], repliedUser: false },
  };

  let sent = existingSent;
  if (sent) {
    sent._activeCollector?.stop('replaced');
    await sent.edit(selectorPayload).catch(() => {});
  } else {
    sent = await message.reply(selectorPayload).catch(() => null);
    if (!sent) return;
  }

  embed.registerPrivateInteraction(sent, message.author.id, 900_000);

  const collector = sent.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : 900_000,
    time   : 900_000,
  });
  sent._activeCollector = collector;

  collector.on('collect', async interaction => {
    if (interaction.customId === 'tp_settings_close') {
      collector.stop('closed');
      await interaction.deferUpdate().catch(() => {});
      await sent.edit({ components: [] }).catch(() => {});
      await message.delete().catch(() => {});
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'tp_settings_select') {
      const panelId = Number.parseInt(interaction.values[0], 10);
      if (!panelId) {
        return interaction.deferUpdate().catch(() => {});
      }

      const panel = db.getTicketPanel(panelId);
      if (!panel || panel.guildId !== guildId) {
        return interaction.reply({
          embeds: [embed.build(guildId, 'Panel introuvable.', { color: '#ED4245' })],
          flags : MessageFlags.Ephemeral,
        }).catch(() => {});
      }

      collector.stop('navigate');
      await interaction.deferUpdate().catch(() => {});
      return _openPanelConfig(client, message, panelId, sent);
    }

    return interaction.deferUpdate().catch(() => {});
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(sent);
    if (!['navigate', 'closed'].includes(reason)) {
      sent.edit({ components: [], content: '-# Session expirée, relance la commande pour reprendre.' }).catch(() => {});
    }
  });
}


async function _openPanelConfig(client, message, panelId, existingSent = null) {
  const guildId = message.guild.id;
  let panel = db.getTicketPanel(panelId);
  const hasMultiplePanels = db.getTicketPanels(guildId).length > 1;

  if (!panel || panel.guildId !== guildId) {
    return embed.replyError(message, 'Panel introuvable sur ce serveur.');
  }

  let viewState = 'main';
  const accentColor = _hexToInt(embed.getGuildColor(guildId));
  const usingV2     = V2_AVAILABLE;

  const buildPayload = () => {
    panel = db.getTicketPanel(panelId);
    if (!panel) return null;

    const options = db.getTicketOptions(panel.id);

    if (usingV2) {
      const v2 = _buildPanelV2Payload(panel, options, viewState, message.guild, accentColor);
      if (v2) {
        return { panel, options, payload: v2, isV2: true };
      }
    }

    return {
      panel,
      options,
      payload: {
        embeds          : [_buildPanelConfigEmbed(guildId, panel, options, viewState)],
        components      : _buildPanelConfigRows(panel, options, viewState, message.guild, hasMultiplePanels),
        allowedMentions : { repliedUser: false },
      },
      isV2: false,
    };
  };

  let state = buildPayload();
  if (!state) return embed.replyError(message, 'Panel introuvable.');

  let sent = existingSent;
  if (sent) {
    sent._activeCollector?.stop('replaced');
    await sent.edit(state.payload).catch(() => {});
  } else {
    sent = await message.reply(state.payload).catch(() => null);
    if (!sent) return;
  }

  embed.registerPrivateInteraction(sent, message.author.id, 900_000);

  const refreshMessage = async () => {
    const next = buildPayload();
    if (!next) return;
    state = next;
    await sent.edit(next.payload).catch(() => {});
  };

  const buildClosedPayload = (text, isError = false) => {
    if (state.isV2) {
      const c = new ContainerBuilder()
        .setAccentColor(isError ? 0xED4245 : accentColor)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
      return { flags: COMPONENTS_V2_FLAG, components: [c] };
    }
    return {
      embeds     : [embed.build(guildId, text, { color: isError ? '#ED4245' : null, timestamp: false })],
      components : [],
    };
  };


  const runSendAuto = async interaction => {
    const opts = db.getTicketOptions(panel.id);
    if (!opts.length) {
      return interaction.reply({
        embeds: [embed.build(guildId, 'Aucune option configurée. Ajoutez-en avant d\'envoyer.', { color: '#ED4245' })],
        flags : MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    const ch = message.guild.channels.cache.get(panel.channelId);
    if (
      !ch ||
      (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement)
    ) {
      return interaction.reply({
        embeds: [embed.build(guildId, 'Salon du panel introuvable ou invalide.', { color: '#ED4245' })],
        flags : MessageFlags.Ephemeral,
      }).catch(() => {});
    }


    await interaction.deferUpdate().catch(() => {});

    const payload = _buildPanelPayload(guildId, panel, opts);
    const sentMsg = await ch.send(payload).catch(() => null);
    if (!sentMsg) {
      return interaction.followUp({
        embeds: [embed.build(guildId, 'Envoi impossible. Vérifiez les permissions du bot.', { color: '#ED4245' })],
        flags : MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    db.updateTicketPanel(panel.id, { channelId: ch.id, messageId: sentMsg.id });
    await refreshMessage();
  };

  const runSetEmbedModal = async interaction => {
    const parsed = _safeJsonParse(panel.embedJson) || {};
    const modal = _modal(`tp_modal_embed_${panel.id}`, 'Personnaliser l\'embed', [
      _input('title',       'Titre',                 TextInputStyle.Short,     { value: parsed.title || '',       maxLength: 256,  required: false }),
      _input('description', 'Description',           TextInputStyle.Paragraph, { value: parsed.description || '', maxLength: 4000, required: false, placeholder: 'Texte de l\'embed du panel (vide = aucune)' }),
      _input('color',       'Couleur hex (#5865F2)', TextInputStyle.Short,     { value: parsed.color || '',       maxLength: 7,    required: false, placeholder: '#2B2D31' }),
      _input('footer',      'Footer',                TextInputStyle.Short,     { value: parsed.footer || '',      maxLength: 256,  required: false }),
      _input('image',       'URL image',             TextInputStyle.Short,     { value: parsed.image || '',       maxLength: 512,  required: false, placeholder: 'https://...' }),
    ]);

    busy = true;
    const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
    busy = false;
    if (!_shown) return;

    const modalSubmit = await _awaitOwnModal(interaction, `tp_modal_embed_${panel.id}`);
    if (!modalSubmit) {
      await refreshMessage();
      return;
    }

    busy = true;
    try {

    const title       = modalSubmit.fields.getTextInputValue('title').trim();
    const description = modalSubmit.fields.getTextInputValue('description').trim();
    const colorRaw    = modalSubmit.fields.getTextInputValue('color').trim();
    const footer      = modalSubmit.fields.getTextInputValue('footer').trim();
    const image       = modalSubmit.fields.getTextInputValue('image').trim();

    const color = colorRaw ? _normalizeHexColor(colorRaw) : null;
    if (colorRaw && !color) {
      return modalSubmit.reply({
        embeds: [embed.build(guildId, 'Couleur invalide. Exemple : `#5865F2`', { color: '#ED4245' })],
        flags : MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    const imageUrl = image ? _validateHttpUrl(image) : null;
    if (image && !imageUrl) {
      return modalSubmit.reply({
        embeds: [embed.build(guildId, 'URL d\'image invalide.', { color: '#ED4245' })],
        flags : MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    db.updateTicketPanelEmbed(panel.id, JSON.stringify({
      title       : title || null,
      description : description || null,
      color       : color || null,
      footer      : footer || null,
      image       : imageUrl || null,
      thumbnail   : null,
    }));

    await modalSubmit.deferUpdate().catch(() => {});
    await refreshMessage();
    } finally {
      busy = false;
    }
  };


  let busy = false;

  const collector = sent.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : 900_000,
    time   : 900_000,
  });
  sent._activeCollector = collector;

  collector.on('collect', async interaction => {
    panel = db.getTicketPanel(panelId);
    if (!panel) return collector.stop();


    if (busy) {
      return interaction.reply({
        content: 'Une modification est déjà en cours.',
        flags  : MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    const id = interaction.customId;

    if (id === 'tp_msg_pick') {
      return runSetEmbedModal(interaction);
    }

    if (id === 'tp_msg_send') {
      return runSendAuto(interaction);
    }

    if (id === 'tp_type_button' || id === 'tp_type_select') {
      const newType = id === 'tp_type_select' ? 'select' : 'button';

      if (panel.panelType !== newType) {
        db.updateTicketPanel(panel.id, { panelType: newType });
        panel = db.getTicketPanel(panel.id);


        if (panel?.messageId && panel?.channelId) {
          try {
            const ch = message.guild.channels.cache.get(panel.channelId);
            if (ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)) {
              const oldMsg = await ch.messages.fetch(panel.messageId).catch(() => null);
              if (oldMsg && oldMsg.author?.id === client.user.id) {
                const opts    = db.getTicketOptions(panel.id);
                const payload = _buildPanelPayload(guildId, panel, opts);
                await oldMsg.edit(payload).catch(() => {});
              }
            }
          } catch {}
        }
      }

      await interaction.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
    }


    if (id === 'tp_claim_off' || id === 'tp_claim_lock' || id === 'tp_claim_cache') {
      const newMode = id === 'tp_claim_lock' ? 'lock' : id === 'tp_claim_cache' ? 'cache' : 'off';
      if ((panel.claimMode || 'off') !== newMode) {
        db.updateTicketPanel(panel.id, { claimMode: newMode });
      }
      await interaction.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
    }

    if (id === 'tp_required_roles' && interaction.isRoleSelectMenu?.()) {
      const ids = (interaction.values || []).slice(0, 10);
      db.updateTicketPanel(panel.id, { requiredRoles: JSON.stringify(ids) });
      await interaction.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
    }

    if (id === 'tp_blocked_roles' && interaction.isRoleSelectMenu?.()) {
      const ids = (interaction.values || []).slice(0, 10);
      db.updateTicketPanel(panel.id, { blockedRoles: JSON.stringify(ids) });
      await interaction.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
    }

    if (id === 'tp_advanced') {
      viewState = 'advanced';
      await interaction.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
    }

    if (id === 'tp_advanced_back' || id === 'tp_back') {
      if (viewState === 'advanced') {
        viewState = 'main';
        await interaction.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
      }
      collector.stop('navigate');
      await interaction.deferUpdate().catch(() => {});
      const allPanels = db.getTicketPanels(guildId);
      return _renderTicketSettingsSelector(client, message, allPanels, sent);
    }

    if (interaction.isStringSelectMenu() && id === 'tp_manage_options') {
      const selected = interaction.values?.[0];

      if (selected === 'no_option') {
        await interaction.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
      }

      if (selected === 'add_option') {
        const modalId = `tp_modal_addopt_${panel.id}`;
        const modal = _modal(modalId, 'Nouvelle option', [
          _input('name', 'Nom de l’option', TextInputStyle.Short, {
            maxLength   : 100,
            required    : true,
            placeholder : 'Support général',
          }),
          _input('description', 'Description (optionnelle)', TextInputStyle.Short, {
            maxLength   : 100,
            required    : false,
            placeholder : 'Pour toute question...',
          }),
          _input('emoji', 'Emoji (optionnel)', TextInputStyle.Short, {
            maxLength   : 64,
            required    : false,
            placeholder : '🎫',
          }),
        ]);

        busy = true;
        const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
        busy = false;
        if (!_shown) return;

        const submit = await _awaitOwnModal(interaction, modalId);
        if (!submit) {
          await refreshMessage();
          return;
        }

        busy = true;
        try {

        const rawName  = (submit.fields.getTextInputValue('name')        || '').trim();
        const rawDesc  = (submit.fields.getTextInputValue('description') || '').trim();
        const rawEmoji = (submit.fields.getTextInputValue('emoji')       || '').trim();

        if (!rawName) {
          return submit.reply({
            embeds: [embed.build(guildId, 'Le nom de l’option est requis.', { color: '#ED4245' })],
            flags : MessageFlags.Ephemeral,
          }).catch(() => {});
        }

        const existing = db.getTicketOptions(panel.id) || [];
        const dup = existing.some(o => String(o.label || '').toLowerCase() === rawName.toLowerCase());
        if (dup) {
          return submit.reply({
            embeds: [embed.build(guildId, `Une option nommée \`${rawName}\` existe déjà sur ce panel.`, { color: '#ED4245' })],
            flags : MessageFlags.Ephemeral,
          }).catch(() => {});
        }


        let validEmoji = null;
        if (rawEmoji) {
          try {
            new ButtonBuilder().setEmoji(rawEmoji);
            validEmoji = rawEmoji;
          } catch {
            return submit.reply({
              embeds: [embed.build(guildId, 'Emoji invalide. Utilisez un emoji unicode (`🎫`) ou un emoji custom (`<:nom:id>`).', { color: '#ED4245' })],
              flags : MessageFlags.Ephemeral,
            }).catch(() => {});
          }
        }

        const newId = db.createTicketOption(panel.id, {
          label        : rawName,
          emoji        : validEmoji,
          description  : rawDesc || null,
          categoryId   : null,
          staffRoles   : '[]',
          mentionRoles : '[]',
          logChannelId : null,
          openMessage  : null,
          nameTemplate : null,
        });

        collector.stop('navigate');
        await submit.deferUpdate().catch(() => {});
        return _openOptionConfig(client, message, newId, null, sent);
        } finally {
          busy = false;
        }
      }

      if (selected?.startsWith('edit_option_')) {
        const optionId = Number.parseInt(selected.replace('edit_option_', ''), 10);
        if (!optionId) {
          await interaction.deferUpdate().catch(() => {});
          await refreshMessage();
          return;
        }

        collector.stop('navigate');
        await interaction.deferUpdate().catch(() => {});
        return _openOptionConfig(client, message, optionId, null, sent);
      }

      await interaction.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
    }


    const _advBtnMap = {
      tp_adv_max                : 'set_max',
      tp_adv_autodelete         : 'set_autodelete',
      tp_adv_inactive           : 'set_inactiveclose',
      tp_adv_logs               : 'set_logchannel',
      tp_adv_bypass             : 'set_bypass_roles',
      tp_adv_placeholder        : 'set_placeholder',
      tp_adv_toggle_autoclaim   : 'toggle_autoclaim',
      tp_adv_toggle_claim       : 'toggle_claim_btn',
      tp_adv_toggle_close       : 'toggle_close_btn',
      tp_adv_toggle_transcript  : 'toggle_transcriptdm',
      tp_adv_toggle_closeonleave: 'toggle_closeonleave',
    };

    const _isCfgSelect  = interaction.isStringSelectMenu() && id === 'tp_config_menu';
    const _advBtnAction = _advBtnMap[id];

    if (_isCfgSelect || _advBtnAction) {
      const selected = _isCfgSelect ? interaction.values?.[0] : _advBtnAction;

      if (selected === 'toggle_autoclaim') {
        const next = panel.claimMode === 'autoclaim' ? 'off' : 'autoclaim';
        db.updateTicketPanel(panel.id, { claimMode: next });
        await interaction.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
      }

      if (selected === 'send_auto') {
        return runSendAuto(interaction);
      }

      if (selected === 'set_embed') {
        return runSetEmbedModal(interaction);
      }

      if (selected === 'set_max') {
        const modal = _modal(`tp_modal_max_${panel.id}`, 'Max tickets par personne', [
          _input('max', 'Nombre maximum (0 = illimité)', TextInputStyle.Short, {
            value      : String(panel.maxOpenPerUser ?? 1),
            maxLength  : 3,
            placeholder: '1',
          }),
        ]);

        busy = true;
        const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
        busy = false;
        if (!_shown) return;

        const modalSubmit = await _awaitOwnModal(interaction, `tp_modal_max_${panel.id}`);
        if (!modalSubmit) {
          await refreshMessage();
          return;
        }

        busy = true;
        try {

        const val = Number.parseInt(modalSubmit.fields.getTextInputValue('max'), 10);
        if (Number.isNaN(val) || val < 0) {
          return modalSubmit.reply({
            embeds: [embed.build(guildId, 'Valeur invalide.', { color: '#ED4245' })],
            flags : MessageFlags.Ephemeral,
          }).catch(() => {});
        }

        db.updateTicketPanel(panel.id, { maxOpenPerUser: val });
        await modalSubmit.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
        } finally {
          busy = false;
        }
      }

      if (selected === 'set_inactiveclose') {
        const modal = _modal(`tp_modal_inactive_${panel.id}`, 'Fermeture inactive', [
          _input('delay', 'Durée (ex : 12h, 2d, 1w -vide = désactivé)', TextInputStyle.Short, {
            value       : _secondsToHuman(panel.inactiveCloseDelay),
            maxLength   : 8,
            required    : false,
            placeholder : '48h',
          }),
        ]);

        busy = true;
        const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
        busy = false;
        if (!_shown) return;

        const modalSubmit = await _awaitOwnModal(interaction, `tp_modal_inactive_${panel.id}`);
        if (!modalSubmit) {
          await refreshMessage();
          return;
        }

        busy = true;
        try {

        const raw = modalSubmit.fields.getTextInputValue('delay').trim().toLowerCase();
        let seconds = 0;

        if (raw && raw !== 'none' && raw !== 'non' && raw !== 'aucun' && raw !== '0') {
          seconds = _parseDuration(raw);
          if (!seconds || seconds < 600) {
            return modalSubmit.reply({
              embeds: [embed.build(guildId, 'Durée invalide ou trop courte (min 10m). Exemples : `10m`, `12h`, `2d`, `1w`', { color: '#ED4245' })],
              flags : MessageFlags.Ephemeral,
            }).catch(() => {});
          }
        }

        db.updateTicketPanel(panel.id, { inactiveCloseDelay: seconds });
        await modalSubmit.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
        } finally {
          busy = false;
        }
      }

      if (selected === 'set_autodelete') {
        const modal = _modal(`tp_modal_autodelete_${panel.id}`, 'Suppression automatique', [
          _input('delay', 'Délai (ex : 30s, 5m, 2h -vide = désactivé)', TextInputStyle.Short, {
            value       : _secondsToHuman(panel.autoDeleteSeconds),
            maxLength   : 8,
            required    : false,
            placeholder : '5m',
          }),
        ]);

        busy = true;
        const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
        busy = false;
        if (!_shown) return;

        const modalSubmit = await _awaitOwnModal(interaction, `tp_modal_autodelete_${panel.id}`);
        if (!modalSubmit) {
          await refreshMessage();
          return;
        }

        busy = true;
        try {

        const raw = modalSubmit.fields.getTextInputValue('delay').trim();
        let seconds = null;

        if (raw) {
          seconds = _parseDuration(raw);
          if (!seconds) {
            return modalSubmit.reply({
              embeds: [embed.build(guildId, 'Durée invalide. Exemples : `30s`, `5m`, `2h`, `1d`', { color: '#ED4245' })],
              flags : MessageFlags.Ephemeral,
            }).catch(() => {});
          }
        }

        db.updateTicketPanel(panel.id, { autoDeleteSeconds: seconds });
        await modalSubmit.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
        } finally {
          busy = false;
        }
      }

      if (selected === 'set_logchannel') {
        const modal = _modal(`tp_modal_logchannel_${panel.id}`, 'Salon de logs du panel', [
          _input('channel', 'ID du salon (vide = désactivé)', TextInputStyle.Short, {
            value       : panel.logChannelId || '',
            maxLength   : 20,
            required    : false,
            placeholder : '123456789012345678',
          }),
        ]);

        busy = true;
        const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
        busy = false;
        if (!_shown) return;

        const modalSubmit = await _awaitOwnModal(interaction, `tp_modal_logchannel_${panel.id}`);
        if (!modalSubmit) {
          await refreshMessage();
          return;
        }

        busy = true;
        try {

        const raw = modalSubmit.fields.getTextInputValue('channel').trim();
        let channelId = null;

        if (raw) {
          const ch = message.guild.channels.cache.get(raw.replace(/[<#>]/g, ''));
          if (!ch || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)) {
            return modalSubmit.reply({
              embeds: [embed.build(guildId, 'Salon introuvable ou invalide.', { color: '#ED4245' })],
              flags : MessageFlags.Ephemeral,
            }).catch(() => {});
          }
          channelId = ch.id;
        }

        db.updateTicketPanel(panel.id, { logChannelId: channelId });
        await modalSubmit.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
        } finally {
          busy = false;
        }
      }

      if (selected === 'toggle_transcriptdm') {
        db.updateTicketPanel(panel.id, { transcriptDm: panel.transcriptDm ? 0 : 1 });
        await interaction.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
      }

      if (selected === 'toggle_claim_btn') {
        db.updateTicketPanel(panel.id, { showClaimButton: Number(panel.showClaimButton ?? 1) ? 0 : 1 });
        await interaction.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
      }

      if (selected === 'toggle_close_btn') {
        db.updateTicketPanel(panel.id, { showCloseButton: Number(panel.showCloseButton ?? 1) ? 0 : 1 });
        await interaction.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
      }

      if (selected === 'toggle_closeonleave') {
        db.updateTicketPanel(panel.id, { closeOnLeave: Number(panel.closeOnLeave) ? 0 : 1 });
        await interaction.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
      }

      if (selected === 'toggle_claimmode') {
        const modes = ['off', 'lock', 'cache', 'autoclaim'];
        const next  = modes[(modes.indexOf(panel.claimMode || 'off') + 1) % modes.length];
        db.updateTicketPanel(panel.id, { claimMode: next });
        await interaction.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
      }

      if (selected === 'set_bypass_roles') {
        const current = _parseJsonArray(panel.bypassRoles).join(', ');
        const modal = _modal(`tp_modal_bypassroles_${panel.id}`, 'Rôles bypass (max tickets)', [
          _input('roles', 'IDs séparés par des virgules (vide = aucun)', TextInputStyle.Paragraph, {
            value       : current,
            maxLength   : 500,
            required    : false,
            placeholder : '123456789012345678, 987654321098765432',
          }),
        ]);

        busy = true;
        const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
        busy = false;
        if (!_shown) return;

        const modalSubmit = await _awaitOwnModal(interaction, `tp_modal_bypassroles_${panel.id}`);
        if (!modalSubmit) {
          await refreshMessage();
          return;
        }

        busy = true;
        try {

        const raw = modalSubmit.fields.getTextInputValue('roles').trim();
        const ids = raw ? _parseRoleIdsFromString(message.guild, raw) : [];
        db.updateTicketPanel(panel.id, { bypassRoles: JSON.stringify(ids) });

        await modalSubmit.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
        } finally {
          busy = false;
        }
      }

      if (selected === 'set_required_roles') {
        const current = _parseJsonArray(panel.requiredRoles).map(id => `<@&${id}>`).join(', ');
        const modal = _modal(`tp_modal_requiredroles_${panel.id}`, 'Rôles requis pour créer un ticket', [
          _input('roles', '@rôle, ID ou nom exact, séparés par ,', TextInputStyle.Paragraph, {
            value       : current,
            maxLength   : 500,
            required    : false,
            placeholder : '@Membre, 123456789012345678',
          }),
        ]);

        busy = true;
        const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
        busy = false;
        if (!_shown) return;

        const modalSubmit = await _awaitOwnModal(interaction, `tp_modal_requiredroles_${panel.id}`);
        if (!modalSubmit) {
          await refreshMessage();
          return;
        }

        busy = true;
        try {

        const raw = modalSubmit.fields.getTextInputValue('roles').trim();
        const result = raw ? _parseRoleList(message.guild, raw) : { ids: [], error: null };

        if (result.error) {
          return modalSubmit.reply({
            embeds: [embed.build(guildId, result.error, { color: '#ED4245' })],
            flags : MessageFlags.Ephemeral,
          }).catch(() => {});
        }

        db.updateTicketPanel(panel.id, { requiredRoles: JSON.stringify(result.ids) });
        await modalSubmit.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
        } finally {
          busy = false;
        }
      }

      if (selected === 'set_blocked_roles') {
        const current = _parseJsonArray(panel.blockedRoles).map(id => `<@&${id}>`).join(', ');
        const modal = _modal(`tp_modal_blockedroles_${panel.id}`, 'Rôles interdits', [
          _input('roles', '@rôle, ID ou nom exact, séparés par ,', TextInputStyle.Paragraph, {
            value       : current,
            maxLength   : 500,
            required    : false,
            placeholder : '@Muted, 123456789012345678',
          }),
        ]);

        busy = true;
        const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
        busy = false;
        if (!_shown) return;

        const modalSubmit = await _awaitOwnModal(interaction, `tp_modal_blockedroles_${panel.id}`);
        if (!modalSubmit) {
          await refreshMessage();
          return;
        }

        busy = true;
        try {

        const raw = modalSubmit.fields.getTextInputValue('roles').trim();
        const result = raw ? _parseRoleList(message.guild, raw) : { ids: [], error: null };

        if (result.error) {
          return modalSubmit.reply({
            embeds: [embed.build(guildId, result.error, { color: '#ED4245' })],
            flags : MessageFlags.Ephemeral,
          }).catch(() => {});
        }

        db.updateTicketPanel(panel.id, { blockedRoles: JSON.stringify(result.ids) });
        await modalSubmit.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
        } finally {
          busy = false;
        }
      }

      if (selected === 'set_placeholder') {
        const modal = _modal(`tp_modal_placeholder_${panel.id}`, 'Texte du menu déroulant', [
          _input('placeholder', 'Texte affiché dans le menu', TextInputStyle.Short, {
            value       : panel.placeholder || '',
            maxLength   : 150,
            required    : false,
            placeholder : 'Choisissez une catégorie...',
          }),
        ]);

        busy = true;
        const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
        busy = false;
        if (!_shown) return;

        const modalSubmit = await _awaitOwnModal(interaction, `tp_modal_placeholder_${panel.id}`);
        if (!modalSubmit) {
          await refreshMessage();
          return;
        }

        busy = true;
        try {

        const val = modalSubmit.fields.getTextInputValue('placeholder').trim();
        db.updateTicketPanel(panel.id, { placeholder: val || null });
        await modalSubmit.deferUpdate().catch(() => {});
        await refreshMessage();
        return;
        } finally {
          busy = false;
        }
      }

      await interaction.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
    }

    if (id === 'tp_validate') {
      collector.stop('validated');
      await interaction.deferUpdate().catch(() => {});
      return sent.edit(buildClosedPayload('Configuration du panel enregistrée.')).catch(() => {});
    }

    if (id === 'tp_add_panel') {
      const modal = _modal(`tp_modal_add_panel_${panel.id}`, 'Ajouter un panel', [
        _input('channel', 'Salon du panel (#salon ou ID)', TextInputStyle.Short, {
          maxLength   : 30,
          placeholder : '#tickets',
        }),
        _input('type', 'Type (button ou select)', TextInputStyle.Short, {
          maxLength   : 10,
          placeholder : 'button',
        }),
      ]);

      busy = true;
      const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
      busy = false;
      if (!_shown) return;

      const modalSubmit = await _awaitOwnModal(interaction, `tp_modal_add_panel_${panel.id}`);
      if (!modalSubmit) return;

      busy = true;
      try {

      const rawChannel = modalSubmit.fields.getTextInputValue('channel').trim();
      const rawType    = modalSubmit.fields.getTextInputValue('type').trim().toLowerCase();

      const channel = message.mentions.channels.first()
        ?? message.guild.channels.cache.get(rawChannel.replace(/[<#>]/g, ''));

      if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        return modalSubmit.reply({
          embeds: [embed.build(guildId, 'Salon introuvable ou invalide.', { color: '#ED4245' })],
          flags : MessageFlags.Ephemeral,
        }).catch(() => {});
      }

      if (!['button', 'select'].includes(rawType)) {
        return modalSubmit.reply({
          embeds: [embed.build(guildId, 'Type invalide. Valeurs : `button` ou `select`.', { color: '#ED4245' })],
          flags : MessageFlags.Ephemeral,
        }).catch(() => {});
      }

      const newPanelId = db.createTicketPanel(guildId, channel.id, rawType);
      collector.stop('navigate');

      await modalSubmit.reply({
        embeds: [embed.build(guildId, `Panel \`${newPanelId}\` créé. Ouverture de la configuration...`, { timestamp: false })],
        flags : MessageFlags.Ephemeral,
      }).catch(() => {});

      return _openPanelConfig(client, message, newPanelId);
      } finally {
        busy = false;
      }
    }

    if (id === 'tp_delete') {
      const opts = db.getTicketOptions(panel.id) || [];
      const chan = panel.channelId ? `<#${panel.channelId}>` : '`Non defini`';
      const type = panel.panelType || 'select';
      const desc = `Supprimer le panel \`#${panel.id}\` ?\n` +
        `Salon : ${chan} - Type : \`${type}\` - Options : \`${opts.length}\``;

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('tp_confirm_delete')
          .setLabel('Confirmer la suppression')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('tp_cancel_delete')
          .setLabel('Annuler')
          .setStyle(ButtonStyle.Secondary),
      );

      let confirmReply;
      try {
        confirmReply = await interaction.reply({
          embeds       : [embed.build(guildId, desc, { timestamp: false })],
          components   : [confirmRow],
          flags        : MessageFlags.Ephemeral,
          withResponse : true,
        });
      } catch { return; }

      const confirmMsg = confirmReply?.resource?.message ?? null;
      if (!confirmMsg) return;

      let confirm;
      try {
        confirm = await confirmMsg.awaitMessageComponent({
          componentType : ComponentType.Button,
          filter        : i => i.user.id === message.author.id,
          time          : TIMEOUTS.CONFIRM_TIME_MS,
        });
      } catch {
        await interaction.editReply({
          embeds     : [embed.build(guildId, 'Suppression annulée (timeout).', { timestamp: false })],
          components : [],
        }).catch(() => {});
        return;
      }

      if (confirm.customId !== 'tp_confirm_delete') {
        await confirm.update({
          embeds     : [embed.build(guildId, 'Suppression annulée.', { timestamp: false })],
          components : [],
        }).catch(() => {});
        return;
      }

      db.deleteTicketPanel(panel.id);

      const remaining = db.getTicketPanels(guildId);
      if (!remaining.length && typeof db.resetTicketPanelSequence === 'function') {
        db.resetTicketPanelSequence();
        if (typeof db.resetTicketOptionSequence === 'function') db.resetTicketOptionSequence();
      }

      await confirm.update({
        embeds     : [embed.build(guildId, `Panel \`#${panel.id}\` supprimé.`, { timestamp: false })],
        components : [],
      }).catch(() => {});

      collector.stop('deleted');
      return sent.edit(buildClosedPayload(`Panel \`${panel.id}\` supprimé.`, '#57F287')).catch(() => {});
    }

    return interaction.deferUpdate().catch(() => {});
  });

  collector.on('end', (_, reason) => {
    busy = false;
    embed.clearPrivateInteraction(sent);
    if (['deleted', 'validated', 'navigate', 'replaced'].includes(reason)) return;
    sent.edit(buildClosedPayload('Configuration expirée.')).catch(() => {});
  });
}


function _buildPanelConfigEmbed(guildId, panel, options, viewState = 'main') {
  const sentState = panel.messageId ? 'Message envoyé' : 'Message non envoyé';

  if (viewState === 'advanced') {
    return embed.build(guildId, `Panel · <#${panel.channelId}>`, {
      title     : 'Paramètres avancés',
      timestamp : false,
    });
  }

  const requiredRoles = _parseJsonArray(panel.requiredRoles);
  const blockedRoles  = _parseJsonArray(panel.blockedRoles);
  const claimMode     = panel.claimMode || 'off';

  const description = `<#${panel.channelId}> · ${sentState}`;

  const fields = [];

  if (claimMode === 'autoclaim') {
    fields.push({ name: 'Claim', value: 'Autoclaim', inline: true });
  }

  fields.push(
    {
      name  : 'Rôles requis',
      value : requiredRoles.length
        ? requiredRoles.map(id => `<@&${id}>`).join(', ').slice(0, 200)
        : 'Aucun',
      inline: true,
    },
    {
      name  : 'Rôles interdits',
      value : blockedRoles.length
        ? blockedRoles.map(id => `<@&${id}>`).join(', ').slice(0, 200)
        : 'Aucun',
      inline: true,
    },
    {
      name  : 'Options',
      value : options.length ? `${options.length} configurée${options.length > 1 ? 's' : ''}` : 'Aucune',
      inline: true,
    },
  );

  return embed.build(guildId, description, {
    title     : 'Paramètres des tickets',
    fields,
    timestamp : false,
  });
}


function _buildPanelConfigRows(panel, options, viewState = 'main', guild = null, hasMultiplePanels = true) {
  if (viewState === 'advanced') {
    return _buildPanelConfigAdvancedRows(panel);
  }

  const claimMode = panel.claimMode || 'off';
  const isSelect  = panel.panelType === 'select';


  const typeClaimRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tp_type_button')
      .setLabel('Boutons')
      .setStyle(isSelect ? ButtonStyle.Secondary : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('tp_type_select')
      .setLabel('Sélecteur')
      .setStyle(isSelect ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('tp_claim_off')
      .setLabel('Désactivé')
      .setStyle(claimMode === 'off' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('tp_claim_lock')
      .setLabel('Empêche parler')
      .setStyle(claimMode === 'lock' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('tp_claim_cache')
      .setLabel('Empêche voir')
      .setStyle(claimMode === 'cache' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );


  const requiredRoleSelect = new RoleSelectMenuBuilder()
    .setCustomId('tp_required_roles')
    .setPlaceholder('Fais un choix')
    .setMinValues(0)
    .setMaxValues(10);


  const blockedRoleSelect = new RoleSelectMenuBuilder()
    .setCustomId('tp_blocked_roles')
    .setPlaceholder('Fais un choix')
    .setMinValues(0)
    .setMaxValues(10);


  try {
    const isValidRole = id => guild?.roles?.cache?.has?.(id) ?? false;

    const reqIds = _parseJsonArray(panel.requiredRoles).filter(isValidRole).slice(0, 10);
    if (reqIds.length && typeof requiredRoleSelect.setDefaultValues === 'function') {
      requiredRoleSelect.setDefaultValues(reqIds);
    }
    const blkIds = _parseJsonArray(panel.blockedRoles).filter(isValidRole).slice(0, 10);
    if (blkIds.length && typeof blockedRoleSelect.setDefaultValues === 'function') {
      blockedRoleSelect.setDefaultValues(blkIds);
    }
  } catch {}


  const optionSelections = [
    { label: 'Ajouter une option', value: 'add_option', description: 'Créer une nouvelle option', emoji: '➕' },
    ...(options.length
      ? options.slice(0, 24).map((o, idx) => ({
          label       : String(o.label || `Option ${idx + 1}`).slice(0, 100),
          value       : `edit_option_${o.id}`,
          description : `Modifier l'option ${idx + 1}`.slice(0, 100),
          emoji       : '✏️',
        }))
      : [{ label: 'Aucune option configurée', value: 'no_option', description: 'Aucune action disponible' }]),
  ].slice(0, 25);

  const optionMenu = new StringSelectMenuBuilder()
    .setCustomId('tp_manage_options')
    .setPlaceholder('Gérer les options')
    .addOptions(optionSelections);


  const footerButtons = [
    new ButtonBuilder().setCustomId('tp_validate').setLabel('Valider').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('tp_add_panel').setLabel('Ajouter un panel').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('tp_advanced').setEmoji('🔧').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tp_delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  ];
  if (hasMultiplePanels) {
    footerButtons.push(new ButtonBuilder().setCustomId('tp_back').setLabel('Retour').setStyle(ButtonStyle.Secondary));
  }
  const footerRow = new ActionRowBuilder().addComponents(footerButtons);

  return [
    typeClaimRow,
    new ActionRowBuilder().addComponents(requiredRoleSelect),
    new ActionRowBuilder().addComponents(blockedRoleSelect),
    new ActionRowBuilder().addComponents(optionMenu),
    footerRow,
  ];
}


function _buildPanelConfigAdvancedRows(panel) {
  const configSelections = [
    { label: 'Choisir le message du panel',     value: 'set_embed',          description: 'Personnaliser titre, description et visuel', emoji: '✏️' },
    { label: 'Envoyer un message automatique',  value: 'send_auto',          description: 'Publier le panel dans son salon',            emoji: '📤' },
    { label: 'Nombre max de tickets',           value: 'set_max',            description: 'Limiter les tickets par membre',             emoji: '🔢' },
    { label: 'Suppression automatique',         value: 'set_autodelete',     description: 'Définir un délai avant suppression',         emoji: '🧹' },
    { label: 'Fermeture inactive',              value: 'set_inactiveclose',  description: 'Fermer si aucun message pendant X temps',    emoji: '⏳' },
    { label: 'Salon de logs',                   value: 'set_logchannel',     description: 'Définir où envoyer les logs',                emoji: '📡' },
    { label: `Transcript MP : ${panel.transcriptDm ? 'Activé' : 'Désactivé'}`,                 value: 'toggle_transcriptdm', description: 'Activer ou désactiver l\'envoi en MP',       emoji: '📩' },
    { label: `Bouton claim : ${Number(panel.showClaimButton ?? 1) ? 'Activé' : 'Désactivé'}`,  value: 'toggle_claim_btn',    description: 'Afficher ou masquer le bouton claim',       emoji: '📌' },
    { label: `Bouton close : ${Number(panel.showCloseButton ?? 1) ? 'Activé' : 'Désactivé'}`,  value: 'toggle_close_btn',    description: 'Afficher ou masquer le bouton close',       emoji: '🔒' },
    { label: `Close on leave : ${Number(panel.closeOnLeave) ? 'Activé' : 'Désactivé'}`,        value: 'toggle_closeonleave', description: 'Fermer le ticket si le membre quitte',      emoji: '🚪' },
    { label: `Autoclaim : ${panel.claimMode === 'autoclaim' ? 'Activé' : 'Désactivé'}`,        value: 'toggle_autoclaim',    description: 'Activer ou désactiver l\'autoclaim',         emoji: '⚡' },
    { label: 'Rôles bypass (max tickets)',      value: 'set_bypass_roles',   description: 'Rôles qui ignorent la limite',              emoji: '🛡️' },
    ...(panel.panelType === 'select'
      ? [{ label: 'Texte du menu', value: 'set_placeholder', description: 'Modifier le placeholder du menu déroulant', emoji: '💬' }]
      : []),
  ].slice(0, 25);

  const configMenu = new StringSelectMenuBuilder()
    .setCustomId('tp_config_menu')
    .setPlaceholder('Configuration avancée')
    .addOptions(configSelections);

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tp_advanced_back').setLabel('Retour').setStyle(ButtonStyle.Secondary),
  );

  return [
    new ActionRowBuilder().addComponents(configMenu),
    backRow,
  ];
}


function _hexToInt(hex) {
  if (typeof hex !== 'string') return 0xED4245;
  const m = hex.replace(/^#/, '').match(/^[0-9a-fA-F]{6}$/);
  return m ? parseInt(m[0], 16) : 0xED4245;
}

function _buildOptionMenuChoices(options) {
  return [
    { label: 'Ajouter une option', value: 'add_option', description: 'Créer une nouvelle option', emoji: '➕' },
    ...(options.length
      ? options.slice(0, 24).map((o, idx) => ({
          label       : String(o.label || `Option ${idx + 1}`).slice(0, 100),
          value       : `edit_option_${o.id}`,
          description : `Modifier l'option ${idx + 1}`.slice(0, 100),
          emoji       : '✏️',
        }))
      : [{ label: 'Aucune option configurée', value: 'no_option', description: 'Aucune action disponible' }]),
  ].slice(0, 25);
}

function _buildAdvancedSelectOptions(panel) {
  return [
    { label: 'Modifier le message du panel',    value: 'set_embed',          emoji: '✏️',  description: 'Personnaliser titre, description et visuel' },
    { label: 'Envoyer le panel',                value: 'send_auto',          emoji: '📤',  description: 'Publier le panel dans son salon' },
    { label: 'Nombre max de tickets',           value: 'set_max',            emoji: '🔢',  description: 'Limiter les tickets par membre' },
    { label: 'Suppression automatique',         value: 'set_autodelete',     emoji: '🧹',  description: 'Définir un délai avant suppression' },
    { label: 'Fermeture inactive',              value: 'set_inactiveclose',  emoji: '⏳',  description: 'Fermer si aucun message pendant X temps' },
    { label: 'Salon de logs',                   value: 'set_logchannel',     emoji: '📡',  description: 'Définir où envoyer les logs' },
    { label: `Transcript MP : ${panel.transcriptDm ? 'Activé' : 'Désactivé'}`,                 value: 'toggle_transcriptdm', emoji: '📩',  description: 'Activer ou désactiver l\'envoi en MP' },
    { label: `Bouton claim : ${Number(panel.showClaimButton ?? 1) ? 'Activé' : 'Désactivé'}`,  value: 'toggle_claim_btn',    emoji: '📌',  description: 'Afficher ou masquer le bouton claim' },
    { label: `Bouton close : ${Number(panel.showCloseButton ?? 1) ? 'Activé' : 'Désactivé'}`,  value: 'toggle_close_btn',    emoji: '🔒',  description: 'Afficher ou masquer le bouton close' },
    { label: `Close on leave : ${Number(panel.closeOnLeave) ? 'Activé' : 'Désactivé'}`,        value: 'toggle_closeonleave', emoji: '🚪',  description: 'Fermer le ticket si le membre quitte' },
    { label: `Autoclaim : ${panel.claimMode === 'autoclaim' ? 'Activé' : 'Désactivé'}`,        value: 'toggle_autoclaim',    emoji: '⚡',  description: 'Activer ou désactiver l\'autoclaim' },
    { label: 'Rôles bypass (max tickets)',      value: 'set_bypass_roles',   emoji: '🛡️', description: 'Rôles qui ignorent la limite' },
    ...(panel.panelType === 'select'
      ? [{ label: 'Texte du menu', value: 'set_placeholder', emoji: '💬', description: 'Modifier le placeholder du menu déroulant' }]
      : []),
  ].slice(0, 25);
}

function _buildPanelV2Payload(panel, options, viewState, guild, accentColor) {
  if (!V2_AVAILABLE) return null;

  try {
    const container = new ContainerBuilder().setAccentColor(accentColor);

    if (viewState === 'advanced') {
      _appendAdvancedV2(container, panel);
    } else {
      _appendMainV2(container, panel, options, guild);
    }

    return {
      flags           : COMPONENTS_V2_FLAG,
      components      : [container],
      allowedMentions : { repliedUser: false },
    };
  } catch {
    return null;
  }
}

function _appendMainV2(container, panel, options, guild) {
  const claimMode = panel.claimMode || 'off';
  const isSelect  = panel.panelType === 'select';


  const channelPart = panel.channelId ? `<#${panel.channelId}>` : '';
  const statePart   = panel.messageId ? '💬' : 'Message non configuré';
  const messageLine = channelPart ? `${channelPart} › ${statePart}` : statePart;


  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## Paramètres des tickets'),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId('tp_advanced')
          .setEmoji('🔧')
          .setStyle(ButtonStyle.Secondary),
      ),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**Message**\n${messageLine}`),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tp_msg_pick').setLabel('Choisir le message du panel').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tp_msg_send').setLabel('Envoyer un message automatique').setStyle(ButtonStyle.Secondary),
    ),
  );

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**Type**'));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tp_type_button').setLabel('Boutons').setStyle(isSelect ? ButtonStyle.Secondary : ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('tp_type_select').setLabel('Sélecteur').setStyle(isSelect ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );

  const claimHeader = claimMode === 'autoclaim' ? '**Claim**\nAutoclaim' : '**Claim**';
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(claimHeader));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tp_claim_off').setLabel('Désactivé').setStyle(claimMode === 'off' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tp_claim_lock').setLabel('Lock : autres staff muets').setStyle(claimMode === 'lock' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tp_claim_cache').setLabel('Cache : autres staff exclus').setStyle(claimMode === 'cache' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );

  const requiredRoleSelect = new RoleSelectMenuBuilder()
    .setCustomId('tp_required_roles')
    .setPlaceholder('Fais un choix')
    .setMinValues(0)
    .setMaxValues(10);

  const blockedRoleSelect = new RoleSelectMenuBuilder()
    .setCustomId('tp_blocked_roles')
    .setPlaceholder('Fais un choix')
    .setMinValues(0)
    .setMaxValues(10);

  try {
    const isValidRole = id => guild?.roles?.cache?.has?.(id) ?? false;

    const reqIds = _parseJsonArray(panel.requiredRoles).filter(isValidRole).slice(0, 10);
    if (reqIds.length && typeof requiredRoleSelect.setDefaultValues === 'function') {
      requiredRoleSelect.setDefaultValues(reqIds);
    }
    const blkIds = _parseJsonArray(panel.blockedRoles).filter(isValidRole).slice(0, 10);
    if (blkIds.length && typeof blockedRoleSelect.setDefaultValues === 'function') {
      blockedRoleSelect.setDefaultValues(blkIds);
    }
  } catch {}

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**Rôles requis**'));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(requiredRoleSelect));

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**Rôles interdits**'));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(blockedRoleSelect));

  const optionMenu = new StringSelectMenuBuilder()
    .setCustomId('tp_manage_options')
    .setPlaceholder('Gérer les options')
    .addOptions(_buildOptionMenuChoices(options));

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**Options**'));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(optionMenu));


  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tp_validate').setLabel('Valider').setEmoji('').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('tp_add_panel').setLabel('Ajouter un panel').setEmoji('➕').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('tp_delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('tp_back').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
    ),
  );
}

function _appendAdvancedV2(container, panel) {
  const fmtDelay = s => (s ? _secondsToHuman(s) || `${s}s` : 'Désactivée');

  const addSeparator = () => {
    try {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    } catch {}
  };

  const addSettingSection = (title, subtitle, btnId, btnLabel, btnStyle = ButtonStyle.Secondary, btnEmoji = null) => {
    const accessory = new ButtonBuilder().setCustomId(btnId).setStyle(btnStyle);
    if (btnLabel) accessory.setLabel(String(btnLabel).slice(0, 80));
    if (btnEmoji) accessory.setEmoji(btnEmoji);
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`**${title}**\n${subtitle}`),
        )
        .setButtonAccessory(accessory),
    );
  };

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Paramètres avancés'),
    new TextDisplayBuilder().setContent(`Panel · <#${panel.channelId}>`),
  );

  addSeparator();

  const parsed   = _safeJsonParse(panel.embedJson) || {};
  const embTitle = String(parsed.title       || 'Tickets').slice(0, 80);
  const embDesc  = String(parsed.description || 'Utilisez ce menu pour créer un ticket et contacter le staff').slice(0, 120);

  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**Message du panel**\n${embTitle}\n${embDesc}`),
      )
      .setButtonAccessory(
        new ButtonBuilder().setCustomId('tp_msg_pick').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      ),
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tp_msg_send').setLabel('Envoyer le panel').setStyle(ButtonStyle.Secondary),
    ),
  );

  const sentState = panel.messageId ? 'Message envoyé' : 'Message non envoyé';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**Salon du panel**\n<#${panel.channelId}> · ${sentState}`),
  );

  addSeparator();

  const maxTickets      = Number(panel.maxOpenPerUser ?? 1);
  const maxTicketsLabel = maxTickets === 0 ? 'Illimité' : String(maxTickets);

  addSettingSection(
    'Max tickets',
    'Nombre de tickets ouverts simultanés par membre.',
    'tp_adv_max',
    maxTicketsLabel,
  );

  addSettingSection(
    'Suppression auto',
    'Délai avant suppression du salon fermé.',
    'tp_adv_autodelete',
    fmtDelay(panel.autoDeleteSeconds),
  );

  addSettingSection(
    'Fermeture inactive',
    'Fermer un ticket sans activité pendant la durée.',
    'tp_adv_inactive',
    fmtDelay(panel.inactiveCloseDelay),
  );

  const styleOf = on => (on ? ButtonStyle.Success : ButtonStyle.Secondary);

  const claimOn      = !!Number(panel.showClaimButton ?? 1);
  const closeOn      = !!Number(panel.showCloseButton ?? 1);
  const autoclaimOn  = panel.claimMode === 'autoclaim';
  const transcriptOn = !!panel.transcriptDm;
  const onLeaveOn    = !!Number(panel.closeOnLeave);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tp_adv_toggle_claim').setLabel('Claim').setStyle(styleOf(claimOn)),
      new ButtonBuilder().setCustomId('tp_adv_toggle_close').setLabel('Close').setStyle(styleOf(closeOn)),
      new ButtonBuilder().setCustomId('tp_adv_toggle_autoclaim').setLabel('Autoclaim').setStyle(styleOf(autoclaimOn)),
      new ButtonBuilder().setCustomId('tp_adv_toggle_transcript').setLabel('Transcript MP').setStyle(styleOf(transcriptOn)),
      new ButtonBuilder().setCustomId('tp_adv_toggle_closeonleave').setLabel('Auto leave').setStyle(styleOf(onLeaveOn)),
    ),
  );

  addSeparator();

  const logsValue = panel.logChannelId ? `<#${panel.logChannelId}>` : 'Aucun salon configuré';
  addSettingSection(
    'Salon de logs',
    logsValue,
    'tp_adv_logs',
    'Modifier',
  );

  const bypassIds   = _parseJsonArray(panel.bypassRoles);
  const bypassLabel = bypassIds.length
    ? bypassIds.slice(0, 6).map(id => `<@&${id}>`).join(' ')
    : 'Aucun rôle bypass';
  addSettingSection(
    'Rôles bypass',
    bypassLabel,
    'tp_adv_bypass',
    'Modifier',
  );

  if (panel.panelType === 'select') {
    const ph = panel.placeholder
      ? String(panel.placeholder).slice(0, 100)
      : 'Choisissez une catégorie...';
    addSettingSection(
      'Texte du menu',
      ph,
      'tp_adv_placeholder',
      null,
      ButtonStyle.Secondary,
      '✏️',
    );
  }

  addSeparator();

  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('**Quitter**\nRevenir au dashboard du panel.'),
      )
      .setButtonAccessory(
        new ButtonBuilder().setCustomId('tp_advanced_back').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      ),
  );
}


async function _openOptionConfig(client, message, optionId, forcePanelId = null, existingSent = null) {
  const guildId = message.guild.id;

  let option = optionId ? db.getTicketOption(optionId) : null;


  if (optionId && !option) {
    return embed.replyError(message, 'Option introuvable.');
  }

  const panelId = forcePanelId || option?.panelId;


  if (!panelId) {
    return embed.replyError(message, 'Aucun panel choisi. Sélectionnez un panel avec `+ticket settings`.');
  }

  const panel = db.getTicketPanel(panelId);
  if (!panel || panel.guildId !== guildId) {

    return embed.replyError(message, option
      ? 'Le panel lié à cette option est introuvable.'
      : 'Panel introuvable sur ce serveur.');
  }

  if (!option) {


    return embed.replyError(
      message,
      'Aucune option à éditer. Ouvrez `+ticket settings` puis "Ajouter une option".',
    );
  }

  const accentColor = _hexToInt(embed.getGuildColor(guildId));

  const buildState = () => {
    option = db.getTicketOption(option.id);
    if (!option) return null;

    return {
      payload: {
        embeds          : [_buildOptionConfigEmbed(guildId, option, panel)],
        components      : _buildOptionConfigRows(),
        allowedMentions : { repliedUser: false },
      },
      isV2: false,
    };
  };

  const state = buildState();
  if (!state) return embed.replyError(message, 'Option introuvable.');

  if (existingSent) {
    existingSent._activeCollector?.stop('replaced');
    await existingSent.edit({ components: [], embeds: [] }).catch(() => {});
  }

  const sent = await message.reply(state.payload).catch(() => null);
  if (!sent) return;

  embed.registerPrivateInteraction(sent, message.author.id, 900_000);

  const refreshMessage = async () => {
    const next = buildState();
    if (!next) return;
    await sent.edit(next.payload).catch(() => {});
  };

  const buildClosedPayload = (text, color) => ({
    embeds          : [embed.build(guildId, text, { color: color || '#ED4245', timestamp: false })],
    components      : [],
    allowedMentions : { repliedUser: false },
  });


  let busy = false;

  const collector = sent.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : 900_000,
    time   : 900_000,
  });
  sent._activeCollector = collector;

  const _selectMap = {
      edit_identity      : 'to_set_label',
      edit_category      : 'to_set_category',
      edit_logs          : 'to_set_logchannel',
      edit_staff_roles   : 'to_set_staffroles',
      edit_mention_roles : 'to_set_mentionroles',
      edit_open_message  : 'to_set_openmessage',
      edit_name_template : 'to_set_nametemplate',
  };


  const _buttonMap = {
      to_edit_label         : 'to_set_label',
      to_edit_emoji         : 'to_set_label',
      to_edit_description   : 'to_set_label',
      to_edit_name_template : 'to_set_nametemplate',
      to_edit_open_message  : 'to_set_openmessage',
  };

  collector.on('collect', async interaction => {
    option = db.getTicketOption(option.id);
    if (!option) return collector.stop();


    if (busy) {
      return interaction.reply({
        content: 'Une modification est déjà en cours.',
        flags  : MessageFlags.Ephemeral,
      }).catch(() => {});
    }


    if (interaction.isChannelSelectMenu?.() && interaction.customId === 'to_select_category') {
      const cid = interaction.values?.[0] || null;
      db.updateTicketOption(option.id, { categoryId: cid });
      await interaction.deferUpdate().catch(() => {});
      return refreshMessage();
    }

    if (interaction.isChannelSelectMenu?.() && interaction.customId === 'to_select_logchannel') {
      const cid = interaction.values?.[0] || null;
      db.updateTicketOption(option.id, { logChannelId: cid });
      await interaction.deferUpdate().catch(() => {});
      return refreshMessage();
    }

    if (interaction.isRoleSelectMenu?.() && interaction.customId === 'to_select_staff_roles') {
      const ids = (interaction.values || []).slice(0, 20);
      db.updateTicketOption(option.id, { staffRoles: JSON.stringify(ids) });
      await interaction.deferUpdate().catch(() => {});
      return refreshMessage();
    }

    if (interaction.isRoleSelectMenu?.() && interaction.customId === 'to_select_mention_roles') {
      const ids = (interaction.values || []).slice(0, 20);
      db.updateTicketOption(option.id, { mentionRoles: JSON.stringify(ids) });
      await interaction.deferUpdate().catch(() => {});
      return refreshMessage();
    }

    const action = interaction.isStringSelectMenu()
      ? (_selectMap[interaction.values[0]] ?? interaction.values[0])
      : (_buttonMap[interaction.customId] ?? interaction.customId);

    if (action === 'to_set_label') {
      const modal = _modal(`to_modal_label_${option.id}`, 'Nom / Emoji / Description', [
        _input('label', 'Nom affiché', TextInputStyle.Short, {
          value       : option.label || '',
          maxLength   : 80,
          placeholder : 'Support',
        }),
        _input('emoji', 'Emoji (optionnel)', TextInputStyle.Short, {
          value       : option.emoji || '',
          maxLength   : 32,
          required    : false,
          placeholder : '📩',
        }),
        _input('description', 'Description (optionnel)', TextInputStyle.Short, {
          value       : option.description || '',
          maxLength   : 100,
          required    : false,
          placeholder : 'Ouvrir un ticket de support',
        }),
      ]);

      busy = true;
      const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
      busy = false;
      if (!_shown) return;

      const modalSubmit = await _awaitOwnModal(interaction, `to_modal_label_${option.id}`);
      if (!modalSubmit) { await refreshMessage(); return; }

      busy = true;
      try {

      const label       = modalSubmit.fields.getTextInputValue('label').trim().slice(0, 80);
      const emoji       = modalSubmit.fields.getTextInputValue('emoji').trim().slice(0, 32) || null;
      const description = modalSubmit.fields.getTextInputValue('description').trim().slice(0, 100) || null;

      if (!label) {
        return modalSubmit.reply({
          embeds: [embed.build(guildId, 'Le nom ne peut pas être vide.', { color: '#ED4245' })],
          flags : MessageFlags.Ephemeral,
        }).catch(() => {});
      }

      db.updateTicketOption(option.id, { label, emoji, description });
      await modalSubmit.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
      } finally {
        busy = false;
      }
    }

    if (action === 'to_set_category') {
      const modal = _modal(`to_modal_category_${option.id}`, 'Catégorie Discord', [
        _input('category', 'ID de la catégorie', TextInputStyle.Short, {
          value       : option.categoryId || '',
          maxLength   : 20,
          placeholder : '123456789012345678',
        }),
      ]);

      busy = true;
      const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
      busy = false;
      if (!_shown) return;

      const modalSubmit = await _awaitOwnModal(interaction, `to_modal_category_${option.id}`);
      if (!modalSubmit) { await refreshMessage(); return; }

      busy = true;
      try {

      const raw = modalSubmit.fields.getTextInputValue('category').replace(/[<#>]/g, '').trim();
      const cat = message.guild.channels.cache.get(raw);

      if (!cat || cat.type !== ChannelType.GuildCategory) {
        return modalSubmit.reply({
          embeds: [embed.build(guildId, 'Catégorie introuvable ou invalide.', { color: '#ED4245' })],
          flags : MessageFlags.Ephemeral,
        }).catch(() => {});
      }


      const me = message.guild.members.me
        ?? await message.guild.members.fetchMe().catch(() => null);
      const botPermsInCategory = me ? cat.permissionsFor(me) : null;

      if (
        !botPermsInCategory?.has('ViewChannel') ||
        !botPermsInCategory?.has('ManageChannels') ||
        !botPermsInCategory?.has('SendMessages') ||
        !botPermsInCategory?.has('EmbedLinks')
      ) {
        return modalSubmit.reply({
          embeds: [embed.build(
            guildId,
            'Je n\'ai pas les permissions nécessaires dans cette catégorie : Voir le salon, Gérer les salons, Envoyer des messages, Intégrer des liens.',
            { color: '#ED4245' }
          )],
          flags : MessageFlags.Ephemeral,
        }).catch(() => {});
      }

      db.updateTicketOption(option.id, { categoryId: cat.id });
      await modalSubmit.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
      } finally {
        busy = false;
      }
    }

    if (action === 'to_set_staffroles') {
      const modal = _modal(`to_modal_staffroles_${option.id}`, 'Rôles staff', [
        _input('roles', 'IDs séparés par des virgules', TextInputStyle.Paragraph, {
          value       : _parseJsonArray(option.staffRoles).join(', '),
          maxLength   : 500,
          required    : false,
          placeholder : '123456789012345678, 987654321098765432',
        }),
      ]);

      busy = true;
      const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
      busy = false;
      if (!_shown) return;

      const modalSubmit = await _awaitOwnModal(interaction, `to_modal_staffroles_${option.id}`);
      if (!modalSubmit) { await refreshMessage(); return; }

      busy = true;
      try {

      const raw = modalSubmit.fields.getTextInputValue('roles').trim();
      const ids = raw ? _parseRoleIdsFromString(message.guild, raw) : [];
      db.updateTicketOption(option.id, { staffRoles: JSON.stringify(ids) });

      await modalSubmit.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
      } finally {
        busy = false;
      }
    }

    if (action === 'to_set_mentionroles') {
      const modal = _modal(`to_modal_mentionroles_${option.id}`, 'Rôles à mentionner', [
        _input('roles', 'IDs séparés par des virgules', TextInputStyle.Paragraph, {
          value       : _parseJsonArray(option.mentionRoles).join(', '),
          maxLength   : 500,
          required    : false,
          placeholder : '123456789012345678',
        }),
      ]);

      busy = true;
      const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
      busy = false;
      if (!_shown) return;

      const modalSubmit = await _awaitOwnModal(interaction, `to_modal_mentionroles_${option.id}`);
      if (!modalSubmit) { await refreshMessage(); return; }

      busy = true;
      try {

      const raw = modalSubmit.fields.getTextInputValue('roles').trim();
      const ids = raw ? _parseRoleIdsFromString(message.guild, raw) : [];
      db.updateTicketOption(option.id, { mentionRoles: JSON.stringify(ids) });

      await modalSubmit.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
      } finally {
        busy = false;
      }
    }

    if (action === 'to_set_logchannel') {
      const modal = _modal(`to_modal_logchannel_${option.id}`, 'Salon de logs', [
        _input('channel', 'ID du salon (vide = désactivé)', TextInputStyle.Short, {
          value       : option.logChannelId || '',
          maxLength   : 20,
          required    : false,
          placeholder : '123456789012345678',
        }),
      ]);

      busy = true;
      const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
      busy = false;
      if (!_shown) return;

      const modalSubmit = await _awaitOwnModal(interaction, `to_modal_logchannel_${option.id}`);
      if (!modalSubmit) { await refreshMessage(); return; }

      busy = true;
      try {

      const raw = modalSubmit.fields.getTextInputValue('channel').trim();
      let channelId = null;

      if (raw) {
        const ch = message.guild.channels.cache.get(raw.replace(/[<#>]/g, ''));
        if (!ch || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)) {
          return modalSubmit.reply({
            embeds: [embed.build(guildId, 'Salon introuvable ou invalide.', { color: '#ED4245' })],
            flags : MessageFlags.Ephemeral,
          }).catch(() => {});
        }
        channelId = ch.id;
      }

      db.updateTicketOption(option.id, { logChannelId: channelId });
      await modalSubmit.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
      } finally {
        busy = false;
      }
    }

    if (action === 'to_set_openmessage') {
      const modal = _modal(`to_modal_openmessage_${option.id}`, 'Message d’ouverture', [
        _input('message', 'Message affiché à l’ouverture', TextInputStyle.Paragraph, {
          value       : option.openMessage || '',
          maxLength   : 2000,
          required    : false,
          placeholder : 'Bienvenue, un membre du staff vous répondra bientôt.',
        }),
      ]);

      busy = true;
      const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
      busy = false;
      if (!_shown) return;

      const modalSubmit = await _awaitOwnModal(interaction, `to_modal_openmessage_${option.id}`);
      if (!modalSubmit) { await refreshMessage(); return; }

      busy = true;
      try {

      const val = modalSubmit.fields.getTextInputValue('message').trim();
      db.updateTicketOption(option.id, { openMessage: val || null });

      await modalSubmit.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
      } finally {
        busy = false;
      }
    }

    if (action === 'to_set_nametemplate') {
      const modal = _modal(`to_modal_nametemplate_${option.id}`, 'Nom du salon ticket', [
        _input('template', 'Template ({username}, {number}, {option})', TextInputStyle.Short, {
          value       : option.nameTemplate || '',
          maxLength   : 90,
          required    : false,
          placeholder : 'ticket-{number}',
        }),
      ]);

      busy = true;
      const _shown = await interaction.showModal(modal).then(() => true).catch(() => false);
      busy = false;
      if (!_shown) return;

      const modalSubmit = await _awaitOwnModal(interaction, `to_modal_nametemplate_${option.id}`);
      if (!modalSubmit) { await refreshMessage(); return; }

      busy = true;
      try {

      const raw  = modalSubmit.fields.getTextInputValue('template').trim();
      const safe = raw.toLowerCase().replace(/[^a-z0-9-_{} ]/g, '').trim().slice(0, 90);
      db.updateTicketOption(option.id, { nameTemplate: safe || null });

      await modalSubmit.deferUpdate().catch(() => {});
      await refreshMessage();
      return;
      } finally {
        busy = false;
      }
    }

    if (action === 'to_delete') {
      const removedId = option.id;
      const labelTxt  = option.label ? `\`${option.label}\`` : '`Sans nom`';
      const cat       = option.categoryId ? `<#${option.categoryId}>` : '`Aucune`';
      const desc = `Supprimer l'option \`#${removedId}\` ?\n` +
        `Nom : ${labelTxt} - Catégorie : ${cat}`;

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('to_confirm_delete')
          .setLabel('Confirmer la suppression')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('to_cancel_delete')
          .setLabel('Annuler')
          .setStyle(ButtonStyle.Secondary),
      );

      let confirmReply;
      try {
        confirmReply = await interaction.reply({
          embeds       : [embed.build(guildId, desc, { timestamp: false })],
          components   : [confirmRow],
          flags        : MessageFlags.Ephemeral,
          withResponse : true,
        });
      } catch { return; }

      const confirmMsg = confirmReply?.resource?.message ?? null;
      if (!confirmMsg) return;

      let confirm;
      try {
        confirm = await confirmMsg.awaitMessageComponent({
          componentType : ComponentType.Button,
          filter        : i => i.user.id === message.author.id,
          time          : TIMEOUTS.CONFIRM_TIME_MS,
        });
      } catch {
        await interaction.editReply({
          embeds     : [embed.build(guildId, 'Suppression annulée (timeout).', { timestamp: false })],
          components : [],
        }).catch(() => {});
        return;
      }

      if (confirm.customId !== 'to_confirm_delete') {
        await confirm.update({
          embeds     : [embed.build(guildId, 'Suppression annulée.', { timestamp: false })],
          components : [],
        }).catch(() => {});
        return;
      }

      db.deleteTicketOption(option.id);

      await confirm.update({
        embeds     : [embed.build(guildId, `Option \`#${removedId}\` supprimée.`, { timestamp: false })],
        components : [],
      }).catch(() => {});

      collector.stop('deleted');
      return sent.edit(buildClosedPayload(`Option \`#${removedId}\` supprimée.`, '#ED4245')).catch(() => {});
    }

    if (action === 'to_back') {
      collector.stop('navigate');
      await interaction.deferUpdate().catch(() => {});
      await sent.edit({ components: [], embeds: [] }).catch(() => {});
      return _openPanelConfig(client, message, panel.id);
    }

    return interaction.deferUpdate().catch(() => {});
  });

  collector.on('end', (_, reason) => {
    busy = false;
    embed.clearPrivateInteraction(sent);
    if (['deleted', 'navigate', 'replaced'].includes(reason)) return;
    sent.edit(buildClosedPayload('Configuration expirée.')).catch(() => {});
  });
}


function _buildOptionConfigEmbed(guildId, option, panel) {
  const staffRoles   = _parseJsonArray(option.staffRoles);
  const mentionRoles = _parseJsonArray(option.mentionRoles);

  return embed.build(guildId, null, {
    title  : `Option \`#${option.id}\` - Panel \`#${panel.id}\``,
    fields : [
      { name: 'Texte',        value: `\`${String(option.label || 'Non défini').slice(0, 80)}\``,                                              inline: true },
      { name: 'Emoji',        value: option.emoji || 'Aucun',                                                                                inline: true },
      { name: 'Description',  value: option.description ? `\`${String(option.description).slice(0, 60)}\`` : 'Aucune',                    inline: true },
      { name: 'Catégorie',    value: option.categoryId   ? `<#${option.categoryId}>`                                  : 'Aucune',           inline: true },
      { name: 'Logs',         value: option.logChannelId ? `<#${option.logChannelId}>`                                : 'Aucun',            inline: true },
      { name: 'Staff',        value: staffRoles.length   ? staffRoles.map(id => `<@&${id}>`).join(', ').slice(0, 200)  : 'Aucun',           inline: true },
      { name: 'Mentions',     value: mentionRoles.length ? mentionRoles.map(id => `<@&${id}>`).join(', ').slice(0, 200) : 'Aucune',         inline: true },
      { name: 'Ouverture',    value: option.openMessage  ? 'Défini'                                                    : 'Non défini',      inline: true },
      { name: 'Nom du salon', value: option.nameTemplate ? `\`${option.nameTemplate}\``                               : '`ticket-{number}`', inline: true },
    ],
    timestamp: false,
  });
}


function _buildOptionConfigRows() {
  const configMenu = new StringSelectMenuBuilder()
    .setCustomId('to_config_menu')
    .setPlaceholder('Configurer l\'option...')
    .addOptions([
      { label: 'Texte, emoji et description', value: 'edit_identity',      description: 'Modifier le nom, l\'emoji et la description', emoji: '✏️' },
      { label: 'Catégorie de création',       value: 'edit_category',      description: 'Définir la catégorie Discord',                emoji: '📁' },
      { label: 'Salon de logs',               value: 'edit_logs',          description: 'Définir le salon de logs de l\'option',       emoji: '📋' },
      { label: 'Rôles staff',                 value: 'edit_staff_roles',   description: 'Définir les rôles staff pour cette option',  emoji: '🛡️' },
      { label: 'Rôles à mentionner',          value: 'edit_mention_roles', description: 'Définir les rôles à mentionner à l\'ouverture', emoji: '🔔' },
      { label: 'Message d\'ouverture',        value: 'edit_open_message',  description: 'Définir le message affiché à l\'ouverture',      emoji: '💬' },
      { label: 'Nom du salon',                value: 'edit_name_template', description: 'Définir le template du nom du salon ticket', emoji: '🏷️' },
    ]);

  return [
    new ActionRowBuilder().addComponents(configMenu),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('to_back').setLabel('Retour au panel').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('to_delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    ),
  ];
}


function _buildOptionV2Payload(option, panel, guild, accentColor) {
  if (!V2_AVAILABLE) return null;
  try {
    const container = new ContainerBuilder().setAccentColor(accentColor);
    _appendOptionV2(container, option, panel, guild);
    return {
      flags           : COMPONENTS_V2_FLAG,
      components      : [container],
      allowedMentions : { repliedUser: false },
    };
  } catch {
    return null;
  }
}

function _appendOptionV2(container, option, panel, guild) {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Paramètres d\'option'),
  );

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**Catégorie**'));

  const catSelect = new ChannelSelectMenuBuilder()
    .setCustomId('to_select_category')
    .setPlaceholder('Choisir une catégorie')
    .setChannelTypes(ChannelType.GuildCategory)
    .setMinValues(0)
    .setMaxValues(1);

  try {
    if (option.categoryId
        && guild?.channels?.cache?.has?.(option.categoryId)
        && typeof catSelect.setDefaultChannels === 'function') {
      catSelect.setDefaultChannels([option.categoryId]);
    }
  } catch {}

  container.addActionRowComponents(new ActionRowBuilder().addComponents(catSelect));

  const emojiVal = option.emoji ? String(option.emoji) : 'Aucun';
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Emoji**\n${emojiVal}`))
      .setButtonAccessory(
        new ButtonBuilder().setCustomId('to_edit_emoji').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      ),
  );

  const labelVal = String(option.label || 'Non défini').slice(0, 80);
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Texte**\n${labelVal}`))
      .setButtonAccessory(
        new ButtonBuilder().setCustomId('to_edit_label').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      ),
  );

  const descVal = option.description ? String(option.description).slice(0, 200) : 'Aucune';
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Description (Sélecteur seulement)**\n${descVal}`))
      .setButtonAccessory(
        new ButtonBuilder().setCustomId('to_edit_description').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      ),
  );

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**Salon de logs**'));

  const logSelect = new ChannelSelectMenuBuilder()
    .setCustomId('to_select_logchannel')
    .setPlaceholder('Choisir un salon de logs')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);

  try {
    if (option.logChannelId
        && guild?.channels?.cache?.has?.(option.logChannelId)
        && typeof logSelect.setDefaultChannels === 'function') {
      logSelect.setDefaultChannels([option.logChannelId]);
    }
  } catch {}

  container.addActionRowComponents(new ActionRowBuilder().addComponents(logSelect));

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**Rôles mentionnés**'));

  const mentionSelect = new RoleSelectMenuBuilder()
    .setCustomId('to_select_mention_roles')
    .setPlaceholder('Choisir les rôles à mentionner')
    .setMinValues(0)
    .setMaxValues(20);

  try {
    const isValidRole = id => guild?.roles?.cache?.has?.(id) ?? false;
    const ids = _parseJsonArray(option.mentionRoles).filter(isValidRole).slice(0, 20);
    if (ids.length && typeof mentionSelect.setDefaultValues === 'function') {
      mentionSelect.setDefaultValues(ids);
    }
  } catch {}

  container.addActionRowComponents(new ActionRowBuilder().addComponents(mentionSelect));

  const nameVal = option.nameTemplate ? `\`${String(option.nameTemplate).slice(0, 80)}\`` : '`ticket-{number}`';
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Nom du salon**\n${nameVal}`))
      .setButtonAccessory(
        new ButtonBuilder().setCustomId('to_edit_name_template').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      ),
  );

  const openVal = option.openMessage ? String(option.openMessage).slice(0, 300) : 'Non défini';
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Message d'ouverture de ticket**\n${openVal}`))
      .setButtonAccessory(
        new ButtonBuilder().setCustomId('to_edit_open_message').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      ),
  );

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**Rôles ayant accès**'));

  const staffSelect = new RoleSelectMenuBuilder()
    .setCustomId('to_select_staff_roles')
    .setPlaceholder('Choisir les rôles staff')
    .setMinValues(0)
    .setMaxValues(20);

  try {
    const isValidRole = id => guild?.roles?.cache?.has?.(id) ?? false;
    const ids = _parseJsonArray(option.staffRoles).filter(isValidRole).slice(0, 20);
    if (ids.length && typeof staffSelect.setDefaultValues === 'function') {
      staffSelect.setDefaultValues(ids);
    }
  } catch {}

  container.addActionRowComponents(new ActionRowBuilder().addComponents(staffSelect));

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('to_back').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('to_delete').setLabel('Supprimer l\'option').setEmoji('').setStyle(ButtonStyle.Danger),
    ),
  );
}


async function _handleNew(message, args) {
  const guildId = message.guild.id;
  const channel = _resolveTextChannel(message, args[0]);
  const type    = (args[1] || 'button').toLowerCase();

  if (!channel) return embed.replyError(message, 'Salon introuvable.\nExemple : `ticket new #tickets button`');
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return embed.replyError(message, 'Le salon doit être un salon textuel.');
  if (!['button', 'select'].includes(type)) return embed.replyError(message, 'Type invalide. Valeurs : `button` ou `select`.');

  const panelId = db.createTicketPanel(guildId, channel.id, type);

  return embed.reply(
    message,
    `Panel \`${panelId}\` créé dans <#${channel.id}>.\nConfigurez-le avec \`ticket panel ${panelId}\`.`
  );
}

async function _handleList(message) {
  const guildId = message.guild.id;
  const panels  = db.getTicketPanels(guildId);

  if (!panels.length) return embed.replyError(message, 'Aucun panel ticket.\nCréez-en un avec `ticket new #salon button`.');

  const lines = panels.map(p => {
    const opts = db.getTicketOptions(p.id);
    return `\`#${p.id}\` · <#${p.channelId}> · \`${p.panelType}\` · ${opts.length} option(s)`;
  });

  return embed.reply(message, lines.join('\n').slice(0, 4000), {
    title     : 'Panels tickets',
    timestamp : false,
  });
}

async function _handleSend(client, message, panelId, sendArgs = []) {
  const guildId = message.guild.id;
  const panel   = db.getTicketPanel(panelId);

  if (!panel || panel.guildId !== guildId) return embed.replyError(message, 'Panel introuvable.');

  const options = db.getTicketOptions(panelId);
  if (!options.length) return embed.replyError(message, 'Ce panel n\'a aucune option configurée.');

  let channelRef = null;
  let targetArg  = null;

  for (const a of sendArgs) {
    if (/^<#\d+>$/.test(a) || /^\d{17,20}$/.test(a)) {
      if (!targetArg && !channelRef) {
        const resolved = message.guild.channels.cache.get(a.replace(/[<#>]/g, ''));
        if (resolved && (resolved.type === ChannelType.GuildText || resolved.type === ChannelType.GuildAnnouncement)) {
          channelRef = resolved;
        } else {
          targetArg = a;
        }
      } else {
        targetArg = a;
      }
    } else if (a.toLowerCase() === 'last') {
      targetArg = 'last';
    } else {
      targetArg = a;
    }
  }

  const channel = channelRef ?? message.guild.channels.cache.get(panel.channelId);
  if (!channel) return embed.replyError(message, 'Le salon du panel est introuvable.');

  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return embed.replyError(message, 'Le salon cible n\'est pas un salon textuel.');
  }

  if (!targetArg) {
    const payload = _buildPanelPayload(guildId, panel, options);
    const sent    = await channel.send(payload);
    db.updateTicketPanel(panelId, { channelId: channel.id, messageId: sent.id });
    return embed.reply(message, `Panel envoyé dans <#${channel.id}>.`);
  }

  let targetMsg = null;

  if (targetArg === 'last') {
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    if (recent) {
      targetMsg = recent.find(m => m.author.id === client.user.id);
    }
    if (!targetMsg) {
      return embed.replyError(message, 'Aucun message du bot trouve dans les 20 derniers messages de ce salon.');
    }
  } else {
    const msgId = targetArg.replace(/[<>]/g, '');
    targetMsg = await channel.messages.fetch(msgId).catch(() => null);
    if (!targetMsg) {
      return embed.replyError(message, 'Message introuvable dans ce salon.');
    }
  }

  if (targetMsg.author.id !== client.user.id) {
    return embed.replyError(message, 'Je peux seulement attacher les boutons a un message envoye par le bot.');
  }

  const { components } = _buildPanelPayload(guildId, panel, options);

  try {
    await targetMsg.edit({ components });
  } catch (err) {
    return embed.replyError(message, `Impossible de modifier le message : ${err.message}`);
  }

  db.updateTicketPanel(panelId, { channelId: channel.id, messageId: targetMsg.id });
  return embed.reply(message, `Panel attache au message \`${targetMsg.id}\` dans <#${channel.id}>.`);
}

async function _handlePreview(client, message, panelId) {
  const guildId = message.guild.id;
  const panel   = db.getTicketPanel(panelId);

  if (!panel || panel.guildId !== guildId) return embed.replyError(message, 'Panel introuvable.');

  const options = db.getTicketOptions(panelId);
  if (!options.length) return embed.replyError(message, 'Ce panel n\'a aucune option configurée.');

  const payload = _buildPanelPayload(guildId, panel, options);

  const disabledComponents = payload.components.map(row => {
    const json = row.toJSON();
    json.components = json.components.map(c => ({ ...c, disabled: true }));
    return ActionRowBuilder.from(json);
  });

  const sent = await message.channel.send({
    content    : '**Aperçu du panel** (temporaire, 60s)',
    embeds     : payload.embeds,
    components : disabledComponents,
  }).catch(() => null);

  if (!sent) return;

  setTimeout(() => {
    sent.delete().catch(() => {});
  }, 60_000);
}

async function _handleDeleteOne(message, panelId) {
  const guildId = message.guild.id;
  const panel = db.getTicketPanel(panelId);

  if (!panel || panel.guildId !== guildId) {
    return embed.replyError(message, 'Panel introuvable sur ce serveur.');
  }

  const opts = db.getTicketOptions(panelId);
  const chan = panel.channelId ? `<#${panel.channelId}>` : '`Non defini`';
  const type = panel.panelType || 'select';
  const desc = `Supprimer le panel \`#${panelId}\` ?\n` +
    `Salon : ${chan} - Type : \`${type}\` - Options : \`${opts?.length ?? 0}\``;

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:ticket:confirmdelete')
      .setLabel('Confirmer la suppression')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('local:ticket:canceldelete')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary),
  );

  const confirmMsg = await message.reply({
    embeds          : [embed.build(guildId, desc, { timestamp: false })],
    components      : [confirmRow],
    allowedMentions : { repliedUser: false, parse: [] },
  }).catch(() => null);

  if (!confirmMsg) return;

  embed.registerPrivateInteraction(confirmMsg, message.author.id, TIMEOUTS.CONFIRM_TIME_MS);

  try {
    const interaction = await confirmMsg.awaitMessageComponent({
      componentType : ComponentType.Button,
      filter        : i => i.user.id === message.author.id,
      time          : TIMEOUTS.CONFIRM_TIME_MS,
    });

    embed.clearPrivateInteraction(confirmMsg);

    if (interaction.customId === 'local:ticket:confirmdelete') {
      db.deleteTicketPanel(panelId);

      const remaining = db.getTicketPanels(guildId);
      if (!remaining.length && typeof db.resetTicketPanelSequence === 'function') {
        db.resetTicketPanelSequence();
        if (typeof db.resetTicketOptionSequence === 'function') db.resetTicketOptionSequence();
      }

      await interaction.update({
        embeds     : [embed.build(guildId, `Panel \`#${panelId}\` supprimé.`, { timestamp: false })],
        components : [],
      }).catch(() => {});
    } else {
      await interaction.update({
        embeds     : [embed.build(guildId, 'Suppression annulée.', { timestamp: false })],
        components : [],
      }).catch(() => {});
    }
  } catch {
    embed.clearPrivateInteraction(confirmMsg);
    await confirmMsg.edit({ components: [] }).catch(() => {});
  }
}

async function _handleDeleteAll(message) {
  const guildId = message.guild.id;
  const panels = db.getTicketPanels(guildId);

  if (!panels.length) {
    return embed.replyError(message, 'Aucun panel à supprimer.');
  }

  for (const panel of panels) {
    db.deleteTicketPanel(panel.id);
  }

  if (typeof db.resetTicketPanelSequence === 'function') {
    db.resetTicketPanelSequence();
    if (typeof db.resetTicketOptionSequence === 'function') db.resetTicketOptionSequence();
  }

  return embed.reply(
    message,
    `Tous les panels du serveur ont été supprimés (\`${panels.length}\`). Le compteur a été réinitialisé.`
  );
}


function _buildPanelPayload(guildId, panel, options) {
  const panelEmbed = _buildPanelEmbed(guildId, panel);
  const components = [];

  if (panel.panelType === 'select' && options.length >= 2) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`ticket_select_${panel.id}`)
      .setPlaceholder((panel.placeholder || 'Fais un choix').slice(0, 150))
      .addOptions(options.slice(0, 25).map(opt => ({
        label       : String(opt.label || 'Option').slice(0, 100),
        description : String(opt.description || 'Ouvrir un ticket').slice(0, 100),
        value       : String(opt.id),
        ...(opt.emoji ? { emoji: opt.emoji } : {}),
      })));

    components.push(new ActionRowBuilder().addComponents(select));
  } else {
    for (let i = 0; i < Math.min(options.length, 25); i += 5) {
      const btns = options.slice(i, i + 5).map((opt, idx) => {
        const btn = new ButtonBuilder()
          .setCustomId(`ticket_open_${panel.id}_${opt.id}`)
          .setLabel(String(opt.label || 'Open').slice(0, 80))
          .setStyle(_buttonStyleFromIndex(idx));

        if (opt.emoji) {
          try { btn.setEmoji(opt.emoji); } catch {}
        }

        return btn;
      });

      if (btns.length) components.push(new ActionRowBuilder().addComponents(btns));
    }
  }

  return { embeds: [panelEmbed], components };
}

function _buildPanelEmbed(guildId, panel) {
  const parsed = _safeJsonParse(panel.embedJson);

  if (!parsed || typeof parsed !== 'object') {
    return embed.build(guildId, 'Utilisez ce menu pour créer un ticket et contacter le staff', {
      title     : 'Tickets',
      timestamp : false,
    });
  }


  const guildColor    = (() => {
    try { return embed.getGuildColor(guildId); } catch { return null; }
  })();
  const resolvedColor = parsed.color || guildColor || '#2B2D31';

  const e = new EmbedBuilder()
    .setColor(resolvedColor)
    .setTitle(parsed.title ? String(parsed.title).slice(0, 256) : 'Tickets')
    .setDescription(parsed.description ? String(parsed.description).slice(0, 4096) : 'Utilisez ce menu pour créer un ticket et contacter le staff');

  if (parsed.footer)    e.setFooter({ text: String(parsed.footer).slice(0, 2048) });
  if (parsed.image)     e.setImage(String(parsed.image));
  if (parsed.thumbnail) e.setThumbnail(String(parsed.thumbnail));

  return e;
}


function _makeNonce() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function _modal(customId, title, inputs) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45));
  modal.addComponents(inputs.map(i => new ActionRowBuilder().addComponents(i)));
  return modal;
}

function _input(customId, label, style, { value, maxLength, required = true, placeholder, minLength } = {}) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 45))
    .setStyle(style)
    .setRequired(required);

  if (placeholder) input.setPlaceholder(placeholder.slice(0, 100));
  if (value != null && value !== '') input.setValue(String(value).slice(0, maxLength || 4000));
  if (maxLength) input.setMaxLength(maxLength);
  if (minLength) input.setMinLength(minLength);

  return input;
}

async function _awaitOwnModal(interaction, customId) {
  try {
    return await interaction.awaitModalSubmit({
      filter : i => i.customId === customId && i.user.id === interaction.user.id,
      time   : 5 * 60 * 1000,
    });
  } catch {
    return null;
  }
}

function _resolveTextChannel(message, raw) {
  return message.mentions.channels.first()
    ?? (raw ? message.guild.channels.cache.get(String(raw).replace(/[<#>]/g, '')) : null);
}

function _parseRoleIdsFromString(guild, raw) {
  return raw
    .split(/[\s,]+/)
    .map(s => s.replace(/[<@&>]/g, '').trim())
    .filter(id => id && guild.roles.cache.has(id));
}

function _parseRoleList(guild, raw) {
  const MAX_ROLES = 4;
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);

  if (parts.length > MAX_ROLES) {
    return { ids: [], error: `Maximum ${MAX_ROLES} roles autorises.` };
  }

  const ids = [];

  for (const part of parts) {
    const clean = part.replace(/[<@&>]/g, '').trim();

    if (!clean) continue;

    if (/^\d{17,20}$/.test(clean)) {
      const role = guild.roles.cache.get(clean);

      if (!role) {
        return { ids: [], error: `Role introuvable : \`${part}\`` };
      }

      if (role.id === guild.id) {
        return { ids: [], error: 'Le role @everyone ne peut pas etre utilise.' };
      }

      if (!ids.includes(role.id)) ids.push(role.id);
      continue;
    }

    const matches = guild.roles.cache.filter(
      r => r.name === clean && r.id !== guild.id
    );

    if (matches.size === 0) {
      return { ids: [], error: `Role introuvable : \`${part}\`` };
    }

    if (matches.size > 1) {
      return { ids: [], error: `Nom ambigu (${matches.size} roles) : \`${part}\`. Utilisez l'ID.` };
    }

    const role = matches.first();
    if (!ids.includes(role.id)) ids.push(role.id);
  }

  return { ids, error: null };
}

function _safeJsonParse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function _normalizeHexColor(input) {
  const value = String(input || '').trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(value)) return value.startsWith('#') ? value : `#${value}`;
  return null;
}

function _validateHttpUrl(input) {
  try {
    const url = new URL(String(input));
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.toString() : null;
  } catch {
    return null;
  }
}

function _parseDuration(input) {
  const match = String(input || '').trim().toLowerCase().match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) return null;
  const num = Number.parseInt(match[1], 10);
  return { s: num, m: num * 60, h: num * 3600, d: num * 86400, w: num * 604800 }[match[2]] ?? null;
}

function _secondsToHuman(seconds) {
  if (!seconds) return '';
  if (seconds % 604800 === 0) return `${seconds / 604800}w`;
  if (seconds % 86400  === 0) return `${seconds / 86400}d`;
  if (seconds % 3600   === 0) return `${seconds / 3600}h`;
  if (seconds % 60     === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function _claimModeLabel(mode) {
  return {
    off       : 'Désactivé',
    lock      : 'Empêche parler',
    cache     : 'Empêche voir',
    autoclaim : 'Autoclaim',
  }[mode] ?? mode;
}

function _buttonStyleFromIndex(index) {
  return [
    ButtonStyle.Primary,
    ButtonStyle.Secondary,
    ButtonStyle.Success,
    ButtonStyle.Danger,
    ButtonStyle.Secondary,
  ][index] ?? ButtonStyle.Secondary;
}

function _sendHelp(message) {
  return embed.reply(message, null, {
    title  : 'Gestion des tickets',
    fields : [{
      name  : 'Commandes',
      value : [
        '`ticket settings` -ouvrir la configuration des tickets',
        '`ticket new #salon button` -créer un panel (boutons)',
        '`ticket new #salon select` -créer un panel (menu déroulant)',
        '`ticket list` -voir tous les panels du serveur',
        '`ticket panel <id>` -ouvrir le configurateur du panel',
        '`ticket option <id>` -configurer une option existante',
        '`ticket send <id>` -envoyer le panel dans son salon',
        '`ticket preview <id>` -prévisualiser le panel',
        '`ticket delete <id>` -supprimer un panel',
        '`ticket delete all` -supprimer tous les panels du serveur',
        '`ticket logchannel #salon` -définir le salon de log global',
        '`ticket rating #salon` -définir le salon des évaluations',
        '`ticket rating on/off` -activer/désactiver les évaluations',
        '`ticketstats` -voir les statistiques des tickets',
      ].join('\n'),
    }],
    timestamp: false,
  });
}

