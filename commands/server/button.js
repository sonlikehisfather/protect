'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ModalBuilder,
  PermissionsBitField,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const USAGE =
  '`+button add <lien du message>`\n' +
  '`+button del <lien du message>`\n' +
  '`+button list <lien du message>`\n\n' +
  'Format avance :\n' +
  '`+button add <messageId|last> <texte> <url>`\n' +
  '`+button del <messageId|last> <index|all>`';

const MSG_LINK_RE = /^https?:\/\/(?:canary\.|ptb\.)?discord\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})$/;

module.exports = {
  help: {
    name        : 'button',
    description : 'Ajoute ou supprime un bouton lien sur un message du bot.',
    usage       : 'button <add/del/list> <lien du message>',
    aliases     : ['buttons'],
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, 'button')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const action = args[0]?.toLowerCase();

    if (!['add', 'del', 'list'].includes(action)) {
      return _reply(message, deleteReply, deleteDelay, USAGE, true);
    }

    const targetArg = args[1];

    if (!targetArg) {
      return _reply(message, deleteReply, deleteDelay, USAGE, true);
    }

    const linkParsed = _parseMessageLink(targetArg, guildId);
    const isLinkMode = Boolean(linkParsed);

    let target;

    if (isLinkMode) {
      target = await _resolveFromLink(message, client, linkParsed);
    } else {
      target = await _resolveMessage(message, client, targetArg.toLowerCase());
    }

    if (!target) {
      return _reply(message, deleteReply, deleteDelay, 'Message introuvable.', true);
    }

    if (target.author.id !== client.user.id) {
      return _reply(message, deleteReply, deleteDelay, 'Je ne peux modifier que mes propres messages.', true);
    }

    if (_hasSystemComponents(target)) {
      return _reply(
        message, deleteReply, deleteDelay,
        'Ce message contient déjà des composants système, je ne peux pas le modifier avec +button.',
        true
      );
    }


    if (isLinkMode && action === 'add') {
      return _handleAddModal(client, message, target, deleteReply, deleteDelay);
    }

    if (isLinkMode && action === 'del') {
      return _handleDelSelect(client, message, target, deleteReply, deleteDelay);
    }

    if (action === 'add') {
      return _handleAddClassic(message, target, args.slice(2), deleteReply, deleteDelay);
    }

    if (action === 'del') {
      return _handleDelClassic(message, target, args[2], deleteReply, deleteDelay);
    }

    return _handleList(message, target, deleteReply, deleteDelay);
  },
};


