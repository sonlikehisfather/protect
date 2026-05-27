'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ComponentType,
  MentionableSelectMenuBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} = require('discord.js');

const db    = require('../core/database');
const embed = require('../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? null;
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder    === 'function' &&
  typeof TextDisplayBuilder  === 'function' &&
  typeof SeparatorBuilder    === 'function'
);

const MAX_ITEMS            = 25;
const MAX_COMPONENTS_TOTAL = 40;
const MAX_BUTTONS_PER_ROW  = 5;

const SUPPORTED_TYPES = new Set([
  'textDisplay', 'separator', 'mediaGallery',
  'button', 'stringSelect',
  'userSelect', 'roleSelect', 'channelSelect', 'mentionableSelect',
]);

const UNSUPPORTED_TYPES = new Set(['actionRow', 'container', 'section']);

const INTERACTIVE_TYPES = new Set([
  'button', 'stringSelect',
  'userSelect', 'roleSelect', 'channelSelect', 'mentionableSelect',
]);

const PAGE_NAME_RE = /^[a-z0-9_-]{1,32}$/;

const CHANNEL_TYPE_MAP = {
  text         : ChannelType.GuildText,
  announcement : ChannelType.GuildAnnouncement,
  voice        : ChannelType.GuildVoice,
  stage        : ChannelType.GuildStageVoice,
  category     : ChannelType.GuildCategory,
  forum        : ChannelType.GuildForum,
};

function _resolveChannelTypes(types) {
  if (!Array.isArray(types) || types.length === 0) {
    return [ChannelType.GuildText, ChannelType.GuildAnnouncement];
  }
  const resolved = types
    .map(t => CHANNEL_TYPE_MAP[String(t).trim().toLowerCase()])
    .filter(v => v !== undefined);
  return resolved.length > 0 ? resolved : [ChannelType.GuildText, ChannelType.GuildAnnouncement];
}

const ACTION_TYPES = new Set([
  'reply', 'dm', 'role_toggle', 'role_add', 'role_remove', 'role_sync',
  'channel_send', 'delete_message', 'none', 'edit_page',
]);

function _isInteractive(it) {
  if (!it) return false;
  if (it.type === 'button' && it.style === 'link') return false;
  return INTERACTIVE_TYPES.has(it.type);
}

function _genComponentId() {
  const t = Date.now().toString(36).slice(-8);
  const r = Math.random().toString(36).slice(2, 6);
  return `c${t}_${r}`.slice(0, 16);
}

function _ensureComponentIds(items) {
  let mutated = false;
  for (const it of items) {
    if (_isInteractive(it) && !it.componentId) {
      it.componentId = _genComponentId();
      mutated = true;
    }
  }
  return mutated;
}


module.exports = { openBuilder };

async function openBuilder(client, message, guildId, opts = {}) {
  if (!V2_AVAILABLE) {
    await embed.replyError(
      message,
      'Components V2 non disponible sur cette version de discord.js.',
      { timestamp: false },
    ).catch(() => {});
    return;
  }

  const ownerId = message.author.id;

  const draft = db.getComponentDraft(guildId, ownerId);
  let items = _parseItems(draft?.json);
  if (_ensureComponentIds(items)) {
    db.setComponentDraft(guildId, ownerId, JSON.stringify(items));
  }

  let currentPage = 'main';

  let initialPayload;
  try {
    initialPayload = _buildPanelPayload(guildId, items, currentPage);
  } catch (err) {
    console.error('[+custom components] _buildPanelPayload failed:', err?.code || err?.message || err);
    initialPayload = _buildClosedPayload(guildId, 'Builder invalide. Corrigez ou réinitialisez.');
  }
  const panel = await message.channel.send(initialPayload)
    .catch(err => {
      console.error('[+custom components] panel send failed:', err?.code || err?.message || err);
      return null;
    });

  if (!panel) {
    await embed.replyError(
      message,
      'Impossible d\'ouvrir le builder Components V2.',
      { timestamp: false },
    ).catch(() => {});
    return;
  }

  embed.registerPrivateInteraction(panel, ownerId, 300_000);


  let busy = false;
  let busyTimer = null;
  const setBusy = (on) => {
    if (busyTimer) { clearTimeout(busyTimer); busyTimer = null; }
    busy = !!on;
    if (on) {
      busyTimer = setTimeout(() => { busy = false; busyTimer = null; }, 5_000);
    }
  };


  let activeModalToken = null;
  const _newToken = () => `t_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  let docMode = false;
  let docPage = 0;

  const collector = panel.createMessageComponentCollector({
    filter : i => i.user.id === ownerId && i.message.id === panel.id,
    idle   : 300_000,
    time   : 600_000,
  });

  collector.on('collect', async interaction => {
    const id = interaction.customId;

    if (busy && !id.startsWith('local:cccomp:add') && !id.startsWith('local:cccomp:doc:') && id !== 'local:cccomp:helpdoc') {
      return _ephemeralInfo(interaction, guildId, 'Action précédente en cours. Réessayez dans quelques secondes.');
    }

    if (id === 'local:cccomp:close') {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      return;
    }

    if (id === 'local:cccomp:doc:prev') {
      docPage = Math.max(0, docPage - 1);
      await interaction.deferUpdate().catch(() => {});
      return panel.edit(_buildDocPayload(guildId, docPage)).catch(() => {});
    }
    if (id === 'local:cccomp:doc:next') {
      docPage = Math.min(_DOC_PAGES.length - 1, docPage + 1);
      await interaction.deferUpdate().catch(() => {});
      return panel.edit(_buildDocPayload(guildId, docPage)).catch(() => {});
    }
    if (id === 'local:cccomp:doc:back') {
      docMode = false;
      await interaction.deferUpdate().catch(() => {});
      return _refresh(panel, guildId, items, currentPage);
    }

    if (id === 'local:cccomp:helpdoc') {
      docMode = true;
      docPage = 0;
      await interaction.deferUpdate().catch(() => {});
      return panel.edit(_buildDocPayload(guildId, docPage)).catch(() => {});
    }


    if (docMode) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    if (id === 'local:cccomp:reset') {
      items = [];
      currentPage = 'main';
      db.deleteComponentDraft(guildId, ownerId);
      await interaction.deferUpdate().catch(() => {});
      return _refresh(panel, guildId, items, currentPage);
    }

    if (id === 'local:cccomp:save') {
      db.setComponentDraft(guildId, ownerId, JSON.stringify(items));
      return _ephemeralInfo(interaction, guildId, `Brouillon enregistre (${items.length} component(s)).`);
    }

    if (id === 'local:cccomp:preview') {
      return _handlePreview(interaction, guildId, items, message.channel);
    }

    if (id === 'local:cccomp:link') {
      setBusy(true);
      const token = _newToken();
      activeModalToken = token;
      const isStillActive = () => activeModalToken === token;
      try {
        await _handleLinkToCustom(interaction, guildId, items, currentPage, isStillActive);
      } finally {
        if (activeModalToken === token) activeModalToken = null;
        setBusy(false);
      }
      return;
    }

    if (id === 'local:cccomp:tools') {
      const tool = interaction.values?.[0];
      if (!tool) { await interaction.deferUpdate().catch(() => {}); return; }

      if (tool === 'aide') {
        return _ephemeralInfo(interaction, guildId,
          '**Aide actions**\n' +
          '\u00b7 **Emoji bouton** : champ optionnel (unicode ou `<:name:id>`)\n' +
          '\u00b7 **Button** : Role ID requis (applique au cliqueur)\n' +
          '\u00b7 **StringSelect role menu** : value = ID du role, action role_toggle sans Role ID\n' +
          '\u00b7 **role_sync** : la selection exacte devient les roles du membre (StringSelect uniquement)\n' +
          '\u00b7 **UserSelect** : Role ID applique au membre selectionne\n' +
          '\u00b7 **RoleSelect** : Role ID vide = role selectionne · `minValues=0` pour X remove\n' +
          '\u00b7 **MentionableSelect** : idem RoleSelect (role uniquement)\n' +
          '\u00b7 **ChannelSelect** : types configurables (text,voice,announcement,stage,forum)\n' +
          '\u00b7 **channel_send** : envoie dans le salon selectionne ou fixe (Channel ID)\n' +
          '\u00b7 **Pagination** : `edit_page` + nom de page dans Reponse\n' +
          '\u00b7 **Multi-actions** : `type|response|roleId|channelId|mode` (max 5)\n' +
          '\u00b7 **min/maxValues** : configurables sur tous les selects (0-25)\n' +
          '\u00b7 **Supprimer message** : bouton avec action `delete_message`\n' +
          '\u00b7 **Pagination auto** : Outils > Creer pagination'
        );
      }

      if (tool === 'export_json') {
        const json = JSON.stringify(items, null, 2);
        const block = '```json\n' + json.slice(0, 3900) + '\n```';
        const truncated = json.length > 3900;
        const desc = truncated
          ? '**Export (tronque)**\nJSON trop long.\n' + block
          : '**Export**\nCopiez ce JSON pour import ulterieur.\n' + block;
        return _ephemeralInfo(interaction, guildId, desc);
      }

      setBusy(true);
      const token = _newToken();
      activeModalToken = token;
      const isStillActive = () => activeModalToken === token;
      try {
        if (tool === 'page_save') {
          await _handleLinkToCustom(interaction, guildId, items, currentPage, isStillActive);
          return;
        }
        if (tool === 'page_load') {
          const result = await _handlePageLoad(interaction, guildId, isStillActive);
          if (result && isStillActive()) {
            items.length = 0;
            for (const it of result.items) items.push(it);
            if (_ensureComponentIds(items)) {  }
            currentPage = result.pageName;
            db.setComponentDraft(guildId, ownerId, JSON.stringify(items));
          }
          return _refresh(panel, guildId, items, currentPage);
        }
        if (tool === 'page_delete') {
          await _handlePageDelete(interaction, guildId, isStillActive);
          return;
        }
        if (tool === 'load_custom') {
          const loaded = await _handleLoadFromCustom(interaction, guildId, items.length > 0, isStillActive);
          if (loaded && isStillActive()) {
            items.length = 0;
            for (const it of loaded) items.push(it);
            if (_ensureComponentIds(items)) {  }
            currentPage = 'main';
            db.setComponentDraft(guildId, ownerId, JSON.stringify(items));
          }
          return _refresh(panel, guildId, items, currentPage);
        }
        if (tool === 'pagination') {
          await _handleCreatePagination(interaction, guildId, isStillActive);
          return;
        }
        if (tool === 'import_json') {
          const imported = await _handleImportJson(interaction, guildId, items.length > 0, isStillActive);
          if (Array.isArray(imported) && imported.length > 0 && isStillActive()) {
            items.length = 0;
            for (const it of imported) items.push(it);
            if (_ensureComponentIds(items)) {  }
            currentPage = 'main';
            db.setComponentDraft(guildId, ownerId, JSON.stringify(items));
          }
          return _refresh(panel, guildId, items, currentPage);
        }
      } finally {
        if (activeModalToken === token) activeModalToken = null;
        setBusy(false);
      }
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    if (id === 'local:cccomp:add') {
      const type = interaction.values?.[0];
      if (!type) { await interaction.deferUpdate().catch(() => {}); return; }

      if (UNSUPPORTED_TYPES.has(type)) {
        return _ephemeral(
          interaction, guildId,
          `\`${type}\` n'est pas editable en V1. Les ActionRow/Container sont auto-generes au rendu.`,
        );
      }
      if (!SUPPORTED_TYPES.has(type)) {
        return _ephemeral(interaction, guildId, 'Type de component inconnu.');
      }
      if (items.length >= MAX_ITEMS) {
        return _ephemeral(interaction, guildId, `Limite atteinte (${MAX_ITEMS} components max).`);
      }

      setBusy(true);
      const addToken = _newToken();
      activeModalToken = addToken;
      const addStillActive = () => activeModalToken === addToken;
      try {
        const added = await _addComponentFlow(interaction, guildId, type, addStillActive);
        if (added && addStillActive()) {
          if (_isInteractive(added) && !added.componentId) {
            added.componentId = _genComponentId();
          }
          items.push(added);
        }
      } finally {
        if (activeModalToken === addToken) activeModalToken = null;
        setBusy(false);
      }
      return _refresh(panel, guildId, items, currentPage);
    }


    if (id === 'local:cccomp:manageone') {
      await interaction.deferUpdate().catch(() => {});
      return panel.edit(_buildPanelPayload(guildId, items, currentPage, true)).catch(() => {});
    }
    if (id === 'local:cccomp:manageback') {
      await interaction.deferUpdate().catch(() => {});
      return _refresh(panel, guildId, items, currentPage);
    }


    if (id === 'local:cccomp:removeone') {
      if (items.length > 0) items.splice(0, 1);
      await interaction.deferUpdate().catch(() => {});
      return _refresh(panel, guildId, items, currentPage);
    }


    if (id === 'local:cccomp:actionone') {
      const _first = items.find(_isInteractive);
      if (!_first) {
        await interaction.deferUpdate().catch(() => {});
        return;
      }
      setBusy(true);
      const actToken = _newToken();
      activeModalToken = actToken;
      const actStillActive = () => activeModalToken === actToken;
      try {
        const action = await _modalConfigureAction(interaction, guildId, _first, actStillActive);
        if (action && actStillActive()) {
          _first.action = action;
          delete _first.actions;
          db.setComponentDraft(guildId, ownerId, JSON.stringify(items));
        }
      } finally {
        if (activeModalToken === actToken) activeModalToken = null;
        setBusy(false);
      }
      return _refresh(panel, guildId, items, currentPage);
    }


    if (id === 'local:cccomp:multione') {
      const _first = items.find(_isInteractive);
      if (!_first) {
        await interaction.deferUpdate().catch(() => {});
        return;
      }
      setBusy(true);
      const mToken = _newToken();
      activeModalToken = mToken;
      const mStillActive = () => activeModalToken === mToken;
      try {
        const actions = await _modalConfigureMultiActions(interaction, guildId, _first, mStillActive);
        if (Array.isArray(actions) && actions.length > 0 && mStillActive()) {
          _first.actions = actions;
          delete _first.action;
          db.setComponentDraft(guildId, ownerId, JSON.stringify(items));
        }
      } finally {
        if (activeModalToken === mToken) activeModalToken = null;
        setBusy(false);
      }
      return _refresh(panel, guildId, items, currentPage);
    }

    if (id === 'local:cccomp:action') {
      const idx = Number(interaction.values?.[0]);
      if (!Number.isFinite(idx) || idx < 0 || idx >= items.length) {
        await interaction.deferUpdate().catch(() => {});
        return;
      }
      const item = items[idx];
      if (!_isInteractive(item)) {
        await interaction.deferUpdate().catch(() => {});
        return _ephemeral(interaction, guildId, 'Cet item n\'est pas interactif.');
      }
      setBusy(true);
      const actToken = _newToken();
      activeModalToken = actToken;
      const actStillActive = () => activeModalToken === actToken;
      try {
        const action = await _modalConfigureAction(interaction, guildId, item, actStillActive);
        if (action && actStillActive()) {
          item.action = action;


          delete item.actions;
          db.setComponentDraft(guildId, ownerId, JSON.stringify(items));
        }
      } finally {
        if (activeModalToken === actToken) activeModalToken = null;
        setBusy(false);
      }
      return _refresh(panel, guildId, items, currentPage);
    }

    if (id === 'local:cccomp:multi') {
      const idx = Number(interaction.values?.[0]);
      if (!Number.isFinite(idx) || idx < 0 || idx >= items.length) {
        await interaction.deferUpdate().catch(() => {});
        return;
      }
      const item = items[idx];
      if (!_isInteractive(item)) {
        await interaction.deferUpdate().catch(() => {});
        return _ephemeral(interaction, guildId, 'Cet item n\'est pas interactif.');
      }
      setBusy(true);
      const mToken = _newToken();
      activeModalToken = mToken;
      const mStillActive = () => activeModalToken === mToken;
      try {
        const actions = await _modalConfigureMultiActions(interaction, guildId, item, mStillActive);
        if (Array.isArray(actions) && actions.length > 0 && mStillActive()) {
          item.actions = actions;

          delete item.action;
          db.setComponentDraft(guildId, ownerId, JSON.stringify(items));
        }
      } finally {
        if (activeModalToken === mToken) activeModalToken = null;
        setBusy(false);
      }
      return _refresh(panel, guildId, items, currentPage);
    }

    if (id === 'local:cccomp:remove') {
      const idx = Number(interaction.values?.[0]);
      if (Number.isFinite(idx) && idx >= 0 && idx < items.length) {
        items.splice(idx, 1);
      }
      await interaction.deferUpdate().catch(() => {});
      return _refresh(panel, guildId, items, currentPage);
    }

    await interaction.deferUpdate().catch(() => {});
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(panel);
    if (reason === 'closed') return;
    panel.edit(_buildClosedPayload(guildId, 'Builder expire.')).catch(() => {});
  });
}


