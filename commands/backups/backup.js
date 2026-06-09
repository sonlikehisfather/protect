'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionsBitField,
  OverwriteType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');

const V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_OK   = typeof ContainerBuilder === 'function' &&
                typeof TextDisplayBuilder === 'function';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups');
const IDLE_MS    = 120_000;
const TOTAL_MS   = 300_000;
const PAGE_SIZE  = 25;

exports.help = {
  name        : 'backup',
  description : 'Create, manage and restore a server backup.',
  usage       : 'backup [create|list|info|delete|load] [id]',
  aliases     : ['backups', 'sauvegarde'],
  category    : 'owner',
};

exports.run = async (client, message, args) => {
  if (!perms.check(message, exports.help.name)) return;

  const guild   = message.guild;
  const guildId = guild.id;
  const config  = db.getGuildConfig(guildId);

  if (Boolean(config?.autoDeleteModCmds)) await message.delete().catch(() => {});

  const sub = args[0]?.toLowerCase();

  if (sub === 'create' || sub === 'créer' || sub === 'creer') {
    return _standalonCreate(message, args.slice(1));
  }
  if (sub === 'list' || sub === 'liste') {
    return _openPanel(message, { view: 'list' });
  }
  if (sub === 'info' || sub === 'show') {
    const b = _getBackupOrNull(args[1]);
    return _openPanel(message, { view: b ? 'detail' : 'home', selected: b });
  }
  if (sub === 'delete' || sub === 'del' || sub === 'remove' || sub === 'supprimer') {
    const b = _getBackupOrNull(args[1]);
    return _openPanel(message, { view: b ? 'confirm_del' : 'home', selected: b });
  }
  if (sub === 'clear' || sub === 'clean' || sub === 'vider') {
    return _openPanel(message, { view: 'confirm_clear' });
  }
  if (sub === 'load' || sub === 'restore' || sub === 'restaurer') {
    const b = _getBackupOrNull(args[1]);
    return _openPanel(message, { view: b ? 'confirm_load' : 'home', selected: b });
  }

  return _openPanel(message, { view: 'home' });
};

