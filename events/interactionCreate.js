'use strict';


const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');

const perms         = require('../utils/permissions');
const embed         = require('../utils/embed');
const errorHandler  = require('../utils/errorHandler');
const tickets       = require('../modules/tickets');
const db            = require('../core/database');
const welcomeSender = require('../utils/welcomeSender');

let customCommandsRuntime = null;
try { customCommandsRuntime = require('../modules/customCommands'); } catch {}

let suggestionModule = null;
try { suggestionModule = require('../commands/general/suggestion'); } catch {}


const _rolemenuBusy = new Set();
const DEBUG_ROLEMENU = process.env.DEBUG_ROLEMENU === 'true';

function _debugRolemenu(tag, data) {
  if (!DEBUG_ROLEMENU) return;
  console.log(`[ROLEMENU:${tag}]`, JSON.stringify(data));
}

function _rebuildSelectRow(menu, options, defaultRoleIds) {
  const maxValues = Math.min(
    Math.max(Number(menu.maxValues) || 1, 1),
    Math.max(options.length, 1),
    25
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`rolemenu:select:${menu.id}`)
    .setPlaceholder(menu.placeholder || 'Choisir un rôle')
    .setMinValues(Number(menu.minValues) || 0)
    .setMaxValues(maxValues)
    .addOptions(
      options.map(option => {
        const opt = new StringSelectMenuOptionBuilder()
          .setLabel(String(option.label || 'Rôle').slice(0, 100))
          .setValue(option.roleId);
        if (option.description) opt.setDescription(String(option.description).slice(0, 100));
        if (option.emoji) opt.setEmoji(option.emoji);
        if (defaultRoleIds && defaultRoleIds.has(option.roleId)) opt.setDefault(true);
        return opt;
      })
    );

  return new ActionRowBuilder().addComponents(selectMenu);
}

async function _resetRolemenuSelect(interaction, menu, options, defaultRoleIds) {
  try {
    await interaction.editReply({ components: [_rebuildSelectRow(menu, options, defaultRoleIds)] });
    _debugRolemenu('RESET_OK', { menuId: menu.id, defaults: defaultRoleIds ? [...defaultRoleIds] : [] });
  } catch (err) {
    _debugRolemenu('RESET_FAIL', { menuId: menu.id, error: err?.message });
  }
}


const CAPTCHA_TTL_MS         = 5 * 60 * 1000;
const CAPTCHA_CODE_LENGTH    = 5;
const CAPTCHA_CODE_ALPHABET  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CAPTCHA_NONCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';


const verifyCaptchaSessions = new Map();

function _sweepCaptchaSessions() {
  const now = Date.now();
  for (const [nonce, s] of verifyCaptchaSessions) {
    if (!s || s.expiresAt <= now) verifyCaptchaSessions.delete(nonce);
  }
}

function _randomString(alphabet, length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function _genCaptchaCode() {
  return _randomString(CAPTCHA_CODE_ALPHABET, CAPTCHA_CODE_LENGTH);
}

function _genCaptchaNonce() {
  let nonce;
  do {
    nonce = _randomString(CAPTCHA_NONCE_ALPHABET, 12);
  } while (verifyCaptchaSessions.has(nonce));
  return nonce;
}

module.exports = {
  name : 'interactionCreate',
  once : false,

  async execute(client, interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        return await _handleSlash(client, interaction);
      }

      if (
        interaction.isMessageComponent() &&
        typeof embed.handlePrivateInteraction === 'function'
      ) {
        const blocked = await embed.handlePrivateInteraction(interaction);
        if (blocked) return;
      }

      if (interaction.isButton()) {
        return await _handleButton(client, interaction);
      }

      if (interaction.isStringSelectMenu()) {
        return await _handleSelectMenu(client, interaction);
      }


      if (
        interaction.isUserSelectMenu?.() ||
        interaction.isRoleSelectMenu?.() ||
        interaction.isChannelSelectMenu?.() ||
        interaction.isMentionableSelectMenu?.()
      ) {
        const cid = interaction.customId || '';
        if (cid.startsWith('cccomp:') && customCommandsRuntime?.executeComponentAction) {
          return await customCommandsRuntime.executeComponentAction(client, interaction);
        }
        if (cid.startsWith('cccompinert:')) {
          return interaction.deferUpdate().catch(() => {});
        }

        if (cid.startsWith('kw:settarget:')) {
          return;
        }

        if (cid.startsWith('cf:chansel:')) {
          return;
        }

        return embed.replyExpiredPanel(interaction);
      }

      if (interaction.isModalSubmit()) {
        return await _handleModal(client, interaction);
      }
    } catch (err) {
      errorHandler.handle(err, {
        source : 'interactionCreate',
        guildId: interaction.guild?.id,
        userId : interaction.user?.id,
      });
    }
  },
};


async function _handleSlash(client, interaction) {
  const command = client.slashCommands.get(interaction.commandName);

  if (!command) {
    return interaction.reply({
      embeds : [embed.build(interaction.guild?.id, 'Commande introuvable.', { color: '#ED4245' })],
      flags  : 64,
    }).catch(() => {});
  }

  if (!perms.check({
    member  : interaction.member,
    guild   : interaction.guild,
    channel : interaction.channel,
  }, interaction.commandName)) {
    return interaction.reply({
      embeds : [embed.noPerm(interaction.guild?.id)],
      flags  : 64,
    }).catch(() => {});
  }

  await errorHandler.runInteraction(
    () => command.execute(interaction, client),
    {
      command : interaction.commandName,
      guildId : interaction.guild?.id,
      userId  : interaction.user.id,
    },
    interaction
  );
}


