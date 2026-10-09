'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COOLDOWN_MS = 60_000;
const _cooldown   = new Map();

const REASON_MIN     = 3;
const REASON_MAX     = 500;
const MAX_REASONS    = 20;
const MAX_PING_ROLES = 5;
const PANEL_IDLE     = 120_000;
const PANEL_TIMEOUT  = 300_000;
const MODAL_TIMEOUT  = 120_000;
const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);


exports.help = {
  name        : 'report',
  description : 'Signaler un membre ou un message au staff.',
  usage       : 'report <@membre|reply> [raison] | report settings',
  defaultPermission: 'everyone',
};

exports.run = async (client, message, args) => {
  if (!message.guild) return;

  const guildId = message.guild.id;
  const config  = db.getGuildConfig(guildId) || {};

  const sub = args[0]?.toLowerCase();

  if (sub === 'settings' || sub === 'on' || sub === 'off' || sub === 'channel') {
    if (!perms.check(message, 'reportconfig')) return;
    return _handleSettings(client, message, guildId, args, config);
  }

  return _handleReport(client, message, guildId, args, config);
};


async function _handleReport(client, message, guildId, args, config) {
  const deleteCmd   = Boolean(config?.autoDeleteInfoCmds ?? config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteInfoReplies ?? config?.autoDeleteModReplies);
  const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  if (!Number(config?.reportEnabled)) {
    return _sendErr(message, 'Le système de reports est désactivé sur ce serveur.', deleteReply, deleteDelay);
  }
  if (!config?.reportChannel) {
    return _sendErr(message, 'Aucun salon de reports n\'est configuré.', deleteReply, deleteDelay);
  }

  const reportChannel = message.guild.channels.cache.get(config.reportChannel);
  if (!reportChannel?.isTextBased()) {
    return _sendErr(message, 'Le salon de reports configure est introuvable ou invalide.', deleteReply, deleteDelay);
  }

  let targetMember     = null;
  let targetUser       = null;
  let targetMessage    = null;
  let consumedTokens   = 0;

  if (message.reference?.messageId) {
    targetMessage = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);

    if (!targetMessage) {
      return _sendErr(message, 'Impossible de retrouver le message a signaler.', deleteReply, deleteDelay);
    }
    targetUser   = targetMessage.author;
    targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
  }
  else if (args[0]) {
    const mention = message.mentions.members?.first() || message.mentions.users?.first();
    if (mention) {
      targetUser     = mention.user ?? mention;
      targetMember   = mention.user ? mention : await message.guild.members.fetch(targetUser.id).catch(() => null);
      consumedTokens = 1;
    } else {
      const clean = String(args[0]).replace(/[<@!>]/g, '');
      if (/^\d{17,20}$/.test(clean)) {
        targetMember = await message.guild.members.fetch(clean).catch(() => null);
        targetUser   = targetMember?.user ?? await client.users.fetch(clean).catch(() => null);
        consumedTokens = 1;
      }
    }
  }

  if (!targetUser) {
    return _sendErr(
      message,
      'Utilisation : `report @membre <raison>` ou repondez au message a signaler.',
      deleteReply,
      deleteDelay,
    );
  }

  if (targetUser.bot) {
    return _sendErr(message, 'Vous ne pouvez pas signaler un bot.', deleteReply, deleteDelay);
  }
  if (targetUser.id === message.author.id) {
    return _sendErr(message, 'Vous ne pouvez pas vous signaler vous-meme.', deleteReply, deleteDelay);
  }
  if (perms.isProtected(targetUser.id, guildId, targetMember)) {
    return _sendErr(message, 'Vous ne pouvez pas signaler ce membre.', deleteReply, deleteDelay);
  }

  const cdKey  = `${guildId}:${message.author.id}`;
  const last   = _cooldown.get(cdKey) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < COOLDOWN_MS) {
    const rem = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
    return _sendErr(
      message,
      `Veuillez attendre **${rem}** seconde(s) avant de refaire un report.`,
      deleteReply,
      deleteDelay,
    );
  }

  const inlineReason = args.slice(consumedTokens).join(' ').trim();

  let reason = null;

  if (inlineReason) {
    const validated = _validateReason(inlineReason, config);
    if (validated.error) {
      return _sendErr(message, validated.error, deleteReply, deleteDelay);
    }
    reason = validated.value;
  } else {
    reason = await _promptReason(message, targetUser, config);
    if (reason === null) return;
    if (reason === '__ABORT__') return;
  }


  _cooldown.set(cdKey, Date.now());
  setTimeout(() => {
    if ((_cooldown.get(cdKey) ?? 0) <= Date.now() - COOLDOWN_MS) {
      _cooldown.delete(cdKey);
    }
  }, COOLDOWN_MS + 1_000).unref?.();

  let reportId;
  try {
    reportId = db.createReport(
      guildId,
      message.author.id,
      targetUser.id,
      targetMessage?.id ?? null,
      targetMessage?.channel?.id ?? message.channel.id,
      reason,
    );
  } catch (err) {
    console.error('[report] DB insert error:', err.message);
    return _sendErr(message, 'Impossible d\'enregistrer le report.', deleteReply, deleteDelay);
  }

  const mentionRoles = _parseJsonArray(config?.reportMentionRoles);
  const reportCount  = db.countReportsAgainst(guildId, targetUser.id);

  const content      = targetMessage?.content
    ? targetMessage.content.slice(0, 1000)
    : (targetMessage ? 'Aucun contenu textuel.' : 'Report sans message lie.');

  const fields = [
    { name: 'Auteur du report', value: `<@${message.author.id}> (${message.author.tag})`,             inline: true  },
    { name: 'Membre signale',   value: `<@${targetUser.id}> (${targetUser.tag})`,                     inline: true  },
    { name: 'Salon',            value: `<#${targetMessage?.channel?.id ?? message.channel.id}>`,      inline: true  },
    { name: 'Raison',           value: reason,                                                        inline: false },
  ];

  if (targetMessage) {
    fields.push(
      { name: 'Message signale', value: content,                                  inline: false },
      { name: 'Lien',            value: `[Voir le message](${targetMessage.url})`, inline: false },
    );
  }

  const reportData = {
    title: 'Nouveau signalement',
    description: `Report **#${reportId}** · ${reportCount} signalement(s) au total contre ce membre.`,
    fields,
  };

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`local:report:handle:${reportId}`)
      .setLabel('Marquer traite')
      .setEmoji('\u2705')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`local:report:reject:${reportId}`)
      .setLabel('Rejeter')
      .setEmoji('\u274C')
      .setStyle(ButtonStyle.Danger),
  );

  const pingContent = mentionRoles.length
    ? mentionRoles.map(id => `<@&${id}>`).join(' ')
    : null;

  const sentReport = await reportChannel.send({
    ..._buildV2Payload({
      ...reportData,
      description: [pingContent, reportData.description].filter(Boolean).join('\n'),
      rows: [buttonRow],
      allowedMentions: { roles: mentionRoles },
    }),
  }).catch(() => null);

  if (!sentReport) {
    return _sendErr(message, 'Impossible d\'envoyer le report dans le salon configure.', deleteReply, deleteDelay);
  }

  _attachStaffCollector(sentReport, guildId, reportId, reportData);

  const sent = await _replyReport(
    message,
    'Signalement envoyé',
    `Ton signalement **#${reportId}** a été transmis au staff.`,
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}