async function _openPanel(message, initialState = {}) {
  const guildId = message.guild.id;

  const state = {
    view     : initialState.view     ?? 'home',
    selected : initialState.selected ?? null,
    page     : 0,
    status   : initialState.status   ?? null,
  };

  const build = (disabled = false) => _buildPanelPayload(guildId, state, disabled);

  const panel = await message.channel.send(build()).catch(() => null);
  if (!panel) return;

  embed.registerPrivateInteraction(panel, message.author.id, TOTAL_MS);

  const collector = panel.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id && i.message.id === panel.id,
    idle   : IDLE_MS,
    time   : TOTAL_MS,
  });

  const refresh = async (i) => {
    const payload = build();
    const { flags: _flags, ...editPayload } = payload;
    await i.deferUpdate().catch(() => {});
    await panel.edit(editPayload).catch(() => {});
  };

  collector.on('collect', async i => {
    const id = i.customId;

    if (id === 'bp:close') {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await i.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      await message.delete().catch(() => {});
      return;
    }

    if (id === 'bp:home') {
      state.view = 'home'; state.selected = null; state.status = null;
      await refresh(i); return;
    }

    if (id === 'bp:action') {
      const action = i.values[0];
      if (action === 'create') {
        state.view = 'creating'; state.status = null;
        await refresh(i);
        const backup = await _doCreate(message).catch(() => null);
        if (backup) {
          state.view = 'created'; state.selected = backup;
        } else {
          state.view = 'home'; state.status = '× Erreur lors de la création.';
        }
        await panel.edit(build()).catch(() => {});
        return;
      }
      if (action === 'list')  { state.view = 'list';       state.page = 0; state.selected = null; state.status = null; await refresh(i); return; }
      if (action === 'info')  { state.view = 'info_select'; state.selected = null; state.status = null; await refresh(i); return; }
      if (action === 'clear') { state.view = 'confirm_clear'; state.status = null; await refresh(i); return; }
      return;
    }

    if (id === 'bp:info:select') {
      const allBackups = _readAllBackups().sort((a, b) => b.createdAt - a.createdAt);
      state.selected = allBackups.find(b => b.id === i.values[0]) ?? null;
      state.view = state.selected ? 'detail' : 'info_select';
      await refresh(i); return;
    }

    if (id === 'bp:list:select') {
      const allBackups = _readAllBackups().sort((a, b) => b.createdAt - a.createdAt);
      state.selected = allBackups.find(b => b.id === i.values[0]) ?? null;
      await refresh(i); return;
    }

    if (id === 'bp:list:prev') { state.page = Math.max(0, state.page - 1); state.selected = null; await refresh(i); return; }
    if (id === 'bp:list:next') {
      const total = Math.ceil(_readAllBackups().length / PAGE_SIZE);
      state.page = Math.min(total - 1, state.page + 1); state.selected = null; await refresh(i); return;
    }

    if (id === 'bp:list')         { state.view = 'list';         state.status = null; state.page = 0; await refresh(i); return; }
    if (id === 'bp:detail')       { state.view = state.selected ? 'detail' : 'list'; state.status = null; await refresh(i); return; }
    if (id === 'bp:confirm_del')  { state.view = state.selected ? 'confirm_del'  : 'list'; state.status = null; await refresh(i); return; }
    if (id === 'bp:confirm_load') { state.view = state.selected ? 'confirm_load' : 'list'; state.status = null; await refresh(i); return; }

    if (id === 'bp:rename') {
      if (!state.selected) return;
      try {
        const modal = new ModalBuilder()
          .setCustomId(`bp:rename:submit:${state.selected.id}`)
          .setTitle('Rename backup');
        const input = new TextInputBuilder()
          .setCustomId('bp:rename:name')
          .setLabel('New name')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(64)
          .setRequired(true)
          .setValue(state.selected.name || '');
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await i.showModal(modal);
        const submitted = await i.awaitModalSubmit({
          filter: m => m.customId === `bp:rename:submit:${state.selected?.id}` && m.user.id === i.user.id,
          time: 120_000,
        }).catch(() => null);
        if (!submitted) return;
        const newName = submitted.fields.getTextInputValue('bp:rename:name')?.trim();
        if (newName && state.selected) {
          const updated = _renameBackup(state.selected.id, newName);
          if (updated) { state.selected = updated; state.status = null; }
        }
        const { flags: _mf, ...modalEdit } = build();
        await submitted.reply({ content: '\u2714 Renomm\u00e9.', flags: MessageFlags.Ephemeral }).catch(() => {});
        await panel.edit(modalEdit).catch(() => {});
      } catch (err) {
        console.error('[backup:rename] crash:', err);
      }
      return;
    }

    if (id === 'bp:do_del') {
      if (!state.selected) { state.view = 'home'; await refresh(i); return; }
      const ok = _deleteBackupFile(state.selected.id);
      state.status   = ok ? `✔ Backup \`${state.selected.id}\` supprimée.` : '× Impossible de supprimer.';
      state.selected = null;
      state.view     = 'list';
      await refresh(i); return;
    }

    if (id === 'bp:do_clear') {
      const result   = _clearAllBackups();
      state.view     = 'home';
      state.status   = `✔ **${result.deleted}** sauvegarde(s) supprimée(s).${result.errors.length ? ` › ${result.errors.length} erreur(s).` : ''}`;
      state.selected = null;
      await refresh(i); return;
    }

    if (id === 'bp:do_load') {
      if (!state.selected) { state.view = 'home'; await refresh(i); return; }
      const me = message.guild.members.me;
      if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles) ||
          !me.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
          !me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        state.status = '× Permissions insuffisantes (Gérer rôles, salons, serveur requis).';
        state.view   = 'confirm_load';
        await refresh(i); return;
      }
      const v = _validateBackup(state.selected);
      if (!v.ok) { state.status = `× Backup invalide : ${v.reason}`; await refresh(i); return; }

      state.view   = 'loading';
      state.status = null;
      const loadPayload = build(true);
      const { flags: _lf, ...loadEdit } = loadPayload;
      await i.deferUpdate().catch(() => {});
      await panel.edit(loadEdit).catch(() => {});

      const result = await _restoreBackup(message.guild, state.selected);
      state.view     = 'loaded';
      state.status   = `✔ Restauration terminée › ${result.rolesCreated} rôles, ${result.channelsCreated} salons${result.errors.length ? `, ${result.errors.length} erreur(s)` : ''}.`;
      state.selected = null;
      const { flags: _rf, ...restoredEdit } = build();
      await panel.edit(restoredEdit).catch(() => {});
      return;
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(panel);
    if (['closed'].includes(reason)) return;
    const { flags: _ef, ...expiredEdit } = build(true);
    panel.edit(expiredEdit).catch(() => {});
  });
}