async function _handleAddModal(client, message, target, deleteReply, deleteDelay) {
  const linkButtons = _getLinkButtons(target);

  if (linkButtons.length >= 25) {
    return _reply(message, deleteReply, deleteDelay, 'Ce message contient déjà le maximum de 25 boutons.', true);
  }

  const promptRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:button:open_modal')
      .setLabel('Configurer le bouton')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('local:button:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
  );

  const panel = await message.channel.send({
    embeds: [embed.build(message.guild.id, 'Cliquez sur le bouton pour configurer le nouveau bouton lien.', { timestamp: false })],
    components: [promptRow],
  }).catch(() => null);

  if (!panel) return;

  embed.registerPrivateInteraction(panel, message.author.id, 300_000);

  let btnInteraction;
  try {
    btnInteraction = await panel.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: i => i.user.id === message.author.id && i.message.id === panel.id,
      idle: 120_000,
      time: 300_000,
    });
  } catch {
    embed.clearPrivateInteraction(panel);
    await panel.edit({ components: [] }).catch(() => {});
    return;
  }

  if (btnInteraction.customId === 'local:button:cancel') {
    embed.clearPrivateInteraction(panel);
    await btnInteraction.deferUpdate().catch(() => {});
    await panel.delete().catch(() => {});
    return;
  }

  const modalId = `local:button:add:${btnInteraction.id}`;
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle('Ajouter un bouton lien')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('label')
          .setLabel('Texte du bouton')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setPlaceholder('Mon site')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('url')
          .setLabel('URL du bouton')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(512)
          .setPlaceholder('https://example.com')
      )
    );

  const shown = await btnInteraction.showModal(modal).then(() => true).catch(() => false);

  if (!shown) {
    embed.clearPrivateInteraction(panel);
    await panel.edit({ components: [] }).catch(() => {});
    return;
  }

  let submit;
  try {
    submit = await btnInteraction.awaitModalSubmit({
      filter: i => i.customId === modalId && i.user.id === message.author.id,
      time: 120_000,
    });
  } catch {
    embed.clearPrivateInteraction(panel);
    await panel.edit({ components: [] }).catch(() => {});
    return;
  }

  embed.clearPrivateInteraction(panel);

  const label  = submit.fields.getTextInputValue('label').trim();
  const rawUrl = submit.fields.getTextInputValue('url').trim();
  const url    = _normalizeUrl(rawUrl);

  if (!label || label.length > 80) {
    await submit.reply({ content: 'Texte du bouton invalide (1-80 caracteres).', flags: 64 }).catch(() => {});
    await panel.delete().catch(() => {});
    return;
  }

  if (!url) {
    await submit.reply({ content: 'URL invalide. Doit commencer par `http://`, `https://` ou `discord.gg/`.', flags: 64 }).catch(() => {});
    await panel.delete().catch(() => {});
    return;
  }


  const current = _getLinkButtons(target);
  if (current.length >= 25) {
    await submit.reply({ content: 'Limite de 25 boutons atteinte.', flags: 64 }).catch(() => {});
    await panel.delete().catch(() => {});
    return;
  }

  const rows = _rebuildLinkRows([...current, { label, url }]);
  const ok = await target.edit({ components: rows }).then(() => true).catch(() => false);

  await submit.deferUpdate().catch(() => {});
  await panel.delete().catch(() => {});

  if (!ok) {
    return _reply(message, deleteReply, deleteDelay, 'Impossible de modifier ce message.', true);
  }

  return _reply(message, deleteReply, deleteDelay, `Bouton \`${label}\` ajoute.`, false);
}


async function _handleDelSelect(client, message, target, deleteReply, deleteDelay) {
  const linkButtons = _getLinkButtons(target);

  if (!linkButtons.length) {
    return _reply(message, deleteReply, deleteDelay, 'Aucun bouton lien sur ce message.', true);
  }

  const options = linkButtons.map((btn, i) => ({
    label: `#${i + 1} - ${btn.label}`.slice(0, 100),
    value: String(i),
    description: btn.url.slice(0, 100),
    emoji: '🔗',
  }));

  options.push({
    label: 'Tout supprimer',
    value: 'all',
    description: `Supprime les ${linkButtons.length} bouton(s)`,
    emoji: '🗑️',
  });

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('local:button:del_select')
      .setPlaceholder('Bouton a supprimer...')
      .addOptions(options)
  );

  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:button:del_cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
  );

  const panel = await message.channel.send({
    embeds: [embed.build(message.guild.id, 'Selectionnez le bouton a supprimer.', { timestamp: false })],
    components: [selectRow, cancelRow],
  }).catch(() => null);

  if (!panel) return;

  embed.registerPrivateInteraction(panel, message.author.id, 300_000);

  let collected;
  try {
    collected = await panel.awaitMessageComponent({
      filter: i => i.user.id === message.author.id && i.message.id === panel.id,
      idle: 120_000,
      time: 300_000,
    });
  } catch {
    embed.clearPrivateInteraction(panel);
    await panel.edit({ components: [] }).catch(() => {});
    return;
  }

  embed.clearPrivateInteraction(panel);
  await collected.deferUpdate().catch(() => {});

  if (collected.customId === 'local:button:del_cancel') {
    await panel.delete().catch(() => {});
    return;
  }

  const val = collected.values?.[0];

  await panel.delete().catch(() => {});

  if (val === 'all') {
    const ok = await target.edit({ components: [] }).then(() => true).catch(() => false);
    if (!ok) {
      return _reply(message, deleteReply, deleteDelay, 'Impossible de modifier ce message.', true);
    }
    return _reply(message, deleteReply, deleteDelay, `${linkButtons.length} bouton(s) supprimé(s).`, false);
  }

  const index = Number(val);

  if (isNaN(index) || index < 0 || index >= linkButtons.length) {
    return _reply(message, deleteReply, deleteDelay, 'Selection invalide.', true);
  }

  const remaining = linkButtons.filter((_, i) => i !== index);
  const rows = remaining.length ? _rebuildLinkRows(remaining) : [];

  const ok = await target.edit({ components: rows }).then(() => true).catch(() => false);

  if (!ok) {
    return _reply(message, deleteReply, deleteDelay, 'Impossible de modifier ce message.', true);
  }

  const removed = linkButtons[index];
  return _reply(message, deleteReply, deleteDelay, `Bouton \`${removed.label}\` supprimé.`, false);
}