async function _handleButton(client, interaction) {
  const id = interaction.customId;


  if (id.startsWith('rr:')) {
    return;
  }

  if (id.startsWith('sa:')) {
    return;
  }

  if (id.startsWith('bp:')) {
    return;
  }

  if (id.startsWith('embed:')) {
    return embed.replyExpiredPanel(interaction);
  }


  if (id.startsWith('local:')) {
    return embed.replyExpiredPanel(interaction);
  }


  if (id.startsWith('vc:') || id.startsWith('tv:') || id.startsWith('sc:')) {
    return embed.replyExpiredPanel(interaction);
  }


  if (id.startsWith('ccbtn:')) {
    return _handleCustomButton(client, interaction);
  }


  if (id.startsWith('cccomp:')) {
    if (customCommandsRuntime?.executeComponentAction) {
      return customCommandsRuntime.executeComponentAction(client, interaction);
    }
    return interaction.deferUpdate().catch(() => {});
  }


  if (id.startsWith('cccompinert:')) {
    return interaction.deferUpdate().catch(() => {});
  }


  if (id.startsWith('help:')) {
    return embed.replyExpiredPanel(interaction);
  }


  if (id.startsWith('al:') || id.startsWith('inv:') || id.startsWith('cap:') || id.startsWith('local:capture:') || id.startsWith('eload:') || id.startsWith('local:translate:') || id.startsWith('local:joke:')) {
    return;
  }


  if (id.startsWith('rolemembers:')) {
    return embed.replyExpiredPanel(interaction);
  }


  if (
    id.startsWith('warninfo:') ||
    id.startsWith('banlist:') ||
    id.startsWith('mutelist:') ||
    id.startsWith('boosters:') ||
    id.startsWith('alladmins:') ||
    id.startsWith('allbots:') ||
    id.startsWith('botadmins:') ||
    id.startsWith('vocinfo:')
  ) {
    return embed.replyExpiredPanel(interaction);
  }


  if (id.startsWith('pic_') || id.startsWith('banner_')) {
    return embed.replyExpiredPanel(interaction);
  }


  if (id.startsWith('tp_') || id.startsWith('to_') || id.startsWith('tpe:') || id.startsWith('mybot:') ||
      id.startsWith('coinflip:') || id.startsWith('guess:') || id.startsWith('quiz:') ||
      id.startsWith('roulette:') || id.startsWith('bj:')) {
    return;
  }


  if (
    id.startsWith('gw_set_') ||
    id.startsWith('gw_confirm_') ||
    id.startsWith('gw_cancel_') ||
    id === 'gw_toggle_mode' ||
    id === 'gw_launch' ||
    id === 'gw_reset' ||
    id === 'gw_cancel'
  ) {
    return embed.replyExpiredPanel(interaction);
  }

  if (id.startsWith('giveaway_')) {
    let giveawayModule = null;
    try { giveawayModule = require('../modules/giveaways'); } catch {}
    if (giveawayModule?.handleButton) {
      return giveawayModule.handleButton(client, interaction);
    }
  }

  if (id.startsWith('leaderboard_page')) {
    let leaderboard = null;
    try { leaderboard = require('../commands/levels/leaderboard'); } catch {}
    if (leaderboard?.handleButton) {
      return leaderboard.handleButton(interaction);
    }
  }

  if (id.startsWith('ticket_open_')) {
    if (tickets?.handleOpen) {
      return tickets.handleOpen(client, interaction);
    }
  }

  if (id === 'ticket_claim') {
    if (tickets?.handleClaim) {
      return tickets.handleClaim(client, interaction);
    }
  }

  if (id === 'ticket_close') {
    if (tickets?.canCloseTicket && !tickets.canCloseTicket(interaction)) {
      return interaction.reply({
        embeds : [embed.build(interaction.guild?.id, 'Vous ne pouvez pas fermer ce ticket.', { color: '#ED4245', timestamp: false })],
        flags  : 64,
        allowedMentions : { parse: [] },
      }).catch(() => {});
    }

    const modal = new ModalBuilder()
      .setCustomId(`ticket_close_reason_${interaction.channel.id}`)
      .setTitle('Fermer le ticket');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Raison de la fermeture')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(1000)
      .setPlaceholder('Ex: problème résolu, demande traitée, ticket doublon...');

    modal.addComponents(
      new ActionRowBuilder().addComponents(reasonInput)
    );

    return interaction.showModal(modal).catch(() => {});
  }

  if (id.startsWith('rolemenu:button:')) {
    return _handleRolemenuButton(interaction);
  }

  if (id.startsWith('rolebtn_')) {
    return _handleRoleButton(interaction);
  }

  if (id.startsWith('verify:button:')) {
    return _handleVerifyButton(client, interaction);
  }

  if (id.startsWith('verify:captcha:open:')) {
    return _handleCaptchaOpen(interaction);
  }

  if (id.startsWith('formulaire:open:')) {
    return _handleFormulaireOpen(interaction);
  }


  if (id.startsWith('sug:')) {
    if (id === 'sug:cancel_del' || id.startsWith('sug:confirm_del:')) {
      return suggestionModule?.handleDeleteConfirm?.(client, interaction)
        ?? interaction.deferUpdate().catch(() => {});
    }
    return suggestionModule?.handleButton?.(client, interaction)
      ?? interaction.deferUpdate().catch(() => {});
  }

  if (id === 'suggestion_upvote' || id === 'suggestion_downvote') {
    return _handleSuggestionVote(interaction);
  }

  if (id.startsWith('server_invite_')) {
    return _handleServerInviteButton(client, interaction, id);
  }

  if (id.startsWith('server_leave_')) {
    return _handleServerLeaveButton(client, interaction, id);
  }

  if (
    id.startsWith('kw:') ||
    id.startsWith('tm:') ||
    id.startsWith('pn:') ||
    id.startsWith('sr:') ||
    id.startsWith('rl:')
  ) {
    return;
  }

  if (id === 'cf:setblacklist') {
    const guildId = interaction.guild?.id;
    const db = require('../core/database');
    const cfg = db.getConfessionConfig(guildId);
    const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
    const modal = new ModalBuilder()
      .setCustomId(`cf:modal:blacklist:${interaction.message?.id ?? '0'}`)
      .setTitle('Blacklist de mots');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('blacklist')
          .setLabel('Mots interdits séparés par des virgules')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(cfg?.blacklist ?? '')
          .setPlaceholder('Ex: insulte1, insulte2, ...'),
      ),
    );
    return interaction.showModal(modal).catch(() => {});
  }

  if (id.startsWith('cf:')) {
    let confMod = null;
    try { confMod = require('../commands/general/confession'); } catch {}
    if (confMod?.handleButton) return confMod.handleButton(client, interaction);
    return;
  }

  return interaction.deferUpdate().catch(() => {});
}

async function _handleServerInviteButton(client, interaction, id) {
  const guildId = id.replace('server_invite_', '');
  const guild = client.guilds.cache.get(guildId);

  if (!guild) {
    return interaction.reply({
      content: 'Je ne suis plus sur ce serveur.',
      flags: 64,
    }).catch(() => {});
  }

  try {
    const textChannel = guild.channels.cache.find(c => 
      c.isTextBased() && !c.isThread() && c.permissionsFor(guild.members.me).has('CreateInstantInvite')
    );

    if (!textChannel) {
      return interaction.reply({
        content: ' Aucun salon disponible pour créer une invitation.',
        flags: 64,
      }).catch(() => {});
    }

    const invite = await textChannel.createInvite({
      maxAge: 86400, 
      maxUses: 1,
      reason: `Invité par ${interaction.user.tag} via le panel owner`,
    });

    await interaction.reply({
      content: ` **Invitation créée pour ${guild.name}**\n\n${invite.url}`,
      flags: 64,
    }).catch(() => {});

  } catch (err) {
    console.error('[ServerInvite] Erreur:', err);
    await interaction.reply({
      content: ' Erreur lors de la création de l\'invitation.',
      flags: 64,
    }).catch(() => {});
  }
}