function _buildPanelPayload(guildId, state, disabled = false) {
  const { view, selected, page, status } = state;
  const allBackups = _readAllBackups().sort((a, b) => b.createdAt - a.createdAt);
  const totalPages = Math.max(1, Math.ceil(allBackups.length / PAGE_SIZE));
  const slice      = allBackups.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const rows = [];
  let bodyLines = [];
  let accent = 0x5865F2;

  if (view === 'home' || view === 'created') {
    accent = view === 'created' ? 0x57F287 : 0x5865F2;
    bodyLines = [
      '## »  Backup manager',
      '',
      `**Available backups** › ${allBackups.length}`,
    ];
    if (status) bodyLines.push('', status);
    bodyLines.push('', '-# The system is limited to 25 backups max.');
    if (view === 'created' && selected) {
      bodyLines.push(
        '',
        '### Backup created',
        `**ID** › \`${selected.id}\``,
        `**Name** › ${_esc(selected.name || 'Unnamed')}`,
        `**Roles** › ${selected.roles.length}  ·  **Channels** › ${selected.channels.length}  ·  **Emojis** › ${selected.emojis?.length ?? 0}`,
        `-# ${_fmt(selected.createdAt)}`,
      );
    }
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('bp:action')
        .setPlaceholder('Choose an action…')
        .setDisabled(disabled)
        .addOptions([
          { label: 'Create a backup',    value: 'create', description: 'Save roles, channels, emojis…' },
          { label: 'List backups',       value: 'list',   description: 'View, load or delete' },
          { label: 'Backup info',        value: 'info',   description: 'Details of a backup' },
          { label: 'Delete all',         value: 'clear',  description: 'Remove all backups' },
        ])
    ));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bp:close').setLabel('×').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    ));
  }

  else if (view === 'creating') {
    accent = 0xFEE75C;
    bodyLines = ['## ◌  Creating backup…', '', '›  Saving roles, channels and assets…'];
  }

  else if (view === 'list') {
    accent = 0x5865F2;
    bodyLines = [
      `## ≡  Backups (${allBackups.length})`,
    ];
    if (totalPages > 1) bodyLines.push(`-# Page ${page + 1} / ${totalPages}`);
    if (status) bodyLines.push('', status);

    if (!allBackups.length) {
      bodyLines.push('', 'No backups available.');
    } else if (selected) {
      bodyLines.push(
        '',
        `### ${_esc(selected.name || 'Unnamed')}`,
        `**ID** › \`${selected.id}\``,
        `**Server** › ${_esc(selected.guildName || 'Unknown')}`,
        `**Roles** › ${selected.roles.length}  ·  **Channels** › ${selected.channels.length}  ·  **Emojis** › ${selected.emojis?.length ?? 0}`,
        `-# Created ${_fmt(selected.createdAt)}`,
      );
    }

    if (slice.length) {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('bp:list:select')
          .setPlaceholder('Select a backup…')
          .setDisabled(disabled)
          .addOptions(slice.map(b => ({
            label      : `${_esc(b.name || 'Unnamed')} · ${b.id}`.slice(0, 100),
            description: `${_esc(b.guildName || '?')} · ${b.roles.length}R / ${b.channels.length}S`.slice(0, 100),
            value      : b.id,
            default    : selected?.id === b.id,
          })))
      ));
    }

    const actionBtns = [
      new ButtonBuilder().setCustomId('bp:detail').setLabel('Info').setStyle(ButtonStyle.Primary).setDisabled(disabled || !selected),
      new ButtonBuilder().setCustomId('bp:confirm_load').setLabel('Load').setStyle(ButtonStyle.Danger).setDisabled(disabled || !selected),
      new ButtonBuilder().setCustomId('bp:confirm_del').setLabel('Delete').setStyle(ButtonStyle.Secondary).setDisabled(disabled || !selected),
    ];
    rows.push(new ActionRowBuilder().addComponents(...actionBtns));

    const navRow = [
      new ButtonBuilder().setCustomId('bp:list:prev').setLabel('‹').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 0),
      new ButtonBuilder().setCustomId('bp:list:next').setLabel('›').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page >= totalPages - 1),
      new ButtonBuilder().setCustomId('bp:home').setLabel('« Home').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:close').setLabel('×').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    ];
    rows.push(new ActionRowBuilder().addComponents(...navRow));
  }

  else if (view === 'detail' && selected) {
    accent = 0x5865F2;
    bodyLines = [
      `## §  ${_esc(selected.name || 'Unnamed')}`,
      '',
      `**ID** › \`${selected.id}\``,
      `**Source server** › ${_esc(selected.guildName || 'Unknown')} (\`${selected.guildId}\`)`,
      `**Created by** › ${selected.createdBy ? `<@${selected.createdBy}>` : 'Unknown'}`,
      '',
      `**Roles** › ${selected.roles.length}  ·  **Channels** › ${selected.channels.length}`,
      `**Emojis** › ${selected.emojis?.length ?? 0}  ·  **Stickers** › ${selected.stickers?.length ?? 0}`,
      `**Icon** › ${selected.hasIcon ? 'Yes' : 'No'}  ·  **Banner** › ${selected.hasBanner ? 'Yes' : 'No'}`,
      '',
      `-# Created ${_fmt(selected.createdAt)}`,
    ];
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bp:confirm_load').setLabel('Load').setStyle(ButtonStyle.Danger).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:rename').setLabel('~ Rename').setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:confirm_del').setLabel('Delete').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:list').setLabel('« Back').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:close').setLabel('×').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    ));
  }

  else if (view === 'confirm_del' && selected) {
    accent = 0xED4245;
    bodyLines = [
      '## ×  Delete this backup?',
      '',
      `**ID** › \`${selected.id}\``,
      `**Name** › ${_esc(selected.name || 'Unnamed')}`,
      `**Server** › ${_esc(selected.guildName || 'Unknown')}`,
      '',
      '> ‼ This action is **irreversible**.',
    ];
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bp:do_del').setLabel('Confirm').setStyle(ButtonStyle.Danger).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:detail').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:close').setLabel('×').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    ));
  }

  else if (view === 'confirm_clear') {
    accent = 0xED4245;
    bodyLines = [
      '## ×  Delete all backups?',
      '',
      `**${allBackups.length}** backup(s) will be permanently deleted.`,
      '',
      '> ‼ This action is **irreversible**.',
    ];
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bp:do_clear').setLabel('Delete all').setStyle(ButtonStyle.Danger).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:home').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:close').setLabel('×').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    ));
  }

  else if (view === 'confirm_load' && selected) {
    accent = 0xED4245;
    bodyLines = [
      '## »  Restore this backup?',
      '',
      `**ID** › \`${selected.id}\`  ·  **${_esc(selected.name || 'Unnamed')}**`,
      `**Source** › ${_esc(selected.guildName || 'Unknown')}`,
      `**Roles** › ${selected.roles.length}  ·  **Channels** › ${selected.channels.length}`,
      '',
      '> ‼ Existing channels and roles will be **deleted** and recreated.',
      '> This action is **irreversible**.',
    ];
    if (status) bodyLines.push('', status);
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bp:do_load').setLabel('Confirm').setStyle(ButtonStyle.Danger).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:detail').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:close').setLabel('×').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    ));
  }

  else if (view === 'info_select') {
    accent = 0x5865F2;
    bodyLines = [
      '## §  Backup info',
      '',
      allBackups.length ? 'Select a backup to view its details.' : 'No backups available.',
    ];
    if (allBackups.length) {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('bp:info:select')
          .setPlaceholder('Choose a backup…')
          .setDisabled(disabled)
          .addOptions(allBackups.slice(0, 25).map(b => ({
            label      : `${_esc(b.name || 'Unnamed')} · ${b.id}`.slice(0, 100),
            description: `${_esc(b.guildName || '?')} · ${b.roles.length}R / ${b.channels.length}S`.slice(0, 100),
            value      : b.id,
          })))
      ));
    }
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bp:home').setLabel('« Home').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:close').setLabel('×').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    ));
  }

  else if (view === 'loading') {
    accent = 0xFEE75C;
    bodyLines = ['## ◌  Restoring backup…', '', '›  Rebuilding roles and channels…'];
  }

  else if (view === 'loaded') {
    accent = 0x57F287;
    bodyLines = ['## +  Restore complete'];
    if (status) bodyLines.push('', status);
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bp:home').setLabel('« Home').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:close').setLabel('×').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    ));
  }

  else {
    bodyLines = ['## »  Backup manager'];
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bp:home').setLabel('« Home').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('bp:close').setLabel('×').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    ));
  }

  if (V2_OK) {
    const c = new ContainerBuilder().setAccentColor(accent);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyLines.join('\n')));
    if (rows.length) {
      c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
      c.addActionRowComponents(...rows);
    }
    return { flags: V2_FLAG, components: [c], allowedMentions: { parse: [] } };
  }

  return {
    embeds     : [embed.build(guildId, bodyLines.join('\n'), { title: 'Gestion des sauvegardes', timestamp: false })],
    components : rows,
    allowedMentions: { parse: [] },
  };
}

