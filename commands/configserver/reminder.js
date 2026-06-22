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
  PermissionsBitField,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const TIMEOUTS = require('../../utils/interactionTimeouts');
const perms = require('../../utils/permissions');

const PANEL_TIMEOUT = 120_000;
const LIST_TIMEOUT  = 120_000;
const PAGE_SIZE     = 15;

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? null;
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder   === 'function' &&
  typeof TextDisplayBuilder === 'function' &&
  typeof SeparatorBuilder   === 'function'
);

function _hexToInt(hex) {
  try {
    const m = String(hex || '').replace(/^#/, '').match(/^[0-9a-fA-F]{6}$/);
    return m ? parseInt(m[0], 16) : 0x2f3136;
  } catch { return 0x2f3136; }
}


const _panelBusy = new Map();

function _isBusy(panel) {
  return Boolean(panel) && _panelBusy.get(panel.id) === true;
}

function _setBusy(panel, value) {
  if (!panel) return;
  if (value) _panelBusy.set(panel.id, true);
  else _panelBusy.delete(panel.id);
}

module.exports = {
  help: {
    name        : 'reminder',
    description : 'Programmer l\'envoi automatique d\'une commande custom.',
    use         : 'reminder | reminder list | reminder <numéro>',
    usage       : 'reminder | reminder list | reminder <numéro>',
    aliases     : ['remind', 'rappel'],
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

    const action = args[0]?.toLowerCase();

    if (['list', 'liste', 'show'].includes(action)) {
      return _handleList(message, guildId, deleteReply, deleteDelay);
    }

    if (['del', 'delete', 'remove', 'cancel', 'annuler'].includes(action)) {
      return _handleDelete(message, guildId, args[1], deleteReply, deleteDelay);
    }


    if (action && _parseDuration(action) && args.length > 1) {
      return _handleLegacyCreate(message, args, guild, guildId, deleteReply, deleteDelay);
    }

    const num = Number(action);

    if (Number.isInteger(num) && num > 0) {
      return _handleOpenByIndex(message, guild, guildId, num, deleteReply, deleteDelay);
    }

    if (!action) {
      return _handleNew(message, guild, guildId, deleteReply, deleteDelay);
    }

    const sent = await embed.replyError(
      message,
      `Utilisation : \`${message.prefix || '+'}reminder\` ou \`${message.prefix || '+'}reminder <duree> <message>\``,
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};


async function _handleNew(message, guild, guildId, deleteReply, deleteDelay) {
  const remindAt = Math.floor(Date.now() / 1000) + 3600;

  let reminderId;

  try {
    reminderId = db.addReminder(guildId, message.author.id, message.channel.id, '', remindAt);
  } catch {
    return embed.replyError(message, 'Impossible de creer le reminder.', { timestamp: false });
  }

  const row = db.getReminderById(reminderId);

  if (!row) {
    return embed.replyError(message, 'Impossible de creer le reminder.', { timestamp: false });
  }

  return _openPanel(message, guild, guildId, row, deleteReply, deleteDelay);
}

async function _handleOpenByIndex(message, guild, guildId, index, deleteReply, deleteDelay) {
  const rows = db.getRemindersByGuild(guildId) || [];

  if (!rows.length) {
    const sent = await embed.replyError(message, 'Aucun reminder actif.', { timestamp: false }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const row = rows[index - 1];

  if (!row) {
    const sent = await embed.replyError(message, `Reminder #${index} introuvable. Max : ${rows.length}.`, { timestamp: false }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  return _openPanel(message, guild, guildId, row, deleteReply, deleteDelay);
}

async function _openPanel(message, guild, guildId, row, deleteReply, deleteDelay) {
  const panel = await message.channel.send({
    embeds     : [_buildPanelEmbed(guildId, row)],
    components : _buildPanelComponents(),
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (!panel) return;

  embed.registerPrivateInteraction(panel, message.author.id, PANEL_TIMEOUT + TIMEOUTS.CONFIRM_TIME_MS);

  const collector = panel.createMessageComponentCollector({
    componentType : ComponentType.StringSelect,
    time          : PANEL_TIMEOUT,
    filter        : i => i.user.id === message.author.id,
  });

  collector.on('collect', async (interaction) => {
    if (_isBusy(panel)) {
      return interaction.reply({
        content         : 'Une modification est déjà en cours.',
        flags           : 64,
        allowedMentions : { parse: [] },
      }).catch(() => {});
    }

    const choice = interaction.values?.[0];

    if (choice === 'cmd')     return _editCustomCommand(interaction, guild, guildId, row, panel);
    if (choice === 'date')    return _editDate(interaction, guildId, row, panel);
    if (choice === 'repeat')  return _editRepeat(interaction, guildId, row, panel);
    if (choice === 'channel') return _editChannel(interaction, guild, guildId, row, panel);
    if (choice === 'delete')  return _confirmDelete(interaction, guildId, row, panel, collector, message.author.id);

    await interaction.deferUpdate().catch(() => {});
  });

  collector.on('end', () => {
    embed.clearPrivateInteraction(panel);
    _setBusy(panel, false);

    const fresh = db.getReminderById(row.id);
    if (fresh && !fresh.message && !fresh.customCommandName) {
      try { db.deleteReminder(row.id); } catch {}
    }
    panel.edit({ components: [] }).catch(() => {});
  });
}

function _buildPanelEmbed(guildId, row) {
  const cmdValue = row.customCommandName
    ? `\`${row.customCommandName}\``
    : (row.message ? `Texte : \`${String(row.message).slice(0, 60)}\`` : '`Aucune`');

  const dateValue = row.remindAt
    ? `<t:${row.remindAt}:F> (<t:${row.remindAt}:R>)`
    : '`Non configuree`';

  const repeatValue = row.repeatEvery
    ? `\`${_formatDuration(Number(row.repeatEvery) * 1000)}\``
    : '`Aucune`';

  const channelValue = row.channelId
    ? `<#${row.channelId}>`
    : '`Aucun`';

  return embed.build(guildId, '', {
    title     : 'Parametres du reminder',
    timestamp : false,
    fields    : [
      { name: 'Commande custom', value: cmdValue,     inline: true },
      { name: 'Date d\'envoi',   value: dateValue,    inline: true },
      { name: '\u200b',          value: '\u200b',     inline: true },
      { name: 'Repetition',      value: repeatValue,  inline: true },
      { name: 'Salon',           value: channelValue,  inline: true },
      { name: '\u200b',          value: '\u200b',     inline: true },
    ],
  });
}

function _buildPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('local:reminder:config')
        .setPlaceholder('Configurer...')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions([
          { label: 'Commande custom liee', value: 'cmd',     description: 'Lier une commande custom existante', emoji: '🔗' },
          { label: 'Date d\'envoi',        value: 'date',    description: 'Date ou duree relative',             emoji: '📅' },
          { label: 'Repetition',           value: 'repeat',  description: 'Intervalle de repetition',           emoji: '🔁' },
          { label: 'Salon',                value: 'channel', description: 'Salon de destination',               emoji: '📢' },
          { label: 'Supprimer',            value: 'delete',  description: 'Supprimer ce reminder',              emoji: '🗑️' },
        ])
    ),
  ];
}


async function _editCustomCommand(interaction, guild, guildId, row, panel) {
  const modalId = `local:reminder:cmd:${interaction.id}`;

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle('Commande custom liee')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Nom de la commande custom')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Nom exact de la commande')
          .setRequired(false)
          .setMaxLength(100)
          .setValue(row.customCommandName || '')
      )
    );

  _setBusy(panel, true);
  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  _setBusy(panel, false);
  if (!shown) return;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 60_000,
  }).catch(() => null);

  if (!submit) return;

  _setBusy(panel, true);
  try {
    const name = submit.fields.getTextInputValue('name').trim();

    if (!name) {
      await submit.deferUpdate().catch(() => {});
      if (!await _updateOrGone(panel, guildId, row, { customCommandName: null })) return;
      row.customCommandName = null;
      return _refreshPanel(panel, guildId, row);
    }

    const custom = db.getCustomCommand(guildId, name);

    if (!custom) {
      await submit.reply({
        embeds : [embed.build(guildId, `Commande custom \`${name}\` introuvable.`, { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
      return;
    }

    await submit.deferUpdate().catch(() => {});
    if (!await _updateOrGone(panel, guildId, row, { customCommandName: name })) return;
    row.customCommandName = name;
    return _refreshPanel(panel, guildId, row);
  } finally {
    _setBusy(panel, false);
  }
}


async function _editDate(interaction, guildId, row, panel) {
  const modalId = `local:reminder:date:${interaction.id}`;

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle('Date d\'envoi')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('date')
          .setLabel('Date ou duree relative')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('17h00, 20/03/2026 17h, +1h, 30m, 2d')
          .setRequired(true)
          .setMaxLength(50)
      )
    );

  _setBusy(panel, true);
  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  _setBusy(panel, false);
  if (!shown) return;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 60_000,
  }).catch(() => null);

  if (!submit) return;

  _setBusy(panel, true);
  try {
    const input = submit.fields.getTextInputValue('date').trim();
    const parsed = _parseDateTime(input);

    if (!parsed) {
      await submit.reply({
        embeds : [embed.build(guildId, 'Date invalide. Exemples : `17h00`, `20/03/2026 17h`, `+1h`, `30m`, `2d`.', { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
      return;
    }

    const now = Math.floor(Date.now() / 1000);

    if (parsed <= now) {
      await submit.reply({
        embeds : [embed.build(guildId, 'La date doit etre dans le futur.', { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
      return;
    }

    await submit.deferUpdate().catch(() => {});
    if (!await _updateOrGone(panel, guildId, row, { remindAt: parsed })) return;
    row.remindAt = parsed;
    return _refreshPanel(panel, guildId, row);
  } finally {
    _setBusy(panel, false);
  }
}


async function _editRepeat(interaction, guildId, row, panel) {
  const modalId = `local:reminder:repeat:${interaction.id}`;

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle('Repetition')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('repeat')
          .setLabel('Intervalle (vide = aucune)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('30m, 12h, 1d ou aucun')
          .setRequired(false)
          .setMaxLength(30)
          .setValue(row.repeatEvery ? _formatDuration(Number(row.repeatEvery) * 1000) : '')
      )
    );

  _setBusy(panel, true);
  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  _setBusy(panel, false);
  if (!shown) return;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 60_000,
  }).catch(() => null);

  if (!submit) return;

  _setBusy(panel, true);
  try {
    const input = submit.fields.getTextInputValue('repeat').trim().toLowerCase();

    if (!input || ['none', 'non', 'aucun', '0'].includes(input)) {
      await submit.deferUpdate().catch(() => {});
      if (!await _updateOrGone(panel, guildId, row, { repeatEvery: null })) return;
      row.repeatEvery = null;
      return _refreshPanel(panel, guildId, row);
    }

    const ms = _parseDuration(input);

    if (!ms || ms < 60_000) {
      await submit.reply({
        embeds : [embed.build(guildId, 'Duree invalide ou inferieure a 1 minute. Exemples : `1m`, `12h`, `1d`.', { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
      return;
    }

    const seconds = Math.floor(ms / 1000);
    await submit.deferUpdate().catch(() => {});
    if (!await _updateOrGone(panel, guildId, row, { repeatEvery: seconds })) return;
    row.repeatEvery = seconds;
    return _refreshPanel(panel, guildId, row);
  } finally {
    _setBusy(panel, false);
  }
}


async function _editChannel(interaction, guild, guildId, row, panel) {
  const modalId = `local:reminder:channel:${interaction.id}`;

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle('Salon de destination')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('channel')
          .setLabel('Mention ou ID du salon')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('#salon ou ID')
          .setRequired(true)
          .setMaxLength(50)
      )
    );

  _setBusy(panel, true);
  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  _setBusy(panel, false);
  if (!shown) return;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 60_000,
  }).catch(() => null);

  if (!submit) return;

  _setBusy(panel, true);
  try {
    const input = submit.fields.getTextInputValue('channel').trim();
    const channel = await _resolveTextChannel(guild, input);

    if (!channel) {
      await submit.reply({
        embeds : [embed.build(guildId, 'Salon introuvable ou non textuel.', { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
      return;
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    const botPerms = me ? channel.permissionsFor(me) : null;

    if (
      !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
      !botPerms?.has(PermissionsBitField.Flags.SendMessages)
    ) {
      await submit.reply({
        embeds : [embed.build(guildId, 'Je n\'ai pas les permissions dans ce salon.', { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
      return;
    }

    await submit.deferUpdate().catch(() => {});
    if (!await _updateOrGone(panel, guildId, row, { channelId: channel.id })) return;
    row.channelId = channel.id;
    return _refreshPanel(panel, guildId, row);
  } finally {
    _setBusy(panel, false);
  }
}


async function _confirmDelete(interaction, guildId, row, panel, collector, ownerId) {
  await interaction.deferUpdate().catch(() => {});

  await panel.edit({
    embeds: [embed.build(guildId, `Supprimer le reminder \`${row.id}\` ?`, { color: '#ED4245', timestamp: false })],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('local:reminder:confirmdelete')
          .setLabel('Confirmer')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('local:reminder:canceldelete')
          .setLabel('Annuler')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  }).catch(() => {});

  const btn = await panel.awaitMessageComponent({
    componentType : ComponentType.Button,
    time          : TIMEOUTS.CONFIRM_TIME_MS,
    filter        : i => i.user.id === ownerId && ['local:reminder:confirmdelete', 'local:reminder:canceldelete'].includes(i.customId),
  }).catch(() => null);

  if (!btn) {
    return _refreshPanel(panel, guildId, row);
  }

  await btn.deferUpdate().catch(() => {});

  if (btn.customId === 'local:reminder:confirmdelete') {
    try {
      db.deleteReminder(row.id);
      if (db.countReminders() === 0) db.resetReminderSequence();
    } catch {}

    collector.stop('deleted');

    await panel.edit({
      embeds     : [embed.build(guildId, `Reminder \`${row.id}\` supprime.`, { timestamp: false })],
      components : [],
    }).catch(() => {});
    return;
  }

  return _refreshPanel(panel, guildId, row);
}


async function _handleList(message, guildId, deleteReply, deleteDelay) {
  let rows = [];
  try { rows = db.getRemindersByGuild(guildId) || []; } catch { rows = []; }

  rows = rows.filter(r => r.message || r.customCommandName);

  const config = db.getGuildConfig(guildId);


  if (!V2_AVAILABLE) {
    return _handleListFallback(message, guildId, rows, deleteReply, deleteDelay);
  }

  if (!rows.length) {
    const payload = _buildListV2Empty(config);
    const sent = await message.channel.send(payload).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  let page = 0;
  const payload = _buildListV2(config, rows, page);
  const panel = await message.channel.send(payload).catch(() => null);
  if (!panel) return;

  embed.registerPrivateInteraction(panel, message.author.id, LIST_TIMEOUT + TIMEOUTS.CONFIRM_TIME_MS);

  let busy = false;

  const collector = panel.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    time   : LIST_TIMEOUT,
  });

  collector.on('collect', async (interaction) => {
    const id = interaction.customId;

    if (id.startsWith('local:reminder:list_prev:') || id.startsWith('local:reminder:list_next:')) {
      if (busy) return interaction.deferUpdate().catch(() => {});
      page = Number(id.split(':').pop()) || 0;
      await interaction.deferUpdate().catch(() => {});
      rows = []; try { rows = db.getRemindersByGuild(guildId) || []; } catch {}
      const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      if (page >= totalPages) page = totalPages - 1;
      if (page < 0) page = 0;
      return panel.edit(_buildListV2(config, rows, page)).catch(() => {});
    }

    if (id === 'local:reminder:list_delete') {
      if (busy) return interaction.deferUpdate().catch(() => {});
      busy = true;

      const modalId = `local:reminder:list_del_modal:${interaction.id}`;
      const shown = await interaction.showModal(
        new ModalBuilder()
          .setCustomId(modalId)
          .setTitle('Supprimer un reminder')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('target')
                .setLabel('Numéro du rappel (ou "tous")')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('1, 2, all, tous')
                .setRequired(true)
                .setMaxLength(10)
            )
          )
      ).then(() => true).catch(() => false);

      if (!shown) { busy = false; return; }

      let submit;
      try {
        submit = await interaction.awaitModalSubmit({
          filter : i => i.customId === modalId && i.user.id === message.author.id,
          time   : 60_000,
        });
      } catch { busy = false; return; }

      const input = submit.fields.getTextInputValue('target').trim().toLowerCase();

      if (['all', 'tous', '*', 'tout'].includes(input)) {
        rows = []; try { rows = db.getRemindersByGuild(guildId) || []; } catch {}
        let deleted = 0;
        for (const r of rows) {
          try { db.deleteReminder(r.id); deleted++; } catch {}
        }
        try { if (db.countReminders() === 0) db.resetReminderSequence(); } catch {}

        await submit.reply({
          embeds : [embed.build(guildId, `${deleted} reminder(s) supprime(s).`, { timestamp: false })],
          flags  : 64,
        }).catch(() => {});

        await panel.edit(_buildListV2Empty(config)).catch(() => {});
        busy = false;
        return;
      }

      const num = Number(input);
      rows = []; try { rows = db.getRemindersByGuild(guildId) || []; } catch {}

      if (!Number.isInteger(num) || num <= 0 || num > rows.length) {
        await submit.reply({
          embeds : [embed.build(guildId, `Numéro invalide. Entrez un numéro entre 1 et ${rows.length}, ou \`all\`.`, { color: '#ED4245', timestamp: false })],
          flags  : 64,
        }).catch(() => {});
        busy = false;
        return;
      }

      const target = rows[num - 1];
      try {
        db.deleteReminder(target.id);
        if (db.countReminders() === 0) db.resetReminderSequence();
      } catch {}

      await submit.reply({
        embeds : [embed.build(guildId, `Reminder \`#${num}\` supprime.`, { timestamp: false })],
        flags  : 64,
      }).catch(() => {});

      rows = []; try { rows = db.getRemindersByGuild(guildId) || []; } catch {}
      const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      if (page >= totalPages) page = Math.max(0, totalPages - 1);

      if (!rows.length) {
        await panel.edit(_buildListV2Empty(config)).catch(() => {});
      } else {
        await panel.edit(_buildListV2(config, rows, page)).catch(() => {});
      }

      busy = false;
      return;
    }

    return interaction.deferUpdate().catch(() => {});
  });

  collector.on('end', () => {
    embed.clearPrivateInteraction(panel);
    rows = []; try { rows = db.getRemindersByGuild(guildId) || []; } catch {}
    if (!rows.length) {
      panel.edit(_buildListV2ReadOnly(config, 'Aucun reminder actif.')).catch(() => {});
    } else {
      panel.edit(_buildListV2ReadOnly(config, `${rows.length} reminder(s) actif(s). Panel expire.`)).catch(() => {});
    }
  });
}


function _buildListV2Empty(config) {
  const accent    = _hexToInt(config?.color);
  const container = new ContainerBuilder().setAccentColor(accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Reminders actifs'),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('Aucun reminder actif.'),
  );

  return {
    flags           : COMPONENTS_V2_FLAG,
    components      : [container],
    allowedMentions : { parse: [] },
  };
}

function _buildListV2ReadOnly(config, text) {
  const accent    = _hexToInt(config?.color);
  const container = new ContainerBuilder().setAccentColor(accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Reminders actifs'),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${text}`),
  );

  return {
    flags           : COMPONENTS_V2_FLAG,
    components      : [container],
    allowedMentions : { parse: [] },
  };
}

function _buildListV2(config, rows, page) {
  const accent     = _hexToInt(config?.color);
  const container  = new ContainerBuilder().setAccentColor(accent);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const start      = page * PAGE_SIZE;
  const slice      = rows.slice(start, start + PAGE_SIZE);

  const pageInfo = totalPages > 1
    ? ` (${start + 1}-${start + slice.length} sur ${rows.length})`
    : '';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Reminders actifs${pageInfo}`),
  );


  for (let i = 0; i < slice.length; i++) {
    const row    = slice[i];
    const idx    = start + i + 1;
    const label  = row.customCommandName ? `**${row.customCommandName}**` : '**texte**';
    const chan   = row.channelId ? `<#${row.channelId}>` : '`Aucun`';
    const repeat = row.repeatEvery
      ? `\`${_formatDuration(Number(row.repeatEvery) * 1000)}\``
      : '`aucune`';

    const lines = [
      `\`${idx}.\` ${label}`,
      `Salon : ${chan}`,
      `Date : <t:${row.remindAt}:F>`,
      `Echeance : <t:${row.remindAt}:R>`,
      `Repetition : ${repeat}`,
    ];
    if (row.customCommandName) {
      lines.push(`Commande custom : \`${row.customCommandName}\``);
    }

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join('\n')),
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder());

  const actionBtns = [
    new ButtonBuilder()
      .setCustomId('local:reminder:list_delete')
      .setLabel('Supprimer')
      .setEmoji('\uD83D\uDDD1')
      .setStyle(ButtonStyle.Danger),
  ];

  if (totalPages > 1) {
    actionBtns.unshift(
      new ButtonBuilder()
        .setCustomId(`local:reminder:list_prev:${page - 1}`)
        .setLabel('Precedent')
        .setEmoji('\u2192')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
    );
    actionBtns.push(
      new ButtonBuilder()
        .setCustomId(`local:reminder:list_next:${page + 1}`)
        .setLabel('Suivant')
        .setEmoji('\u25B6')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(...actionBtns),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('-# Les reminders sont tries par date d\'echeance.'),
  );

  return {
    flags           : COMPONENTS_V2_FLAG,
    components      : [container],
    allowedMentions : { parse: [] },
  };
}


function _handleListFallback(message, guildId, rows, deleteReply, deleteDelay) {
  if (!rows.length) {
    const p = embed.replyError(message, 'Aucun reminder actif sur ce serveur.', { timestamp: false }).catch(() => null);
    return p.then(sent => { if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay); });
  }

  const blocks = rows.slice(0, PAGE_SIZE).map((row, index) => {
    const label = row.customCommandName ? `**${row.customCommandName}**` : '**texte**';
    const chan = row.channelId ? `<#${row.channelId}>` : '`Aucun`';
    const repeat = row.repeatEvery
      ? `\`${_formatDuration(Number(row.repeatEvery) * 1000)}\``
      : '`aucune`';

    const lines = [
      `\`${index + 1}.\` ${label}`,
      `Salon : ${chan}`,
      `Date : <t:${row.remindAt}:F>`,
      `Echeance : <t:${row.remindAt}:R>`,
      `Repetition : ${repeat}`,
    ];

    if (row.customCommandName) {
      lines.push(`Commande custom : \`${row.customCommandName}\``);
    }

    return lines.join('\n');
  });

  const extra = rows.length > PAGE_SIZE
    ? `\n\nEt \`${rows.length - PAGE_SIZE}\` autre(s).`
    : '';

  return message.channel.send({
    embeds: [
      embed.build(guildId, `${blocks.join('\n\n')}${extra}`, {
        title    : 'Reminders actifs',
        timestamp: false,
      }),
    ],
    allowedMentions: { parse: [] },
  }).then(sent => {
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  }).catch(() => {});
}


async function _handleDelete(message, guildId, rawId, deleteReply, deleteDelay) {
  const input = String(rawId || '').trim().toLowerCase();

  if (['all', 'tout', '*'].includes(input)) {
    return _handleDeleteAll(message, guildId, deleteReply, deleteDelay);
  }

  const num = Number(rawId);

  if (!Number.isInteger(num) || num <= 0) {
    const sent = await embed.replyError(
      message,
      `Utilisation : \`${message.prefix || '+'}reminder del <numéro/all>\``,
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  let rows = [];
  try { rows = db.getRemindersByGuild(guildId) || []; } catch { rows = []; }


  let row = rows[num - 1] || null;
  let resolvedBy = 'index';

  if (!row) {
    try { row = db.getReminderById(num); } catch { row = null; }
    if (row && row.guildId !== guildId) row = null;
    resolvedBy = row ? 'dbid' : null;
  }

  if (!row) {
    const hint = rows.length
      ? `Numéros valides : 1 à ${rows.length}.`
      : 'Aucun reminder actif.';
    const sent = await embed.replyError(message, `Reminder introuvable. ${hint}`, { timestamp: false }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const dbId = row.id;
  const label = row.customCommandName ? `\`${row.customCommandName}\`` : 'texte';
  const chan = row.channelId ? `<#${row.channelId}>` : 'aucun salon';
  const repeat = row.repeatEvery
    ? `\`${_formatDuration(Number(row.repeatEvery) * 1000)}\``
    : '`aucune`';

  const targetLine = resolvedBy === 'dbid'
    ? `Cible : reminder ID interne \`${dbId}\``
    : `Cible : reminder \`#${num}\` (ID interne \`${dbId}\`)`;

  const summaryDesc = [
    `Supprimer ce reminder ?`,
    targetLine,
    `Type : ${label}`,
    `Salon : ${chan}`,
    `Date : <t:${row.remindAt}:F> (<t:${row.remindAt}:R>)`,
    `Repetition : ${repeat}`,
  ].join('\n');

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:reminder:cli:confirmdelete')
      .setLabel('Confirmer la suppression')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('local:reminder:cli:canceldelete')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary),
  );

  const confirmMsg = await message.reply({
    embeds          : [embed.build(guildId, summaryDesc, { color: '#ED4245', timestamp: false })],
    components      : [confirmRow],
    allowedMentions : { repliedUser: false, parse: [] },
  }).catch(() => null);

  if (!confirmMsg) return;

  embed.registerPrivateInteraction(confirmMsg, message.author.id, TIMEOUTS.CONFIRM_TIME_MS);

  let btn;
  try {
    btn = await confirmMsg.awaitMessageComponent({
      componentType : ComponentType.Button,
      filter        : i => i.user.id === message.author.id,
      time          : TIMEOUTS.CONFIRM_TIME_MS,
    });
  } catch {
    embed.clearPrivateInteraction(confirmMsg);
    await confirmMsg.edit({
      embeds     : [embed.build(guildId, 'Suppression annulée (timeout).', { timestamp: false })],
      components : [],
    }).catch(() => {});
    if (deleteReply) embed.scheduleDelete(confirmMsg, deleteDelay);
    return;
  }

  embed.clearPrivateInteraction(confirmMsg);

  if (btn.customId !== 'local:reminder:cli:confirmdelete') {
    await btn.update({
      embeds     : [embed.build(guildId, 'Suppression annulée.', { timestamp: false })],
      components : [],
    }).catch(() => {});
    if (deleteReply) embed.scheduleDelete(confirmMsg, deleteDelay);
    return;
  }

  try {
    db.deleteReminder(dbId);
  } catch {
    await btn.update({
      embeds     : [embed.build(guildId, 'Impossible d\'annuler ce reminder.', { color: '#ED4245', timestamp: false })],
      components : [],
    }).catch(() => {});
    if (deleteReply) embed.scheduleDelete(confirmMsg, deleteDelay);
    return;
  }

  try {
    if (db.countReminders() === 0) db.resetReminderSequence();
  } catch {}

  const summary = resolvedBy === 'dbid'
    ? `Reminder supprime (ID interne ${dbId}) : ${label} dans ${chan}.`
    : `Reminder #${num} supprime : ${label} dans ${chan}.`;

  await btn.update({
    embeds     : [embed.build(guildId, summary, { timestamp: false })],
    components : [],
  }).catch(() => {});

  if (deleteReply) embed.scheduleDelete(confirmMsg, deleteDelay);
}

async function _handleDeleteAll(message, guildId, deleteReply, deleteDelay) {
  let rows = [];

  try {
    rows = db.getRemindersByGuildRaw(guildId);
  } catch {
    rows = [];
  }

  if (!rows.length) {
    const sent = await embed.replyError(message, 'Aucun reminder a supprimer.', { timestamp: false }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  let deleted = 0;

  for (const row of rows) {
    try { db.deleteReminder(row.id); deleted++; } catch {}
  }

  try {
    if (db.countReminders() === 0) db.resetReminderSequence();
  } catch {}

  const sent = await embed.reply(message, `${deleted} reminder(s) supprime(s).`, { timestamp: false }).catch(() => null);
  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}


async function _handleLegacyCreate(message, args, guild, guildId, deleteReply, deleteDelay) {
  const duration = _parseDuration(args[0]);
  const remindAt = Math.floor((Date.now() + duration) / 1000);

  let channelId = message.channel.id;
  let textStart = 1;

  if (args[1]) {
    const clean = args[1].replace(/[<#>]/g, '');

    if (/^\d{17,20}$/.test(clean)) {
      const ch = guild.channels.cache.get(clean);

      if (ch && _isTextChannel(ch)) {
        channelId = ch.id;
        textStart = 2;
      }
    }
  }

  const text = args.slice(textStart).join(' ').trim();

  if (!text) {
    const sent = await embed.replyError(
      message,
      `Utilisation : \`${message.prefix || '+'}reminder <duree> [#salon] <message>\``,
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  let reminderId;

  try {
    reminderId = db.addReminder(guildId, message.author.id, channelId, text, remindAt);
  } catch {
    const sent = await embed.replyError(message, 'Impossible de creer le reminder.', { timestamp: false }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const sent = await embed.reply(
    message,
    `Reminder \`${reminderId}\` programme <t:${remindAt}:R> dans <#${channelId}>.`,
    { timestamp: false }
  ).catch(() => null);
  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}


async function _updateOrGone(panel, guildId, row, data) {
  const ok = db.updateReminder(row.id, data);

  if (!ok) {
    await panel.edit({
      embeds     : [embed.build(guildId, 'Ce reminder n\'existe plus.', { color: '#ED4245', timestamp: false })],
      components : [],
    }).catch(() => {});
    return false;
  }

  return true;
}

async function _refreshPanel(panel, guildId, row) {
  const fresh = db.getReminderById(row.id);
  const data = fresh || row;
  Object.assign(row, data);

  await panel.edit({
    embeds     : [_buildPanelEmbed(guildId, data)],
    components : _buildPanelComponents(),
  }).catch(() => {});
}

async function _resolveTextChannel(guild, query) {
  if (!query || typeof query !== 'string') return null;

  const clean = query.replace(/[<#>]/g, '');

  if (/^\d{17,20}$/.test(clean)) {
    const channel =
      guild.channels.cache.get(clean) ??
      await guild.channels.fetch(clean).catch(() => null);

    return _isTextChannel(channel) ? channel : null;
  }

  const lower = _normalizeChannelName(query);

  return guild.channels.cache.find(ch =>
    _isTextChannel(ch) &&
    _normalizeChannelName(ch.name) === lower
  ) ?? null;
}

function _normalizeChannelName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^#/, '')
    .trim();
}

function _isTextChannel(channel) {
  return Boolean(
    channel &&
    (
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement
    )
  );
}

function _parseDuration(input) {
  if (!input) return null;

  const str = String(input).trim().toLowerCase();
  const match = str.match(/^(\d+)\s*(s|sec|secs|m|min|mins|h|d|j|w|sem)$/i);

  if (!match) return null;

  const value = Number(match[1]);
  const unit  = match[2];

  if (!Number.isFinite(value) || value <= 0) return null;

  if (['s', 'sec', 'secs'].includes(unit)) return value * 1000;
  if (['m', 'min', 'mins'].includes(unit)) return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  if (['d', 'j'].includes(unit)) return value * 24 * 60 * 60 * 1000;
  if (['w', 'sem'].includes(unit)) return value * 7 * 24 * 60 * 60 * 1000;

  return null;
}

function _parseDateTime(input) {
  if (!input) return null;


  const full = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[hH:](\d{0,2})$/);

  if (full) {
    const [, day, month, year, hours, minutes] = full;
    const d = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes || 0));

    if (isNaN(d.getTime())) return null;
    return Math.floor(d.getTime() / 1000);
  }


  const dateOnly = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (dateOnly) {
    const [, day, month, year] = dateOnly;
    const now = new Date();
    const d = new Date(Number(year), Number(month) - 1, Number(day), now.getHours(), now.getMinutes());

    if (isNaN(d.getTime())) return null;
    return Math.floor(d.getTime() / 1000);
  }


  const timeOnly = input.match(/^(\d{1,2})[hH:](\d{0,2})$/);

  if (timeOnly) {
    const [, hours, minutes] = timeOnly;
    const h = Number(hours);
    const hasMinutes = minutes.length > 0;

    if (h >= 13 || hasMinutes) {
      const now = new Date();
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, Number(minutes || 0));

      if (isNaN(d.getTime())) return null;

      if (d.getTime() <= Date.now()) {
        d.setDate(d.getDate() + 1);
      }

      return Math.floor(d.getTime() / 1000);
    }
  }


  const durInput = input.startsWith('+') ? input.slice(1) : input;
  const ms = _parseDuration(durInput);
  if (ms) return Math.floor((Date.now() + ms) / 1000);

  return null;
}

function _formatDuration(ms) {
  if (!ms || ms <= 0) return '-';

  const seconds = Math.floor(ms / 1000);

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;

  return `${Math.floor(seconds / 604800)}sem`;
}

