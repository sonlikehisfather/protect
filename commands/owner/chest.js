'use strict';

/**
 * +chest : stockage privé de textes, images et vidéos.
 * Accès : buyer principal (BUYER_ID) + personnes autorisées avec `+chest access add`.
 * Les fichiers sont copiés sur le disque (data/vault) : les liens Discord expirent, pas le disque.
 */

const fs   = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, FileUploadBuilder,
  AttachmentBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');
const logger = require('../../utils/logger');

const VAULT_DIR       = path.join(__dirname, '..', '..', 'data', 'vault');
const PAGE_SIZE       = 8;
const IDLE_MS         = 5 * 60_000;
const MAX_FILE_BYTES  = 200 * 1024 * 1024;
const MAX_DRAFT_FILES = 25;

const KINDS = {
  text : { label: 'Textes', one: 'texte' },
  image: { label: 'Images', one: 'image' },
  video: { label: 'Vidéos', one: 'vidéo' },
  file : { label: 'Fichiers', one: 'fichier' },
};

const TEXT_WAIT_MS = 120_000;

const ORDERS = {
  recent: 'Plus récents d’abord',
  old   : 'Plus anciens d’abord',
  title : 'Titre (A à Z)',
};

const DAY = 86_400_000;
const PERIODS = {
  all : { label: 'Toute la période',    ms: null },
  d1  : { label: '24 dernières heures', ms: DAY },
  d7  : { label: '7 derniers jours',    ms: 7 * DAY },
  d30 : { label: '30 derniers jours',   ms: 30 * DAY },
  d365: { label: '12 derniers mois',    ms: 365 * DAY },
};

module.exports = {
  help: {
    name        : 'chest',
    description : 'Chest privé (textes, images, vidéos). Accès restreint.',
    usage       : 'chest | chest access <add|del|list> [@membre]',
    aliases     : [],
    category    : 'owner',
    selfManaged : true,
    hidden      : true,
  },

  async run(client, message, args) {
    const userId = message.author.id;
    const isMain = perms.isSuperAdmin(userId);

    // Commande invisible pour les autres : aucune réponse, aucune trace.
    if (!isMain && !_hasAccess(userId)) return;

    if ((args[0] || '').toLowerCase() === 'access') {
      if (!isMain) return;   // les personnes autorisées ne gèrent pas les accès
      return _handleAccess(client, message, args.slice(1));
    }

    return _openPanel(client, message);
  },
};

function _hasAccess(userId) {
  try { return db.hasVaultAccess(userId); } catch { return false; }
}

// ─── Gestion des accès ──────────────────────────────────────────────────────

async function _handleAccess(client, message, args) {
  const guildId = message.guild.id;
  const action  = (args[0] || 'list').toLowerCase();
  const send = content => message.channel.send({ content, allowedMentions: { parse: [] } }).catch(() => {});

  if (action === 'list') {
    const rows = db.listVaultAccess();
    const lines = rows.length
      ? rows.map(r => `▸ <@${r.userId}> (\`${r.userId}\`) depuis <t:${Math.floor(r.grantedAt / 1000)}:d>`).join('\n')
      : 'Aucune personne autorisée (à part toi).';
    return message.channel.send(_ctr(guildId, { title: '◈ Accès au chest', body: lines })).catch(() => {});
  }

  if (action !== 'add' && action !== 'del') {
    return send('Utilisation : `chest access <add|del|list> [@membre]`');
  }

  const raw = args[1];
  const id  = message.mentions.users.first()?.id ?? (raw && /^\d{15,25}$/.test(raw) ? raw : null);
  if (!id) return send('Mentionne un membre ou donne son identifiant.');
  if (id === message.author.id) return send('Tu as déjà accès (buyer principal).');

  if (action === 'add') {
    const user = await client.users.fetch(id).catch(() => null);
    if (!user || user.bot) return send('Utilisateur introuvable (ou bot).');
    db.grantVaultAccess(id, message.author.id);
    return send(`<@${id}> a maintenant accès au chest.`);
  }

  const removed = db.revokeVaultAccess(id);
  return send(removed ? `<@${id}> n’a plus accès au chest.` : 'Cette personne n’avait pas d’accès.');
}