async function _promptReason(message, targetUser, config) {
  const reasons        = _parseJsonArray(config?.reportReasons);
  const reasonRequired = Number(config?.reportReasonRequired ?? 1) === 1;


  if (!reasons.length) {
    return _promptReasonModal(message, reasonRequired);
  }


  return _promptReasonSelect(message, targetUser, reasons, reasonRequired);
}

async function _promptReasonSelect(message, targetUser, reasons, reasonRequired) {

  const limited = reasons.slice(0, 22);

  const options = limited.map((r, i) => ({
    label : String(r).slice(0, 100),
    value : `r:${i}`,
  }));

  options.push({
    label : 'Autre (preciser)',
    value : '__other__',
    emoji : '\u270F\uFE0F',
  });

  if (!reasonRequired) {
    options.push({
      label : 'Passer (aucune raison)',
      value : '__skip__',
      emoji : '\u23ED\uFE0F',
    });
  }

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('local:report:reason:select')
      .setPlaceholder('Choisir une raison...')
      .addOptions(options),
  );

  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:report:reason:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary),
  );

  const prompt = await message.reply({
    ..._buildV2Payload({
      title: 'Signaler un membre',
      description: `Choisis une raison pour **${targetUser.tag}** dans le menu ci-dessous.`,
      rows: [selectRow, cancelRow],
    }),
  }).catch(() => null);

  if (!prompt) return null;

  embed.registerPrivateInteraction(prompt, message.author.id, PANEL_TIMEOUT);

  const interaction = await prompt.awaitMessageComponent({
    filter : i => i.user.id === message.author.id && i.customId.startsWith('local:report:reason:'),
    idle   : PANEL_IDLE,
    time   : PANEL_TIMEOUT,
  }).catch(() => null);

  embed.clearPrivateInteraction(prompt);

  if (!interaction) {
    prompt.delete().catch(() => {});
    return null;
  }

  if (interaction.customId === 'local:report:reason:cancel') {
    await interaction.deferUpdate().catch(() => {});
    prompt.delete().catch(() => {});
    return '__ABORT__';
  }

  const value = interaction.values?.[0];

  if (value === '__skip__') {
    await interaction.deferUpdate().catch(() => {});
    prompt.delete().catch(() => {});
    return 'Aucune raison fournie';
  }

  if (value === '__other__') {
    prompt.delete().catch(() => {});
    return _promptReasonModalFromInteraction(interaction, true);
  }

  const idx = Number(value?.replace('r:', ''));
  await interaction.deferUpdate().catch(() => {});
  prompt.delete().catch(() => {});
  return limited[idx] ?? null;
}