async function _standalonCreate(message, nameArgs) {
  const guild = message.guild;
  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);
  await guild.emojis.fetch().catch(() => null);
  await guild.stickers.fetch().catch(() => null);
  const backup = await _serializeGuild(guild, message.author.id, nameArgs.join(' ').trim());
  await _writeBackupWithAssets(backup.id, backup, guild);
  return _openPanel(message, { view: 'created', selected: backup });
}

async function _doCreate(message) {
  const guild = message.guild;
  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);
  await guild.emojis.fetch().catch(() => null);
  await guild.stickers.fetch().catch(() => null);
  const backup = await _serializeGuild(guild, message.author.id, '');
  await _writeBackupWithAssets(backup.id, backup, guild);
  return backup;
}

function _renameBackup(id, newName) {
  const safeId = _safeId(id);
  if (!safeId) return false;
  const filePath = fs.existsSync(path.join(BACKUP_DIR, safeId, 'backup.json'))
    ? path.join(BACKUP_DIR, safeId, 'backup.json')
    : fs.existsSync(path.join(BACKUP_DIR, `${safeId}.json`))
      ? path.join(BACKUP_DIR, `${safeId}.json`)
      : null;
  if (!filePath) return false;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.name  = newName.slice(0, 64).trim();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return data;
  } catch { return false; }
}