async function _addComponentFlow(interaction, guildId, type, isStillActive = () => true) {
  switch (type) {
    case 'separator': {
      await interaction.deferUpdate().catch(() => {});
      return { type: 'separator' };
    }

    case 'textDisplay':
      return _modalAdd(interaction, 'local:cccomp:m:td', 'TextDisplay', [
        _input('content', 'Contenu', TextInputStyle.Paragraph, { required: true, maxLength: 2000 }),
      ], f => ({ type: 'textDisplay', content: f.content.trim() }), v => v.content.trim().length > 0, guildId, isStillActive);

    case 'mediaGallery':
      return _modalAdd(interaction, 'local:cccomp:m:mg', 'MediaGallery', [
        _input('url', 'URL de l\'image', TextInputStyle.Short, { required: true, maxLength: 500 }),
      ], f => ({ type: 'mediaGallery', url: f.url.trim() }), v => /^https?:\/\//i.test(v.url.trim()), guildId, isStillActive);

    case 'button':
      return _modalAdd(interaction, 'local:cccomp:m:btn', 'Bouton', [
        _input('label', 'Label', TextInputStyle.Short, { required: true, maxLength: 80 }),
        _input('style', 'Style (primary|secondary|success|danger|link)', TextInputStyle.Short, {
          required: true, maxLength: 10, value: 'secondary',
        }),
        _input('target', 'URL (uniquement si style=link)', TextInputStyle.Short, {
          required: false, maxLength: 500,
          placeholder: 'https://... · ignore pour les autres styles',
        }),
        _input('emoji', 'Emoji (optionnel)', TextInputStyle.Short, {
          required: false, maxLength: 50,
          placeholder: 'Unicode ou custom <:name:id>',
        }),
      ], f => {
        const style = f.style.trim().toLowerCase();
        const out = { type: 'button', label: f.label.trim(), style };
        if (style === 'link') out.url = f.target.trim();
        const emojiRaw = f.emoji.trim();
        if (emojiRaw) out.emoji = emojiRaw;
        return out;
      }, v => {
        const style = v.style.trim().toLowerCase();
        if (!['primary','secondary','success','danger','link'].includes(style)) return false;
        if (style === 'link') {
          const t = v.target.trim();
          if (!t) return false;
          if (!/^https?:\/\//i.test(t)) return false;
        }
        return true;
      }, guildId, isStillActive);

    case 'stringSelect':
      return _modalAdd(interaction, 'local:cccomp:m:ss', 'StringSelect', [
        _input('placeholder', 'Placeholder', TextInputStyle.Short, { maxLength: 150 }),
        _input('options', 'Options (une ligne = label|value)', TextInputStyle.Paragraph, {
          required: true, maxLength: 2000,
          placeholder: 'Option A|value_a\nOption B|value_b',
        }),
        _input('minValues', 'Min selections (1-25)', TextInputStyle.Short, {
          required: false, maxLength: 2, value: '1',
        }),
        _input('maxValues', 'Max selections (1-25)', TextInputStyle.Short, {
          required: false, maxLength: 2, value: '1',
        }),
      ], f => {
        const seenValues = new Set();
        const options = f.options.split('\n').map(line => {
          const [label, value] = line.split('|').map(s => (s || '').trim());
          if (!label || !value) return null;
          if (seenValues.has(value)) return null;
          seenValues.add(value);
          return _cleanSelectOption({ label, value });
        }).filter(Boolean).slice(0, 25);
        const out = {
          type        : 'stringSelect',
          placeholder : f.placeholder.trim() || undefined,
          options,
        };
        const min = parseInt(f.minValues, 10);
        const max = parseInt(f.maxValues, 10);
        if (!isNaN(min) && min >= 0 && min <= 25) out.minValues = min;
        if (!isNaN(max) && max >= 1 && max <= 25) out.maxValues = max;
        if (out.minValues !== undefined && out.maxValues !== undefined && out.minValues > out.maxValues) {
          out.minValues = out.maxValues;
        }
        return out;
      }, v => {
        const parsed = v.options.split('\n').filter(l => l.includes('|') && l.split('|')[0].trim() && l.split('|')[1].trim());
        return parsed.length > 0;
      }, guildId, isStillActive);

    case 'userSelect':
    case 'roleSelect':
    case 'mentionableSelect':
      return _modalAdd(interaction, `local:cccomp:m:${type}`, _titleForSelect(type), [
        _input('placeholder', 'Placeholder (optionnel)', TextInputStyle.Short, { maxLength: 150 }),
        _input('minValues', 'Min selections (0-25)', TextInputStyle.Short, {
          required: false, maxLength: 2,
          value: (type === 'roleSelect' || type === 'mentionableSelect') ? '0' : '1',
        }),
        _input('maxValues', 'Max selections (1-25)', TextInputStyle.Short, {
          required: false, maxLength: 2, value: '1',
        }),
      ], f => {
        const out = { type, placeholder: f.placeholder.trim() || undefined };
        const min = parseInt(f.minValues, 10);
        const max = parseInt(f.maxValues, 10);
        if (!isNaN(min) && min >= 0 && min <= 25) out.minValues = min;
        if (!isNaN(max) && max >= 1 && max <= 25) out.maxValues = max;
        if (out.minValues !== undefined && out.maxValues !== undefined && out.minValues > out.maxValues) {
          out.minValues = out.maxValues;
        }
        return out;
      }, () => true, guildId, isStillActive);

    case 'channelSelect':
      return _modalAdd(interaction, 'local:cccomp:m:channelSelect', 'ChannelSelect', [
        _input('placeholder', 'Placeholder (optionnel)', TextInputStyle.Short, { maxLength: 150 }),
        _input('channelTypes', 'Types : text,voice,announcement,stage,forum', TextInputStyle.Short, {
          required: false, maxLength: 100, value: 'text,announcement',
          placeholder: 'text,announcement,voice,stage,category,forum',
        }),
        _input('minValues', 'Min selections (0-25)', TextInputStyle.Short, {
          required: false, maxLength: 2, value: '1',
        }),
        _input('maxValues', 'Max selections (1-25)', TextInputStyle.Short, {
          required: false, maxLength: 2, value: '1',
        }),
      ], f => {
        const out = { type: 'channelSelect', placeholder: f.placeholder.trim() || undefined };
        const rawTypes = f.channelTypes.trim().split(/[,\s]+/).filter(Boolean);
        if (rawTypes.length > 0) out.channelTypes = rawTypes;
        const min = parseInt(f.minValues, 10);
        const max = parseInt(f.maxValues, 10);
        if (!isNaN(min) && min >= 0 && min <= 25) out.minValues = min;
        if (!isNaN(max) && max >= 1 && max <= 25) out.maxValues = max;
        if (out.minValues !== undefined && out.maxValues !== undefined && out.minValues > out.maxValues) {
          out.minValues = out.maxValues;
        }
        return out;
      }, () => true, guildId, isStillActive);

    default:
      await interaction.deferUpdate().catch(() => {});
      return null;
  }
}

function _titleForSelect(type) {
  return {
    userSelect        : 'UserSelect',
    roleSelect        : 'RoleSelect',
    channelSelect     : 'ChannelSelect',
    mentionableSelect : 'MentionableSelect',
  }[type] || 'Select';
}

async function _modalConfigureAction(interaction, guildId, item, isStillActive = () => true) {
  const cur = item.action || {};
  const modalId = `local:cccomp:m:act:${interaction.id}`.slice(0, 100);

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(`Action · ${_labelForItem(item)}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        _input('type', 'Action',
          TextInputStyle.Short, {
            required: true, maxLength: 20,
            value: cur.type || 'reply',
            placeholder: 'reply|dm|role_add|role_remove|role_toggle|role_sync|channel_send|delete_message|edit_page|none',
          }),
      ),
      new ActionRowBuilder().addComponents(
        _input('response', 'Réponse / Nom de page (edit_page)',
          TextInputStyle.Paragraph, {
            required: false, maxLength: 1500,
            value: cur.response || '',
            placeholder: 'Texte pour reply/dm | pour edit_page : main, page2...',
          }),
      ),
      new ActionRowBuilder().addComponents(
        _input('roleId', 'Rôle à gérer (role_*)',
          TextInputStyle.Short, {
            required: false, maxLength: 25,
            value: cur.roleId || '',
            placeholder: 'Vide = rôle sélectionné. Requis pour Button/UserSelect',
          }),
      ),
      new ActionRowBuilder().addComponents(
        _input('channelId', 'Salon (channel_send)',
          TextInputStyle.Short, {
            required: false, maxLength: 25,
            value: cur.channelId || '',
            placeholder: 'Vide = salon sélectionné (ChannelSelect). Requis sinon.',
          }),
      ),
      new ActionRowBuilder().addComponents(
        _input('mode', 'Mode de réponse (reply)',
          TextInputStyle.Short, {
            required: false, maxLength: 12,
            value: cur.mode || 'ephemeral',
            placeholder: 'ephemeral ou public',
          }),
      ),
    );

  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  if (!shown) return null;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 180_000,
  }).catch(() => null);
  if (!submit) return null;

  if (!isStillActive()) {
    await submit.reply({
      embeds : [embed.build(guildId ?? submit.guildId, 'Cette modification a expiré.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }

  const type      = (submit.fields.getTextInputValue('type') || '').toLowerCase().trim();
  const response  = (submit.fields.getTextInputValue('response') || '').trim();
  const roleId    = (submit.fields.getTextInputValue('roleId') || '').trim();
  const channelId = (submit.fields.getTextInputValue('channelId') || '').trim();
  const mode      = (submit.fields.getTextInputValue('mode') || 'ephemeral').toLowerCase().trim();

  if (!ACTION_TYPES.has(type)) {
    await submit.reply({
      embeds : [embed.build(submit.guildId, `Type d'action invalide : \`${type}\`.`, { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }
  if ((type === 'reply' || type === 'dm' || type === 'channel_send') && !response) {
    await submit.reply({
      embeds : [embed.build(submit.guildId, 'Une réponse est requise pour reply/dm/channel_send.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }
  if (type === 'edit_page') {
    const _pn = response.toLowerCase().trim();
    if (!_pn || !PAGE_NAME_RE.test(_pn)) {
      await submit.reply({
        embeds : [embed.build(submit.guildId, 'edit_page : nom de page requis (a-z 0-9 _- max 32, ex: main, page2).', { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
      return null;
    }
  }


  if (type === 'channel_send') {
    if (item.type !== 'channelSelect') {
      if (!/^\d{17,20}$/.test(channelId)) {
        await submit.reply({
          embeds : [embed.build(submit.guildId, `Salon ID requis pour un ${_labelForItem(item)} avec channel_send.`, { color: '#ED4245', timestamp: false })],
          flags  : 64,
        }).catch(() => {});
        return null;
      }
    } else if (channelId && !/^\d{17,20}$/.test(channelId)) {
      await submit.reply({
        embeds : [embed.build(submit.guildId, 'Salon ID invalide (laissez vide pour utiliser la sélection).', { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
      return null;
    }
  }


  if (type.startsWith('role_')) {
    if (item.type === 'channelSelect') {
      await submit.reply({
        embeds : [embed.build(submit.guildId, 'Un ChannelSelect ne peut pas effectuer une action role_*. Utilisez un RoleSelect ou un Button.', { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
      return null;
    }
    if (type === 'role_sync') {
      if (item.type !== 'stringSelect') {
        await submit.reply({
          embeds : [embed.build(submit.guildId, 'role_sync est reserve au StringSelect (role menu).', { color: '#ED4245', timestamp: false })],
          flags  : 64,
        }).catch(() => {});
        return null;
      }
      if (roleId) {
        await submit.reply({
          embeds : [embed.build(submit.guildId, 'role_sync ne supporte pas de Role ID fixe (laissez vide).', { color: '#ED4245', timestamp: false })],
          flags  : 64,
        }).catch(() => {});
        return null;
      }
      const _opts = (item.options || []).map(o => String(o.value || '').trim());
      if (!_opts.length || _opts.some(v => !/^\d{17,20}$/.test(v))) {
        await submit.reply({
          embeds : [embed.build(submit.guildId, 'role_sync : chaque value d\'option doit etre l\'ID d\'un role (snowflake 17-20 chiffres).', { color: '#ED4245', timestamp: false })],
          flags  : 64,
        }).catch(() => {});
        return null;
      }
      if (item.minValues !== 0) {
        await submit.reply({
          embeds : [embed.build(submit.guildId, 'role_sync necessite minValues=0 pour permettre de retirer tous les roles.', { color: '#ED4245', timestamp: false })],
          flags  : 64,
        }).catch(() => {});
        return null;
      }
    } else if (item.type === 'button' || item.type === 'userSelect') {
      if (!/^\d{17,20}$/.test(roleId)) {
        await submit.reply({
          embeds : [embed.build(submit.guildId, `Role ID requis pour un ${_labelForItem(item)} avec une action role_*.`, { color: '#ED4245', timestamp: false })],
          flags  : 64,
        }).catch(() => {});
        return null;
      }
    } else if (item.type === 'stringSelect' && !roleId) {
      const _opts = (item.options || []).map(o => String(o.value || '').trim());
      if (!_opts.length || _opts.some(v => !/^\d{17,20}$/.test(v))) {
        await submit.reply({
          embeds : [embed.build(submit.guildId, 'StringSelect role menu : chaque value d\'option doit etre l\'ID d\'un role (snowflake 17-20 chiffres).', { color: '#ED4245', timestamp: false })],
          flags  : 64,
        }).catch(() => {});
        return null;
      }
    } else if (roleId && !/^\d{17,20}$/.test(roleId)) {
      await submit.reply({
        embeds : [embed.build(submit.guildId, 'Rôle ID invalide (laissez vide pour utiliser la sélection).', { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
      return null;
    }
  }

  await submit.deferUpdate().catch(() => {});

  const out = { type };
  if (response)  out.response  = response;
  if (roleId)    out.roleId    = roleId;
  if (channelId) out.channelId = channelId;
  if (type === 'reply') out.mode = (mode === 'public') ? 'public' : 'ephemeral';
  return out;
}


const MAX_MULTI_ACTIONS = 5;

function _parseActionLine(line, item) {
  const raw = (line || '').trim();
  if (!raw) return null;

  const parts = raw.split('|');
  while (parts.length < 5) parts.push('');
  const [rawType, rawResponse, rawRoleId, rawChannelId, rawMode] = parts;

  const type      = rawType.trim().toLowerCase();
  const response  = rawResponse.trim();
  const roleId    = rawRoleId.trim();
  const channelId = rawChannelId.trim();
  const mode      = rawMode.trim().toLowerCase();

  if (!ACTION_TYPES.has(type)) {
    return { error: `Type d'action inconnu : \`${rawType.trim() || '(vide)'}\`.` };
  }

  if ((type === 'reply' || type === 'dm' || type === 'channel_send') && !response) {
    return { error: `\`${type}\` requiert un texte de réponse (2e champ).` };
  }
  if (type === 'edit_page') {
    const _pn2 = response.toLowerCase().trim();
    if (!_pn2 || !PAGE_NAME_RE.test(_pn2)) {
      return { error: '`edit_page` : nom de page requis (a-z 0-9 _- max 32, ex: main, page2).' };
    }
  }

  if (type === 'channel_send') {
    if (item.type !== 'channelSelect') {
      if (!/^\d{17,20}$/.test(channelId)) {
        return { error: `\`channel_send\` requiert un Salon ID (4e champ) pour un ${_labelForItem(item)}.` };
      }
    } else if (channelId && !/^\d{17,20}$/.test(channelId)) {
      return { error: '`channel_send` : Salon ID invalide (laisser vide pour utiliser la sélection).' };
    }
  }

  if (type.startsWith('role_')) {
    if (item.type === 'channelSelect') {
      return { error: `\`${type}\` incompatible avec un ChannelSelect. Utilisez un RoleSelect ou un Button.` };
    }
    if (type === 'role_sync') {
      if (item.type !== 'stringSelect') {
        return { error: '`role_sync` est reserve au StringSelect (role menu).' };
      }
      if (roleId) {
        return { error: '`role_sync` ne supporte pas de Role ID fixe (laisser vide).' };
      }
      const _opts = (item.options || []).map(o => String(o.value || '').trim());
      if (!_opts.length || _opts.some(v => !/^\d{17,20}$/.test(v))) {
        return { error: '`role_sync` : chaque value d\'option doit etre l\'ID d\'un role (snowflake 17-20 chiffres).' };
      }
      if (item.minValues !== 0) {
        return { error: '`role_sync` necessite minValues=0 pour permettre de retirer tous les roles.' };
      }
    } else if (item.type === 'button' || item.type === 'userSelect') {
      if (!/^\d{17,20}$/.test(roleId)) {
        return { error: `\`${type}\` requiert un Role ID (3e champ) pour un ${_labelForItem(item)}.` };
      }
    } else if (item.type === 'stringSelect' && !roleId) {
      const _opts = (item.options || []).map(o => String(o.value || '').trim());
      if (!_opts.length || _opts.some(v => !/^\d{17,20}$/.test(v))) {
        return { error: 'StringSelect role menu : chaque value d\'option doit etre l\'ID d\'un role (snowflake 17-20 chiffres).' };
      }
    } else if (roleId && !/^\d{17,20}$/.test(roleId)) {
      return { error: `\`${type}\` : Role ID invalide.` };
    }
  }

  const out = { type };
  if (response)  out.response  = response;
  if (roleId)    out.roleId    = roleId;
  if (channelId) out.channelId = channelId;
  if (type === 'reply' && mode) out.mode = (mode === 'public') ? 'public' : 'ephemeral';
  return out;
}

function _serializeActionLine(a) {
  if (!a || !a.type) return '';
  return [a.type, a.response || '', a.roleId || '', a.channelId || '', a.mode || ''].join('|');
}

async function _modalConfigureMultiActions(interaction, guildId, item, isStillActive = () => true) {
  const cur = Array.isArray(item.actions) && item.actions.length > 0
    ? item.actions
    : (item.action ? [item.action] : []);

  const modalId = `local:cccomp:m:multi:${interaction.id}`.slice(0, 100);

  const rows = [];
  for (let i = 0; i < MAX_MULTI_ACTIONS; i++) {
    const value = _serializeActionLine(cur[i]);
    rows.push(new ActionRowBuilder().addComponents(
      _input(`a${i + 1}`, `Action ${i + 1} (vide = ignor\u00e9)`,
        TextInputStyle.Short, {
          required: false, maxLength: 400,
          value,
          placeholder: i === 0
            ? 'type|response|roleId|channelId|mode'
            : 'ex : role_add||123456789012345678||',
        }),
    ));
  }

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(`Multi-actions · ${_labelForItem(item)}`.slice(0, 45))
    .addComponents(...rows);

  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  if (!shown) return null;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 180_000,
  }).catch(() => null);
  if (!submit) return null;

  if (!isStillActive()) {
    await submit.reply({
      embeds : [embed.build(guildId ?? submit.guildId, 'Cette modification a expiré.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }

  const out = [];
  for (let i = 0; i < MAX_MULTI_ACTIONS; i++) {
    const raw = submit.fields.getTextInputValue(`a${i + 1}`) || '';
    const parsed = _parseActionLine(raw, item);
    if (parsed === null) continue;
    if (parsed.error) {
      await submit.reply({
        embeds : [embed.build(submit.guildId, `Ligne ${i + 1} : ${parsed.error}`, { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
      return null;
    }
    out.push(parsed);
  }

  if (out.length === 0) {
    await submit.reply({
      embeds : [embed.build(submit.guildId, 'Aucune action saisie. Laissez les 5 champs vides pour effacer ; sinon ajoutez au moins une ligne.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }

  await submit.deferUpdate().catch(() => {});
  return out;
}

async function _modalAdd(interaction, modalBaseId, title, inputs, toData, validate, guildId, isStillActive = () => true) {
  const modalId = `${modalBaseId}:${interaction.id}`;
  const modal   = new ModalBuilder()
    .setCustomId(modalId.slice(0, 100))
    .setTitle(title.slice(0, 45))
    .addComponents(inputs.map(input => new ActionRowBuilder().addComponents(input)));

  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  if (!shown) return null;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 120_000,
  }).catch(() => null);

  if (!submit) return null;


  if (!isStillActive()) {
    await submit.reply({
      embeds : [embed.build(guildId ?? submit.guildId, 'Cette modification a expiré.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }

  const fields = {};
  for (const input of inputs) {
    const cid = input.data.custom_id || input.data.customId;
    fields[cid] = submit.fields.getTextInputValue(cid) || '';
  }

  if (typeof validate === 'function' && !validate(fields)) {
    await submit.reply({
      embeds : [embed.build(guildId ?? submit.guildId, 'Champs invalides.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }

  await submit.deferUpdate().catch(() => {});
  return toData(fields);
}


function _buildPanelPayload(guildId, items, currentPage = 'main', manageMode = false) {
  const accent = _hexToInt(embed.getGuildColor(guildId));
  const container = new ContainerBuilder().setAccentColor(accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Components avancés'),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '_Components V2 · Messages/Embeds/Boutons legacy désactivés · Aide via Outils_',
    ),
  );

  const addSelect = new StringSelectMenuBuilder()
    .setCustomId('local:cccomp:add')
    .setPlaceholder('Ajouter un nouveau component')
    .addOptions([
      { label: 'TextDisplay',       value: 'textDisplay',       description: 'Un texte simple' },
      { label: 'Separator',         value: 'separator',         description: 'Une ligne de séparation horizontal' },
      { label: 'MediaGallery',      value: 'mediaGallery',      description: 'Un groupe d\'image' },
      { label: 'Button',            value: 'button',            description: 'Un bouton' },
      { label: 'StringSelect',      value: 'stringSelect',      description: 'Un menu déroulant' },
      { label: 'UserSelect',        value: 'userSelect',        description: 'Sélecteur d\'utilisateur' },
      { label: 'RoleSelect',        value: 'roleSelect',        description: 'Sélecteur de rôle' },
      { label: 'ChannelSelect',     value: 'channelSelect',     description: 'Sélecteur de salon' },
      { label: 'MentionableSelect', value: 'mentionableSelect', description: 'Sélecteur de membre ou rôle' },
    ].map(_cleanSelectOption));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(addSelect));


  if (items.length > 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(_buildListing(items, currentPage)),
    );
  }

  const interactiveIdx = items
    .map((it, i) => ({ it, i }))
    .filter(x => _isInteractive(x.it))
    .slice(0, 25);


  if (items.length === 1) {
    if (manageMode) {
      const mRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('local:cccomp:removeone')
          .setLabel('Supprimer')
          .setStyle(ButtonStyle.Danger),
      );
      if (interactiveIdx.length === 1) {
        mRow.addComponents(
          new ButtonBuilder()
            .setCustomId('local:cccomp:actionone')
            .setLabel('Action')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('local:cccomp:multione')
            .setLabel('Multi-actions')
            .setStyle(ButtonStyle.Secondary),
        );
      }
      mRow.addComponents(
        new ButtonBuilder()
          .setCustomId('local:cccomp:manageback')
          .setLabel('Retour')
          .setStyle(ButtonStyle.Secondary),
      );
      container.addActionRowComponents(mRow);
    } else {
      container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('local:cccomp:manageone')
          .setLabel('Gerer')
          .setStyle(ButtonStyle.Secondary),
      ));
    }
  } else if (items.length > 1) {

    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId('local:cccomp:remove')
      .setPlaceholder('Supprimer un component')
      .addOptions(items.slice(0, 25).map((it, i) => _cleanSelectOption({
        label       : `${i + 1}. ${_labelForItem(it)}`,
        value       : String(i),
        description : _descForItem(it),
      })));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(removeSelect));
  }

  if (interactiveIdx.length > 1) {
    const actionSelect = new StringSelectMenuBuilder()
      .setCustomId('local:cccomp:action')
      .setPlaceholder('Configurer une action (simple)')
      .addOptions(interactiveIdx.map(x => _cleanSelectOption({
        label       : `${x.i + 1}. ${_labelForItem(x.it)}`,
        value       : String(x.i),
        description : _descActionForSelect(x.it),
      })));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(actionSelect));

    const multiSelect = new StringSelectMenuBuilder()
      .setCustomId('local:cccomp:multi')
      .setPlaceholder('Configurer multi-actions (jusqu\'a 5)')
      .addOptions(interactiveIdx.map(x => _cleanSelectOption({
        label       : `${x.i + 1}. ${_labelForItem(x.it)}`,
        value       : String(x.i),
        description : _descActionForSelect(x.it),
      })));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(multiSelect));
  }

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:cccomp:preview')
        .setLabel('Aperçu')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(items.length === 0),
      new ButtonBuilder()
        .setCustomId('local:cccomp:link')
        .setLabel('Lier à une custom')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(items.length === 0),
      new ButtonBuilder()
        .setCustomId('local:cccomp:save')
        .setLabel('Enregistrer')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('local:cccomp:reset')
        .setLabel('Réinitialiser')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(items.length === 0),
    ),
  );

  const toolsSelect = new StringSelectMenuBuilder()
    .setCustomId('local:cccomp:tools')
    .setPlaceholder('Outils avances')
    .addOptions([
      { label: 'Aide',              value: 'aide',         description: 'Aide actions, variables, pagination' },
      { label: 'Creer pagination',  value: 'pagination',   description: 'Generer pages + boutons navigation' },
      { label: 'Enregistrer page',  value: 'page_save',    description: 'Sauvegarder dans une page nommee' },
      { label: 'Charger page',      value: 'page_load',    description: 'Charger une page existante' },
      { label: 'Supprimer page',    value: 'page_delete',  description: 'Supprimer une page nommee' },
      { label: 'Charger une custom', value: 'load_custom', description: 'Charger les components d\'une custom' },
      { label: 'Exporter JSON',     value: 'export_json',  description: 'Copier le JSON du brouillon' },
      { label: 'Importer JSON',     value: 'import_json',  description: 'Coller un JSON pour remplacer' },
    ].map(_cleanSelectOption));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(toolsSelect));

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:cccomp:helpdoc')
        .setEmoji('\u2753')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:cccomp:close')
        .setLabel('Fermer')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return {
    flags           : COMPONENTS_V2_FLAG,
    embeds          : [],
    components      : [container],
    allowedMentions : { parse: [] },
  };
}

function _buildListing(items, currentPage = 'main') {
  if (!items.length) return '**Components** _Aucun_ · Page : **' + currentPage + '**';
  const MAX_VISIBLE = 10;
  const visible = items.slice(0, MAX_VISIBLE);
  const lines = visible.map((it, i) =>
    `> ${i + 1}. **${_labelForItem(it)}** ${_descForItem(it)}`
  );
  const overflow = items.length > MAX_VISIBLE
    ? `\n> _...et ${items.length - MAX_VISIBLE} autre(s)_`
    : '';
  return `**Components (${items.length})** · Page : **${currentPage}**\n${lines.join('\n')}${overflow}`;
}

function _labelForItem(it) {
  return {
    textDisplay       : 'TextDisplay',
    separator         : 'Separator',
    mediaGallery      : 'MediaGallery',
    button            : 'Button',
    stringSelect      : 'StringSelect',
    userSelect        : 'UserSelect',
    roleSelect        : 'RoleSelect',
    channelSelect     : 'ChannelSelect',
    mentionableSelect : 'MentionableSelect',
  }[it.type] || it.type;
}

function _descForItem(it) {
  let base;
  switch (it.type) {
    case 'textDisplay'  : base = `· ${_truncate(it.content || '', 30)}`; break;
    case 'separator'    : base = ''; break;
    case 'mediaGallery' : base = `· ${_truncate(it.url || '', 40)}`; break;
    case 'button'       : { const e = it.emoji ? ` ${it.emoji}` : ''; base = `· ${it.style}${e} · ${_truncate(it.label || '', 20)}`; break; }
    case 'stringSelect' : base = `· ${(it.options || []).length} opt`; break;
    default             : base = it.placeholder ? `· ${_truncate(it.placeholder, 30)}` : '';
  }
  if (_isInteractive(it)) {
    const suffix = _descActionShort(it);
    if (suffix) return base ? `${base} · ${suffix}` : `· ${suffix}`;
  }
  return base;
}

function _descActionShort(it) {
  if (Array.isArray(it.actions) && it.actions.length > 0) {
    return `Actions : ${it.actions.length}`;
  }
  if (it.action?.type) return `Action : ${it.action.type}`;
  return '';
}

function _descActionForSelect(it) {


  if (Array.isArray(it.actions) && it.actions.length > 0) {
    const types = it.actions.map(a => a.type).join(', ');
    return _truncate(`Actions : ${types}`, 100);
  }
  if (it.action?.type) return `Action : ${it.action.type}`;
  return 'Aucune action configurée';
}


async function _handleLinkToCustom(interaction, guildId, items, currentPage = 'main', isStillActive = () => true) {
  if (!items.length) {
    return _ephemeral(interaction, guildId, 'Ajoutez au moins un component avant de lier.');
  }

  const validation = _validate(items);
  if (!validation.ok) {
    return _ephemeral(interaction, guildId, `Validation : ${validation.reason}`);
  }

  const modalId = `local:cccomp:linkmodal:${interaction.id}`;
  const modal   = new ModalBuilder()
    .setCustomId(modalId.slice(0, 100))
    .setTitle('Lier à une custom')
    .addComponents(
      new ActionRowBuilder().addComponents(
        _input('keyword', 'Mot-clé de la custom (sans +)', TextInputStyle.Short, {
          required: true, maxLength: 32,
          placeholder: 'ex: hello',
        }),
      ),
      new ActionRowBuilder().addComponents(
        _input('pageName', 'Page (main = page principale)', TextInputStyle.Short, {
          required: false, maxLength: 32,
          value: currentPage,
          placeholder: 'main, page2, page3...',
        }),
      ),
    );

  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  if (!shown) return;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 120_000,
  }).catch(() => null);

  if (!submit) return;

  if (!isStillActive()) {
    return submit.reply({
      embeds : [embed.build(guildId, 'Cette modification a expiré.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const raw = submit.fields.getTextInputValue('keyword') || '';
  const keyword = raw.toLowerCase().trim().replace(/^\+/, '');

  if (!/^[a-z0-9_-]{1,32}$/i.test(keyword)) {
    return submit.reply({
      embeds : [embed.build(guildId, 'Mot-clé invalide. Lettres, chiffres, tiret, underscore (max 32).', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const rawPage = (submit.fields.getTextInputValue('pageName') || '').trim().toLowerCase() || 'main';
  if (!PAGE_NAME_RE.test(rawPage)) {
    return submit.reply({
      embeds : [embed.build(guildId, 'Nom de page invalide (a-z0-9_- max 32, ex: main, page2).', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const custom = db.getCustomCommand(guildId, keyword);
  if (!custom) {
    return submit.reply({
      embeds : [embed.build(guildId, `Aucune custom \`+${keyword}\`. Creez-la d'abord avec \`+custom ${keyword}\`.`, { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  try {
    if (rawPage === 'main') {
      db.updateCustomCommandField(guildId, keyword, 'componentsJson', JSON.stringify(items));
    } else {
      let _pages = {};
      try { if (custom.componentsPagesJson) _pages = JSON.parse(custom.componentsPagesJson); } catch {}
      _pages[rawPage] = items;
      db.updateCustomCommandField(guildId, keyword, 'componentsPagesJson', JSON.stringify(_pages));
    }
  } catch (err) {
    console.error('[+custom components] link failed:', err?.code || err?.message || err);
    return submit.reply({
      embeds : [embed.build(guildId, 'Erreur lors de la liaison. Vérifiez les logs.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const _pageMsg = rawPage === 'main'
    ? `Components liés a \`+${keyword}\` (page principale). Runtime classique désactivé.`
    : `Components liés a \`+${keyword}\` page \`${rawPage}\`. Configurez un bouton avec edit_page|${rawPage}|||`;

  return submit.reply({
    embeds : [embed.build(guildId, _pageMsg, { timestamp: false })],
    flags  : 64,
  }).catch(() => {});
}


async function _handlePageLoad(interaction, guildId, isStillActive = () => true) {
  const modalId = `local:cccomp:pageload:${interaction.id}`;
  const modal = new ModalBuilder()
    .setCustomId(modalId.slice(0, 100))
    .setTitle('Charger une page')
    .addComponents(
      new ActionRowBuilder().addComponents(
        _input('keyword', 'Mot-cle de la custom (sans +)', TextInputStyle.Short, {
          required: true, maxLength: 32, placeholder: 'ex: hello',
        }),
      ),
      new ActionRowBuilder().addComponents(
        _input('pageName', 'Nom de page', TextInputStyle.Short, {
          required: true, maxLength: 32, placeholder: 'main, page2...',
        }),
      ),
    );

  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  if (!shown) return null;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 120_000,
  }).catch(() => null);
  if (!submit) return null;

  if (!isStillActive()) {
    await submit.reply({ embeds: [embed.build(guildId, 'Cette modification a expiré.', { color: '#ED4245', timestamp: false })], flags: 64 }).catch(() => {});
    return null;
  }

  const keyword  = (submit.fields.getTextInputValue('keyword') || '').toLowerCase().trim().replace(/^\+/, '');
  const pageName = (submit.fields.getTextInputValue('pageName') || '').toLowerCase().trim();

  if (!/^[a-z0-9_-]{1,32}$/i.test(keyword)) {
    await submit.reply({ embeds: [embed.build(guildId, 'Mot-cle invalide.', { color: '#ED4245', timestamp: false })], flags: 64 }).catch(() => {});
    return null;
  }
  if (!PAGE_NAME_RE.test(pageName)) {
    await submit.reply({ embeds: [embed.build(guildId, 'Nom de page invalide (a-z0-9_- max 32).', { color: '#ED4245', timestamp: false })], flags: 64 }).catch(() => {});
    return null;
  }

  const custom = db.getCustomCommand(guildId, keyword);
  if (!custom) {
    await submit.reply({ embeds: [embed.build(guildId, `Aucune custom \`+${keyword}\`.`, { color: '#ED4245', timestamp: false })], flags: 64 }).catch(() => {});
    return null;
  }

  let loaded;
  if (pageName === 'main') {
    loaded = _parseItems(custom.componentsJson);
  } else {
    if (!custom.componentsPagesJson) {
      await submit.reply({ embeds: [embed.build(guildId, `Aucune page \`${pageName}\` pour \`+${keyword}\`.`, { color: '#ED4245', timestamp: false })], flags: 64 }).catch(() => {});
      return null;
    }
    try {
      const _pgs = JSON.parse(custom.componentsPagesJson);
      loaded = _parseItems(_pgs[pageName] ? JSON.stringify(_pgs[pageName]) : null);
    } catch { loaded = []; }
  }

  if (!loaded.length) {
    await submit.reply({ embeds: [embed.build(guildId, `Page \`${pageName}\` vide ou introuvable dans \`+${keyword}\`.`, { color: '#ED4245', timestamp: false })], flags: 64 }).catch(() => {});
    return null;
  }

  await submit.reply({ embeds: [embed.build(guildId, `Page \`${pageName}\` chargee depuis \`+${keyword}\` (${loaded.length} component(s)).`, { timestamp: false })], flags: 64 }).catch(() => {});
  return { items: loaded, pageName };
}

async function _handlePageDelete(interaction, guildId, isStillActive = () => true) {
  const modalId = `local:cccomp:pagedel:${interaction.id}`;
  const modal = new ModalBuilder()
    .setCustomId(modalId.slice(0, 100))
    .setTitle('Supprimer une page')
    .addComponents(
      new ActionRowBuilder().addComponents(
        _input('keyword', 'Mot-cle de la custom (sans +)', TextInputStyle.Short, {
          required: true, maxLength: 32, placeholder: 'ex: hello',
        }),
      ),
      new ActionRowBuilder().addComponents(
        _input('pageName', 'Nom de page (pas main)', TextInputStyle.Short, {
          required: true, maxLength: 32, placeholder: 'page2, page3...',
        }),
      ),
    );

  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  if (!shown) return;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 120_000,
  }).catch(() => null);
  if (!submit) return;

  if (!isStillActive()) {
    await submit.reply({ embeds: [embed.build(guildId, 'Cette modification a expiré.', { color: '#ED4245', timestamp: false })], flags: 64 }).catch(() => {});
    return;
  }

  const keyword  = (submit.fields.getTextInputValue('keyword') || '').toLowerCase().trim().replace(/^\+/, '');
  const pageName = (submit.fields.getTextInputValue('pageName') || '').toLowerCase().trim();

  if (!/^[a-z0-9_-]{1,32}$/i.test(keyword)) {
    await submit.reply({ embeds: [embed.build(guildId, 'Mot-cle invalide.', { color: '#ED4245', timestamp: false })], flags: 64 }).catch(() => {});
    return;
  }
  if (pageName === 'main' || !PAGE_NAME_RE.test(pageName)) {
    await submit.reply({ embeds: [embed.build(guildId, 'Nom de page invalide ou "main" non supprimable.', { color: '#ED4245', timestamp: false })], flags: 64 }).catch(() => {});
    return;
  }

  const custom = db.getCustomCommand(guildId, keyword);
  if (!custom || !custom.componentsPagesJson) {
    await submit.reply({ embeds: [embed.build(guildId, `Aucune page secondaire pour \`+${keyword}\`.`, { color: '#ED4245', timestamp: false })], flags: 64 }).catch(() => {});
    return;
  }

  let pages;
  try { pages = JSON.parse(custom.componentsPagesJson); } catch {
    await submit.reply({ embeds: [embed.build(guildId, 'Pages corrompues.', { color: '#ED4245', timestamp: false })], flags: 64 }).catch(() => {});
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(pages, pageName)) {
    await submit.reply({ embeds: [embed.build(guildId, `Page \`${pageName}\` introuvable.`, { color: '#ED4245', timestamp: false })], flags: 64 }).catch(() => {});
    return;
  }

  delete pages[pageName];
  const newJson = Object.keys(pages).length > 0 ? JSON.stringify(pages) : null;
  try {
    db.updateCustomCommandField(guildId, keyword, 'componentsPagesJson', newJson);
  } catch {
    await submit.reply({ embeds: [embed.build(guildId, 'Erreur lors de la suppression.', { color: '#ED4245', timestamp: false })], flags: 64 }).catch(() => {});
    return;
  }

  await submit.reply({ embeds: [embed.build(guildId, `Page \`${pageName}\` supprimée de \`+${keyword}\`.`, { timestamp: false })], flags: 64 }).catch(() => {});
}


const BUTTON_STYLE_MAP = {
  primary   : ButtonStyle.Primary,
  secondary : ButtonStyle.Secondary,
  success   : ButtonStyle.Success,
  danger    : ButtonStyle.Danger,
};

async function _handleCreatePagination(interaction, guildId, isStillActive = () => true) {
  const modalId = `local:cccomp:paginmodal:${interaction.id}`;
  const modal = new ModalBuilder()
    .setCustomId(modalId.slice(0, 100))
    .setTitle('Creer pagination')
    .addComponents(
      new ActionRowBuilder().addComponents(
        _input('keyword', 'Mot-cle de la custom (sans +)', TextInputStyle.Short, {
          required: true, maxLength: 32,
          placeholder: 'ex: hello',
        }),
      ),
      new ActionRowBuilder().addComponents(
        _input('pageCount', 'Nombre de pages (2-10)', TextInputStyle.Short, {
          required: true, maxLength: 2,
          placeholder: '3',
        }),
      ),
      new ActionRowBuilder().addComponents(
        _input('prefix', 'Prefixe titre (defaut: Page)', TextInputStyle.Short, {
          required: false, maxLength: 30,
          placeholder: 'Page',
        }),
      ),
      new ActionRowBuilder().addComponents(
        _input('labels', 'Labels boutons prev|next (defaut: \u25c0|\u25b6)', TextInputStyle.Short, {
          required: false, maxLength: 40,
          placeholder: '\u25c0|\u25b6',
        }),
      ),
      new ActionRowBuilder().addComponents(
        _input('style', 'Style boutons (secondary/primary/success/danger)', TextInputStyle.Short, {
          required: false, maxLength: 12,
          placeholder: 'secondary',
        }),
      ),
    );

  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  if (!shown) return;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 120_000,
  }).catch(() => null);
  if (!submit) return;

  if (!isStillActive()) {
    await submit.reply({
      embeds : [embed.build(guildId, 'Cette modification a expiré.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return;
  }

  const rawKw = submit.fields.getTextInputValue('keyword') || '';
  const keyword = rawKw.toLowerCase().trim().replace(/^\+/, '');
  if (!/^[a-z0-9_-]{1,32}$/i.test(keyword)) {
    return submit.reply({
      embeds : [embed.build(guildId, 'Mot-cle invalide.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const custom = db.getCustomCommand(guildId, keyword);
  if (!custom) {
    return submit.reply({
      embeds : [embed.build(guildId, `Aucune custom \`+${keyword}\`. Creez-la d'abord.`, { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const count = parseInt(submit.fields.getTextInputValue('pageCount') || '', 10);
  if (isNaN(count) || count < 2 || count > 10) {
    return submit.reply({
      embeds : [embed.build(guildId, 'Nombre de pages invalide (2-10).', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const hasExisting = !!(custom.componentsJson || custom.componentsPagesJson);

  const prefix   = (submit.fields.getTextInputValue('prefix') || '').trim() || 'Page';
  const rawLabel = (submit.fields.getTextInputValue('labels') || '').trim() || '\u25c0|\u25b6';
  const parts    = rawLabel.split('|');
  const prevLabel = (parts[0] || '\u25c0').trim().slice(0, 20) || '\u25c0';
  const nextLabel = (parts[1] || '\u25b6').trim().slice(0, 20) || '\u25b6';

  const rawStyle = (submit.fields.getTextInputValue('style') || '').trim().toLowerCase() || 'secondary';
  const btnStyle = BUTTON_STYLE_MAP[rawStyle] || ButtonStyle.Secondary;

  if (hasExisting) {
    const confirmId = `local:cccomp:paginconfirm:${interaction.id}`;
    const cancelId  = `local:cccomp:pagincancel:${interaction.id}`;
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel('Oui, écraser').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(cancelId).setLabel('Annuler').setStyle(ButtonStyle.Secondary),
    );
    await submit.reply({
      embeds     : [embed.build(guildId, `\`+${keyword}\` a déjà des components. Écraser avec ${count} pages ?`, { color: '#FAA61A', timestamp: false })],
      components : [confirmRow],
      flags      : 64,
    }).catch(() => {});

    const btn = await submit.channel?.awaitMessageComponent({
      filter     : i => (i.customId === confirmId || i.customId === cancelId) && i.user.id === interaction.user.id,
      time       : TIMEOUTS.CONFIRM_TIME_MS,
      componentType : ComponentType.Button,
    }).catch(() => null);

    if (!btn || btn.customId !== confirmId) {
      if (btn) await btn.update({ embeds: [embed.build(guildId, 'Pagination annulée.', { timestamp: false })], components: [] }).catch(() => {});
      return;
    }
    await btn.deferUpdate().catch(() => {});
  }

  const pageNames = [];
  for (let p = 1; p <= count; p++) {
    pageNames.push(p === 1 ? 'main' : `page${p}`);
  }

  const allPages = {};
  for (let p = 0; p < count; p++) {
    const pageItems = [];

    pageItems.push({
      type    : 'textDisplay',
      content : `**${prefix} ${p + 1}**`,
    });

    if (p > 0) {
      pageItems.push({
        type        : 'button',
        label       : prevLabel,
        style       : _btnStyleName(btnStyle),
        componentId : _genComponentId(),
        action      : { type: 'edit_page', response: pageNames[p - 1] },
      });
    }
    if (p < count - 1) {
      pageItems.push({
        type        : 'button',
        label       : nextLabel,
        style       : _btnStyleName(btnStyle),
        componentId : _genComponentId(),
        action      : { type: 'edit_page', response: pageNames[p + 1] },
      });
    }

    allPages[pageNames[p]] = pageItems;
  }

  try {
    db.updateCustomCommandField(guildId, keyword, 'componentsJson', JSON.stringify(allPages['main']));

    const secondaryPages = {};
    for (const [name, pgItems] of Object.entries(allPages)) {
      if (name !== 'main') secondaryPages[name] = pgItems;
    }
    const pagesJson = Object.keys(secondaryPages).length > 0 ? JSON.stringify(secondaryPages) : null;
    db.updateCustomCommandField(guildId, keyword, 'componentsPagesJson', pagesJson);
  } catch (err) {
    console.error('[+custom components] pagination save failed:', err?.code || err?.message || err);
    const errPayload = { embeds: [embed.build(guildId, 'Erreur lors de la sauvegarde.', { color: '#ED4245', timestamp: false })], components: [] };
    if (hasExisting) return submit.editReply(errPayload).catch(() => {});
    return submit.reply({ ...errPayload, flags: 64 }).catch(() => {});
  }

  const pageList = pageNames.map((n, i) => `\`${n}\` = ${prefix} ${i + 1}`).join(', ');
  const successMsg = `Pagination creee pour \`+${keyword}\` : ${count} pages.\n${pageList}\nBoutons : ${prevLabel} / ${nextLabel}`;
  const successPayload = { embeds: [embed.build(guildId, successMsg, { timestamp: false })], components: [] };

  if (hasExisting) return submit.editReply(successPayload).catch(() => {});
  return submit.reply({ ...successPayload, flags: 64 }).catch(() => {});
}

function _btnStyleName(style) {
  switch (style) {
    case ButtonStyle.Primary   : return 'primary';
    case ButtonStyle.Success   : return 'success';
    case ButtonStyle.Danger    : return 'danger';
    default                    : return 'secondary';
  }
}


async function _handleLoadFromCustom(interaction, guildId, hasDraft, isStillActive = () => true) {
  const modalId = `local:cccomp:loadmodal:${interaction.id}`;
  const inputs  = [
    _input('keyword', 'Mot-clé de la custom (sans +)', TextInputStyle.Short, {
      required: true, maxLength: 32,
      placeholder: 'ex: hello',
    }),
  ];
  if (hasDraft) {
    inputs.push(
      _input('confirm', 'Écraser le brouillon actuel ? Tapez OUI', TextInputStyle.Short, {
        required: true, maxLength: 8,
        placeholder: 'OUI',
      }),
    );
  }

  const modal = new ModalBuilder()
    .setCustomId(modalId.slice(0, 100))
    .setTitle('Charger depuis une custom')
    .addComponents(inputs.map(i => new ActionRowBuilder().addComponents(i)));

  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  if (!shown) return null;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 120_000,
  }).catch(() => null);
  if (!submit) return null;

  if (!isStillActive()) {
    await submit.reply({
      embeds : [embed.build(guildId, 'Cette modification a expiré.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }

  const raw     = submit.fields.getTextInputValue('keyword') || '';
  const keyword = raw.toLowerCase().trim().replace(/^\+/, '');

  if (!/^[a-z0-9_-]{1,32}$/i.test(keyword)) {
    await submit.reply({
      embeds : [embed.build(guildId, 'Mot-clé invalide. Lettres, chiffres, tiret, underscore (max 32).', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }

  if (hasDraft) {
    const confirm = (submit.fields.getTextInputValue('confirm') || '').trim().toUpperCase();
    if (confirm !== 'OUI') {
      await submit.reply({
        embeds : [embed.build(guildId, 'Confirmation refusée. Le brouillon actuel est conservé.', { timestamp: false })],
        flags  : 64,
      }).catch(() => {});
      return null;
    }
  }

  const custom = db.getCustomCommand(guildId, keyword);
  if (!custom) {
    await submit.reply({
      embeds : [embed.build(guildId, `Aucune custom \`+${keyword}\`.`, { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }

  if (!custom.componentsJson) {
    await submit.reply({
      embeds : [embed.build(guildId, `La custom \`+${keyword}\` n'a pas de components liés.`, { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }

  const loaded = _parseItems(custom.componentsJson);
  if (!loaded.length) {
    await submit.reply({
      embeds : [embed.build(guildId, `Les components de \`+${keyword}\` sont illisibles ou vides.`, { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }

  await submit.reply({
    embeds : [embed.build(guildId, `Brouillon chargé depuis \`+${keyword}\` (${loaded.length} component(s)). Modifiez puis relink pour sauvegarder.`, { timestamp: false })],
    flags  : 64,
  }).catch(() => {});
  return loaded;
}


async function _handleImportJson(interaction, guildId, hasDraft, isStillActive = () => true) {
  const modalId = `local:cccomp:impjson:${interaction.id}`;
  const inputs = [
    _input('json', 'JSON (tableau de components)', TextInputStyle.Paragraph, {
      required: true, maxLength: 4000,
      placeholder: '[{"type":"textDisplay","content":"Hello"}]',
    }),
  ];
  if (hasDraft) {
    inputs.push(
      _input('confirm', 'Écraser le brouillon actuel ? Tapez OUI', TextInputStyle.Short, {
        required: true, maxLength: 8,
        placeholder: 'OUI',
      }),
    );
  }

  const modal = new ModalBuilder()
    .setCustomId(modalId.slice(0, 100))
    .setTitle('Importer JSON')
    .addComponents(inputs.map(i => new ActionRowBuilder().addComponents(i)));

  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  if (!shown) return null;

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 120_000,
  }).catch(() => null);
  if (!submit) return null;

  if (!isStillActive()) {
    await submit.reply({
      embeds : [embed.build(guildId, 'Cette modification a expiré.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }

  if (hasDraft) {
    const confirm = (submit.fields.getTextInputValue('confirm') || '').trim().toUpperCase();
    if (confirm !== 'OUI') {
      await submit.reply({
        embeds : [embed.build(guildId, 'Import annule. Brouillon conserve.', { timestamp: false })],
        flags  : 64,
      }).catch(() => {});
      return null;
    }
  }

  const raw = submit.fields.getTextInputValue('json') || '';
  const parsed = _parseItems(raw);
  if (!parsed.length) {
    await submit.reply({
      embeds : [embed.build(guildId, 'JSON invalide ou aucun component reconnu.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }

  const validation = _validate(parsed);
  if (!validation.ok) {
    await submit.reply({
      embeds : [embed.build(guildId, `Validation : ${validation.reason}`, { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
    return null;
  }

  await submit.reply({
    embeds : [embed.build(guildId, `Import reussi (${parsed.length} component(s)). N'oubliez pas de lier a une custom.`, { timestamp: false })],
    flags  : 64,
  }).catch(() => {});
  return parsed;
}


async function _handlePreview(interaction, guildId, items, channel) {
  const validation = _validate(items);
  if (!validation.ok) {
    return _ephemeral(interaction, guildId, `Validation : ${validation.reason}`);
  }

  const payload = _buildPreviewPayload(guildId, items);
  if (!payload) {
    return _ephemeral(interaction, guildId, 'Impossible de generer l\'apercu (aucun component exploitable).');
  }

  await interaction.deferUpdate().catch(() => {});
  await channel.send(payload).catch(err => {
    console.error('[+custom components] preview send failed:', err?.code || err?.message || err);
  });
}

function _buildPreviewPayload(guildId, items) {
  const accent = _hexToInt(embed.getGuildColor(guildId));
  const container = new ContainerBuilder().setAccentColor(accent);

  let pendingActionables = [];

  const flush = () => {
    while (pendingActionables.length > 0) {
      const chunk = pendingActionables.splice(0, MAX_BUTTONS_PER_ROW);
      const row = new ActionRowBuilder().addComponents(chunk);
      container.addActionRowComponents(row);
    }
  };

  for (const it of items) {
    if (_isSelect(it.type)) {
      flush();
      const select = _buildSelect(it);
      if (select) {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
      }
      continue;
    }

    if (it.type === 'button') {
      const btn = _buildButton(it);
      if (btn) {

        pendingActionables.push(btn);
        if (pendingActionables.length >= MAX_BUTTONS_PER_ROW) flush();
      }
      continue;
    }

    flush();

    switch (it.type) {
      case 'textDisplay':
        if (it.content?.trim()) {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(it.content),
          );
        }
        break;
      case 'separator':
        container.addSeparatorComponents(new SeparatorBuilder());
        break;
      case 'mediaGallery':
        if (it.url) {
          try {
            const gallery = new MediaGalleryBuilder()
              .addItems(new MediaGalleryItemBuilder().setURL(it.url));
            container.addMediaGalleryComponents(gallery);
          } catch {}
        }
        break;
    }
  }

  flush();

  return {
    flags           : COMPONENTS_V2_FLAG,
    embeds          : [],
    components      : [container],
    allowedMentions : { parse: [] },
  };
}

function _buildButton(it) {
  const styleMap = {
    primary   : ButtonStyle.Primary,
    secondary : ButtonStyle.Secondary,
    success   : ButtonStyle.Success,
    danger    : ButtonStyle.Danger,
    link      : ButtonStyle.Link,
  };
  const style = styleMap[it.style];
  if (!style) return null;

  const btn = new ButtonBuilder()
    .setLabel((it.label || '').slice(0, 80))
    .setStyle(style)
    .setDisabled(true);

  if (it.emoji) {
    try { btn.setEmoji(it.emoji); } catch {}
  }

  if (style === ButtonStyle.Link) {
    if (!it.url) return null;
    btn.setURL(it.url);
  } else {
    btn.setCustomId((it.customId || `local:cccomp:inert:${Math.random().toString(36).slice(2, 10)}`).slice(0, 100));
  }
  return btn;
}

function _buildSelect(it) {
  try {
    const _applyMinMax = (s, defaultMin) => {
      try {
        const min = it.minValues !== undefined ? Number(it.minValues) : defaultMin;
        const max = it.maxValues !== undefined ? Number(it.maxValues) : 1;
        if (!isNaN(min) && min >= 0) s.setMinValues(min);
        if (!isNaN(max) && max >= 1) s.setMaxValues(max);
      } catch {}
    };

    if (it.type === 'stringSelect') {
      if (!it.options?.length) return null;
      const opts = it.options.slice(0, 25)
        .map(_cleanSelectOption)
        .filter(o => o && o.label && o.value);
      if (!opts.length) return null;
      const s = new StringSelectMenuBuilder()
        .setCustomId(`local:cccomp:inert:ss:${Math.random().toString(36).slice(2, 10)}`)
        .setDisabled(true)
        .addOptions(opts);
      if (it.placeholder) s.setPlaceholder(it.placeholder.slice(0, 150));
      _applyMinMax(s, 1);
      return s;
    }
    if (it.type === 'userSelect') {
      const s = new UserSelectMenuBuilder()
        .setCustomId(`local:cccomp:inert:us:${Math.random().toString(36).slice(2, 10)}`)
        .setDisabled(true);
      if (it.placeholder) s.setPlaceholder(it.placeholder.slice(0, 150));
      _applyMinMax(s, 1);
      return s;
    }
    if (it.type === 'roleSelect') {
      const s = new RoleSelectMenuBuilder()
        .setCustomId(`local:cccomp:inert:rs:${Math.random().toString(36).slice(2, 10)}`)
        .setDisabled(true);
      if (it.placeholder) s.setPlaceholder(it.placeholder.slice(0, 150));
      _applyMinMax(s, 0);
      return s;
    }
    if (it.type === 'channelSelect') {
      const s = new ChannelSelectMenuBuilder()
        .setCustomId(`local:cccomp:inert:cs:${Math.random().toString(36).slice(2, 10)}`)
        .setDisabled(true)
        .addChannelTypes(..._resolveChannelTypes(it.channelTypes));
      if (it.placeholder) s.setPlaceholder(it.placeholder.slice(0, 150));
      _applyMinMax(s, 1);
      return s;
    }
    if (it.type === 'mentionableSelect') {
      const s = new MentionableSelectMenuBuilder()
        .setCustomId(`local:cccomp:inert:ms:${Math.random().toString(36).slice(2, 10)}`)
        .setDisabled(true);
      if (it.placeholder) s.setPlaceholder(it.placeholder.slice(0, 150));
      _applyMinMax(s, 0);
      return s;
    }
  } catch {}
  return null;
}

function _isSelect(type) {
  return ['stringSelect', 'userSelect', 'roleSelect', 'channelSelect', 'mentionableSelect'].includes(type);
}


function _validate(items) {
  if (!Array.isArray(items)) return { ok: false, reason: 'JSON invalide' };
  if (items.length === 0)    return { ok: false, reason: 'Aucun component.' };

  let count = 1;
  let pendingButtons = 0;

  const flushCount = () => {
    while (pendingButtons > 0) {
      count += 1 + Math.min(pendingButtons, MAX_BUTTONS_PER_ROW);
      pendingButtons -= Math.min(pendingButtons, MAX_BUTTONS_PER_ROW);
    }
  };

  for (const it of items) {
    if (!it || typeof it !== 'object' || !SUPPORTED_TYPES.has(it.type)) {
      return { ok: false, reason: `type non supporte : ${it?.type ?? '?'}` };
    }
    if (it.type === 'textDisplay') {
      if (!it.content || !String(it.content).trim()) return { ok: false, reason: 'TextDisplay vide' };
      flushCount();
      count += 1;
    } else if (it.type === 'separator') {
      flushCount();
      count += 1;
    } else if (it.type === 'mediaGallery') {
      if (!it.url) return { ok: false, reason: 'MediaGallery sans URL' };
      flushCount();
      count += 1;
    } else if (it.type === 'button') {
      if (!it.label) return { ok: false, reason: 'Button sans label' };
      if (it.style === 'link' && !it.url)           return { ok: false, reason: 'Button link sans URL' };


      if ((it.customId || '').length > 100)         return { ok: false, reason: 'customId > 100' };
      if ((it.label || '').length > 80)             return { ok: false, reason: 'label > 80' };
      pendingButtons += 1;
    } else if (_isSelect(it.type)) {
      if (it.type === 'stringSelect' && (it.options?.length || 0) < 2) {
        return { ok: false, reason: 'StringSelect requiert au moins 2 options' };
      }
      if (it.placeholder && it.placeholder.length > 150) {
        return { ok: false, reason: 'placeholder > 150' };
      }
      flushCount();
      count += 2;
    }
  }
  flushCount();

  if (count > MAX_COMPONENTS_TOTAL) {
    return { ok: false, reason: `> 40 components (${count})` };
  }
  return { ok: true, count };
}


function _parseItems(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter(it => it && SUPPORTED_TYPES.has(it.type)) : [];
  } catch {
    return [];
  }
}

async function _refresh(panel, guildId, items, currentPage = 'main') {
  let payload;
  try {
    payload = _buildPanelPayload(guildId, items, currentPage);
  } catch (err) {
    console.error('[+custom components] _buildPanelPayload failed:', err?.code || err?.message || err);
    payload = _buildClosedPayload(guildId, 'Builder invalide. Corrigez ou réinitialisez.');
  }
  return panel.edit(payload).catch(() => {});
}

function _buildClosedPayload(guildId, content) {
  if (!V2_AVAILABLE) {
    return {
      embeds          : [embed.build(guildId, content, { timestamp: false })],
      components      : [],
      allowedMentions : { parse: [] },
    };
  }
  const accent = _hexToInt(embed.getGuildColor(guildId));
  const container = new ContainerBuilder().setAccentColor(accent);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
  return {
    flags           : COMPONENTS_V2_FLAG,
    embeds          : [],
    components      : [container],
    allowedMentions : { parse: [] },
  };
}


function _cleanSelectOption(opt = {}) {
  const labelRaw = String(opt.label ?? '').trim();
  const valueRaw = String(opt.value ?? '').trim();
  const descRaw  = String(opt.description ?? '').trim();

  const label = (labelRaw || 'Option').slice(0, 100);
  const value = (valueRaw || `opt_${Math.random().toString(36).slice(2, 10)}`).slice(0, 100);

  const out = { label, value };
  if (descRaw) out.description = descRaw.slice(0, 100);
  if (opt.emoji != null && opt.emoji !== '') out.emoji = opt.emoji;
  return out;
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
    input.setMaxLength(Math.min(4000, options.maxLength));
  }
  return input;
}


const _DOC_PAGES = [
  '## Comprendre Components V2\n\n' +
  'Components V2 remplace l\'embed classique.\n' +
  'Pour faire un rendu type embed :\n\n' +
  '- **TextDisplay** = titre / description\n' +
  '- **Separator** = ligne de separation\n' +
  '- **MediaGallery** = image\n' +
  '- **Button / Select** = actions dessous\n\n' +
  '> Un bouton "en dehors de l\'embed" se fait en ajoutant un Button apres le TextDisplay/MediaGallery.\n' +
  '> En V2, tout est dans le meme message, les boutons apparaissent sous le contenu comme un bouton classique.',

  '## Creer un menu de roles\n\n' +
  '1. Ajouter un **StringSelect**\n' +
  '2. Options : `Rouge|ID_ROLE_ROUGE` / `Bleu|ID_ROLE_BLEU`\n' +
  '3. Action : **role_sync**\n' +
  '4. Role ID : **vide**\n' +
  '5. minValues : **0** / maxValues : nombre de roles\n\n' +
  '> La selection exacte devient les roles du membre.\n' +
  '> Deselectionner tout retire tous les roles du menu.',

  '## Actions utiles\n\n' +
  '- **reply** : repond au membre (ephemeral ou public)\n' +
  '- **dm** : envoie un MP au membre\n' +
  '- **role_add / role_remove / role_toggle** : gere un role\n' +
  '- **role_sync** : synchronise un menu de roles\n' +
  '- **channel_send** : envoie un message dans un salon\n' +
  '- **delete_message** : bouton poubelle\n' +
  '- **edit_page** : change de page (pagination)\n' +
  '- **none** : ne fait rien (utile en multi-actions)',

  '## Pagination\n\n' +
  '- **main** = page affichee avec la commande\n' +
  '- **page2 / page3** = pages secondaires\n\n' +
  'Bouton Suivant :\n' +
  '  action `edit_page` reponse `page2`\n\n' +
  'Bouton Retour :\n' +
  '  action `edit_page` reponse `main`\n\n' +
  '> **Outils > Creer pagination** genere automatiquement les boutons de navigation.',

  '## Exemples de commandes possibles\n\n' +
  '- Rolemenu custom\n' +
  '- Panel staff\n' +
  '- Mini ticket\n' +
  '- Menu permissions\n' +
  '- Help interactif\n' +
  '- Verify simple\n' +
  '- Navigation multi-pages\n' +
  '- Panneau de regles\n' +
  '- Bouton poubelle\n' +
  '- Formulaire leger avec channel_send',

  '## Outils\n\n' +
  '- **Enregistrer page** : sauvegarde la page actuelle\n' +
  '- **Charger page** : charge une page existante\n' +
  '- **Charger une custom** : reprend les components d\'une custom\n' +
  '- **Exporter JSON** : copier le JSON du brouillon\n' +
  '- **Importer JSON** : coller un JSON pour remplacer\n' +
  '- **Creer pagination** : genere pages main/page2/page3 + boutons',
];

function _buildDocPayload(guildId, docPage) {
  const total = _DOC_PAGES.length;
  const p = Math.max(0, Math.min(total - 1, docPage));
  const accent = _hexToInt(embed.getGuildColor(guildId));
  const container = new ContainerBuilder().setAccentColor(accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Documentation components'),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(_DOC_PAGES[p]),
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:cccomp:doc:prev')
        .setEmoji('\u25c0')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p === 0),
      new ButtonBuilder()
        .setCustomId('local:cccomp:doc:page')
        .setLabel(`${p + 1}/${total}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('local:cccomp:doc:next')
        .setEmoji('\u25b6')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p === total - 1),
      new ButtonBuilder()
        .setCustomId('local:cccomp:doc:back')
        .setLabel('Retour')
        .setEmoji('\u21a9')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return {
    flags           : COMPONENTS_V2_FLAG,
    embeds          : [],
    components      : [container],
    allowedMentions : { parse: [] },
  };
}

async function _ephemeral(interaction, guildId, content) {
  return interaction.reply({
    embeds : [embed.build(guildId, content, { color: '#ED4245', timestamp: false })],
    flags  : 64,
  }).catch(() => {});
}

async function _ephemeralInfo(interaction, guildId, content) {
  return interaction.reply({
    embeds : [embed.build(guildId, content, { timestamp: false })],
    flags  : 64,
  }).catch(() => {});
}

function _truncate(text, max) {
  if (!text || text.length <= max) return text || '';
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function _hexToInt(hex) {
  if (typeof hex !== 'string') return 0x5865F2;
  const m = hex.replace(/^#/, '').match(/^[0-9a-fA-F]{6}$/);
  return m ? parseInt(m[0], 16) : 0x5865F2;
}