async function _promptReasonModal(message, reasonRequired) {


  const openRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:report:reason:open')
      .setLabel('Saisir une raison')
      .setEmoji('\u270F\uFE0F')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('local:report:reason:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary),
  );

  const prompt = await message.reply({
    ..._buildV2Payload({
      title: 'Raison du signalement',
      description: reasonRequired
        ? 'Clique sur **Saisir une raison** pour préciser ton signalement.'
        : 'Clique sur **Saisir une raison** (facultatif) ou **Annuler**.',
      rows: [openRow],
    }),
  }).catch(() => null);

  if (!prompt) return null;

  embed.registerPrivateInteraction(prompt, message.author.id, PANEL_TIMEOUT);

  const interaction = await prompt.awaitMessageComponent({
    filter : i => i.user.id === message.author.id && i.customId.startsWith('local:report:reason:'),
    idle   : PANEL_IDLE,
    time   : PANEL_TIMEOUT,
  }).catch(() => null);

  embed.clearPrivateInteraction(prompt);

  if (!interaction) {
    prompt.delete().catch(() => {});
    return null;
  }

  if (interaction.customId === 'local:report:reason:cancel') {
    await interaction.deferUpdate().catch(() => {});
    prompt.delete().catch(() => {});
    return '__ABORT__';
  }

  prompt.delete().catch(() => {});
  return _promptReasonModalFromInteraction(interaction, reasonRequired);
}

async function _promptReasonModalFromInteraction(interaction, reasonRequired) {
  const modalId = `local:report:modal:${interaction.id}`;

  const input = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Raison du report')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(reasonRequired ? REASON_MIN : 0)
    .setMaxLength(REASON_MAX)
    .setRequired(reasonRequired)
    .setPlaceholder(reasonRequired ? 'Decris le comportement signale...' : 'Optionnel');

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle('Raison du report')
    .addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal).catch(() => null);

  const submitted = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : MODAL_TIMEOUT,
  }).catch(() => null);

  if (!submitted) return null;

  let raw = '';
  try { raw = submitted.fields.getTextInputValue('reason') ?? ''; } catch {}
  raw = String(raw).trim();

  if (!raw) {
    if (reasonRequired) {
      await submitted.reply(_interactionTextPayload(
        'Signalement annulé',
        'Une raison est obligatoire.',
      )).catch(() => {});
      return '__ABORT__';
    }
    await submitted.deferUpdate().catch(() => {});
    return 'Aucune raison fournie';
  }

  if (raw.length < REASON_MIN) {
    await submitted.reply(_interactionTextPayload(
      'Raison trop courte',
      `La raison doit faire au moins **${REASON_MIN} caractères**.`,
    )).catch(() => {});
    return '__ABORT__';
  }
  if (raw.length > REASON_MAX) {
    raw = raw.slice(0, REASON_MAX);
  }

  await submitted.deferUpdate().catch(() => {});
  return raw;
}