async function _serializeGuild(guild, createdBy, name) {
  const roles = guild.roles.cache
    .filter(role => role.id !== guild.id && !role.managed)
    .sort((a, b) => a.position - b.position)
    .map(role => ({
      oldId       : role.id,
      name        : role.name,
      color       : role.color,
      hoist       : role.hoist,
      mentionable : role.mentionable,
      permissions : role.permissions.bitfield.toString(),
      position    : role.position,
      rawPosition : role.rawPosition ?? role.position,
    }));

  const channels = guild.channels.cache
    .filter(ch => ch.type !== ChannelType.DM && ch.type !== ChannelType.GroupDM)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map(ch => ({
      oldId                         : ch.id,
      parentId                      : ch.parentId,
      type                          : ch.type,
      name                          : ch.name,
      topic                         : ch.topic ?? null,
      nsfw                          : Boolean(ch.nsfw),
      bitrate                       : ch.bitrate ?? null,
      userLimit                     : ch.userLimit ?? null,
      rateLimitPerUser              : ch.rateLimitPerUser ?? null,
      position                      : ch.rawPosition,
      defaultAutoArchiveDuration    : ch.defaultAutoArchiveDuration ?? null,
      defaultReactionEmoji          : ch.defaultReactionEmoji ?? null,
      defaultThreadRateLimitPerUser : ch.defaultThreadRateLimitPerUser ?? null,
      defaultSortOrder              : ch.defaultSortOrder ?? null,
      defaultForumLayout            : ch.defaultForumLayout ?? null,
      availableTags                 : Array.isArray(ch.availableTags)
        ? ch.availableTags.map(t => ({ name: t.name, moderated: Boolean(t.moderated), emojiId: t.emoji?.id ?? null, emojiName: t.emoji?.name ?? null }))
        : [],
      permissionOverwrites: ch.permissionOverwrites.cache.map(o => ({
        id   : o.id,
        type : o.type,
        allow: o.allow.bitfield.toString(),
        deny : o.deny.bitfield.toString(),
      })),
    }));

  const emojis = guild.emojis.cache.map(e => ({
    id      : e.id,
    name    : e.name,
    animated: e.animated,
    url     : e.imageURL({ extension: e.animated ? 'gif' : 'png', size: 128 }),
  }));

  const stickers = guild.stickers.cache.map(s => ({
    id         : s.id,
    name       : s.name,
    description: s.description ?? null,
    tags       : s.tags ?? [],
    format     : s.format,
    url        : s.url,
  }));

  return {
    version   : 2,
    id        : _makeId(),
    name      : name || null,
    guildId   : guild.id,
    guildName : guild.name,
    createdAt : Math.floor(Date.now() / 1000),
    createdBy,
    roles,
    channels,
    emojis,
    stickers,
    hasIcon  : !!guild.iconURL(),
    hasBanner: !!guild.bannerURL(),
  };
}