// ─── Panel ──────────────────────────────────────────────────────────────────

async function _openPanel(client, message) {
  const guildId  = message.guild.id;
  const authorId = message.author.id;

  const state = {
    view: 'home',                 // home | list | detail | draft
    kind: 'text',
    page: 0,
    order: 'recent',
    period: 'all',
    search: '',
    itemId: null,
    confirmDelete: false,
    busy: false,
    notice: null,
    draft: null,                  // { kind, title, note, files: [{ rel, name, size, mime }] }
  };

  const render = () => _render(guildId, state);
  const panel = await message.channel.send({ ...render(), allowedMentions: { parse: [] } }).catch(() => null);
  if (!panel) return;

  embed.registerPrivateInteraction(panel, authorId, IDLE_MS);

  const collector = panel.createMessageComponentCollector({
    filter: i => i.user.id === authorId && i.message.id === panel.id,
    idle: IDLE_MS,
  });

  collector.on('collect', async interaction => {
    try {
      if (state.busy) return interaction.deferUpdate().catch(() => {});
      await _onInteraction(message, panel, collector, state, interaction, render);
    } catch (err) {
      logger.error?.(`[chest] ${err.stack || err.message}`);
      state.busy = false;
      if (!interaction.replied && !interaction.deferred) interaction.deferUpdate().catch(() => {});
    }
  });

  collector.on('end', async () => {
    embed.clearPrivateInteraction(panel);
    state.waiter?.stop('closed');
    _discardDraft(state);
    // Fermeture (bouton ou inactivité) : le panel ET le message de commande disparaissent.
    await panel.delete().catch(() => {});
    await message.delete().catch(() => {});
  });
}

async function _onInteraction(message, panel, collector, state, i, render) {
  const id = i.customId;
  state.notice = null;

  const update = () => i.update(render()).catch(() => {});

  // Navigation
  if (id === 'vlt:close') {
    collector.stop('closed');
    return i.deferUpdate().catch(() => {});
  }
  if (id === 'vlt:home') { state.view = 'home'; state.confirmDelete = false; return update(); }

  if (id === 'vlt:kind') {
    state.kind = i.values[0];
    state.view = 'list'; state.page = 0; state.search = '';
    return update();
  }

  if (id === 'vlt:prev') { state.page = Math.max(0, state.page - 1); return update(); }
  if (id === 'vlt:next') { state.page += 1; return update(); }
  if (id === 'vlt:back') { state.view = 'list'; state.confirmDelete = false; return update(); }

  if (id === 'vlt:order')  { state.order  = i.values[0]; state.page = 0; return update(); }
  if (id === 'vlt:period') { state.period = i.values[0]; state.page = 0; return update(); }
  if (id === 'vlt:open')   { state.itemId = Number(i.values[0]); state.view = 'detail'; state.confirmDelete = false; return update(); }

  // Recherche
  if (id === 'vlt:search') {
    const modal = new ModalBuilder().setCustomId(`vlt:modal:search:${i.id}`).setTitle('Rechercher')
      .addLabelComponents(_text('q', 'Mot-clé (vide = tout afficher)', TextInputStyle.Short, { value: state.search, required: false, max: 100 }));
    await i.showModal(modal).catch(() => {});
    const sub = await _awaitModal(i, modal.data.custom_id);
    if (!sub) return;
    state.search = sub.fields.getTextInputValue('q').trim();
    state.page = 0;
    return sub.update(render()).catch(() => {});
  }

  // Ajout
  if (id === 'vlt:add') { state.view = 'new'; return update(); }
  if (id === 'vlt:newtype') return _onNewType(message, panel, state, i, render);
  if (id === 'vlt:waitcancel') {
    state.waitCancelled = true;
    state.waiter?.stop('cancel');
    return i.deferUpdate().catch(() => {});
  }

  // Brouillon (images, vidéos, fichiers)
  if (id === 'vlt:draft:files') return _draftFiles(state, panel, i, render);
  if (id === 'vlt:draft:cancel') {
    _discardDraft(state);
    state.view = 'home';
    state.notice = 'Ajout annulé.';
    return update();
  }
  if (id === 'vlt:draft:save') return _draftSave(message, state, i, render);

  // Fiche d'un élément
  if (id.startsWith('vlt:item:')) {
    const item = db.getVaultItem(state.itemId);
    if (!item) { state.view = 'list'; state.notice = 'Cet élément n’existe plus.'; return update(); }

    if (id === 'vlt:item:show') return _showItem(i, item);

    if (id === 'vlt:item:rename') {
      const modal = new ModalBuilder().setCustomId(`vlt:modal:rename:${i.id}`).setTitle('Renommer')
        .addLabelComponents(
          _text('title', 'Titre', TextInputStyle.Short, { value: item.title, max: 100 }),
          _text('note', 'Note (optionnelle)', TextInputStyle.Paragraph, { value: item.note || '', required: false, max: 500 }),
        );
      await i.showModal(modal).catch(() => {});
      const sub = await _awaitModal(i, modal.data.custom_id);
      if (!sub) return;
      db.renameVaultItem(item.id, sub.fields.getTextInputValue('title').trim() || item.title,
        sub.fields.getTextInputValue('note').trim() || null);
      state.notice = 'Élément mis à jour.';
      return sub.update(render()).catch(() => {});
    }

    if (id === 'vlt:item:delete') { state.confirmDelete = true; return update(); }
    if (id === 'vlt:item:cancel') { state.confirmDelete = false; return update(); }
    if (id === 'vlt:item:confirm') {
      _deleteFile(item);
      db.deleteVaultItem(item.id);
      state.view = 'list'; state.confirmDelete = false; state.itemId = null;
      state.notice = `« ${item.title} » supprimé.`;
      return update();
    }
  }

  return i.deferUpdate().catch(() => {});
}