function _validateReason(raw, config) {
  const reasonRequired = Number(config?.reportReasonRequired ?? 1) === 1;
  const value = String(raw ?? '').trim();

  if (!value) {
    if (reasonRequired) return { error: `Precisez une raison (min ${REASON_MIN} caracteres).` };
    return { value: 'Aucune raison fournie' };
  }
  if (value.length < REASON_MIN && reasonRequired) {
    return { error: `La raison doit faire au moins **${REASON_MIN}** caracteres.` };
  }
  if (value.length > REASON_MAX) {
    return { value: value.slice(0, REASON_MAX) };
  }
  return { value };
}


function _attachStaffCollector(reportMessage, guildId, reportId, reportData) {


  const collector = reportMessage.createMessageComponentCollector({
    componentType : ComponentType.Button,
    filter        : i =>
      i.customId === `local:report:handle:${reportId}` ||
      i.customId === `local:report:reject:${reportId}`,
    time : 24 * 60 * 60 * 1000,
  });

  collector.on('collect', async interaction => {
    try {
      if (!perms.check(interaction, 'reportconfig')) {
        await interaction.reply(_interactionTextPayload(
          'Action réservée au staff',
          'Tu n’as pas la permission de traiter ce signalement.',
        )).catch(() => {});
        return;
      }

      const isHandle = interaction.customId.endsWith(`:handle:${reportId}`);
      const status   = isHandle ? 'handled' : 'rejected';

      try {
        db.setReportStatus(reportId, status, interaction.user.id);
      } catch (err) {
        console.error('[report] DB update status error:', err.message);
      }


      await interaction.update(_buildV2Payload({
        ...reportData,
        title: isHandle ? 'Signalement traité' : 'Signalement rejeté',
        fields: [
          ...reportData.fields,
          {
            name: isHandle ? 'Traité par' : 'Rejeté par',
            value: `<@${interaction.user.id}> (${interaction.user.tag})`,
          },
        ],
      })).catch(() => {});

      collector.stop('done');
    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) {
        console.error('[report] staff collector error:', err.message);
      }
    }
  });

  collector.on('end', () => {


  });
}


async function _handleSettings(client, message, guildId, args, config) {
  const sub = args[0]?.toLowerCase();

  if (sub === 'on' || sub === 'off') {
    return _cliToggle(message, guildId, sub === 'on' ? 1 : 0, config);
  }
  if (sub === 'channel') {
    return _cliChannel(message, guildId, args.slice(1), config);
  }


  return _openSettingsPanel(client, message, guildId);
}