async function _handleAddClassic(message, target, remaining, deleteReply, deleteDelay) {
  if (remaining.length < 2) {
    return _reply(message, deleteReply, deleteDelay, '`+button add <messageId|last> <texte> <url>`', true);
  }

  const rawUrl = remaining[remaining.length - 1];
  const label  = remaining.slice(0, -1).join(' ');

  const url = _normalizeUrl(rawUrl);

  if (!url) {
    return _reply(message, deleteReply, deleteDelay, 'URL invalide. Doit commencer par `http://`, `https://` ou `discord.gg/`.', true);
  }

  if (!label || label.length > 80) {
    return _reply(message, deleteReply, deleteDelay, 'Le texte du bouton est obligatoire et ne doit pas depasser 80 caracteres.', true);
  }

  const linkButtons = _getLinkButtons(target);

  if (linkButtons.length >= 25) {
    return _reply(message, deleteReply, deleteDelay, 'Ce message contient déjà le maximum de 25 boutons.', true);
  }

  const rows = _rebuildLinkRows([...linkButtons, { label, url }]);

  const ok = await target.edit({ components: rows }).then(() => true).catch(() => false);

  if (!ok) {
    return _reply(message, deleteReply, deleteDelay, 'Impossible de modifier ce message.', true);
  }

  return _reply(message, deleteReply, deleteDelay, `Bouton \`${label}\` ajoute.`, false);
}


async function _handleDelClassic(message, target, indexArg, deleteReply, deleteDelay) {
  if (!indexArg) {
    return _reply(message, deleteReply, deleteDelay, '`+button del <messageId|last> <index|all>`', true);
  }

  const linkButtons = _getLinkButtons(target);

  if (!linkButtons.length) {
    return _reply(message, deleteReply, deleteDelay, 'Aucun bouton lien sur ce message.', true);
  }

  if (indexArg.toLowerCase() === 'all') {
    const ok = await target.edit({ components: [] }).then(() => true).catch(() => false);

    if (!ok) {
      return _reply(message, deleteReply, deleteDelay, 'Impossible de modifier ce message.', true);
    }

    return _reply(message, deleteReply, deleteDelay, `${linkButtons.length} bouton(s) supprimé(s).`, false);
  }

  const index = Number(indexArg);

  if (!Number.isInteger(index) || index < 1 || index > linkButtons.length) {
    return _reply(
      message, deleteReply, deleteDelay,
      `Index invalide. Utilisez un nombre entre 1 et ${linkButtons.length}, ou \`all\`.`,
      true
    );
  }

  const remaining = linkButtons.filter((_, i) => i !== index - 1);
  const rows = remaining.length ? _rebuildLinkRows(remaining) : [];

  const ok = await target.edit({ components: rows }).then(() => true).catch(() => false);

  if (!ok) {
    return _reply(message, deleteReply, deleteDelay, 'Impossible de modifier ce message.', true);
  }

  const removed = linkButtons[index - 1];
  return _reply(message, deleteReply, deleteDelay, `Bouton \`${removed.label}\` supprimé.`, false);
}