// ─── Ajout ──────────────────────────────────────────────────────────────────

/** Le menu "type" de la vue Nouvel élément : texte (via le chat) ou formulaire d'envoi de fichiers. */
async function _onNewType(message, panel, state, i, render) {
  const kind = i.values[0];
  if (!KINDS[kind]) return i.deferUpdate().catch(() => {});
  state.kind = kind;
  if (kind === 'text') return _waitText(message, panel, state, i, render);
  return _uploadForm(state, panel, i, kind, render);
}

async function _waitText(message, panel, state, i, render) {
  state.view = 'waittext';
  state.waitCancelled = false;
  await i.update(render()).catch(() => {});

  const col = message.channel.createMessageCollector({
    filter: m => m.author.id === i.user.id,
    max: 1,
    time: TEXT_WAIT_MS,
  });
  state.waiter = col;

  const got = await new Promise(resolve => {
    let m = null;
    col.on('collect', x => { m = x; });
    col.on('end', () => resolve(m));
  });
  state.waiter = null;

  const back = notice => { state.view = 'new'; state.notice = notice; return panel.edit(render()).catch(() => {}); };

  if (!got) return back(state.waitCancelled ? 'Ajout annulé.' : 'Temps écoulé : rien n’a été enregistré.');
  const content = got.content.trim();
  got.delete().catch(() => {});
  if (/^annuler$/i.test(content)) return back('Ajout annulé.');
  if (!content) return back('Message vide : un texte doit être écrit dans le message.');

  const newId = db.addVaultItem({
    kind: 'text',
    title: _cut(content.split('\n')[0].trim(), 60) || 'Sans titre',
    content: content.slice(0, 4000),
    createdBy: i.user.id,
  });
  state.view = 'detail'; state.itemId = newId;
  state.notice = 'Texte enregistré. « Renommer » permet de changer le titre ou d’ajouter une note.';
  return panel.edit(render()).catch(() => {});
}