async function _restoreBackup(guild, backup) {
  const result = {
    guildRenamed   : false, iconRestored : false, bannerRestored: false,
    rolesDeleted   : 0,     channelsDeleted: 0,
    rolesCreated   : 0,     channelsCreated: 0,
    emojisCreated  : 0,     stickersCreated: 0,
    errors         : [],
  };

  const roleMap    = new Map([[backup.guildId, guild.id], [guild.id, guild.id]]);
  const userMap    = new Map();
  const channelMap = new Map();
  const me         = guild.members.me;

  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);

  if (backup.guildName && guild.name !== backup.guildName)
    await guild.setName(backup.guildName, `Restauration ${backup.id}`)
      .then(() => { result.guildRenamed = true; })
      .catch(err => result.errors.push(`Nom: ${err.message}`));

  await _clearGuild(guild, result);
  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);

  for (const role of [...backup.roles].sort((a, b) => _rolePos(b) - _rolePos(a))) {
    try {
      const safePerms = BigInt(role.permissions) & ~PermissionsBitField.Flags.Administrator;
      const created   = await guild.roles.create({
        name: role.name, hoist: role.hoist, mentionable: role.mentionable,
        permissions: safePerms, reason: `Restauration ${backup.id}`,
      });
      roleMap.set(role.oldId, created.id);
      result.rolesCreated++;
    } catch (err) { result.errors.push(`Rôle ${role.name}: ${err.message}`); }
  }

  const cats   = backup.channels.filter(c => c.type === ChannelType.GuildCategory);
  const others = backup.channels.filter(c => c.type !== ChannelType.GuildCategory);

  for (const ch of [...cats, ...others]) {
    try {
      const opts = {
        name: ch.name, type: ch.type, reason: `Restauration ${backup.id}`,
        permissionOverwrites: _mapOverwrites(ch.permissionOverwrites, roleMap, userMap, guild),
      };
      if (ch.parentId && channelMap.has(ch.parentId)) opts.parent = channelMap.get(ch.parentId);
      if (ch.topic)                    opts.topic                         = ch.topic;
      if (ch.nsfw != null)             opts.nsfw                          = ch.nsfw;
      if (ch.bitrate)                  opts.bitrate                       = ch.bitrate;
      if (ch.userLimit != null)        opts.userLimit                     = ch.userLimit;
      if (ch.rateLimitPerUser != null) opts.rateLimitPerUser              = ch.rateLimitPerUser;
      if (ch.defaultAutoArchiveDuration != null) opts.defaultAutoArchiveDuration = ch.defaultAutoArchiveDuration;
      if (ch.defaultReactionEmoji != null)       opts.defaultReactionEmoji       = ch.defaultReactionEmoji;
      if (ch.defaultThreadRateLimitPerUser != null) opts.defaultThreadRateLimitPerUser = ch.defaultThreadRateLimitPerUser;
      if (ch.defaultSortOrder != null) opts.defaultSortOrder = ch.defaultSortOrder;
      if (ch.defaultForumLayout != null) opts.defaultForumLayout = ch.defaultForumLayout;
      if (Array.isArray(ch.availableTags) && ch.availableTags.length) opts.availableTags = ch.availableTags;

      const created = await guild.channels.create(opts);
      channelMap.set(ch.oldId, created.id);
      result.channelsCreated++;
    } catch (err) { result.errors.push(`Salon ${ch.name}: ${err.message}`); }
  }

  await _applyPositions(guild, backup, roleMap, channelMap, result, me);
  await _restoreAssets(guild, backup, result);
  return result;
}

async function _clearGuild(guild, result) {
  for (const ch of [...guild.channels.cache.values()].filter(c => c.deletable).sort((a, b) => b.rawPosition - a.rawPosition))
    await ch.delete('Nettoyage backup').then(() => result.channelsDeleted++).catch(err => result.errors.push(`Del salon ${ch.name}: ${err.message}`));

  await guild.channels.fetch().catch(() => null);

  for (const r of [...guild.roles.cache.values()].filter(r => r.id !== guild.id && !r.managed && r.editable).sort((a, b) => b.position - a.position))
    await r.delete('Nettoyage backup').then(() => result.rolesDeleted++).catch(err => result.errors.push(`Del rôle ${r.name}: ${err.message}`));
}