async function _handleList(message, target, deleteReply, deleteDelay) {
  const linkButtons = _getLinkButtons(target);

  if (!linkButtons.length) {
    return _reply(message, deleteReply, deleteDelay, 'Aucun bouton lien sur ce message.', true);
  }

  const lines = linkButtons.map((btn, i) =>
    `\`${i + 1}.\` **${btn.label}** - ${btn.url}`
  );

  return _reply(message, deleteReply, deleteDelay, lines.join('\n'), false);
}


function _parseMessageLink(input, guildId) {
  const match = input.match(MSG_LINK_RE);
  if (!match) return null;

  const [, linkGuildId, channelId, messageId] = match;

  if (linkGuildId !== guildId) return null;

  return { channelId, messageId };
}

async function _resolveFromLink(message, client, parsed) {
  const guild   = message.guild;
  const channel = guild.channels.cache.get(parsed.channelId)
    ?? await guild.channels.fetch(parsed.channelId).catch(() => null);

  if (!channel?.isTextBased()) return null;

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  const botPerms = me ? channel.permissionsFor(me) : null;

  if (
    !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
    !botPerms?.has(PermissionsBitField.Flags.ReadMessageHistory)
  ) {
    return null;
  }

  return channel.messages.fetch(parsed.messageId).catch(() => null);
}

async function _resolveMessage(message, client, targetArg) {
  if (targetArg === 'last') {
    const messages = await message.channel.messages.fetch({ limit: 20 }).catch(() => null);
    if (!messages) return null;
    return messages.find(m => m.author.id === client.user.id && m.id !== message.id) ?? null;
  }

  if (/^\d{17,20}$/.test(targetArg)) {
    return message.channel.messages.fetch(targetArg).catch(() => null);
  }

  return null;
}

function _hasSystemComponents(msg) {
  for (const row of msg.components) {
    for (const comp of row.components) {
      if (comp.type === ComponentType.Button && comp.style !== ButtonStyle.Link) {
        return true;
      }
      if (comp.type === ComponentType.StringSelect || comp.type === ComponentType.RoleSelect ||
          comp.type === ComponentType.UserSelect || comp.type === ComponentType.ChannelSelect ||
          comp.type === ComponentType.MentionableSelect) {
        return true;
      }
    }
  }
  return false;
}

function _getLinkButtons(msg) {
  const buttons = [];
  for (const row of msg.components) {
    for (const comp of row.components) {
      if (comp.type === ComponentType.Button && comp.style === ButtonStyle.Link) {
        buttons.push({ label: comp.label || 'Lien', url: comp.url });
      }
    }
  }
  return buttons;
}

function _rebuildLinkRows(buttons) {
  const rows = [];
  let current = new ActionRowBuilder();

  for (const btn of buttons) {
    if (current.components.length >= 5) {
      rows.push(current);
      current = new ActionRowBuilder();
    }

    current.addComponents(
      new ButtonBuilder()
        .setLabel(String(btn.label).slice(0, 80))
        .setStyle(ButtonStyle.Link)
        .setURL(btn.url)
    );
  }

  if (current.components.length) {
    rows.push(current);
  }

  return rows.slice(0, 5);
}

function _normalizeUrl(value) {
  if (!value) return null;

  let raw = value.trim();


  if (/^discord\.gg\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
  }

  return null;
}

async function _reply(message, deleteReply, deleteDelay, content, isError) {
  const fn = isError ? embed.replyError : embed.reply;
  const sent = await fn(message, content, { timestamp: false }).catch(() => null);
  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}