async function _uploadForm(state, panel, i, kind, render) {
  const k = KINDS[kind];
  const upload = new FileUploadBuilder().setCustomId('files').setMinValues(1).setMaxValues(10).setRequired(true);
  const modal = new ModalBuilder().setCustomId(`vlt:modal:up:${i.id}`).setTitle(`Nouveau : ${k.one}`)
    .addLabelComponents(
      _text('title', 'Titre', TextInputStyle.Short, { max: 100 }),
      _text('note', 'Note (optionnelle)', TextInputStyle.Short, { required: false, max: 500 }),
      new LabelBuilder().setLabel(k.label).setDescription('10 fichiers maximum à la fois.').setFileUploadComponent(upload),
    );

  await i.showModal(modal).catch(() => {});
  const sub = await _awaitModal(i, modal.data.custom_id);
  if (!sub) return;

  _discardDraft(state);
  state.draft = {
    kind,
    title: sub.fields.getTextInputValue('title').trim() || 'Sans titre',
    note : sub.fields.getTextInputValue('note').trim() || null,
    files: [],
  };
  state.view = 'draft';
  state.busy = true;
  state.notice = 'Téléchargement en cours...';
  await sub.update(render()).catch(() => {});

  state.notice = await _ingest(state.draft, sub.fields.getUploadedFiles('files', false));
  state.busy = false;
  return panel.edit(render()).catch(() => {});
}

/** Copie les fichiers reçus sur le disque et les ajoute au brouillon. Renvoie le message de bilan. */
async function _ingest(d, files) {
  const errors = [];
  let added = 0;

  for (const att of files?.values() ?? []) {
    if (d.files.length >= MAX_DRAFT_FILES) { errors.push(`Limite de ${MAX_DRAFT_FILES} fichiers atteinte.`); break; }
    const mime = att.contentType || _mimeFromName(att.name);
    if (d.kind === 'image' && !mime.startsWith('image/')) { errors.push(`${att.name} : n’est pas une image`); continue; }
    if (d.kind === 'video' && !mime.startsWith('video/')) { errors.push(`${att.name} : n’est pas une vidéo`); continue; }
    if (att.size > MAX_FILE_BYTES) { errors.push(`${att.name} : trop lourd (200 Mo maximum)`); continue; }

    try {
      const rel = await _download(att.url, d.kind, att.name);
      d.files.push({ rel, name: att.name, size: att.size, mime });
      added++;
    } catch (err) {
      errors.push(`${att.name} : téléchargement impossible`);
      logger.error?.(`[chest] download ${att.name}: ${err.message}`);
    }
  }

  const parts = [];
  if (added) parts.push(`${added} fichier(s) ajouté(s) au brouillon.`);
  if (errors.length) parts.push(errors.join('\n'));
  return parts.join('\n') || 'Aucun fichier reçu.';
}

/** Ajoute d'autres fichiers à un brouillon existant. */
async function _draftFiles(state, panel, i, render) {
  const d = state.draft;
  if (!d) return i.deferUpdate().catch(() => {});

  const upload = new FileUploadBuilder().setCustomId('files').setMinValues(1).setMaxValues(10).setRequired(true);
  const modal = new ModalBuilder().setCustomId(`vlt:modal:files:${i.id}`).setTitle(`Fichiers : ${_cut(d.title, 30)}`)
    .addLabelComponents(
      new LabelBuilder().setLabel(KINDS[d.kind].label).setDescription('10 fichiers maximum à la fois.').setFileUploadComponent(upload),
    );

  await i.showModal(modal).catch(() => {});
  const sub = await _awaitModal(i, modal.data.custom_id);
  if (!sub) return;

  state.busy = true;
  state.notice = 'Téléchargement en cours...';
  await sub.update(render()).catch(() => {});

  state.notice = await _ingest(d, sub.fields.getUploadedFiles('files', false));
  state.busy = false;
  return panel.edit(render()).catch(() => {});
}


async function _draftSave(message, state, i, render) {
  const d = state.draft;
  if (!d || !d.files.length) return i.deferUpdate().catch(() => {});

  let firstId = null;
  d.files.forEach((f, idx) => {
    const itemId = db.addVaultItem({
      kind: d.kind,
      title: d.files.length > 1 ? `${d.title} (${idx + 1})` : d.title,
      note: d.note, filePath: f.rel, originalName: f.name, mime: f.mime, size: f.size,
      createdBy: i.user.id,
    });
    if (firstId == null) firstId = itemId;
  });

  const count = d.files.length;
  state.draft = null;
  state.kind = d.kind;
  state.page = 0; state.search = '';
  if (count === 1) { state.view = 'detail'; state.itemId = firstId; } else { state.view = 'list'; }
  state.notice = `${count} fichier(s) enregistré(s).`;
  return i.update(render()).catch(() => {});
}