async function _handleServerLeaveButton(client, interaction, id) {
  const guildId = id.replace('server_leave_', '');
  const guild = client.guilds.cache.get(guildId);

  if (!guild) {
    return interaction.reply({
      content: 'Je ne suis plus sur ce serveur.',
      flags: 64,
    }).catch(() => {});
  }

  try {
    await guild.leave();
    await interaction.reply({
      content: ` **Quitté le serveur** : ${guild.name}`,
      flags: 64,
    }).catch(() => {});

    await interaction.message.edit({
      components: [],
    }).catch(() => {});

  } catch (err) {
    console.error('[ServerLeave] Erreur:', err);
    await interaction.reply({
      content: ' Erreur lors de la sortie du serveur.',
      flags: 64,
    }).catch(() => {});
  }
}


async function _handleSelectMenu(client, interaction) {
  const id = interaction.customId;


  if (id.startsWith('rr:')) {
    return;
  }

  if (id.startsWith('sa:')) {
    return;
  }

  if (id.startsWith('bp:')) {
    return;
  }


  if (id.startsWith('embed:')) {
    return embed.replyExpiredPanel(interaction);
  }


  if (id.startsWith('local:')) {
    return embed.replyExpiredPanel(interaction);
  }


  if (id.startsWith('ccsel:')) {
    return _handleCustomSelect(client, interaction);
  }


  if (id.startsWith('cccomp:')) {
    if (customCommandsRuntime?.executeComponentAction) {
      return customCommandsRuntime.executeComponentAction(client, interaction);
    }
    return interaction.deferUpdate().catch(() => {});
  }
  if (id.startsWith('cccompinert:')) {
    return interaction.deferUpdate().catch(() => {});
  }


  if (id.startsWith('help:')) {
    return embed.replyExpiredPanel(interaction);
  }


  if (id.startsWith('al:') || id.startsWith('cap:') || id.startsWith('local:capture:') || id.startsWith('eload:') || id.startsWith('local:translate:') || id.startsWith('local:joke:')) {
    return;
  }


  if (id.startsWith('tp_') || id.startsWith('tpe:') || id === 'to_config_menu' || id.startsWith('to_select_') || id.startsWith('ticket_rating:')) {
    return;
  }

  if (id.startsWith('gw_select_')) {
    return embed.replyExpiredPanel(interaction);
  }

  if (id.startsWith('rolemenu:select:')) {
    return _handleRolemenuSelect(interaction);
  }

  if (id === 'roleselect') {
    return _handleRoleSelect(interaction);
  }

  if (id.startsWith('ticket_select_')) {
    if (tickets?.handleSelectOpen) {
      return tickets.handleSelectOpen(client, interaction);
    }
  }

  return interaction.deferUpdate().catch(() => {});
}


async function _handleModal(client, interaction) {
  const id = interaction.customId;


  if (id.startsWith('embed:')) {
    return embed.replyExpiredPanel(interaction);
  }


  if (id.startsWith('local:')) {
    return embed.replyExpiredPanel(interaction);
  }

  if (id.startsWith('ticket_close_reason_')) {
    if (tickets?.handleCloseModal) {
      return tickets.handleCloseModal(client, interaction);
    }
  }


  if (id.startsWith('gw_modal_')) {
    return embed.replyExpiredPanel(interaction);
  }

  if (id.startsWith('formulaire:submit:')) {
    return _handleFormulaireSubmit(interaction);
  }

  if (id.startsWith('verify:captcha:submit:')) {
    return _handleCaptchaSubmit(client, interaction);
  }

  if (id.startsWith('myvc:')) {
    return;
  }

  if (id.startsWith('kw:modal:')) {
    let kwModule = null;
    try { kwModule = require('../commands/general/keyword'); } catch {}
    if (kwModule?.handleModalSubmit) return kwModule.handleModalSubmit(interaction);
    return embed.replyExpiredPanel(interaction);
  }

  if (id.startsWith('cf:modal:')) {
    const parts = id.split(':');
    const action = parts[2];
    if (action === 'submit' || action === 'reply') {
      let confMod = null;
      try { confMod = require('../commands/general/confession'); } catch {}
      if (confMod?.handleModalSubmit) return confMod.handleModalSubmit(client, interaction);
    } else {
      let confConfigMod = null;
      try { confConfigMod = require('../commands/general/confconfig'); } catch {}
      if (confConfigMod?.handleModalSubmit) return confConfigMod.handleModalSubmit(interaction);
    }
    return embed.replyExpiredPanel(interaction);
  }

  return embed.replyExpiredPanel(interaction);
}


async function _handleRolemenuButton(interaction) {
  const guildId = interaction.guild?.id;

  if (!guildId) {
    return interaction.deferUpdate().catch(() => {});
  }

  const parts = interaction.customId.split(':');
  const menuId = Number(parts[2]);
  const roleId = parts[3];

  if (!menuId || !roleId) {
    return _replyRolemenuError(interaction, guildId, 'Menu de rôles invalide.');
  }

  const menu = db.getRoleMenu(menuId);

  if (!menu || menu.guildId !== guildId) {
    return _replyRolemenuError(interaction, guildId, 'Ce menu de rôles n\'existe plus.');
  }

  if (menu.messageId && menu.messageId !== interaction.message.id) {
    return _replyRolemenuError(interaction, guildId, 'Ce bouton n\'est plus lié au bon menu.');
  }

  const componentType = menu.componentType || menu.panelType || 'button';


  const isSelectFallback = componentType === 'select' && (db.getRoleMenuOptions(menuId)?.length ?? 0) < 2;

  if (componentType !== 'button' && !isSelectFallback) {
    return _replyRolemenuError(interaction, guildId, 'Ce menu n\'est pas configuré en boutons.');
  }


  const lockKey = `${guildId}:${interaction.user.id}:${menuId}`;
  if (_rolemenuBusy.has(lockKey)) {
    return interaction.deferUpdate().catch(() => {});
  }
  _rolemenuBusy.add(lockKey);

  try {
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  if (!member) {
    return _replyRolemenuError(interaction, guildId, 'Membre introuvable.');
  }

  if (!perms.isBuyer(interaction.user.id) && !perms.isOwner(guildId,interaction.user.id)) {
    const restrictionError = _checkRolemenuRestrictions(member, menu, interaction.guild);
    if (restrictionError) {
      return _replyRolemenuError(interaction, guildId, restrictionError);
    }
  }

  const option = _getRoleMenuOption(menuId, roleId);

  if (!option) {
    return _replyRolemenuError(interaction, guildId, 'Ce rôle n\'est plus configuré dans le menu.');
  }

  const result = await _applyRoleMenuRole(interaction, roleId, menu.mode || 'toggle', menu, member);

  const fb = _normalizeFeedback(menu.feedbackMode);
  if (fb === 'none') return interaction.deferUpdate().catch(() => {});

  return _replyRolemenuResults(interaction, guildId, [result], fb);
  } finally {
    _rolemenuBusy.delete(lockKey);
  }
}