async function _applyPositions(guild, backup, roleMap, channelMap, result, me) {
  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);

  const maxPos = Math.max(me.roles.highest.position - 1, 1);
  const rPos   = backup.roles
    .filter(r => roleMap.has(r.oldId))
    .sort((a, b) => _rolePos(b) - _rolePos(a))
    .map(r => ({ role: roleMap.get(r.oldId), position: Math.min(Math.max(_rolePos(r), 1), maxPos) }));
  if (rPos.length) await guild.roles.setPositions(rPos).catch(err => result.errors.push(`Pos rôles: ${err.message}`));

  await guild.channels.fetch().catch(() => null);

  for (const [i, ch] of backup.channels.filter(c => c.type === ChannelType.GuildCategory && channelMap.has(c.oldId)).sort((a, b) => a.position - b.position).entries()) {
    const c = guild.channels.cache.get(channelMap.get(ch.oldId));
    if (c) await c.setPosition(i).catch(() => {});
  }

  await guild.channels.fetch().catch(() => null);

  const groups = new Map();
  for (const ch of backup.channels) {
    if (ch.type === ChannelType.GuildCategory || !channelMap.has(ch.oldId)) continue;
    const key = ch.parentId && channelMap.has(ch.parentId) ? ch.parentId : 'root';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ch);
  }
  for (const chs of groups.values()) {
    chs.sort((a, b) => a.position - b.position);
    for (const [i, ch] of chs.entries()) {
      const c = guild.channels.cache.get(channelMap.get(ch.oldId));
      if (c) await c.setPosition(i).catch(() => {});
    }
  }
}

async function _restoreAssets(guild, backup, result) {
  const dir = path.join(BACKUP_DIR, backup.id);

  const iconPath = path.join(dir, 'icon.png');
  if (backup.hasIcon && fs.existsSync(iconPath))
    await guild.setIcon(iconPath).then(() => result.iconRestored = true).catch(err => result.errors.push(`Icône: ${err.message}`));

  const bannerPath = path.join(dir, 'banner.png');
  if (backup.hasBanner && fs.existsSync(bannerPath))
    await guild.setBanner(bannerPath).then(() => result.bannerRestored = true).catch(err => result.errors.push(`Bannière: ${err.message}`));

  if (backup.emojis?.length) {
    const emojiDir = path.join(dir, 'emojis');
    for (const e of backup.emojis) {
      const p = path.join(emojiDir, `${e.id}.${e.animated ? 'gif' : 'png'}`);
      if (!fs.existsSync(p)) continue;
      try { await guild.emojis.create({ attachment: p, name: e.name }); result.emojisCreated++; }
      catch (err) { if (err.code === 30008) break; result.errors.push(`Emoji ${e.name}: ${err.message}`); }
    }
  }

  if (backup.stickers?.length) {
    const stickerDir = path.join(dir, 'stickers');
    for (const s of backup.stickers) {
      const p = path.join(stickerDir, `${s.id}.png`);
      if (!fs.existsSync(p)) continue;
      try { await guild.stickers.create({ file: p, name: s.name, description: s.description || s.name, tags: s.tags?.[0] || s.name }); result.stickersCreated++; }
      catch (err) { if (err.code === 30039) break; result.errors.push(`Sticker ${s.name}: ${err.message}`); }
    }
  }
}

function _mapOverwrites(overwrites, roleMap, userMap, guild) {
  const mapped = [];
  for (const o of overwrites || []) {
    let id = o.id;
    if (o.id === guild.id) { id = guild.id; }
    else if (o.type === OverwriteType.Role || o.type === 0) {
      if (!roleMap.has(o.id)) continue;
      id = roleMap.get(o.id);
    } else if (o.type === OverwriteType.Member || o.type === 1) {
      if (!guild.members.cache.has(o.id) && !userMap.has(o.id)) continue;
      userMap.set(o.id, o.id); id = o.id;
    } else continue;
    mapped.push({ id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) });
  }
  return mapped;
}

function _ensureDir() { fs.mkdirSync(BACKUP_DIR, { recursive: true }); }