function _discardDraft(state) {
  const d = state.draft;
  state.draft = null;
  if (!d) return;
  for (const f of d.files) {
    const full = _resolveFile({ filePath: f.rel });
    if (full) fs.rmSync(full, { force: true });
  }
}

async function _download(url, kind, originalName) {
  const dir = path.join(VAULT_DIR, kind);
  fs.mkdirSync(dir, { recursive: true });

  let ext = path.extname(originalName || '').toLowerCase();
  if (!/^\.[a-z0-9]{1,5}$/.test(ext)) ext = kind === 'image' ? '.png' : kind === 'video' ? '.mp4' : '.bin';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const full = path.join(dir, name);

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  try {
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(full));
  } catch (err) {
    fs.rmSync(full, { force: true });
    throw err;
  }
  return `${kind}/${name}`;
}

function _deleteFile(item) {
  const full = _resolveFile(item);
  if (full) fs.rmSync(full, { force: true });
}

function _resolveFile(item) {
  if (!item.filePath) return null;
  const full = path.resolve(VAULT_DIR, item.filePath);
  return full.startsWith(path.resolve(VAULT_DIR) + path.sep) ? full : null;   // anti path-traversal
}

function _mimeFromName(name = '') {
  const e = path.extname(name).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif'].includes(e)) return `image/${e.slice(1).replace('jpg', 'jpeg')}`;
  if (['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'].includes(e)) return `video/${e.slice(1)}`;
  return 'application/octet-stream';
}

// ─── Affichage privé (visible de toi seul) ─────────────────────────────────