async function _handleRolemenuSelect(interaction) {
  const guildId = interaction.guild?.id;

  if (!guildId) {
    return interaction.deferUpdate().catch(() => {});
  }

  const parts = interaction.customId.split(':');
  const menuId = Number(parts[2]);

  if (!menuId) {
    return _replyRolemenuError(interaction, guildId, 'Menu de rôles invalide.');
  }

  const menu = db.getRoleMenu(menuId);

  if (!menu || menu.guildId !== guildId) {
    return _replyRolemenuError(interaction, guildId, 'Ce menu de rôles n\'existe plus.');
  }

  if (menu.messageId && menu.messageId !== interaction.message.id) {
    return _replyRolemenuError(interaction, guildId, 'Ce select menu n\'est plus lié au bon menu.');
  }

  const componentType = menu.componentType || menu.panelType || 'select';

  if (componentType !== 'select') {
    return _replyRolemenuError(interaction, guildId, 'Ce menu n\'est pas configuré en select menu.');
  }

  await interaction.deferUpdate().catch(() => {});


  const lockKey = `${guildId}:${interaction.user.id}:${menuId}`;
  if (_rolemenuBusy.has(lockKey)) return;
  _rolemenuBusy.add(lockKey);

  try {
  const selectedIds = [...new Set(interaction.values || [])];
  const mode = String(menu.mode || 'toggle').toLowerCase();

  const options = db.getRoleMenuOptions(menuId);
  const validRoleIds = new Set(options.map(option => option.roleId));


  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  if (!member) {
    await interaction.followUp({
      embeds: [embed.build(guildId, 'Membre introuvable.', { color: '#ED4245', timestamp: false })],
      flags: 64,
    }).catch(() => {});
    return;
  }

  if (!perms.isBuyer(interaction.user.id) && !perms.isOwner(guildId,interaction.user.id)) {
    const restrictionError = _checkRolemenuRestrictions(member, menu, interaction.guild);
    if (restrictionError) {
      await interaction.followUp({
        embeds: [embed.build(guildId, restrictionError, { color: '#ED4245', timestamp: false })],
        flags: 64,
      }).catch(() => {});
      return;
    }
  }

  _debugRolemenu('SELECT', {
    menuId, mode, min: menu.minValues, max: menu.maxValues,
    selectedIds, userId: interaction.user.id,
    rolesBefore: [...member.roles.cache.keys()].filter(id => validRoleIds.has(id)),
  });


  if (mode === 'sync') {
    const selectedSet = new Set(selectedIds.filter(id => validRoleIds.has(id)));
    const results = [];

    for (const option of options) {
      const roleId = option.roleId;
      const hasRole = member.roles.cache.has(roleId);
      const wants   = selectedSet.has(roleId);

      if (wants && !hasRole) {
        results.push(await _applyRoleMenuRole(interaction, roleId, 'add', menu, member));
      } else if (!wants && hasRole) {
        results.push(await _applyRoleMenuRole(interaction, roleId, 'remove', menu, member));
      }
    }


    const freshMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => member);
    const currentRoleIds = new Set(
      options.map(o => o.roleId).filter(id => freshMember.roles.cache.has(id)),
    );

    await _resetRolemenuSelect(interaction, menu, options, currentRoleIds);

    const fb = _normalizeFeedback(menu.feedbackMode);
    if (fb !== 'none' && results.length) {
      await _replyRolemenuResults(interaction, guildId, results, fb, 'followUp');
    }
    return;
  }


  if (!selectedIds.length) {
    if (mode === 'toggle' || mode === 'remove') {
      await _resetRolemenuSelect(interaction, menu, options);
      return;
    }

    const ownedRoleIds = options
      .map(option => option.roleId)
      .filter(roleId => member.roles.cache.has(roleId));

    if (!ownedRoleIds.length) {
      await _resetRolemenuSelect(interaction, menu, options);
      return;
    }

    const results = [];

    for (const roleId of ownedRoleIds) {
      results.push(
        await _applyRoleMenuRole(interaction, roleId, 'remove', null, member)
      );
    }

    await _resetRolemenuSelect(interaction, menu, options);

    const fb = _normalizeFeedback(menu.feedbackMode);
    if (fb !== 'none') {
      await _replyRolemenuResults(interaction, guildId, results, fb, 'followUp');
    }
    return;
  }


  const effectiveMode = (mode === 'toggle' && selectedIds.length > 1)
    ? 'add'
    : mode;

  const results = [];

  for (const roleId of selectedIds) {
    if (!validRoleIds.has(roleId)) {
      results.push({
        status : 'error',
        roleId,
        label  : `<@&${roleId}>`,
        reason : 'Rôle non configuré dans ce menu.',
      });
      continue;
    }

    results.push(
      await _applyRoleMenuRole(interaction, roleId, effectiveMode, menu, member)
    );
  }

  await _resetRolemenuSelect(interaction, menu, options);

  const fb = _normalizeFeedback(menu.feedbackMode);
  if (fb !== 'none') {
    await _replyRolemenuResults(interaction, guildId, results, fb, 'followUp');
  }
  } finally {
    _rolemenuBusy.delete(lockKey);
  }
}

function _getRoleMenuOption(menuId, roleId) {
  if (typeof db.getRoleMenuOption === 'function') {
    return db.getRoleMenuOption(menuId, roleId);
  }

  return db.getRoleMenuOptions(menuId)
    .find(option => option.roleId === roleId) ?? null;
}