async function _writeBackupWithAssets(id, payload, guild) {
  _ensureDir();
  const dir = path.join(BACKUP_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'backup.json'), JSON.stringify(payload, null, 2), 'utf8');

  const dl = [];
  if (payload.hasIcon) {
    const u = guild.iconURL({ extension: 'png', size: 4096 });
    if (u) dl.push(_download(u, path.join(dir, 'icon.png')));
  }
  if (payload.hasBanner) {
    const u = guild.bannerURL({ extension: 'png', size: 4096 });
    if (u) dl.push(_download(u, path.join(dir, 'banner.png')));
  }
  if (payload.emojis?.length) {
    const ed = path.join(dir, 'emojis');
    fs.mkdirSync(ed, { recursive: true });
    for (const e of payload.emojis)
      if (e.url) dl.push(_download(e.url, path.join(ed, `${e.id}.${e.animated ? 'gif' : 'png'}`)));
  }
  if (payload.stickers?.length) {
    const sd = path.join(dir, 'stickers');
    fs.mkdirSync(sd, { recursive: true });
    for (const s of payload.stickers)
      if (s.url) dl.push(_download(s.url, path.join(sd, `${s.id}.png`)));
  }
  await Promise.allSettled(dl);
}

function _download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { timeout: 30000 }, res => {
      if (res.statusCode !== 200) { file.close(); try { fs.unlinkSync(dest); } catch {} reject(new Error(`${res.statusCode}`)); return; }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { file.close(); try { fs.unlinkSync(dest); } catch {} reject(err); });
  });
}

function _readAllBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  const backups = [];
  for (const entry of fs.readdirSync(BACKUP_DIR)) {
    const full = path.join(BACKUP_DIR, entry);
    const stat = fs.statSync(full);
    if (stat.isFile() && entry.endsWith('.json')) { const p = _readFile(full); if (p) backups.push(p); continue; }
    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(full))
        if (f.endsWith('.json')) { const p = _readFile(path.join(full, f)); if (p) backups.push(p); }
    }
  }
  const unique = new Map();
  for (const b of backups) if (b?.id && !unique.has(b.id)) unique.set(b.id, b);
  return [...unique.values()];
}

function _getBackupOrNull(id) {
  const safeId = _safeId(id);
  if (!safeId) return null;
  const dirFile = path.join(BACKUP_DIR, safeId, 'backup.json');
  if (fs.existsSync(dirFile)) return _readFile(dirFile);
  const flat = path.join(BACKUP_DIR, `${safeId}.json`);
  if (fs.existsSync(flat)) return _readFile(flat);
  return null;
}

function _deleteBackupFile(id) {
  const safeId = _safeId(id);
  if (!safeId) return false;
  const dir = path.join(BACKUP_DIR, safeId);
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) { fs.rmSync(dir, { recursive: true, force: true }); return true; }
  const flat = path.join(BACKUP_DIR, `${safeId}.json`);
  if (fs.existsSync(flat)) { fs.unlinkSync(flat); return true; }
  return false;
}

function _clearAllBackups() {
  const result = { deleted: 0, errors: [] };
  if (!fs.existsSync(BACKUP_DIR)) return result;
  for (const entry of fs.readdirSync(BACKUP_DIR)) {
    const full = path.join(BACKUP_DIR, entry);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && entry.endsWith('.json')) { fs.unlinkSync(full); result.deleted++; }
      else if (stat.isDirectory()) { fs.rmSync(full, { recursive: true, force: true }); result.deleted++; }
    } catch (err) { result.errors.push(`${entry}: ${err.message}`); }
  }
  return result;
}

function _readFile(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function _validateBackup(b) {
  if (!b || typeof b !== 'object')            return { ok: false, reason: 'format invalide' };
  if (b.version !== 1 && b.version !== 2)     return { ok: false, reason: 'version non supportée' };
  if (!b.id || !_safeId(b.id))               return { ok: false, reason: 'identifiant invalide' };
  if (!Array.isArray(b.roles))               return { ok: false, reason: 'liste des rôles invalide' };
  if (!Array.isArray(b.channels))            return { ok: false, reason: 'liste des salons invalide' };
  if (b.roles.length > 250)                  return { ok: false, reason: 'trop de rôles' };
  if (b.channels.length > 500)              return { ok: false, reason: 'trop de salons' };
  return { ok: true };
}

function _safeId(v)     { const id = String(v || '').trim().toLowerCase(); return /^[a-z0-9_-]{6,32}$/.test(id) ? id : null; }
function _makeId()      { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function _rolePos(r)    { const p = Number(r?.rawPosition ?? r?.position ?? 1); return Number.isFinite(p) ? p : 1; }
function _fmt(ts)       { return `<t:${Math.floor(Number(ts))}:f>`; }
function _esc(v)        { return String(v).replace(/[*_`~|]/g, '\\$&').slice(0, 80); }