async function _cliToggle(message, guildId, enabled, config) {
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

  if (Number(config?.reportEnabled) === enabled) {
    return _sendErr(message, enabled ? 'Déjà activé.' : 'Déjà désactivé.', deleteReply, deleteDelay);
  }
  if (enabled && !config?.reportChannel) {
    return _sendErr(message, 'Définissez d\'abord un salon avec `report channel #salon`.', deleteReply, deleteDelay);
  }

  db.setGuildConfig(guildId, 'reportEnabled', enabled);

  const sent = await _replyReport(message, 'État mis à jour', enabled
    ? 'Le système de signalements est maintenant **activé**.'
    : 'Le système de signalements est maintenant **désactivé**.');

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _cliChannel(message, guildId, args, config) {
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

  const target = args[0]?.toLowerCase();
  if (!target) {
    return _sendErr(
      message,
      'Utilisation : `report channel #salon` ou `report channel off`.',
      deleteReply,
      deleteDelay,
    );
  }

  if (target === 'off' || target === 'reset') {
    if (!config?.reportChannel) {
      return _sendErr(message, 'Aucun salon configure.', deleteReply, deleteDelay);
    }
    db.setGuildConfig(guildId, 'reportChannel', null);
    db.setGuildConfig(guildId, 'reportEnabled', 0);
    const sent = await _replyReport(message, 'Salon retiré', 'Le système de signalements a été désactivé.');
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const channel = message.mentions.channels.first()
    ?? (args[0] ? message.guild.channels.cache.get(String(args[0]).replace(/[<#>]/g, '')) : null);

  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    return _sendErr(message, 'Salon invalide. Mentionnez un salon textuel.', deleteReply, deleteDelay);
  }


  const me = message.guild.members.me
    ?? await message.guild.members.fetchMe().catch(() => null);
  const botPerms = me ? channel.permissionsFor(me) : null;

  if (
    !botPerms?.has('ViewChannel') ||
    !botPerms?.has('SendMessages')
  ) {
    return _sendErr(
      message,
      `Je n'ai pas les permissions nécessaires dans <#${channel.id}> : Voir le salon et Envoyer des messages.`,
      deleteReply,
      deleteDelay
    );
  }

  db.setGuildConfig(guildId, 'reportChannel', channel.id);

  const sent = await _replyReport(message, 'Salon défini', `Les signalements seront envoyés dans <#${channel.id}>.`);
  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}


async function _openSettingsPanel(client, message, guildId) {
  const buildPayload = (disabled = false) => {
    const cfg = db.getGuildConfig(guildId) || {};
    const reasons      = _parseJsonArray(cfg.reportReasons);
    const mentionRoles = _parseJsonArray(cfg.reportMentionRoles);

    const reasonSummary = reasons.length
      ? reasons.map((reason, index) => `\`${index + 1}.\` ${String(reason).slice(0, 100)}`).join('\n')
      : 'Aucune raison prédéfinie. Une raison libre sera demandée.';
    const roleSummary = mentionRoles.length
      ? mentionRoles.map(id => `<@&${id}>`).join(', ')
      : 'Aucun rôle ne sera mentionné.';
    const description = [
      `**État** · ${Number(cfg.reportEnabled) ? '🟢 Activé' : '⚪ Désactivé'}`,
      `**Salon de réception** · ${cfg.reportChannel ? `<#${cfg.reportChannel}>` : 'Non configuré'}`,
      `**Raison obligatoire** · ${Number(cfg.reportReasonRequired ?? 1) ? 'Oui' : 'Non'}`,
      '',
      `**Raisons prédéfinies · ${reasons.length}/${MAX_REASONS}**`,
      reasonSummary,
      '',
      `**Rôles notifiés · ${mentionRoles.length}/${MAX_PING_ROLES}**`,
      roleSummary,
      '',
      '-# Choisis une action dans le menu pour modifier la configuration.',
    ].join('\n');

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('local:reportset:action')
        .setPlaceholder('Choisir une action...')
        .setDisabled(disabled)
        .addOptions(
          { label: 'Activer / désactiver', value: 'toggle',     description: 'Changer l’état du système', emoji: '\uD83D\uDD01' },
          { label: 'Choisir le salon',     value: 'channel',    description: 'Définir où les signalements arrivent', emoji: '\uD83D\uDCCD' },
          { label: 'Raison obligatoire',   value: 'required',   description: 'Rendre la raison facultative ou obligatoire', emoji: '\u2754' },
          { label: 'Ajouter une raison',   value: 'reason_add', description: 'Ajouter un motif prédéfini', emoji: '\u2795' },
          { label: 'Retirer une raison',   value: 'reason_del', description: 'Supprimer un motif prédéfini', emoji: '\u2796' },
          { label: 'Rôles notifiés',       value: 'roles',      description: 'Choisir les rôles à mentionner', emoji: '\uD83D\uDC65' },
          { label: 'Fermer le panneau',    value: 'close',      description: 'Fermer ce panneau', emoji: '\u274C' },
        ),
    );

    return _buildV2Payload({
      title: 'Centre de signalements',
      description,
      rows: [selectRow],
    });
  };

  const panel = await message.reply(buildPayload()).catch(() => null);
  if (!panel) return;

  embed.registerPrivateInteraction(panel, message.author.id, PANEL_TIMEOUT);

  const collector = panel.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : PANEL_IDLE,
    time   : PANEL_TIMEOUT,
  });

  collector.on('collect', async interaction => {
    try {
      if (interaction.customId !== 'local:reportset:action') return;

      const action = interaction.values?.[0];

      if (action === 'close') {
        await interaction.deferUpdate().catch(() => {});
        embed.clearPrivateInteraction(panel);
        collector.stop('closed');
        await panel.delete().catch(() => {});
        return;
      }

      await _applySettingsAction(interaction, guildId, action);

      const payload = buildPayload();
      if (interaction.replied || interaction.deferred) {
        await panel.edit(payload).catch(() => {});
      } else {
        await interaction.update(payload).catch(() => {});
      }
    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) {
        console.error('[report settings] collect error:', err.message);
      }
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(panel);
    if (reason === 'closed') return;
    panel.edit(buildPayload(true)).catch(() => {});
  });
}

async function _applySettingsAction(interaction, guildId, action) {
  const cfg = db.getGuildConfig(guildId) || {};

  if (action === 'toggle') {
    const current = Number(cfg.reportEnabled);
    if (!current && !cfg.reportChannel) {
      await interaction.reply(_interactionTextPayload(
        'Salon manquant',
        'Définis d’abord le salon de réception avant d’activer le système.',
      )).catch(() => {});
      return;
    }
    db.setGuildConfig(guildId, 'reportEnabled', current ? 0 : 1);
    return;
  }

  if (action === 'required') {
    const current = Number(cfg.reportReasonRequired ?? 1);
    db.setGuildConfig(guildId, 'reportReasonRequired', current ? 0 : 1);
    return;
  }

  if (action === 'channel') {
    const value = await _modalInput(interaction, {
      title       : 'Salon des reports',
      label       : 'ID ou mention du salon (off pour retirer)',
      placeholder : '#salon ou 123456789... ou off',
      required    : true,
      maxLength   : 100,
    });
    if (value == null) return;

    if (/^(off|reset|none)$/i.test(value)) {
      db.setGuildConfig(guildId, 'reportChannel', null);
      db.setGuildConfig(guildId, 'reportEnabled', 0);
      return;
    }
    const clean = value.replace(/[<#>]/g, '').trim();
    const ch    = interaction.guild.channels.cache.get(clean);
    if (!ch || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)) {
      await interaction.followUp(_interactionTextPayload(
        'Salon invalide',
        'Choisis un salon textuel de ce serveur.',
      )).catch(() => {});
      return;
    }
    db.setGuildConfig(guildId, 'reportChannel', ch.id);
    return;
  }

  if (action === 'reason_add') {
    const reasons = _parseJsonArray(cfg.reportReasons);
    if (reasons.length >= MAX_REASONS) {
      await interaction.reply(_interactionTextPayload(
        'Limite atteinte',
        `Tu peux configurer jusqu’à **${MAX_REASONS} raisons**.`,
      )).catch(() => {});
      return;
    }
    const value = await _modalInput(interaction, {
      title       : 'Ajouter une raison',
      label       : 'Libelle de la raison',
      placeholder : 'Spam, insultes, ...',
      required    : true,
      maxLength   : 100,
    });
    if (!value) return;

    const trimmed = value.trim().slice(0, 100);
    if (reasons.some(r => String(r).toLowerCase() === trimmed.toLowerCase())) {
      await interaction.followUp(_interactionTextPayload(
        'Raison déjà présente',
        'Cette raison existe déjà dans la liste.',
      )).catch(() => {});
      return;
    }
    reasons.push(trimmed);
    db.setGuildConfig(guildId, 'reportReasons', JSON.stringify(reasons));
    return;
  }

  if (action === 'reason_del') {
    const reasons = _parseJsonArray(cfg.reportReasons);
    if (!reasons.length) {
      await interaction.reply(_interactionTextPayload(
        'Aucune raison configurée',
        'Ajoute d’abord une raison prédéfinie.',
      )).catch(() => {});
      return;
    }
    const value = await _modalInput(interaction, {
      title       : 'Retirer une raison',
      label       : `Numéro (1-${reasons.length}) ou "all"`,
      placeholder : '1, 2, ... ou all',
      required    : true,
      maxLength   : 10,
    });
    if (!value) return;

    if (/^all$/i.test(value.trim())) {
      db.setGuildConfig(guildId, 'reportReasons', null);
      return;
    }

    const idx = Number(value.trim()) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= reasons.length) {
      await interaction.followUp(_interactionTextPayload(
        'Numéro invalide',
        'Choisis un numéro présent dans la liste ou `all`.',
      )).catch(() => {});
      return;
    }
    reasons.splice(idx, 1);
    db.setGuildConfig(guildId, 'reportReasons', reasons.length ? JSON.stringify(reasons) : null);
    return;
  }

  if (action === 'roles') {
    const current = _parseJsonArray(cfg.reportMentionRoles);
    const value = await _modalInput(interaction, {
      title       : 'Rôles à mentionner',
      label       : `Liste IDs/mentions (max ${MAX_PING_ROLES}, "off" pour vider)`,
      placeholder : '@StaffRole, 123456789..., ou off',
      required    : false,
      maxLength   : 500,
      style       : TextInputStyle.Paragraph,
      initialValue: current.map(id => `<@&${id}>`).join(' '),
    });
    if (value == null) return;

    if (!value.trim() || /^off$/i.test(value.trim())) {
      db.setGuildConfig(guildId, 'reportMentionRoles', null);
      return;
    }

    const ids = [...new Set(
      String(value)
        .split(/[\s,]+/)
        .map(t => t.replace(/[<@&>]/g, '').trim())
        .filter(t => /^\d{17,20}$/.test(t))
    )].slice(0, MAX_PING_ROLES);

    const valid = ids.filter(id => interaction.guild.roles.cache.has(id));

    if (!valid.length) {
      await interaction.followUp(_interactionTextPayload(
        'Aucun rôle valide',
        'Mentionne au moins un rôle existant sur ce serveur.',
      )).catch(() => {});
      return;
    }

    db.setGuildConfig(guildId, 'reportMentionRoles', JSON.stringify(valid));
    return;
  }
}


async function _modalInput(interaction, opts) {
  const modalId = `local:reportset:modal:${opts.title.slice(0, 8)}:${interaction.id}`;

  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(opts.label.slice(0, 45))
    .setStyle(opts.style ?? TextInputStyle.Short)
    .setRequired(Boolean(opts.required))
    .setMaxLength(opts.maxLength ?? 200);

  if (opts.placeholder) input.setPlaceholder(opts.placeholder.slice(0, 100));
  if (opts.initialValue) input.setValue(String(opts.initialValue).slice(0, opts.maxLength ?? 200));

  const modal = new ModalBuilder()
    .setCustomId(modalId.slice(0, 100))
    .setTitle(opts.title.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal).catch(() => null);

  const submitted = await interaction.awaitModalSubmit({
    filter : i => i.customId === modal.data.custom_id && i.user.id === interaction.user.id,
    time   : MODAL_TIMEOUT,
  }).catch(() => null);

  if (!submitted) return null;

  let raw = '';
  try { raw = submitted.fields.getTextInputValue('value') ?? ''; } catch {}
  await submitted.deferUpdate().catch(() => {});
  return String(raw);
}


function _parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function _sendErr(message, text, deleteReply, deleteDelay) {
  const sent = await _replyReport(message, 'Impossible de continuer', text).catch(() => null);
  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  return null;
}

async function _replyReport(message, title, description) {
  return message.reply(_buildV2Payload({ title, description }));
}

function _interactionTextPayload(title, description) {
  return _buildV2Payload({
    title,
    description,
    flags: COMPONENTS_V2_FLAG | MessageFlags.Ephemeral,
  });
}

function _buildV2Payload({
  title,
  description = '',
  fields = [],
  rows = [],
  allowedMentions = { parse: [] },
  flags = COMPONENTS_V2_FLAG,
}) {
  const container = new ContainerBuilder();
  const sections = [`## ${title}`];

  if (description) sections.push(description);
  for (const field of fields) {
    sections.push('', `**${field.name}**`, String(field.value ?? '—'));
  }

  const content = sections.join('\n').slice(0, 4000);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content || '## Signalement'));

  if (rows.length) {
    container.addSeparatorComponents(new SeparatorBuilder());
    for (const row of rows) container.addActionRowComponents(row);
  }

  return {
    embeds: [],
    components: [container],
    flags,
    allowedMentions,
  };
}