async function _applyRoleMenuRole(interaction, roleId, mode = 'toggle', menu = null, memberOverride = null) {
  const guild = interaction.guild;

  const member = memberOverride
    || await guild.members.fetch(interaction.user.id).catch(() => null);

  if (!member) {
    return {
      status : 'error',
      roleId,
      label  : `<@&${roleId}>`,
      reason : 'Membre introuvable.',
    };
  }

  const role = guild.roles.cache.get(roleId)
    ?? await guild.roles.fetch(roleId).catch(() => null);

  if (!role) {
    return {
      status : 'error',
      roleId,
      label  : `<@&${roleId}>`,
      reason : 'Rôle introuvable.',
    };
  }

  const roleError = await _validateRoleForMenu(guild, role);

  if (roleError) {
    return {
      status : 'error',
      roleId,
      label  : `<@&${roleId}>`,
      reason : roleError,
    };
  }

  const hasRole = member.roles.cache.has(roleId);
  const normalizedMode = String(mode || 'toggle').toLowerCase();

  _debugRolemenu('APPLY', { roleId, mode: normalizedMode, hasRole, userId: interaction.user.id });

  const willAdd =
    normalizedMode === 'add' ||
    (normalizedMode === 'toggle' && !hasRole);


  if (willAdd && menu && normalizedMode === 'add') {
    const limit = Math.min(
      Math.max(Number(menu.maxValues) || 0, 0),
      25
    );

    if (limit > 0) {
      const options = db.getRoleMenuOptions(menu.id);
      const menuRoleIds = options.map(option => option.roleId);
      const ownedRoleIds = menuRoleIds.filter(id => member.roles.cache.has(id));

      if (limit === 1) {
        const rolesToRemove = ownedRoleIds.filter(id => id !== roleId);

        for (const oldRoleId of rolesToRemove) {
          const oldRole = guild.roles.cache.get(oldRoleId)
            ?? await guild.roles.fetch(oldRoleId).catch(() => null);

          if (!oldRole) continue;

          const oldRoleError = await _validateRoleForMenu(guild, oldRole);
          if (oldRoleError) continue;

          await member.roles.remove(oldRole, 'Rolemenu maxValues replacement').catch(err => {
            _debugRolemenu('REPLACE_FAIL', { oldRoleId, error: err?.message });
          });
        }
      } else if (!hasRole && ownedRoleIds.length >= limit) {
        return {
          status : 'unchanged',
          roleId,
          label  : `<@&${roleId}>`,
          reason : `Vous avez déjà atteint la limite de ${limit} rôle(s) sur ce menu.`,
        };
      }
    }
  }

  if (normalizedMode === 'add') {
    if (hasRole) {
      return {
        status : 'unchanged',
        roleId,
        label  : `<@&${roleId}>`,
        reason : 'Vous avez déjà ce rôle.',
      };
    }

    const addRes = await member.roles.add(role, 'Rolemenu')
      .then(() => ({ ok: true }))
      .catch(err => ({ ok: false, msg: err?.message }));

    if (!addRes.ok) _debugRolemenu('ADD_FAIL', { roleId, error: addRes.msg });

    return addRes.ok
      ? { status: 'added', roleId, label: `<@&${roleId}>` }
      : { status: 'error', roleId, label: `<@&${roleId}>`, reason: addRes.msg || 'Impossible d\'ajouter le rôle.' };
  }

  if (normalizedMode === 'remove') {
    if (!hasRole) {
      return {
        status : 'unchanged',
        roleId,
        label  : `<@&${roleId}>`,
        reason : 'Vous n\'avez pas ce rôle.',
      };
    }

    const rmRes = await member.roles.remove(role, 'Rolemenu')
      .then(() => ({ ok: true }))
      .catch(err => ({ ok: false, msg: err?.message }));

    if (!rmRes.ok) _debugRolemenu('REMOVE_FAIL', { roleId, error: rmRes.msg });

    return rmRes.ok
      ? { status: 'removed', roleId, label: `<@&${roleId}>` }
      : { status: 'error', roleId, label: `<@&${roleId}>`, reason: rmRes.msg || 'Impossible de retirer le rôle.' };
  }

  if (hasRole) {
    const trmRes = await member.roles.remove(role, 'Rolemenu toggle')
      .then(() => ({ ok: true }))
      .catch(err => ({ ok: false, msg: err?.message }));

    if (!trmRes.ok) _debugRolemenu('TOGGLE_REMOVE_FAIL', { roleId, error: trmRes.msg });

    return trmRes.ok
      ? { status: 'removed', roleId, label: `<@&${roleId}>` }
      : { status: 'error', roleId, label: `<@&${roleId}>`, reason: trmRes.msg || 'Impossible de retirer le rôle.' };
  }

  const taddRes = await member.roles.add(role, 'Rolemenu toggle')
    .then(() => ({ ok: true }))
    .catch(err => ({ ok: false, msg: err?.message }));

  if (!taddRes.ok) _debugRolemenu('TOGGLE_ADD_FAIL', { roleId, error: taddRes.msg });

  return taddRes.ok
    ? { status: 'added', roleId, label: `<@&${roleId}>` }
    : { status: 'error', roleId, label: `<@&${roleId}>`, reason: taddRes.msg || 'Impossible d\'ajouter le rôle.' };
}

async function _validateRoleForMenu(guild, role) {
  if (!role || role.id === guild.id) {
    return 'Rôle invalide.';
  }

  if (role.managed) {
    return 'Ce rôle est géré par une intégration.';
  }

  const me = guild.members.me
    ?? await guild.members.fetchMe().catch(() => null);

  if (!me) {
    return 'Impossible de vérifier mes permissions.';
  }

  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return 'Je n\'ai pas la permission de gérer les rôles.';
  }

  if (role.position >= me.roles.highest.position) {
    return 'Ce rôle est au-dessus ou au même niveau que mon rôle le plus haut.';
  }

  return null;
}

function _normalizeFeedback(mode) {
  if (mode === 'message' || mode === 'none') return mode;
  return 'embed';
}

async function _replyRolemenuResults(interaction, guildId, results, format = 'embed', method = 'reply') {
  const added   = results.filter(r => r.status === 'added');
  const removed = results.filter(r => r.status === 'removed');
  const errors  = results.filter(r => r.status === 'error');

  const lines = [];

  if (added.length && !removed.length && !errors.length) {
    const roles = added.map(r => r.label).join(', ');
    lines.push(added.length === 1
      ? `Vous venez de recevoir le role ${roles} !`
      : `Vous venez de recevoir les roles ${roles} !`);
  } else if (removed.length && !added.length && !errors.length) {
    const roles = removed.map(r => r.label).join(', ');
    lines.push(removed.length === 1
      ? `Vous venez de retirer le role ${roles} !`
      : `Vous venez de retirer les roles ${roles} !`);
  } else if (added.length || removed.length) {
    lines.push('Vos roles ont ete mis a jour.');
    if (added.length)   lines.push(`Recus : ${added.map(r => r.label).join(', ')}`);
    if (removed.length) lines.push(`Retires : ${removed.map(r => r.label).join(', ')}`);
  }

  if (errors.length) {
    for (const e of errors) {
      lines.push(`Erreur : ${e.label} - ${e.reason || 'Action impossible.'}`);
    }
  }

  if (!lines.length) {
    lines.push('Aucun changement effectue.');
  }

  const options = { timestamp: false };
  if (errors.length) options.color = '#ED4245';

  const text = lines.join('\n').slice(0, 3900);

  const payload = format === 'message'
    ? { content: text, flags: 64, allowedMentions: { parse: [] } }
    : { embeds: [embed.build(guildId, text, options)], flags: 64, allowedMentions: { parse: [] } };

  if (method === 'followUp') {
    return interaction.followUp(payload).catch(() => {});
  }
  return interaction.reply(payload).catch(() => interaction.deferUpdate().catch(() => {}));
}

function _checkRolemenuRestrictions(member, menu, guild) {
  if (!member?.roles?.cache) return null;

  const forbidden = _parseJsonArray(menu.forbiddenRoleIds);
  if (forbidden.length) {
    const validForbidden = guild
      ? forbidden.filter(id => guild.roles.cache.has(id))
      : forbidden;
    if (validForbidden.length && validForbidden.some(id => member.roles.cache.has(id))) {
      return 'Vous ne pouvez pas utiliser ce rolemenu.';
    }
  }

  const required = _parseJsonArray(menu.requiredRoleIds);
  if (required.length) {
    const validRequired = guild
      ? required.filter(id => guild.roles.cache.has(id))
      : required;
    if (!validRequired.length) {
      return 'Ce rolemenu est mal configure : le role requis n\'existe plus.';
    }
    if (!validRequired.some(id => member.roles.cache.has(id))) {
      return 'Vous n\'avez pas le role requis pour utiliser ce rolemenu.';
    }
  }

  return null;
}