async function _showItem(i, item) {
  if (item.kind === 'text') {
    const text = item.content || '';
    const chunks = [];
    for (let p = 0; p < text.length; p += 1900) chunks.push(text.slice(p, p + 1900));
    await i.reply({ content: `**${item.title}**\n${chunks[0] || '*(vide)*'}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {});
    for (const c of chunks.slice(1)) {
      await i.followUp({ content: c, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {});
    }
    return;
  }

  const full = _resolveFile(item);
  if (!full || !fs.existsSync(full)) {
    return i.reply({ content: 'Le fichier est introuvable sur le disque.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  try {
    await i.editReply({
      content: `**${item.title}**`,
      files: [new AttachmentBuilder(full, { name: item.originalName || path.basename(full) })],
    });
  } catch {
    await i.editReply({
      content: `Impossible d’envoyer ce fichier (${_fmtSize(item.size)}) : il dépasse sûrement la limite d’envoi du serveur.`,
    }).catch(() => {});
  }
}

// ─── Rendu ──────────────────────────────────────────────────────────────────

function _render(guildId, state) {
  if (state.view === 'list')   return _renderList(guildId, state);
  if (state.view === 'detail') return _renderDetail(guildId, state);
  if (state.view === 'draft')  return _renderDraft(guildId, state);
  if (state.view === 'new')    return _renderNew(guildId, state);
  if (state.view === 'waittext') return _renderWaitText(guildId);
  return _renderHome(guildId, state);
}

function _renderNew(guildId, state) {
  const body =
    'Choisis le type d’élément à ajouter.\n\n' +
    '▸ **Texte** : tu l’envoies ensuite dans le chat\n' +
    '▸ **Image, vidéo, fichier** : un formulaire s’ouvre (10 fichiers à la fois)' +
    (state.notice ? `\n\n> ${state.notice}` : '');

  return _ctr(guildId, {
    title: '◈ Nouvel élément',
    body,
    rows: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('vlt:newtype').setPlaceholder('Type d’élément')
          .addOptions(Object.entries(KINDS).map(([k, v]) => ({
            label: v.one.charAt(0).toUpperCase() + v.one.slice(1),
            value: k,
            default: k === state.kind,
          }))),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vlt:home').setLabel('Retour').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('vlt:close').setLabel('Fermer').setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}

function _renderWaitText(guildId) {
  return _ctr(guildId, {
    title: '◈ Nouveau texte',
    body :
      'Envoie maintenant ton texte dans ce salon (4000 caractères maximum).\n' +
      'Ton message sera supprimé une fois enregistré. Tu as 2 minutes.',
    rows: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vlt:waitcancel').setLabel('Annuler').setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}

function _renderHome(guildId, state) {
  const c = db.countVaultItems();
  const desc =
    `Espace privé. Tout est rangé par type et classable par date.\n\n` +
    `▸ **Textes** : \`${c.text}\`\n` +
    `▸ **Images** : \`${c.image}\`\n` +
    `▸ **Vidéos** : \`${c.video}\`\n` +
    `▸ **Fichiers** : \`${c.file}\`` +
    (state.notice ? `\n\n> ${state.notice}` : '');

  return _ctr(guildId, {
    title: '◈ Chest',
    body : desc,
    rows : [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('vlt:kind').setPlaceholder('Ouvrir une rubrique')
          .addOptions(Object.entries(KINDS).map(([k, v]) => ({
            label: v.label, value: k, description: `${c[k]} élément(s)`,
          }))),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vlt:add').setLabel('Nouvel élément').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('vlt:close').setLabel('Fermer').setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}

function _query(state) {
  const p = PERIODS[state.period] ?? PERIODS.all;
  return {
    kind: state.kind,
    search: state.search,
    since: p.ms ? Date.now() - p.ms : null,
    order: state.order,
  };
}

function _renderList(guildId, state) {
  const k = KINDS[state.kind];
  let q = db.queryVaultItems({ ..._query(state), limit: PAGE_SIZE, offset: state.page * PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(q.total / PAGE_SIZE));
  if (state.page > pages - 1) {
    state.page = pages - 1;
    q = db.queryVaultItems({ ..._query(state), limit: PAGE_SIZE, offset: state.page * PAGE_SIZE });
  }

  const lines = q.rows.length
    ? q.rows.map(r => `\`#${r.num ?? r.id}\` **${_cut(r.title, 60)}** ・ <t:${Math.floor(r.createdAt / 1000)}:d>${r.size ? ` ・ ${_fmtSize(r.size)}` : ''}`).join('\n')
    : '*Aucun élément pour ces filtres.*';

  const filters = [
    `Tri : **${ORDERS[state.order]}**`,
    `Période : **${PERIODS[state.period].label}**`,
    state.search ? `Recherche : **${_cut(state.search, 40)}**` : null,
  ].filter(Boolean).join(' ・ ');

  const body   = `${filters}\n\n${lines}${state.notice ? `\n\n> ${state.notice}` : ''}`;
  const title  = `◈ ${k.label} ・ ${q.total} élément(s)`;
  const footer = `Page ${state.page + 1}/${pages}`;

  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('vlt:order').setPlaceholder('Trier par')
        .addOptions(Object.entries(ORDERS).map(([v, l]) => ({ label: l, value: v, default: v === state.order }))),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('vlt:period').setPlaceholder('Période')
        .addOptions(Object.entries(PERIODS).map(([v, p]) => ({ label: p.label, value: v, default: v === state.period }))),
    ),
  ];

  if (q.rows.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('vlt:open').setPlaceholder('Ouvrir un élément')
        .addOptions(q.rows.map(r => ({
          label: _cut(`#${r.num ?? r.id} ${r.title}`, 100),
          description: _fmtDate(r.createdAt),
          value: String(r.id),
        }))),
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vlt:prev').setLabel('Précédent').setStyle(ButtonStyle.Secondary).setDisabled(state.page <= 0),
    new ButtonBuilder().setCustomId('vlt:next').setLabel('Suivant').setStyle(ButtonStyle.Secondary).setDisabled(state.page >= pages - 1),
    new ButtonBuilder().setCustomId('vlt:search').setLabel('Rechercher').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vlt:add').setLabel('Nouveau').setStyle(ButtonStyle.Success),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vlt:home').setLabel('Accueil').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vlt:close').setLabel('Fermer').setStyle(ButtonStyle.Danger),
  ));

  return _ctr(guildId, { title, body, footer, rows });
}

function _renderDetail(guildId, state) {
  const item = db.getVaultItem(state.itemId);
  if (!item) {
    state.view = 'list';
    state.notice = 'Cet élément n’existe plus.';
    return _renderList(guildId, state);
  }

  const ts = Math.floor(item.createdAt / 1000);
  const meta = [
    `**Type** : ${KINDS[item.kind].one}`,
    `**Ajouté** : <t:${ts}:F> (<t:${ts}:R>)`,
    `**Par** : <@${item.createdBy}>`,
    item.originalName ? `**Fichier** : ${item.originalName} (${_fmtSize(item.size)})` : null,
    item.note ? `**Note** : ${_cut(item.note, 500)}` : null,
  ].filter(Boolean).join('\n');

  const preview = item.kind === 'text'
    ? `\n\n**Aperçu**\n${_cut(item.content || '', 300).replace(/```/g, "'''")}`
    : '';
  const warn = state.confirmDelete ? '\n\n**Supprimer définitivement cet élément ?**' : '';

  const body  = `${meta}${preview}${warn}${state.notice ? `\n\n> ${state.notice}` : ''}`;
  const title = `◈ #${item.num ?? item.id} ・ ${_cut(item.title, 200)}`;

  const buttons = state.confirmDelete
    ? [
        new ButtonBuilder().setCustomId('vlt:item:confirm').setLabel('Confirmer la suppression').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('vlt:item:cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
      ]
    : [
        new ButtonBuilder().setCustomId('vlt:item:show').setLabel(item.kind === 'text' ? 'Afficher (privé)' : 'Récupérer (privé)').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('vlt:item:rename').setLabel('Renommer').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vlt:item:delete').setLabel('Supprimer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('vlt:back').setLabel('Retour').setStyle(ButtonStyle.Primary),
      ];

  return _ctr(guildId, { title, body, rows: [new ActionRowBuilder().addComponents(...buttons)] });
}

function _renderDraft(guildId, state) {
  const d = state.draft;
  if (!d) { state.view = 'home'; return _renderHome(guildId, state); }

  const list = d.files.length
    ? d.files.map(f => `▸ ${_cut(f.name, 60)} ・ ${_fmtSize(f.size)}`).join('\n')
    : '*Aucun fichier pour le moment.*';

  const desc =
    `**Titre** : ${_cut(d.title, 100)}\n` +
    (d.note ? `**Note** : ${_cut(d.note, 300)}\n` : '') +
    `\n**Fichiers (${d.files.length})**\n${list}\n\n` +
    `Clique sur **Ajouter des fichiers**, choisis tes ${KINDS[d.kind].label.toLowerCase()} dans le formulaire, ` +
    `puis **Enregistrer**.` +
    (state.notice ? `\n\n> ${state.notice}` : '');

  return _ctr(guildId, {
    title: `◈ Nouveau : ${KINDS[d.kind].one}`,
    body : desc,
    rows : [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vlt:draft:files').setLabel('Ajouter des fichiers').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('vlt:draft:save').setLabel(`Enregistrer (${d.files.length})`).setStyle(ButtonStyle.Success).setDisabled(!d.files.length),
        new ButtonBuilder().setCustomId('vlt:draft:cancel').setLabel('Annuler').setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}

// ─── Utilitaires ────────────────────────────────────────────────────────────

/** Message Components V2 : un conteneur (texte + séparateur + rangées de boutons / menus). */
function _ctr(guildId, { title, body, footer, rows = [] }) {
  const c = new ContainerBuilder();
  try { c.setAccentColor(embed.getGuildColor(guildId)); } catch {}

  const parts = [];
  if (title) parts.push(`### ${title}`);
  if (body)  parts.push(body);
  if (footer) parts.push(`-# ${footer}`);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(parts.join('\n\n').slice(0, 4000)));

  if (rows.length) {
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    for (const r of rows) c.addActionRowComponents(r);
  }

  return { components: [c], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function _text(id, label, style, { value, required = true, max } = {}) {
  const t = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required);
  if (value) t.setValue(String(value).slice(0, max ?? 4000));
  if (max) t.setMaxLength(max);
  return new LabelBuilder().setLabel(label).setTextInputComponent(t);
}

async function _awaitModal(interaction, customId) {
  return interaction.awaitModalSubmit({
    filter: m => m.customId === customId && m.user.id === interaction.user.id,
    time: 10 * 60_000,
  }).catch(() => null);
}

function _cut(s, n) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function _fmtSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(2)} Go`;
}

function _fmtDate(ms) {
  return new Date(ms).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