function _parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function _replyRolemenuError(interaction, guildId, content) {
  return interaction.reply({
    embeds : [
      embed.build(guildId, content, {
        color    : '#ED4245',
        timestamp: false,
      }),
    ],
    flags: 64,
  }).catch(() => interaction.deferUpdate().catch(() => {}));
}

async function _handleSuggestionVote(interaction) {
  const guildId = interaction.guild?.id;
  const userId  = interaction.user.id;

  if (!guildId) {
    return interaction.deferUpdate().catch(() => {});
  }

  try {
    const suggestion = db.getSuggestionByMessageId(interaction.message.id);

    if (!suggestion || suggestion.guildId !== guildId) {
      return interaction.reply({
        embeds : [embed.build(guildId, 'Cette suggestion n\'existe plus.', { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
    }

    const wantedVote = interaction.customId === 'suggestion_upvote' ? 1 : -1;
    const currentVote = db.getUserSuggestionVote(suggestion.id, userId);

    const finalVote = currentVote === wantedVote ? 0 : wantedVote;
    const totals = db.voteSuggestion(suggestion.id, userId, finalVote);

    const up   = Number(totals?.up || 0);
    const down = Number(totals?.down || 0);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('suggestion_upvote')
        .setLabel(String(up))
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('suggestion_downvote')
        .setLabel(String(down))
        .setStyle(ButtonStyle.Danger)
    );

    const oldEmbed = interaction.message.embeds?.[0];
    const data = oldEmbed?.toJSON?.() || null;

    if (data && Array.isArray(data.fields)) {
      const voteField = data.fields.find(f => f.name === 'Votes');

      if (voteField) {
        voteField.value = `\`${up}\` pour - \`${down}\` contre`;
      }
    }

    await interaction.message.edit({
      embeds     : oldEmbed && data ? [data] : interaction.message.embeds,
      components : [row],
    }).catch(() => {});

    return interaction.deferUpdate().catch(() => {});
  } catch (err) {
    errorHandler.handle(err, {
      source : 'suggestion.vote',
      guildId,
      userId,
    });

    return interaction.reply({
      embeds : [embed.build(guildId, 'Impossible d\'enregistrer votre vote.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }
}

async function _handleRoleButton(interaction) {
  try {
    const roleId = interaction.customId.split('_')[1];
    const role   = interaction.guild.roles.cache.get(roleId);

    if (!role) return interaction.deferUpdate().catch(() => {});

    const member  = interaction.member;
    const hasRole = member.roles.cache.has(roleId);

    await member.roles[hasRole ? 'remove' : 'add'](role).catch(() => {});
    return interaction.deferUpdate().catch(() => {});
  } catch {
    return interaction.deferUpdate().catch(() => {});
  }
}

async function _handleRoleSelect(interaction) {
  try {
    const member      = interaction.member;
    const selectedIds = interaction.values;
    const allIds      = interaction.component.options.map(o => o.value);

    await Promise.all(allIds.map(roleId => {
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) return null;

      const hasRole    = member.roles.cache.has(roleId);
      const shouldHave = selectedIds.includes(roleId);

      if (!hasRole && shouldHave) return member.roles.add(role).catch(() => {});
      if (hasRole && !shouldHave) return member.roles.remove(role).catch(() => {});
      return null;
    }));

    return interaction.deferUpdate().catch(() => {});
  } catch {
    return interaction.deferUpdate().catch(() => {});
  }
}

async function _handleVerifyButton(client, interaction) {
  try {
    const guild = interaction.guild;

    if (!guild) {
      return interaction.deferUpdate().catch(() => {});
    }

    const parts = interaction.customId.split(':');
    const customGuildId = parts[2];

    if (!customGuildId || customGuildId !== guild.id) {
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Bouton de vérification invalide.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    const config = db.getGuildConfig(guild.id);

    if (Number(config?.verifyEnabled) !== 1 || !config?.verifyRoleId) {
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Vérification désactivée.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    const member = interaction.member?.roles
      ? interaction.member
      : await guild.members.fetch(interaction.user.id).catch(() => null);

    if (!member) {
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Membre introuvable.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    if (member.user?.bot) {
      return interaction.deferUpdate().catch(() => {});
    }

    const role = guild.roles.cache.get(config.verifyRoleId)
      ?? await guild.roles.fetch(config.verifyRoleId).catch(() => null);

    if (!role) {
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Rôle de vérification introuvable, contactez un administrateur.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    if (member.roles.cache.has(role.id)) {
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Vous êtes déjà vérifié.', { color: '#FAA61A' })],
        flags  : 64,
      }).catch(() => {});
    }

    const me = guild.members.me
      ?? await guild.members.fetchMe().catch(() => null);

    if (!me) {
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Impossible de vérifier mes permissions.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Je n\'ai pas la permission de gérer les rôles.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    if (role.position >= me.roles.highest.position) {
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Je ne peux pas attribuer ce rôle à cause de la hiérarchie.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    if (String(config.verifyType || 'button').toLowerCase() === 'captcha') {
      return _startCaptchaSession(interaction, guild.id, member.id);
    }

    const added = await member.roles.add(role.id, 'Vérification bouton').then(() => true).catch(() => false);

    if (!added) {
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Impossible de vous vérifier pour le moment.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    await interaction.reply({
      embeds : [embed.build(guild.id, 'Vérification réussie.', { color: '#43B581' })],
      flags  : 64,
    }).catch(() => {});

    try {
      const verifyTimeouts = require('../utils/verifyTimeouts');
      verifyTimeouts.cancel(guild.id, member.id);
    } catch {
    }

    if (Number(config?.welcomeAfterVerify) === 1) {
      await welcomeSender.sendWelcome(member, config).catch(() => null);
    }

    try {
      const verifyLogger = require('../utils/verifyLogger');
      await verifyLogger.sendVerifyLog(client, guild.id, {
        title  : 'Membre vérifié',
        level  : 'success',
        fields : [
          {
            name   : 'Membre',
            value  : `<@${member.id}> (${member.user.tag}) \`${member.id}\``,
            inline : true,
          },
          {
            name   : 'Rôle',
            value  : `<@&${role.id}>`,
            inline : true,
          },
          {
            name   : 'Mode',
            value  : 'Bouton',
            inline : true,
          },
        ],
        thumbnail : member.user.displayAvatarURL({ dynamic: true }),
      });
    } catch {
    }

    return;
  } catch {
    return interaction.deferUpdate().catch(() => {});
  }
}

async function _handleFormulaireOpen(interaction) {
  const guildId = interaction.guild.id;
  const panelId = Number.parseInt(interaction.customId.split(':')[2], 10);

  if (!panelId) {
    return interaction.reply({
      embeds : [embed.build(guildId, 'Formulaire invalide.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const panel = db.raw()
    .prepare('SELECT * FROM ticket_panels WHERE id = ? AND guildId = ?')
    .get(panelId, guildId);

  if (!panel) {
    return interaction.reply({
      embeds : [embed.build(guildId, 'Ce formulaire n\'existe plus.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const modal = new ModalBuilder()
    .setCustomId(`formulaire:submit:${panelId}`)
    .setTitle('Répondre au formulaire');

  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Nom / pseudo')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const subjectInput = new TextInputBuilder()
    .setCustomId('subject')
    .setLabel('Sujet')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const contentInput = new TextInputBuilder()
    .setCustomId('content')
    .setLabel('Votre réponse')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(subjectInput),
    new ActionRowBuilder().addComponents(contentInput)
  );

  return interaction.showModal(modal).catch(() => {});
}

async function _handleFormulaireSubmit(interaction) {
  const guild   = interaction.guild;
  const guildId = guild.id;
  const panelId = Number.parseInt(interaction.customId.split(':')[2], 10);

  const panel = db.raw()
    .prepare('SELECT * FROM ticket_panels WHERE id = ? AND guildId = ?')
    .get(panelId, guildId);

  if (!panel) {
    return interaction.reply({
      embeds : [embed.build(guildId, 'Ce formulaire n\'existe plus.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const config       = db.getGuildConfig(guildId);
  const logChannelId = config?.ticketLogChannel;

  if (!logChannelId) {
    return interaction.reply({
      embeds : [embed.build(guildId, 'Aucun salon de log ticket n\'est configuré.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const logChannel = guild.channels.cache.get(logChannelId);
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

  if (
    !logChannel ||
    !me ||
    !logChannel.permissionsFor(me)?.has(PermissionsBitField.Flags.SendMessages)
  ) {
    return interaction.reply({
      embeds : [embed.build(guildId, 'Le salon de log ticket est introuvable ou inaccessible.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const name    = interaction.fields.getTextInputValue('name').trim();
  const subject = interaction.fields.getTextInputValue('subject').trim();
  const content = interaction.fields.getTextInputValue('content').trim();

  const formEmbed = embed.build(
    guildId,
    content,
    {
      title  : 'Nouvelle réponse formulaire',
      fields : [
        { name: 'Membre',       value: `<@${interaction.user.id}> (${interaction.user.tag}) \`${interaction.user.id}\``, inline: false },
        { name: 'Panel',        value: `#${panelId}`,                                         inline: true  },
        { name: 'Nom / pseudo', value: name    || 'Non renseigné',                            inline: true  },
        { name: 'Sujet',        value: subject || 'Non renseigné',                            inline: false },
      ],
      timestamp : new Date(),
    }
  );

  const sentLog = await logChannel.send({
    embeds          : [formEmbed],
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!sentLog) {
    return interaction.reply({
      embeds : [embed.build(guildId, 'Impossible d\'envoyer la réponse du formulaire.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  return interaction.reply({
    embeds : [embed.build(guildId, 'Votre réponse a bien été envoyée.', { timestamp: false })],
    flags  : 64,
  }).catch(() => {});
}


async function _startCaptchaSession(interaction, guildId, userId) {
  try {
    _sweepCaptchaSessions();

    const code  = _genCaptchaCode();
    const nonce = _genCaptchaNonce();

    verifyCaptchaSessions.set(nonce, {
      guildId,
      userId,
      code,
      expiresAt : Date.now() + CAPTCHA_TTL_MS,
    });

    const openButton = new ButtonBuilder()
      .setCustomId(`verify:captcha:open:${guildId}:${nonce}`)
      .setLabel('Entrer le code')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(openButton);

    const desc =
      'Entrez le code de vérification pour recevoir le rôle.\n\n' +
      `Code : \`\`\`${code}\`\`\`\n` +
      'La saisie est insensible à la casse. Le code expire dans 5 minutes.';

    return interaction.reply({
      embeds          : [embed.build(guildId, desc, { title: 'Vérification captcha', color: '#5865F2', timestamp: false })],
      components      : [row],
      flags           : 64,
      allowedMentions : { parse: [] },
    }).catch(() => {});
  } catch (err) {
    errorHandler.handle(err, {
      source : '_startCaptchaSession',
      guildId,
      userId,
    });

    return interaction.reply({
      embeds : [embed.build(guildId, 'Impossible de démarrer le captcha. Réessayez.', { color: '#ED4245' })],
      flags  : 64,
    }).catch(() => {});
  }
}

async function _handleCaptchaOpen(interaction) {
  try {
    _sweepCaptchaSessions();

    const guild = interaction.guild;
    if (!guild) return interaction.deferUpdate().catch(() => {});

    const parts = interaction.customId.split(':');

    const customGuildId = parts[3];
    const nonce         = parts[4];

    if (!customGuildId || customGuildId !== guild.id || !nonce) {
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Captcha invalide. Recliquez sur Vérifier.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    const session = verifyCaptchaSessions.get(nonce);

    if (
      !session ||
      session.guildId !== guild.id ||
      session.userId !== interaction.user.id ||
      session.expiresAt <= Date.now()
    ) {
      if (session && session.expiresAt <= Date.now()) {
        verifyCaptchaSessions.delete(nonce);
      }
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Captcha expiré. Recliquez sur Vérifier.', { color: '#FAA61A' })],
        flags  : 64,
      }).catch(() => {});
    }

    const modal = new ModalBuilder()
      .setCustomId(`verify:captcha:submit:${guild.id}:${nonce}`)
      .setTitle('Vérification captcha')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('code')
            .setLabel('Code de vérification')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(10)
        )
      );

    return interaction.showModal(modal).catch(() => {});
  } catch (err) {
    errorHandler.handle(err, {
      source  : '_handleCaptchaOpen',
      guildId : interaction.guild?.id,
      userId  : interaction.user?.id,
    });
    return interaction.deferUpdate().catch(() => {});
  }
}

async function _handleCaptchaSubmit(client, interaction) {
  try {
    _sweepCaptchaSessions();

    const guild = interaction.guild;
    if (!guild) return interaction.deferUpdate().catch(() => {});

    const parts = interaction.customId.split(':');

    const customGuildId = parts[3];
    const nonce         = parts[4];

    if (!customGuildId || customGuildId !== guild.id || !nonce) {
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Captcha invalide. Recliquez sur Vérifier.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    const session = verifyCaptchaSessions.get(nonce);

    if (
      !session ||
      session.guildId !== guild.id ||
      session.userId !== interaction.user.id ||
      session.expiresAt <= Date.now()
    ) {
      if (session && session.expiresAt <= Date.now()) {
        verifyCaptchaSessions.delete(nonce);
      }
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Captcha expiré. Recliquez sur Vérifier.', { color: '#FAA61A' })],
        flags  : 64,
      }).catch(() => {});
    }

    const submitted = String(interaction.fields.getTextInputValue('code') || '').trim().toUpperCase();
    const expected  = String(session.code || '').toUpperCase();

    if (submitted !== expected) {
      try {
        const verifyLogger = require('../utils/verifyLogger');
        await verifyLogger.sendVerifyLog(client, guild.id, {
          title  : 'Captcha incorrect',
          level  : 'warn',
          fields : [
            { name: 'Membre', value: `<@${interaction.user.id}> (${interaction.user.tag}) \`${interaction.user.id}\``, inline: true },
            { name: 'Saisi',  value: `\`${submitted.slice(0, 10) || ' '}\``,             inline: true },
          ],
        });
      } catch {
      }

      return interaction.reply({
        embeds : [embed.build(guild.id, 'Code incorrect.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }


    const config = db.getGuildConfig(guild.id);

    if (Number(config?.verifyEnabled) !== 1 || !config?.verifyRoleId) {
      verifyCaptchaSessions.delete(nonce);
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Vérification désactivée.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    const member = interaction.member?.roles
      ? interaction.member
      : await guild.members.fetch(interaction.user.id).catch(() => null);

    if (!member) {
      verifyCaptchaSessions.delete(nonce);
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Membre introuvable.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    const role = guild.roles.cache.get(config.verifyRoleId)
      ?? await guild.roles.fetch(config.verifyRoleId).catch(() => null);

    if (!role) {
      verifyCaptchaSessions.delete(nonce);
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Rôle de vérification introuvable, contactez un administrateur.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    if (member.roles.cache.has(role.id)) {
      verifyCaptchaSessions.delete(nonce);
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Vous êtes déjà vérifié.', { color: '#FAA61A' })],
        flags  : 64,
      }).catch(() => {});
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Je n\'ai pas la permission de gérer les rôles.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    if (role.position >= me.roles.highest.position) {
      return interaction.reply({
        embeds : [embed.build(guild.id, 'Je ne peux pas attribuer ce rôle à cause de la hiérarchie.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    const added = await member.roles.add(role.id, 'Vérification captcha').then(() => true).catch(() => false);

    if (!added) {
      try {
        const verifyLogger = require('../utils/verifyLogger');
        await verifyLogger.sendVerifyLog(client, guild.id, {
          title  : 'Captcha role add échoué',
          level  : 'error',
          fields : [
            { name: 'Membre', value: `<@${member.id}> (${member.user.tag}) \`${member.id}\``, inline: true },
            { name: 'Role',   value: `<@&${role.id}>`,                                       inline: true },
          ],
        });
      } catch {
      }

      return interaction.reply({
        embeds : [embed.build(guild.id, 'Impossible de vous vérifier pour le moment.', { color: '#ED4245' })],
        flags  : 64,
      }).catch(() => {});
    }

    verifyCaptchaSessions.delete(nonce);

    try {
      const verifyTimeouts = require('../utils/verifyTimeouts');
      verifyTimeouts.cancel(guild.id, member.id);
    } catch {
    }

    await interaction.reply({
      embeds : [embed.build(guild.id, 'Vérification réussie.', { color: '#43B581' })],
      flags  : 64,
    }).catch(() => {});

    if (Number(config?.welcomeAfterVerify) === 1) {
      await welcomeSender.sendWelcome(member, config).catch(() => null);
    }

    try {
      const verifyLogger = require('../utils/verifyLogger');
      await verifyLogger.sendVerifyLog(client, guild.id, {
        title  : 'Membre vérifié',
        level  : 'success',
        fields : [
          { name: 'Membre', value: `<@${member.id}> (${member.user.tag}) \`${member.id}\``, inline: true },
          { name: 'Rôle',   value: `<@&${role.id}>`,                                       inline: true },
          { name: 'Mode',   value: 'Captcha',                                                inline: true },
        ],
        thumbnail : member.user.displayAvatarURL?.({ dynamic: true }) || null,
      });
    } catch {
    }
  } catch (err) {
    errorHandler.handle(err, {
      source  : '_handleCaptchaSubmit',
      guildId : interaction.guild?.id,
      userId  : interaction.user?.id,
    });
    return interaction.deferUpdate().catch(() => {});
  }
}


async function _handleCustomButton(client, interaction) {
  if (!customCommandsRuntime?.executeFromInteraction) {
    return interaction.deferUpdate().catch(() => {});
  }


  const parts = interaction.customId.split(':');
  const cbGuildId = parts[1];
  const keyword   = parts[2];
  const idx       = Number.parseInt(parts[3], 10);

  if (!cbGuildId || !keyword || !Number.isFinite(idx)) {
    return _replyCustomError(interaction, 'Bouton invalide.');
  }

  if (interaction.guild?.id !== cbGuildId) {
    return _replyCustomError(interaction, 'Bouton invalide pour ce serveur.');
  }

  const source = db.getCustomCommand(cbGuildId, keyword);

  if (!source) {
    return _replyCustomError(interaction, 'Source introuvable.');
  }

  let buttons = [];
  try { buttons = JSON.parse(source.buttonsJson || '[]'); } catch {}

  const btn = buttons[idx];

  if (!btn || btn.type !== 'custom' || !btn.target || !btn.mode) {
    return _replyCustomError(interaction, 'Action introuvable.');
  }

  return customCommandsRuntime.executeFromInteraction(
    client,
    interaction,
    String(btn.target).toLowerCase(),
    String(btn.mode).toLowerCase()
  );
}

async function _handleCustomSelect(client, interaction) {
  if (!customCommandsRuntime?.executeFromInteraction) {
    return interaction.deferUpdate().catch(() => {});
  }

  const parts = interaction.customId.split(':');
  const cbGuildId = parts[1];
  const keyword   = parts[2];
  const selIdx    = Number.parseInt(parts[3], 10);

  if (!cbGuildId || !keyword || !Number.isFinite(selIdx)) {
    return _replyCustomError(interaction, 'Sélecteur invalide.');
  }

  if (interaction.guild?.id !== cbGuildId) {
    return _replyCustomError(interaction, 'Sélecteur invalide pour ce serveur.');
  }

  const source = db.getCustomCommand(cbGuildId, keyword);

  if (!source) {
    return _replyCustomError(interaction, 'Source introuvable.');
  }

  let selects = [];
  try { selects = JSON.parse(source.selectsJson || '[]'); } catch {}

  const select = selects[selIdx];

  if (!select || !Array.isArray(select.options)) {
    return _replyCustomError(interaction, 'Sélecteur introuvable.');
  }

  const optIdx = Number.parseInt(interaction.values?.[0], 10);
  const opt    = select.options[optIdx];

  if (!opt || !opt.target || !opt.mode) {
    return _replyCustomError(interaction, 'Option introuvable.');
  }

  return customCommandsRuntime.executeFromInteraction(
    client,
    interaction,
    String(opt.target).toLowerCase(),
    String(opt.mode).toLowerCase()
  );
}

async function _replyCustomError(interaction, content) {
  return interaction.reply({
    embeds : [embed.build(interaction.guild?.id, content, { color: '#ED4245', timestamp: false })],
    flags  : 64,
  }).catch(() => {});
}
