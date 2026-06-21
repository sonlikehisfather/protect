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
  MessageFlags,
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
const _casinoConfigPanels = new Map(); // guildId:userId -> panel message
const _casinoConfigViews = new Map();
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

        if (cid.startsWith('csconf_')) {
          return _handleCasinoConfigSelect(interaction, cid);
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

  if (id.startsWith('plinko:')) {
    return;
  }

  if (id.startsWith('tower:')) {
    return;
  }

  if (id.startsWith('chicken:')) {
    return;
  }

  if (id.startsWith('dice:')) {
    return;
  }

  if (id.startsWith('cs_inv_')) {
    console.log(`[BUTTON] Casino inventory action: ${id}, user=${interaction.user.id}`);
    let casino = null;
    try { casino = require('../commands/casino/casino'); } catch (e) { console.error('[INV] Failed to load casino module:', e); }
    if (casino?.handleInventoryAction) return casino.handleInventoryAction(interaction, id);
    return interaction.reply({ content: 'Action inventaire indisponible.', flags: 64 }).catch(() => {});
  }

  if (id.startsWith('csconf_')) {
    console.log(`[CASINO] Handling config button: ${id} from user ${interaction.user.id}`);
    return _handleCasinoConfigButton(client, interaction, id);
  }

  if (id.startsWith('cs_panel_')) {
    let casino = null;
    try { casino = require('../commands/casino/casino'); } catch {}
    if (casino?.handleInteraction) {
      return casino.handleInteraction(interaction, id);
    }
    return interaction.deferUpdate().catch(() => {});
  }

  if (id.startsWith('cs_ach_')) {
    let casino = null;
    try { casino = require('../commands/casino/casino'); } catch {}
    if (casino?.handleAchievementInteraction) {
      return casino.handleAchievementInteraction(interaction, id);
    }
    return interaction.deferUpdate().catch(() => {});
  }

  // Handle panel navigation and draws globally (no collector dependency)
  if (id === 'cs_page_nav') {
    let casino = null;
    try { casino = require('../commands/casino/casino'); } catch {}
    if (casino?.handlePanelNav) return casino.handlePanelNav(interaction);
    return interaction.deferUpdate().catch(() => {});
  }

  if (id.startsWith('cs_do_tirage')) {
    let casino = null;
    try { casino = require('../commands/casino/casino'); } catch {}
    if (casino?.handlePanelDraw) return casino.handlePanelDraw(interaction, id);
    return interaction.deferUpdate().catch(() => {});
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


  if (id.startsWith('al:') || id.startsWith('inv:') || id.startsWith('cap:') || id.startsWith('local:capture:') || id.startsWith('eload:') || id.startsWith('mye:') || id.startsWith('local:translate:') || id.startsWith('local:joke:') || id.startsWith('local:blcasino:')) {
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
      id.startsWith('roulette:') || id.startsWith('bj:') || id.startsWith('gift:') ||
      id.startsWith('russian:') || id.startsWith('mine:')) {
    return;
  }

  // Casino handlers
  if (id.startsWith('gcoins_')) {
    let gcoins = null;
    try { gcoins = require('../commands/casino/gcoins'); } catch {}
    if (gcoins?.handleInteraction) {
      return gcoins.handleInteraction(interaction, id);
    }
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
  console.log(`[SELECT-MENU] Received: ${id}, type=${interaction.componentType}, user=${interaction.user.id}`);

  if (id.startsWith('rr:')) {
    return;
  }

  if (id.startsWith('sa:')) {
    return;
  }

  if (id.startsWith('bp:')) {
    return;
  }

  if (id === 'cs_shop_select') {
    let casino = null;
    try { casino = require('../commands/casino/casino'); } catch {}
    if (casino?.handleShopSelect) return casino.handleShopSelect(interaction);
    return interaction.deferUpdate().catch(() => {});
  }

  if (id === 'cs_shop_category') {
    let casino = null;
    try { casino = require('../commands/casino/casino'); } catch {}
    if (casino?.handleShopCategory) return casino.handleShopCategory(interaction);
    return interaction.deferUpdate().catch(() => {});
  }

  if (id === 'cs_inv_category') {
    let casino = null;
    try { casino = require('../commands/casino/casino'); } catch {}
    if (casino?.handleInventoryCategory) return casino.handleInventoryCategory(interaction);
    return interaction.deferUpdate().catch(() => {});
  }

  if (id.startsWith('cs_inv_select:')) {
    let casino = null;
    try { casino = require('../commands/casino/casino'); } catch {}
    if (casino?.handleInventorySelect) return casino.handleInventorySelect(interaction);
    return interaction.deferUpdate().catch(() => {});
  }

  if (id.startsWith('cs_inv_use_xp:')) {
    console.log(`[BUTTON] cs_inv_use_xp triggered: id=${id}`);
    try {
      const itemId = parseInt(id.split(':')[1], 10);
      const guildId = interaction.guild?.id;
      const userId = interaction.user.id;
      console.log(`[INV] Use XP: itemId=${itemId}, guildId=${guildId}, userId=${userId}`);
      
      const inv = db.getInventory(guildId, userId);
      const item = inv.find(i => i.itemId === itemId);
      if (!item) {
        console.log(`[INV] Item not found: ${itemId}`);
        return interaction.reply({ content: 'Item non trouvé.', flags: 64 }).catch(() => {});
      }
      
      const xpAmount = parseInt(item.value || 0, 10) || 100;
      console.log(`[INV] Adding XP: ${xpAmount}`);
      db.addUserXP(guildId, userId, xpAmount);
      db.removeInventoryItem(guildId, userId, itemId, 1);
      
      const user = db.getCasinoUser(guildId, userId);
      console.log(`[INV] XP used successfully. New XP: ${user.xp}`);
      return interaction.reply({ content: `✓ **+${xpAmount}** XP utilisé ! (Total: ${user.xp} XP)`, flags: 64 }).catch(() => {});
    } catch (e) {
      console.error(`[INV] Error using XP:`, e);
      return interaction.reply({ content: `Erreur: ${e.message}`, flags: 64 }).catch(() => {});
    }
  }

  if (id.startsWith('cs_inv_toggle_role:')) {
    console.log(`[BUTTON] cs_inv_toggle_role triggered: id=${id}`);
    try {
      const itemId = parseInt(id.split(':')[1], 10);
      const guildId = interaction.guild?.id;
      const userId = interaction.user.id;
      console.log(`[INV] Toggle role: itemId=${itemId}, guildId=${guildId}, userId=${userId}`);
      
      const inv = db.getInventory(guildId, userId);
      const item = inv.find(i => i.itemId === itemId);
      if (!item || !item.roleId) {
        console.log(`[INV] Item or roleId not found: item=${item}, roleId=${item?.roleId}`);
        return interaction.reply({ content: 'Item ou rôle non trouvé.', flags: 64 }).catch(() => {});
      }
      
      const member = await interaction.guild?.members.fetch(userId).catch((e) => {
        console.error(`[INV] Failed to fetch member:`, e);
        return null;
      });
      if (!member) {
        console.log(`[INV] Member not found`);
        return interaction.reply({ content: 'Membre non trouvé.', flags: 64 }).catch(() => {});
      }
      
      const hasRole = member.roles.cache.has(item.roleId);
      console.log(`[INV] Has role: ${hasRole}, roleId: ${item.roleId}`);
      
      if (hasRole) {
        await member.roles.remove(item.roleId).catch((e) => console.error(`[INV] Failed to remove role:`, e));
        console.log(`[INV] Role removed successfully`);
        return interaction.reply({ content: `✓ Rôle **${item.name}** retiré !`, flags: 64 }).catch(() => {});
      } else {
        await member.roles.add(item.roleId).catch((e) => console.error(`[INV] Failed to add role:`, e));
        console.log(`[INV] Role added successfully`);
        return interaction.reply({ content: `✓ Rôle **${item.name}** ajouté !`, flags: 64 }).catch(() => {});
      }
    } catch (e) {
      console.error(`[INV] Error toggling role:`, e);
      return interaction.reply({ content: `Erreur: ${e.message}`, flags: 64 }).catch(() => {});
    }
  }

  if (id.startsWith('cs_inv_toggle_title:')) {
    console.log(`[BUTTON] cs_inv_toggle_title triggered: id=${id}`);
    try {
      const itemId = parseInt(id.split(':')[1], 10);
      const guildId = interaction.guild?.id;
      const userId = interaction.user.id;
      console.log(`[INV] Toggle title: itemId=${itemId}, guildId=${guildId}, userId=${userId}`);
      
      const user = db.getCasinoUser(guildId, userId);
      const inv = db.getInventory(guildId, userId);
      const item = inv.find(i => i.itemId === itemId);
      if (!item) {
        console.log(`[INV] Item not found: ${itemId}`);
        return interaction.reply({ content: 'Item non trouvé.', flags: 64 }).catch(() => {});
      }
      
      const isActive = user?.activeTitle === itemId;
      console.log(`[INV] Is active: ${isActive}, activeTitle: ${user?.activeTitle}`);
      
      if (isActive) {
        db.setActiveTitle(guildId, userId, null);
        console.log(`[INV] Title removed successfully`);
        return interaction.reply({ content: `✓ Titre **${item.name}** retiré !`, flags: 64 }).catch(() => {});
      } else {
        db.setActiveTitle(guildId, userId, itemId);
        console.log(`[INV] Title set successfully`);
        return interaction.reply({ content: `✓ Titre **${item.name}** affiché !`, flags: 64 }).catch(() => {});
      }
    } catch (e) {
      console.error(`[INV] Error toggling title:`, e);
      return interaction.reply({ content: `Erreur: ${e.message}`, flags: 64 }).catch(() => {});
    }
  }

  if (id.startsWith('cs_inv_remove:')) {
    console.log(`[BUTTON] cs_inv_remove triggered: id=${id}`);
    try {
      const itemId = parseInt(id.split(':')[1], 10);
      const guildId = interaction.guild?.id;
      const userId = interaction.user.id;
      console.log(`[INV] Remove item: itemId=${itemId}, guildId=${guildId}, userId=${userId}`);
      
      const inv = db.getInventory(guildId, userId);
      const item = inv.find(i => i.itemId === itemId);
      if (!item) {
        console.log(`[INV] Item not found: ${itemId}`);
        return interaction.reply({ content: 'Item non trouvé.', flags: 64 }).catch(() => {});
      }
      
      db.removeInventoryItem(guildId, userId, itemId, item.quantity);
      console.log(`[INV] Item removed successfully`);
      return interaction.reply({ content: `✓ **${item.name}** x${item.quantity} supprimé(s) !`, flags: 64 }).catch(() => {});
    } catch (e) {
      console.error(`[INV] Error removing item:`, e);
      return interaction.reply({ content: `Erreur: ${e.message}`, flags: 64 }).catch(() => {});
    }
  }

  if (id === 'cs_shop_shield_select') {
    let casino = null;
    try { casino = require('../commands/casino/casino'); } catch {}
    if (casino?.handleShopShieldSelect) return casino.handleShopShieldSelect(interaction);
    return interaction.deferUpdate().catch(() => {});
  }

  if (id === 'cs_ach_catsel' || id === 'cs_ach_owned_catsel') {
    let casino = null;
    try { casino = require('../commands/casino/casino'); } catch {}
    if (casino?.handleAchievementInteraction) return casino.handleAchievementInteraction(interaction, id);
    return interaction.deferUpdate().catch(() => {});
  }

  // Casino config select menus (ephemeral, handled directly)
  if (id.startsWith('csconf_')) {
    console.log(`[CASINO] Handling config select: ${id} from user ${interaction.user.id}`);
    return _handleCasinoConfigSelect(interaction, id);
  }

  // Handle panel navigation globally (no collector dependency)
  if (id === 'cs_page_nav') {
    let casino = null;
    try { casino = require('../commands/casino/casino'); } catch {}
    if (casino?.handlePanelNav) return casino.handlePanelNav(interaction);
    return interaction.deferUpdate().catch(() => {});
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


  if (id.startsWith('al:') || id.startsWith('cap:') || id.startsWith('local:capture:') || id.startsWith('eload:') || id.startsWith('mye:') || id.startsWith('local:translate:') || id.startsWith('local:joke:') || id.startsWith('local:blcasino:')) {
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
  const guildId = interaction.guild?.id;


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

  if (id.startsWith('dice:')) {
    return;
  }

  if (id === 'csconf_gains_modal') {
    return _handleCasinoGainsModal(interaction);
  }

  if (id === 'csconf_statustext_modal') {
    const raw = interaction.fields.getTextInputValue('status_texts') || '';
    const texts = raw.split('\n').map(t => t.trim()).filter(Boolean).join('|');
    db.setCasinoConfig(guildId, { statusText: texts });
    await interaction.reply({ content: `✓ Texte(s) statut mis à jour : \`${texts || 'aucun'}\``, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  // Cotes modals
  if (id === 'csconf_cotes_bj_modal') {
    const coteNormal = parseFloat(interaction.fields.getTextInputValue('cote_bj'));
    const coteBonus = parseFloat(interaction.fields.getTextInputValue('cote_bj_bonus'));
    if (!isNaN(coteNormal) && coteNormal > 0) {
      db.setCasinoConfig(guildId, { coteBlackjack: coteNormal });
    }
    if (!isNaN(coteBonus) && coteBonus > 0) {
      db.setCasinoConfig(guildId, { coteBlackjackBonus: coteBonus });
    }
    await interaction.reply({ content: `Cotes Blackjack mises à jour : x${coteNormal} (normal) / x${coteBonus || 'N/A'} (bonus)`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id === 'csconf_cotes_cf_modal') {
    const coteNormal = parseFloat(interaction.fields.getTextInputValue('cote_cf'));
    const coteBonus = parseFloat(interaction.fields.getTextInputValue('cote_cf_bonus'));
    if (!isNaN(coteNormal) && coteNormal > 0) {
      db.setCasinoConfig(guildId, { coteCoinflip: coteNormal });
    }
    if (!isNaN(coteBonus) && coteBonus > 0) {
      db.setCasinoConfig(guildId, { coteCoinflipBonus: coteBonus });
    }
    await interaction.reply({ content: `Cotes Coinflip mises à jour : x${coteNormal} (normal) / x${coteBonus || 'N/A'} (bonus)`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id.startsWith('csconf_limits_mises_modal')) {
    const cmd = id.split(':')[1];
    const parse = v => { const n = parseInt(v); return isNaN(n) || n < 0 ? 0 : n; };
    const min = parse(interaction.fields.getTextInputValue('min'));
    const max = parse(interaction.fields.getTextInputValue('max'));
    if (cmd === 'bj')  db.setCasinoConfig(guildId, { limitBjMin: min, limitBjMax: max });
    if (cmd === 'cf')  db.setCasinoConfig(guildId, { limitCfMin: min, limitCfMax: max });
    if (cmd === 'rl')  db.setCasinoConfig(guildId, { limitRlMin: min, limitRlMax: max });
    if (cmd === 'russian') db.setCasinoConfig(guildId, { limitRussianMin: min, limitRussianMax: max });
    if (cmd === 'mine')    {
      let bombs = parseInt(interaction.fields.getTextInputValue('bombs'));
      if (isNaN(bombs) || bombs < 1) bombs = 3;
      if (bombs > 24) bombs = 24;
      db.setCasinoConfig(guildId, { limitMineMin: min, limitMineMax: max, limitMineBombs: bombs });
    }
    if (cmd === 'plinko') db.setCasinoConfig(guildId, { limitPlinkoMin: min, limitPlinkoMax: max });
    if (cmd === 'tower')  db.setCasinoConfig(guildId, { limitTowerMin: min, limitTowerMax: max });
    const labelMap = { bj: 'Blackjack', cf: 'Coinflip', rl: 'Roulette', russian: 'Russian', mine: 'Mine', plinko: 'Plinko', tower: 'Tower' };
    const label = labelMap[cmd] || cmd;
    await interaction.reply({ content: `✓ Mises ${label} ・ min: ${min || 'aucune'} / max: ${max || 'illimité'}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id.startsWith('csconf_limits_cd_modal')) {
    const cmd = id.split(':')[1];
    const parseDur = v => {
      if (!v || !v.trim()) return 0;
      const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*([smhj]?)$/i);
      if (!m) return 0;
      const mult = { s: 1, m: 60, h: 3600, j: 86400 }[(m[2] || 's').toLowerCase()] ?? 1;
      return Math.max(0, Math.round(parseFloat(m[1]) * mult));
    };
    const secs = parseDur(interaction.fields.getTextInputValue('duration'));
    const cdMap = { bj: 'cooldownBj', cf: 'cooldownCf', rl: 'cooldownRl', collect: 'cooldownCollect', vol: 'cooldownVol', gift: 'cooldownGift', russian: 'cooldownRussian', mine: 'cooldownMine', plinko: 'cooldownPlinko', tower: 'cooldownTower', withdraw: 'cooldownWithdraw' };
    const labelMap = { bj: 'Blackjack', cf: 'Coinflip', rl: 'Roulette', collect: 'Collect', vol: 'Vol', gift: 'Gift', russian: 'Russian', mine: 'Mine', plinko: 'Plinko', tower: 'Tower', withdraw: 'Withdraw' };
    if (cdMap[cmd]) db.setCasinoConfig(guildId, { [cdMap[cmd]]: secs });
    const fmtCd = s => s > 0 ? (s % 86400 === 0 ? `${s/86400}j` : s % 3600 === 0 ? `${s/3600}h` : s % 60 === 0 ? `${s/60}m` : `${s}s`) : 'aucun';
    await interaction.reply({ content: `✓ Cooldown ${labelMap[cmd]} : ${fmtCd(secs)}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id === 'csconf_investments_modal') {
    const parseInt_ = v => { const n = parseInt(v); return isNaN(n) || n < 0 ? 0 : n; };
    const parseRate = v => { const n = parseFloat(v); return isNaN(n) || n < 0 ? 0.05 : n / 100; };
    const parseDur = v => {
      if (!v || !v.trim()) return 86400;
      const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*([smhj]?)$/i);
      if (!m) return parseInt(v) || 86400;
      const mult = { s: 1, m: 60, h: 3600, j: 86400 }[(m[2] || 's').toLowerCase()] ?? 1;
      return Math.max(1, Math.round(parseFloat(m[1]) * mult));
    };
    const min = parseInt_(interaction.fields.getTextInputValue('min')) || 10000;
    const max = parseInt_(interaction.fields.getTextInputValue('max')) || 1000000;
    const rate = parseRate(interaction.fields.getTextInputValue('rate')) || 0.05;
    const cooldown = parseDur(interaction.fields.getTextInputValue('cooldown'));
    const penaltyRaw = parseFloat(interaction.fields.getTextInputValue('penalty') || '10');
    const penalty = isNaN(penaltyRaw) ? 0.1 : Math.min(100, Math.max(0, penaltyRaw)) / 100;
    db.setCasinoConfig(guildId, { investmentMin: min, investmentMax: max, investmentRate: rate, investmentClaimCooldown: cooldown, withdrawalPenalty: penalty });
    const fmtCd = s => s % 86400 === 0 ? `${s/86400}j` : s % 3600 === 0 ? `${s/3600}h` : s % 60 === 0 ? `${s/60}m` : `${s}s`;
    await interaction.reply({ content: `✓ Investissements ・ Min: ${min} | Max: ${max} | Taux: ${(rate*100).toFixed(1)}% | Cooldown: ${fmtCd(cooldown)} | Pénalité: ${(penalty*100).toFixed(0)}%`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id.startsWith('csconf_limits_cap_modal')) {
    const type = id.split(':')[1];
    const parseInt_ = v => { const n = parseInt(v); return isNaN(n) || n < 0 ? 0 : n; };
    const parseDur  = v => {
      if (!v || !v.trim()) return 0;
      const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*([smhj]?)$/i);
      if (!m) return 0;
      const mult = { s: 1, m: 60, h: 3600, j: 86400 }[(m[2] || 's').toLowerCase()] ?? 1;
      return Math.max(0, Math.round(parseFloat(m[1]) * mult));
    };
    if (type === 'max_coins') {
      const val = parseInt_(interaction.fields.getTextInputValue('value'));
      db.setCasinoConfig(guildId, { limitMaxCoins: val });
      await interaction.reply({ content: `✓ Coins max détenus : ${val > 0 ? val.toLocaleString() : 'illimité'}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else if (type === 'max_draws') {
      const val = parseInt_(interaction.fields.getTextInputValue('value'));
      db.setCasinoConfig(guildId, { limitMaxDraws: val });
      await interaction.reply({ content: `✓ Tirages max détenus : ${val > 0 ? val : 'illimité'}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else if (type === 'gains') {
      const val    = parseInt_(interaction.fields.getTextInputValue('value'));
      const period = parseDur(interaction.fields.getTextInputValue('period'));
      const fmtCd  = s => s > 0 ? (s % 86400 === 0 ? `${s/86400}j` : s % 3600 === 0 ? `${s/3600}h` : s % 60 === 0 ? `${s/60}m` : `${s}s`) : 'off';
      db.setCasinoConfig(guildId, { limitGainsMax: val, limitGainsPeriod: period });
      await interaction.reply({ content: `✓ Gains max : ${val > 0 ? val.toLocaleString() + ' coins' : 'illimité'} / ${fmtCd(period)}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else if (type === 'draws') {
      const val    = parseInt_(interaction.fields.getTextInputValue('value'));
      const period = parseDur(interaction.fields.getTextInputValue('period'));
      const fmtCd  = s => s > 0 ? (s % 86400 === 0 ? `${s/86400}j` : s % 3600 === 0 ? `${s/3600}h` : s % 60 === 0 ? `${s/60}m` : `${s}s`) : 'off';
      db.setCasinoConfig(guildId, { limitDrawsMax: val, limitDrawsPeriod: period });
      await interaction.reply({ content: `✓ Tirages max : ${val > 0 ? val : 'illimité'} / ${fmtCd(period)}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else if (type === 'invest_max') {
      const val = parseInt_(interaction.fields.getTextInputValue('value'));
      db.setCasinoConfig(guildId, { investmentCapMax: val });
      await interaction.reply({ content: `✓ Investissement max : ${val > 0 ? val.toLocaleString() + ' coins' : 'illimité'}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id === 'csconf_gains_gift_modal') {
    const parse = v => { const n = parseInt(v); return isNaN(n) || n < 0 ? 0 : n; };
    const giftMin = parse(interaction.fields.getTextInputValue('gift_min'));
    const giftMax = parse(interaction.fields.getTextInputValue('gift_max'));
    if (giftMin > 0 && giftMax >= giftMin) db.setCasinoConfig(guildId, { giftMin, giftMax });
    await interaction.reply({ content: `✓ Gift : **${embed.fmtCoins(giftMin)}** ・ **${embed.fmtCoins(giftMax)}** coins`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id === 'csconf_jackpot_cost_modal') {
    const parse = v => { const n = parseInt(v); return isNaN(n) || n < 1 ? 0 : n; };
    const cost = parse(interaction.fields.getTextInputValue('jackpot_cost'));
    if (cost > 0) db.setCasinoConfig(guildId, { jackpotCost: cost });
    await interaction.reply({ content: `✓ Cout jackpot : **${embed.fmtCoins(cost)}** coins par tentative`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id === 'csconf_creation_bonus_modal') {
    const parse = v => { const n = parseInt(v); return isNaN(n) || n < 0 ? 0 : n; };
    const bonus = parse(interaction.fields.getTextInputValue('creation_bonus'));
    db.setCasinoConfig(guildId, { creationBonus: bonus });
    await interaction.reply({ content: `✓ Bonus creation de profil : **${embed.fmtCoins(bonus)}** coins`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id === 'csconf_gains_daily_range_modal') {
    const parse = v => { const n = parseInt(v); return isNaN(n) || n < 0 ? 0 : n; };
    const dailyMin = parse(interaction.fields.getTextInputValue('daily_min'));
    const dailyMax = parse(interaction.fields.getTextInputValue('daily_max'));
    const dailyDraws = parse(interaction.fields.getTextInputValue('daily_draws'));
    db.setCasinoConfig(guildId, { dailyMin, dailyMax, dailyDraws });
    const msg = dailyMin > 0 && dailyMax >= dailyMin
      ? `✓ Plage daily : **${embed.fmtCoins(dailyMin)}** ・ **${embed.fmtCoins(dailyMax)}** coins • **${dailyDraws}** tirage(s)/jour`
      : `✓ Plage daily désactivée ・ valeur fixe utilisée. • **${dailyDraws}** tirage(s)/jour`;
    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id === 'csconf_gains_status_modal') {
    const vocMul = parseFloat(interaction.fields.getTextInputValue('status_voc_mul'));
    const msgMul = parseFloat(interaction.fields.getTextInputValue('status_msg_mul'));
    if (!isNaN(vocMul) && vocMul > 0) db.setCasinoConfig(guildId, { statusVocMultiplier: vocMul });
    if (!isNaN(msgMul) && msgMul > 0) db.setCasinoConfig(guildId, { statusMsgMultiplier: msgMul });
    await interaction.reply({ content: `✓ Multiplicateurs statut mis à jour : vocal x${vocMul} / messages x${msgMul}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id === 'csconf_cotes_bonus_modal') {
    const bjBonus = parseFloat(interaction.fields.getTextInputValue('cote_bj_bonus'));
    const cfBonus = parseFloat(interaction.fields.getTextInputValue('cote_cf_bonus'));
    if (!isNaN(bjBonus) && bjBonus > 0) db.setCasinoConfig(guildId, { coteBlackjackBonus: bjBonus });
    if (!isNaN(cfBonus) && cfBonus > 0) db.setCasinoConfig(guildId, { coteCoinflipBonus: cfBonus });
    await interaction.reply({ content: `✓ Cotes bonus rôle mises à jour : Blackjack x${bjBonus} / Coinflip x${cfBonus}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id === 'csconf_cotes_status_modal') {
    const bjStatus = parseFloat(interaction.fields.getTextInputValue('cote_bj_status'));
    const cfStatus = parseFloat(interaction.fields.getTextInputValue('cote_cf_status'));
    if (!isNaN(bjStatus) && bjStatus > 0) db.setCasinoConfig(guildId, { coteBlackjackStatus: bjStatus });
    if (!isNaN(cfStatus) && cfStatus > 0) db.setCasinoConfig(guildId, { coteCoinflipStatus: cfStatus });
    await interaction.reply({ content: `✓ Cotes bonus statut mises à jour : Blackjack x${bjStatus} / Coinflip x${cfStatus}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id === 'csconf_xp_config_modal') {
    const xpBjWin  = parseInt(interaction.fields.getTextInputValue('xp_bj_win'), 10);
    const xpBjLoss = parseInt(interaction.fields.getTextInputValue('xp_bj_loss'), 10);
    const xpBjPush = parseInt(interaction.fields.getTextInputValue('xp_bj_push'), 10);
    const xpCfWin  = parseInt(interaction.fields.getTextInputValue('xp_cf_win'), 10);
    const xpCfLoss = parseInt(interaction.fields.getTextInputValue('xp_cf_loss'), 10);
    const updates = {};
    if (!isNaN(xpBjWin) && xpBjWin >= 0) updates.xpBjWin = xpBjWin;
    if (!isNaN(xpBjLoss) && xpBjLoss >= 0) updates.xpBjLoss = xpBjLoss;
    if (!isNaN(xpBjPush) && xpBjPush >= 0) updates.xpBjPush = xpBjPush;
    if (!isNaN(xpCfWin) && xpCfWin >= 0) updates.xpCfWin = xpCfWin;
    if (!isNaN(xpCfLoss) && xpCfLoss >= 0) updates.xpCfLoss = xpCfLoss;
    if (Object.keys(updates).length) db.setCasinoConfig(guildId, updates);
    await interaction.reply({ content: `✓ XP BJ+PF mis à jour : BJ ${updates.xpBjWin ?? '?'}/${updates.xpBjLoss ?? '?'}/${updates.xpBjPush ?? '?'} • PF ${updates.xpCfWin ?? '?'}/${updates.xpCfLoss ?? '?'}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id === 'csconf_xp_roulette_modal') {
    const xpRlWin  = parseInt(interaction.fields.getTextInputValue('xp_rl_win'), 10);
    const xpRlLoss = parseInt(interaction.fields.getTextInputValue('xp_rl_loss'), 10);
    const updates = {};
    if (!isNaN(xpRlWin) && xpRlWin >= 0) updates.xpRlWin = xpRlWin;
    if (!isNaN(xpRlLoss) && xpRlLoss >= 0) updates.xpRlLoss = xpRlLoss;
    if (Object.keys(updates).length) db.setCasinoConfig(guildId, updates);
    await interaction.reply({ content: `✓ XP Roulette mis à jour : victoire ${updates.xpRlWin ?? '?'} / défaite ${updates.xpRlLoss ?? '?'}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id === 'csconf_shield_prices_modal') {
    const s1  = parseInt(interaction.fields.getTextInputValue('shield_1'), 10);
    const s3  = parseInt(interaction.fields.getTextInputValue('shield_3'), 10);
    const s5  = parseInt(interaction.fields.getTextInputValue('shield_5'), 10);
    const s10 = parseInt(interaction.fields.getTextInputValue('shield_10'), 10);
    const updates = {};
    if (!isNaN(s1) && s1 >= 0) updates.shieldPrice1 = s1;
    if (!isNaN(s3) && s3 >= 0) updates.shieldPrice3 = s3;
    if (!isNaN(s5) && s5 >= 0) updates.shieldPrice5 = s5;
    if (!isNaN(s10) && s10 >= 0) updates.shieldPrice10 = s10;
    if (Object.keys(updates).length) db.setCasinoConfig(guildId, updates);
    await interaction.reply({ content: `✓ Prix boucliers mis à jour : x1 ${updates.shieldPrice1 ?? '?'} / x3 ${updates.shieldPrice3 ?? '?'} / x5 ${updates.shieldPrice5 ?? '?'} / x10 ${updates.shieldPrice10 ?? '?'}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    await _refreshCasinoConfigPanel(interaction);
    return;
  }

  if (id === 'csconf_shop_add_modal' || id === 'csconf_gacha_add_modal' || id === 'csconf_gacha_coins_modal' || id === 'csconf_level_add_modal' || id === 'csconf_rules_add_modal' || id.startsWith('csconf_rules_edit_modal:') || id === 'csconf_panel_add_modal' || id.startsWith('csconf_panel_edit_modal:')) {
    return _handleCasinoModuleModal(interaction, id);
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

async function _handleCasinoConfigButton(client, interaction, id) {
  const guildId = interaction.guild?.id;
  console.log(`[CASINO-BUTTON] Handling ${id} for guild ${guildId}`);

  if (!guildId) {
    console.log(`[CASINO-BUTTON] No guildId, deferring`);
    return interaction.deferUpdate().catch(() => {});
  }

  try {
    const key = `${guildId}:${interaction.user.id}`;
    if (interaction.message) {
      _casinoConfigPanels.set(key, interaction.message);
      if (!_casinoConfigViews.has(key)) _casinoConfigViews.set(key, 'overview');
    }

    // Close button
    if (id === 'csconf_close') {
      console.log(`[CASINO-BUTTON] Closing panel`);
      await interaction.deferUpdate().catch(() => {});
      return interaction.message.delete().catch(() => {});
    }

    // Toggle enabled
    if (id === 'csconf_toggle') {
      const cfg = db.getCasinoConfig(guildId);
      db.enableCasino(guildId, !cfg.enabled);
      await interaction.deferUpdate().catch(() => {});
      await _refreshCasinoConfigPanel(interaction);
      return;
    }

    if (id === 'csconf_gains_gift') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const key = `${guildId}:${interaction.user.id}`;
      _casinoConfigViews.set(key, 'gains');
      const modal = new ModalBuilder().setCustomId('csconf_gains_gift_modal').setTitle('Config Gift');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gift_min').setLabel('Récompense minimum').setStyle(TextInputStyle.Short).setValue(String(cfg.giftMin ?? 100)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gift_max').setLabel('Récompense maximum').setStyle(TextInputStyle.Short).setValue(String(cfg.giftMax ?? 1000)).setRequired(true)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_jackpot_cost') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const key = `${guildId}:${interaction.user.id}`;
      _casinoConfigViews.set(key, 'gains');
      const modal = new ModalBuilder().setCustomId('csconf_jackpot_cost_modal').setTitle('Cout Jackpot');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('jackpot_cost').setLabel('Cout par tentative (coins)').setStyle(TextInputStyle.Short).setValue(String(cfg.jackpotCost ?? 1000)).setRequired(true)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_creation_bonus') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const key = `${guildId}:${interaction.user.id}`;
      _casinoConfigViews.set(key, 'gains');
      const modal = new ModalBuilder().setCustomId('csconf_creation_bonus_modal').setTitle('Bonus Creation de Profil');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('creation_bonus').setLabel('Coins a attribuer (0 = aucun)').setStyle(TextInputStyle.Short).setValue(String(cfg.creationBonus ?? 0)).setRequired(false)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_jackpot_reset') {
      db.resetJackpot(guildId);
      await interaction.reply({ content: `✓ Cagnotte jackpot remise a zero. Un nouveau numero gagnant a ete genere.`, flags: MessageFlags.Ephemeral }).catch(() => {});
      await _refreshCasinoConfigPanel(interaction);
      return;
    }

    if (id === 'csconf_gains_daily_range') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const key = `${guildId}:${interaction.user.id}`;
      _casinoConfigViews.set(key, 'gains');
      const modal = new ModalBuilder().setCustomId('csconf_gains_daily_range_modal').setTitle('Plage Daily (coins + tirages)');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('daily_min').setLabel('Coins minimum (0 = désactiver la plage)').setStyle(TextInputStyle.Short).setValue(String(cfg.dailyMin ?? 0)).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('daily_max').setLabel('Coins maximum').setStyle(TextInputStyle.Short).setValue(String(cfg.dailyMax ?? 0)).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('daily_draws').setLabel('Tirages par jour').setStyle(TextInputStyle.Short).setValue(String(cfg.dailyDraws ?? 0)).setRequired(false)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_gains_status') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const key = `${guildId}:${interaction.user.id}`;
      _casinoConfigViews.set(key, 'gains');
      const modal = new ModalBuilder().setCustomId('csconf_gains_status_modal').setTitle('Multiplicateurs Statut');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('status_voc_mul').setLabel('Multiplicateur vocal (ex: 2.0 = x2)').setStyle(TextInputStyle.Short).setValue(String(cfg.statusVocMultiplier ?? 2.0)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('status_msg_mul').setLabel('Multiplicateur messages (ex: 2.0 = x2)').setStyle(TextInputStyle.Short).setValue(String(cfg.statusMsgMultiplier ?? 2.0)).setRequired(true)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_statusmul') {
      const cfg = db.getCasinoConfig(guildId);
      db.setCasinoConfig(guildId, { statusMultiplier: cfg.statusMultiplier ? 0 : 1 });
      await interaction.deferUpdate().catch(() => {});
      await _refreshCasinoConfigPanel(interaction);
      return;
    }

    if (id === 'csconf_statustext') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const modal = new ModalBuilder().setCustomId('csconf_statustext_modal').setTitle('Textes de statut');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('status_texts')
            .setLabel('Texte(s) requis dans le statut Discord')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(cfg.statusText || '')
            .setPlaceholder('Un texte par ligne. Ex:\n.gg/monserveur\nmon texte custom')
            .setRequired(false)
        ),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_publish') {
      let casino = null;
      try { casino = require('../commands/casino/casino'); } catch {}
      const payload = casino?.buildCasinoHomePanel?.(guildId);
      const cfg = db.getCasinoConfig(guildId);
      const channel = cfg.panelChannelId
        ? await interaction.guild.channels.fetch(cfg.panelChannelId).catch(() => null)
        : interaction.channel;
      if (!payload || !channel?.send) {
        return interaction.reply({ content: 'Salon panel introuvable.', flags: 64 }).catch(() => {});
      }
      if (cfg.panelMessageId && cfg.panelChannelId) {
        try {
          const oldMsg = await channel.messages.fetch(cfg.panelMessageId).catch(() => null);
          if (oldMsg) await oldMsg.delete().catch(() => {});
        } catch {}
      }
      const sent = await channel.send(payload).catch(() => null);
      if (sent) {
        db.setCasinoConfig(guildId, { panelMessageId: sent.id, panelChannelId: channel.id });
        if (casino?.handlePanelInteractions) {
          casino.handlePanelInteractions(sent, { author: interaction.user, guild: interaction.guild });
        }
      }
      return interaction.reply({ content: `Panel casino publié dans <#${channel.id}>.`, flags: 64 }).catch(() => {});
    }

    const viewByButton = {
      csconf_shop: 'shop_admin',
      csconf_gacha: 'gacha_admin',
      csconf_lvlroles: 'levels_admin',
      csconf_panel: 'panel_admin',
      csconf_back_modules: 'modules',
    };
    if (viewByButton[id]) {
      _casinoConfigViews.set(key, viewByButton[id]);
      await interaction.deferUpdate().catch(() => {});
      await _refreshCasinoConfigPanel(interaction);
      return;
    }

    // Panel channel selector
    if (id === 'csconf_panelch') {
      console.log(`[CASINO-BUTTON] Sending channel selector`);
      const { ChannelSelectMenuBuilder, ActionRowBuilder, ChannelType, MessageFlags } = require('discord.js');
      const select = new ChannelSelectMenuBuilder()
        .setCustomId('csconf_panelch_sel')
        .setChannelTypes(ChannelType.GuildText)
        .setPlaceholder('Select panel channel');
      const result = await interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral }).catch((e) => {
        console.log(`[CASINO-BUTTON] Failed to send selector: ${e?.message}`);
        return null;
      });
      console.log(`[CASINO-BUTTON] Selector sent: ${result ? 'success' : 'failed'}`);
      return result;
    }

    // Allowed channels selector
    if (id === 'csconf_allowed') {
      const { ChannelSelectMenuBuilder, ActionRowBuilder, ChannelType, MessageFlags } = require('discord.js');
      const select = new ChannelSelectMenuBuilder()
        .setCustomId('csconf_allowed_sel')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1).setMaxValues(10)
        .setPlaceholder('Select allowed channels');
      return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    // Logs selector
    if (id === 'csconf_logs') {
      const { StringSelectMenuBuilder, ActionRowBuilder, MessageFlags } = require('discord.js');
      const select = new StringSelectMenuBuilder()
        .setCustomId('csconf_logs_sel')
        .setPlaceholder('Log type')
        .addOptions(
          { label: '[G] Gains', value: 'gains', description: 'Vocal, messages, draws, daily' },
          { label: '[J] Games', value: 'games', description: 'Roulette, blackjack, duels' },
        );
      return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    // Roles selector
    if (id === 'csconf_roles') {
      const { StringSelectMenuBuilder, ActionRowBuilder, MessageFlags } = require('discord.js');
      const select = new StringSelectMenuBuilder()
        .setCustomId('csconf_roles_sel')
        .setPlaceholder('Role type')
        .addOptions(
          { label: '[R] Required role', value: 'required', description: 'Role needed for casino' },
          { label: '[M] Multiplier role', value: 'multiplier', description: 'Role that doubles gains' },
        );
      return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    // Gains modal
    if (id === 'csconf_gains') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const modal = new ModalBuilder().setCustomId('csconf_gains_modal').setTitle('Gains settings');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_voc_min').setLabel('Coins/min vocal').setStyle(TextInputStyle.Short).setValue(String(cfg.coinsPerVocMin ?? 0)).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('d_voc').setLabel('Draws/h vocal').setStyle(TextInputStyle.Short).setValue(String(cfg.drawsPerVocHour)).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_msg').setLabel('Coins/msg').setStyle(TextInputStyle.Short).setValue(String(cfg.coinsPerMsg)).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('collect_bonus').setLabel('Collect bonus (0.5 = +50%)').setStyle(TextInputStyle.Short).setValue(String(cfg.collectBonusRate ?? 0.5)).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mul_pub').setLabel('Public vocal multiplier').setStyle(TextInputStyle.Short).setValue(String(cfg.publicVocMultiplier)).setRequired(false)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    // Cotes configuration modals
    if (id === 'csconf_cotes_bj') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const key = `${guildId}:${interaction.user.id}`;
      _casinoConfigViews.set(key, 'cotes'); // Ensure view is stored as cotes
      const modal = new ModalBuilder().setCustomId('csconf_cotes_bj_modal').setTitle('Cote Blackjack');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cote_bj').setLabel('Cote normale (ex: 2.0)').setStyle(TextInputStyle.Short).setValue(String(cfg.coteBlackjack ?? 2.0)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cote_bj_bonus').setLabel('Cote bonus (ex: 2.5)').setStyle(TextInputStyle.Short).setValue(String(cfg.coteBlackjackBonus ?? 2.5)).setRequired(false)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_cotes_cf') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const key = `${guildId}:${interaction.user.id}`;
      _casinoConfigViews.set(key, 'cotes'); // Ensure view is stored as cotes
      const modal = new ModalBuilder().setCustomId('csconf_cotes_cf_modal').setTitle('Cote Coinflip');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cote_cf').setLabel('Cote normale (ex: 2.0)').setStyle(TextInputStyle.Short).setValue(String(cfg.coteCoinflip ?? 2.0)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cote_cf_bonus').setLabel('Cote bonus (ex: 2.5)').setStyle(TextInputStyle.Short).setValue(String(cfg.coteCoinflipBonus ?? 2.5)).setRequired(false)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_cotes_status') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const key = `${guildId}:${interaction.user.id}`;
      _casinoConfigViews.set(key, 'cotes');
      const modal = new ModalBuilder().setCustomId('csconf_cotes_status_modal').setTitle('Cotes Bonus Statut');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cote_bj_status').setLabel('Cote Blackjack (statut)').setStyle(TextInputStyle.Short).setValue(String(cfg.coteBlackjackStatus ?? 2.5)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cote_cf_status').setLabel('Cote Coinflip (statut)').setStyle(TextInputStyle.Short).setValue(String(cfg.coteCoinflipStatus ?? 2.5)).setRequired(true)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_cotes_bonus') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const key = `${guildId}:${interaction.user.id}`;
      _casinoConfigViews.set(key, 'cotes');
      const modal = new ModalBuilder().setCustomId('csconf_cotes_bonus_modal').setTitle('Cotes Bonus Rôle');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cote_bj_bonus').setLabel('Cote Blackjack (bonus rôle)').setStyle(TextInputStyle.Short).setValue(String(cfg.coteBlackjackBonus ?? 2.5)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cote_cf_bonus').setLabel('Cote Coinflip (bonus rôle)').setStyle(TextInputStyle.Short).setValue(String(cfg.coteCoinflipBonus ?? 2.5)).setRequired(true)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_xp_config') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const key = `${guildId}:${interaction.user.id}`;
      _casinoConfigViews.set(key, 'cotes');
      const modal = new ModalBuilder().setCustomId('csconf_xp_config_modal').setTitle('Config XP BJ + PF');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('xp_bj_win').setLabel('BJ Victoire').setStyle(TextInputStyle.Short).setValue(String(cfg.xpBjWin ?? 50)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('xp_bj_loss').setLabel('BJ Défaite').setStyle(TextInputStyle.Short).setValue(String(cfg.xpBjLoss ?? 15)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('xp_bj_push').setLabel('BJ Égalité').setStyle(TextInputStyle.Short).setValue(String(cfg.xpBjPush ?? 5)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('xp_cf_win').setLabel('PF Victoire').setStyle(TextInputStyle.Short).setValue(String(cfg.xpCfWin ?? 30)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('xp_cf_loss').setLabel('PF Défaite').setStyle(TextInputStyle.Short).setValue(String(cfg.xpCfLoss ?? 10)).setRequired(true)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_xp_roulette') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const key = `${guildId}:${interaction.user.id}`;
      _casinoConfigViews.set(key, 'cotes');
      const modal = new ModalBuilder().setCustomId('csconf_xp_roulette_modal').setTitle('Config XP Roulette');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('xp_rl_win').setLabel('Roulette Victoire').setStyle(TextInputStyle.Short).setValue(String(cfg.xpRlWin ?? 40)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('xp_rl_loss').setLabel('Roulette Défaite').setStyle(TextInputStyle.Short).setValue(String(cfg.xpRlLoss ?? 15)).setRequired(true)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_shield_prices') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const cfg = db.getCasinoConfig(guildId);
      const key = `${guildId}:${interaction.user.id}`;
      _casinoConfigViews.set(key, 'shop_admin');
      const modal = new ModalBuilder().setCustomId('csconf_shield_prices_modal').setTitle('Prix des Boucliers');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('shield_1').setLabel('Prix x1 bouclier').setStyle(TextInputStyle.Short).setValue(String(cfg.shieldPrice1 ?? 500)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('shield_3').setLabel('Prix x3 boucliers').setStyle(TextInputStyle.Short).setValue(String(cfg.shieldPrice3 ?? 1200)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('shield_5').setLabel('Prix x5 boucliers').setStyle(TextInputStyle.Short).setValue(String(cfg.shieldPrice5 ?? 1800)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('shield_10').setLabel('Prix x10 boucliers').setStyle(TextInputStyle.Short).setValue(String(cfg.shieldPrice10 ?? 3000)).setRequired(true)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_cotes_role') {
      const { RoleSelectMenuBuilder, ActionRowBuilder, MessageFlags, ButtonBuilder, ButtonStyle } = require('discord.js');
      const select = new RoleSelectMenuBuilder()
        .setCustomId('csconf_cotes_role_sel')
        .setPlaceholder('Sélectionne le rôle bonus')
        .setMinValues(0)
        .setMaxValues(1);
      const btnReset = new ButtonBuilder()
        .setCustomId('csconf_cotes_role_reset')
        .setLabel('Réinitialiser le rôle')
        .setStyle(ButtonStyle.Danger);
      return interaction.reply({
        content: 'Choisis le rôle qui bénéficie des cotes bonus rôle.',
        components: [
          new ActionRowBuilder().addComponents(select),
          new ActionRowBuilder().addComponents(btnReset)
        ],
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }

    if (id === 'csconf_cotes_role_reset') {
      db.setCasinoConfig(guildId, { coteBonusRole: '' });
      await interaction.update({ content: '✓ Rôle bonus supprimé', components: [] }).catch(() => {});

      // Try to refresh, if failed recreate panel in channel
      const refreshed = await _refreshCasinoConfigPanel(interaction);
      if (!refreshed) {
        // Panel was deleted, recreate it
        const key = `${guildId}:${interaction.user.id}`;
        const view = _casinoConfigViews.get(key) || 'overview';
        const casino = require('../commands/casino/casino');
        if (casino.buildConfigPanel) {
          const container = await casino.buildConfigPanel(interaction.guild, view);
          const newPanel = await interaction.channel?.send({ components: [container] }).catch(() => null);
          if (newPanel) {
            _casinoConfigPanels.set(key, newPanel);
            await interaction.followUp({ content: '✓ Panel recréé (l\'ancien était supprimé)', flags: MessageFlags.Ephemeral }).catch(() => {});
          }
        }
      }
      return;
    }

    if (id === 'csconf_shop_add') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('csconf_shop_type_sel')
        .setPlaceholder('Choisir le type d\'item')
        .addOptions(
          { label: 'Rôle', value: 'role', description: 'Attribue un rôle Discord' },
          { label: 'Tirages', value: 'draws', description: 'Offre des tirages casino' },
          { label: 'Couleur', value: 'color', description: 'Couleur de pseudo' },
          { label: 'Badge', value: 'badge', description: 'Badge de profil' },
          { label: 'Décor', value: 'decor', description: 'Décor de profil' },
          { label: 'Titre', value: 'title', description: 'Titre de profil' },
          { label: 'XP', value: 'xp', description: 'Points d\'expérience' },
          { label: 'Autre', value: 'item', description: 'Item générique' },
        );
      return interaction.reply({ content: 'Choisis le type d\'item à ajouter.', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (id === 'csconf_shop_remove') {
      const items = db.getShopItems(guildId).slice(0, 25);
      if (!items.length) return interaction.reply({ content: 'Aucun item à supprimer.', flags: 64 }).catch(() => {});
      const select = new StringSelectMenuBuilder()
        .setCustomId('csconf_shop_remove_sel')
        .setPlaceholder('Choisir l\'item à supprimer')
        .addOptions(items.map(item => ({
          label: item.name.slice(0, 100),
          value: String(item.id),
          description: `${embed.fmtCoins(item.price)} coins • ${item.type}`.slice(0, 100),
        })));
      return interaction.reply({ content: 'Sélectionne l\'item à supprimer.', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral }).catch(() => {});
    }


    if (id === 'csconf_gacha_coins') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
      const modal = new ModalBuilder().setCustomId('csconf_gacha_coins_modal').setTitle('Config coins par tirage');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('min').setLabel('Coins minimum par tirage').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('ex: 500')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('max').setLabel('Coins maximum par tirage').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('ex: 2000')),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_gacha_add') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('csconf_gacha_type_sel')
        .setPlaceholder('Choisir le type d\'item bonus')
        .addOptions(
          { label: 'R\u00f4le', value: 'role', description: 'Attribue un r\u00f4le Discord au joueur' },
          { label: 'Couleur', value: 'color', description: 'Couleur de pseudo' },
          { label: 'Badge', value: 'badge', description: 'Badge de profil' },
          { label: 'D\u00e9cor', value: 'decor', description: 'D\u00e9cor de profil' },
          { label: 'Nitro', value: 'nitro', description: 'R\u00e9compense Nitro' },
          { label: 'Tirages', value: 'draws', description: 'Offre des tirages casino' },
          { label: 'XP', value: 'xp', description: 'Points d\'exp\u00e9rience' },
        );
      return interaction.reply({ content: 'Choisis le type d\'item bonus \u00e0 ajouter aux tirages.', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (id === 'csconf_gacha_remove') {
      const items = db.getGachaPool(guildId).filter(i => i.type !== 'coins').slice(0, 25);
      if (!items.length) return interaction.reply({ content: 'Aucun item bonus à supprimer.', flags: 64 }).catch(() => {});
      const select = new StringSelectMenuBuilder()
        .setCustomId('csconf_gacha_remove_sel')
        .setPlaceholder('Choisir l\'item à supprimer')
        .addOptions(items.map(item => ({
          label: item.name.slice(0, 100),
          value: String(item.id),
          description: `${item.chance}% de chance (${item.type})`,
        })));
      return interaction.reply({ content: 'Sélectionne l\'item à supprimer.', components: [new ActionRowBuilder().addComponents(select)], flags: 64 }).catch(() => {});
    }

    if (id === 'csconf_level_add') {
      const modal = new ModalBuilder().setCustomId('csconf_level_add_modal').setTitle('Ajouter rôle niveau');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('level').setLabel('Niveau').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roleId').setLabel('Role ID').setStyle(TextInputStyle.Short).setRequired(true)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_rules_add') {
      const modal = new ModalBuilder().setCustomId('csconf_rules_add_modal').setTitle('Ajouter une section');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Titre de la section').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('content').setLabel('Contenu (markdown, > pour citation)').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1800)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_rules_edit') {
      const { getRulesSections } = require('../commands/casino/casino');
      const sections = getRulesSections(guildId);
      if (!sections.length) return interaction.deferUpdate().catch(() => {});
      const options = sections.map((s, i) => ({ label: `${i + 1}. ${s.title.slice(0, 90)}`, value: String(i) }));
      return interaction.reply({
        content: 'Choisis la section à modifier :',
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('csconf_rules_edit_sel').setPlaceholder('Sélectionner une section').addOptions(options)
        )],
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    if (id === 'csconf_rules_del') {
      const { getRulesSections } = require('../commands/casino/casino');
      const sections = getRulesSections(guildId);
      if (!sections.length) return interaction.deferUpdate().catch(() => {});
      const options = sections.map((s, i) => ({ label: `${i + 1}. ${s.title.slice(0, 90)}`, value: String(i) }));
      return interaction.reply({
        content: 'Choisis la section à supprimer :',
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('csconf_rules_del_sel').setPlaceholder('Sélectionner une section').addOptions(options)
        )],
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    if (id === 'csconf_rules_reset') {
      db.setCasinoConfig(guildId, { casinoRules: null });
      await interaction.reply({ content: '✓ Règlement réinitialisé aux valeurs par défaut.', flags: MessageFlags.Ephemeral }).catch(() => {});
      await _refreshCasinoConfigPanel(interaction);
      return;
    }

    if (id === 'csconf_panel_add') {
      const modal = new ModalBuilder().setCustomId('csconf_panel_add_modal').setTitle('Ajouter une section panel');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Titre de la section').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('content').setLabel('Contenu (markdown, > pour citation)').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1800)),
      );
      return interaction.showModal(modal).catch(() => {});
    }

    if (id === 'csconf_panel_edit') {
      const { getPanelSections } = require('../commands/casino/casino');
      const sections = getPanelSections(guildId);
      if (!sections.length) return interaction.deferUpdate().catch(() => {});
      const options = sections.map((s, i) => ({ label: `${i + 1}. ${s.title.slice(0, 90)}`, value: String(i) }));
      return interaction.reply({
        content: 'Choisis la section à modifier :',
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('csconf_panel_edit_sel').setPlaceholder('Sélectionner une section').addOptions(options)
        )],
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    if (id === 'csconf_panel_del') {
      const { getPanelSections } = require('../commands/casino/casino');
      const sections = getPanelSections(guildId);
      if (!sections.length) return interaction.deferUpdate().catch(() => {});
      const options = sections.map((s, i) => ({ label: `${i + 1}. ${s.title.slice(0, 90)}`, value: String(i) }));
      return interaction.reply({
        content: 'Choisis la section à supprimer :',
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('csconf_panel_del_sel').setPlaceholder('Sélectionner une section').addOptions(options)
        )],
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    if (id === 'csconf_panel_reset') {
      db.setCasinoConfig(guildId, { casinoPanelContent: null });
      await interaction.reply({ content: '✓ Panel réinitialisé aux valeurs par défaut.', flags: MessageFlags.Ephemeral }).catch(() => {});
      await _refreshCasinoConfigPanel(interaction);
      return;
    }

    return interaction.deferUpdate().catch(() => {})
  } catch (err) {
    console.error('[CASINO-BUTTON] Caught error:', err?.message, err?.stack?.split('\n')[1]);
    return interaction.deferUpdate().catch(() => {});
  }
}

async function _refreshCasinoConfigPanel(interaction) {
  const guildId = interaction.guild?.id;
  const userId = interaction.user?.id;
  const key = `${guildId}:${userId}`;
  const view = _casinoConfigViews.get(key) || 'overview';

  try {
    let panel = _casinoConfigPanels.get(key);

    if (!panel && interaction.channel?.messages) {
      try {
        const messages = await interaction.channel.messages.fetch({ limit: 20 });
        panel = messages.find(m =>
          m.author?.id === interaction.client.user?.id &&
          m.components?.some(c => c?.type === 17)
        );
        if (panel) {
          _casinoConfigPanels.set(key, panel);
          console.log(`[CASINO-REFRESH] Found panel in channel for ${key}`);
        }
      } catch (fetchErr) {
        console.log(`[CASINO-REFRESH] Failed to search for panel: ${fetchErr?.message}`);
      }
    }

    if (!panel) {
      console.log(`[CASINO-REFRESH] No stored panel for ${key}`);
      return false;
    }

    console.log(`[CASINO-REFRESH] Refreshing panel for ${key}, view=${view}`);
    const casino = require('../commands/casino/casino');
    if (!casino.buildConfigPanel) return false;

    const container = await casino.buildConfigPanel(interaction.guild, view);

    try {
      await panel.edit({ components: [container] });
      console.log(`[CASINO-REFRESH] Panel edited successfully for ${key}`);
      return true;
    } catch (editErr) {
      // Try to fetch fresh message if edit fails (Unknown Message)
      if (editErr?.message?.includes('Unknown Message') && panel.channel?.messages) {
        try {
          const fetched = await panel.channel.messages.fetch(panel.id);
          if (fetched) {
            _casinoConfigPanels.set(key, fetched);
            await fetched.edit({ components: [container] });
            console.log(`[CASINO-REFRESH] Panel fetched and edited successfully for ${key}`);
            return true;
          }
        } catch (fetchErr) {
          console.log(`[CASINO-REFRESH] Failed to fetch panel: ${fetchErr?.message}`);
          // Clean up stored reference if message is gone
          _casinoConfigPanels.delete(key);
          console.log(`[CASINO-REFRESH] Cleaned up panel reference for ${key}`);
        }
      } else if (editErr?.message?.includes('Unknown Message')) {
        // Clean up if we can't even try to fetch
        _casinoConfigPanels.delete(key);
        console.log(`[CASINO-REFRESH] Cleaned up panel reference for ${key} (no channel access)`);
      }
      return false;
    }
  } catch (e) {
    console.log(`[CASINO-REFRESH] Failed to refresh panel: ${e?.message}`);
    return false;
  }
}

// Export for casino.js to register panels
module.exports.registerCasinoConfigPanel = (guildId, userId, panelMessage) => {
  const key = `${guildId}:${userId}`;
  _casinoConfigPanels.set(key, panelMessage);
  _casinoConfigViews.set(key, 'overview');
  console.log(`[CASINO] Registered panel for ${key}`);
};

async function _handleCasinoConfigSelect(interaction, id) {
  const guildId = interaction.guild?.id;
  console.log(`[CASINO-SELECT] Entered handler for ${id}, guild=${guildId}`);

  if (!guildId) {
    console.log(`[CASINO-SELECT] No guildId, deferring`);
    return interaction.deferUpdate().catch(() => {});
  }

  try {
    console.log(`[CASINO-SELECT] Checking types: isChannelSelect=${interaction.isChannelSelectMenu?.()}, isRoleSelect=${interaction.isRoleSelectMenu?.()}, isStringSelect=${interaction.isStringSelectMenu?.()}`);

    // Channel select menus
    if (interaction.isChannelSelectMenu?.()) {
      console.log(`[CASINO-SELECT] Channel select detected for ${id}`);
      if (id === 'csconf_panelch_sel') {
        db.setCasinoConfig(guildId, { panelChannelId: interaction.values[0] });
        console.log(`[CASINO-SELECT] Updated panel channel to ${interaction.values[0]}`);
        await interaction.update({ content: '✓ Panel channel updated', components: [] }).catch(() => {});
        await _refreshCasinoConfigPanel(interaction);
        return;
      }
      if (id === 'csconf_allowed_sel') {
        db.setCasinoConfig(guildId, { allowedChannels: interaction.values.join(',') });
        await interaction.update({ content: '✓ Allowed channels updated', components: [] }).catch(() => {});
        await _refreshCasinoConfigPanel(interaction);
        return;
      }
      if (id === 'csconf_logch_sel') {
        const type = interaction.message.components?.[0]?.components?.[0]?.placeholder?.includes('Gains') ? 'logChannelGains' : 'logChannelGames';
        db.setCasinoConfig(guildId, { [type]: interaction.values[0] });
        await interaction.update({ content: '✓ Log channel updated', components: [] }).catch(() => {});
        await _refreshCasinoConfigPanel(interaction);
        return;
      }
    }

    // Role select menus
    if (interaction.isRoleSelectMenu?.()) {
      console.log(`[CASINO-SELECT] Role select detected for ${id}`);
      if (id === 'csconf_rolereq_sel') {
        db.setCasinoConfig(guildId, { roleRequired: interaction.values[0] });
        await interaction.update({ content: '✓ Required role updated', components: [] }).catch(() => {});
        await _refreshCasinoConfigPanel(interaction);
        return;
      }
      if (id === 'csconf_rolemul_sel') {
        db.setCasinoConfig(guildId, { roleMultiplierId: interaction.values[0] });
        await interaction.update({ content: '✓ Multiplier role updated', components: [] }).catch(() => {});
        await _refreshCasinoConfigPanel(interaction);
        return;
      }
      if (id === 'csconf_shop_role_sel' || id.startsWith('csconf_shop_role_sel:')) {
        const type = id.includes(':') ? id.split(':')[1] : 'role';
        const roleId = interaction.values[0];
        return interaction.showModal(_buildShopAddModal(type, roleId)).catch(() => {});
      }
      if (id === 'csconf_cotes_role_sel') {
        const roleId = interaction.values[0] || '';
        db.setCasinoConfig(guildId, { coteBonusRole: roleId });
        await interaction.update({ content: roleId ? `✓ Rôle bonus: <@&${roleId}>` : '✓ Rôle bonus supprimé', components: [] }).catch(() => {});
        await _refreshCasinoConfigPanel(interaction);
        return;
      }
    }

    // String select menus (intermediate steps)
    if (interaction.isStringSelectMenu?.()) {
      console.log(`[CASINO-SELECT] String select detected for ${id}`);
      if (id === 'csconf_view') {
        const view = interaction.values?.[0] || 'overview';
        const key = `${guildId}:${interaction.user.id}`;
        _casinoConfigPanels.set(key, interaction.message);
        _casinoConfigViews.set(key, view);
        const casino = require('../commands/casino/casino');
        const container = casino.buildConfigPanel(interaction.guild, view);
        const V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
        return interaction.update({ flags: V2_FLAG, components: [container] }).catch(() => {});
      }
      if (id === 'csconf_logs_sel') {
        const type = interaction.values[0];
        const { ChannelSelectMenuBuilder, ActionRowBuilder, ChannelType } = require('discord.js');
        const select = new ChannelSelectMenuBuilder()
          .setCustomId('csconf_logch_sel')
          .setChannelTypes(ChannelType.GuildText)
          .setPlaceholder(type === 'gains' ? '[G] Gains channel' : '[J] Games channel');
        return interaction.update({ components: [new ActionRowBuilder().addComponents(select)] }).catch(() => {});
      }
      if (id === 'csconf_roles_sel') {
        const type = interaction.values[0];
        const { RoleSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
        const select = new RoleSelectMenuBuilder()
          .setCustomId(type === 'required' ? 'csconf_rolereq_sel' : 'csconf_rolemul_sel')
          .setPlaceholder(type === 'required' ? '[R] Required role' : '[M] Multiplier role');
        return interaction.update({ components: [new ActionRowBuilder().addComponents(select)] }).catch(() => {});
      }
      if (id === 'csconf_limits_sel') {
        const { StringSelectMenuBuilder, ActionRowBuilder, MessageFlags } = require('discord.js');
        const sub = interaction.values[0];
        const key = `${guildId}:${interaction.user.id}`;
        _casinoConfigViews.set(key, 'limits');

        if (sub === 'mises') {
          return interaction.reply({
            content: '**⊘ Mises** ・ Choisir la commande à configurer :',
            components: [new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder().setCustomId('csconf_limits_mises_cmd').setPlaceholder('Sélectionne une commande').addOptions(
                { label: 'Blackjack', value: 'bj', description: 'Configurer les mises min/max du Blackjack' },
                { label: 'Coinflip',  value: 'cf', description: 'Configurer les mises min/max du Coinflip' },
                { label: 'Roulette',  value: 'rl', description: 'Configurer les mises min/max de la Roulette' },
                { label: 'Russian',   value: 'russian', description: 'Configurer les mises min/max du Russian' },
                { label: 'Mine',      value: 'mine', description: 'Configurer les mises min/max du Mine' },
                { label: 'Plinko',    value: 'plinko', description: 'Configurer les mises min/max du Plinko' },
                { label: 'Tower',     value: 'tower',  description: 'Configurer les mises min/max du Tower' },
                { label: 'Dice',      value: 'dice',   description: 'Configurer les mises min/max du Dice' },
              )
            )],
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }

        if (sub === 'cooldowns') {
          return interaction.reply({
            content: '**⏱ Cooldowns** ・ Choisir la commande à configurer :',
            components: [new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder().setCustomId('csconf_limits_cd_cmd').setPlaceholder('Sélectionne une commande').addOptions(
                { label: 'Blackjack', value: 'bj',      description: 'Cooldown entre chaque .blackjack' },
                { label: 'Coinflip',  value: 'cf',      description: 'Cooldown entre chaque .coinflip' },
                { label: 'Roulette',  value: 'rl',      description: 'Cooldown entre chaque .roulette' },
                { label: 'Collect',   value: 'collect', description: 'Cooldown du .collect' },
                { label: 'Vol',       value: 'vol',     description: 'Cooldown du .vol' },
                { label: 'Gift',      value: 'gift',    description: 'Cooldown du .gift' },
                { label: 'Russian',   value: 'russian', description: 'Cooldown du .russian' },
                { label: 'Mine',      value: 'mine',    description: 'Cooldown du .mine' },
                { label: 'Plinko',    value: 'plinko',  description: 'Cooldown du .plinko' },
                { label: 'Tower',     value: 'tower',   description: 'Cooldown du .tower' },
                { label: 'Dice',      value: 'dice',    description: 'Cooldown du .dice' },
                { label: 'Invest',    value: 'invest',   description: 'Cooldown du .invest' },
                { label: 'Claims',    value: 'claims',   description: 'Cooldown du .claims (gains investissement)' },
                { label: 'Withdraw',  value: 'withdraw', description: 'Cooldown du .withdraw (retrait investissement)' },
              )
            )],
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }

        if (sub === 'investments') {
          const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
          const cfg = db.getCasinoConfig(guildId);
          const modal = new ModalBuilder()
            .setCustomId('csconf_investments_modal')
            .setTitle('Investissements');
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('min').setLabel('Montant minimum (défaut: 10000)').setStyle(TextInputStyle.Short).setValue(String(cfg.investmentMin ?? 10000)).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('max').setLabel('Montant maximum (défaut: 1000000)').setStyle(TextInputStyle.Short).setValue(String(cfg.investmentMax ?? 1000000)).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rate').setLabel('Taux % par claim (ex: 5 = 5%)').setStyle(TextInputStyle.Short).setValue(String((cfg.investmentRate ?? 0.05) * 100)).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cooldown').setLabel('Cooldown claim (ex: 30s, 5m, 1h, 1j)').setStyle(TextInputStyle.Short).setValue(String(cfg.investmentClaimCooldown ?? 86400)).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('penalty').setLabel('Pénalité retrait % (ex: 10 = 10%)').setStyle(TextInputStyle.Short).setValue(String((cfg.withdrawalPenalty ?? 0.1) * 100)).setRequired(false)),
          );
          return interaction.showModal(modal).catch(() => {});
        }

        if (sub === 'plafonds') {
          return interaction.reply({
            content: '**⬆ Plafonds** ・ Choisir le type à configurer :',
            components: [new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder().setCustomId('csconf_limits_cap_cmd').setPlaceholder('Sélectionne un type').addOptions(
                { label: 'Coins max détenus', value: 'max_coins', description: 'Plafond de coins qu\'un joueur peut avoir' },
                { label: 'Tirages max détenus', value: 'max_draws', description: 'Plafond de tirages qu\'un joueur peut avoir' },
                { label: 'Gains max par période', value: 'gains', description: 'Limite de coins gagnés sur une période' },
                { label: 'Tirages max par période', value: 'draws', description: 'Limite de tirages gagnés sur une période' },
                { label: 'Investissement max', value: 'invest_max', description: 'Plafond total d\'investissement par joueur' },
              )
            )],
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }
        return interaction.deferUpdate().catch(() => {});
      }

      if (id === 'csconf_limits_mises_cmd') {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
        const cmd = interaction.values[0];
        const cfg = db.getCasinoConfig(guildId);
        const minMap = { bj: 'limitBjMin', cf: 'limitCfMin', rl: 'limitRlMin', russian: 'limitRussianMin', mine: 'limitMineMin', plinko: 'limitPlinkoMin', tower: 'limitTowerMin', dice: 'limitDiceMin' };
        const maxMap = { bj: 'limitBjMax', cf: 'limitCfMax', rl: 'limitRlMax', russian: 'limitRussianMax', mine: 'limitMineMax', plinko: 'limitPlinkoMax', tower: 'limitTowerMax', dice: 'limitDiceMax' };
        const labelMap = { bj: 'Blackjack', cf: 'Coinflip', rl: 'Roulette', russian: 'Russian', mine: 'Mine', plinko: 'Plinko', tower: 'Tower', dice: 'Dice' };
        const modal = new ModalBuilder()
          .setCustomId(`csconf_limits_mises_modal:${cmd}`)
          .setTitle(`Mises ・ ${labelMap[cmd]}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('min').setLabel(`Mise minimum (0 = aucune)`).setStyle(TextInputStyle.Short).setValue(String(cfg[minMap[cmd]] ?? 0)).setRequired(false)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('max').setLabel(`Mise maximum (0 = illimité)`).setStyle(TextInputStyle.Short).setValue(String(cfg[maxMap[cmd]] ?? 0)).setRequired(false)),
        );
        if (cmd === 'mine') {
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bombs').setLabel(`Nombre de bombes (1-24, défaut 3)`).setStyle(TextInputStyle.Short).setValue(String(cfg.limitMineBombs ?? 3)).setRequired(false)),
          );
        }
        return interaction.showModal(modal).catch(() => {});
      }

      if (id === 'csconf_limits_cd_cmd') {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
        const cmd = interaction.values[0];
        const cfg = db.getCasinoConfig(guildId);
        const fmtCd = s => s > 0 ? (s % 86400 === 0 ? `${s/86400}j` : s % 3600 === 0 ? `${s/3600}h` : s % 60 === 0 ? `${s/60}m` : `${s}s`) : '0';
        const cdMap = { bj: 'cooldownBj', cf: 'cooldownCf', rl: 'cooldownRl', collect: 'cooldownCollect', vol: 'cooldownVol', gift: 'cooldownGift', russian: 'cooldownRussian', mine: 'cooldownMine', plinko: 'cooldownPlinko', tower: 'cooldownTower', dice: 'cooldownDice', invest: 'cooldownInvest', claims: 'cooldownClaims' };
        const labelMap = { bj: 'Blackjack', cf: 'Coinflip', rl: 'Roulette', collect: 'Collect', vol: 'Vol', gift: 'Gift', russian: 'Russian', mine: 'Mine', plinko: 'Plinko', tower: 'Tower', dice: 'Dice', invest: 'Invest', claims: 'Claims' };
        const modal = new ModalBuilder()
          .setCustomId(`csconf_limits_cd_modal:${cmd}`)
          .setTitle(`Cooldown ・ ${labelMap[cmd]}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Durée (ex: 30s, 2m, 1h, 1j ・ 0 = aucun)').setStyle(TextInputStyle.Short).setValue(fmtCd(cfg[cdMap[cmd]] ?? 0)).setRequired(false)),
        );
        return interaction.showModal(modal).catch(() => {});
      }

      if (id === 'csconf_limits_cap_cmd') {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
        const type = interaction.values[0];
        const cfg  = db.getCasinoConfig(guildId);
        const fmtCd = s => s > 0 ? (s % 86400 === 0 ? `${s/86400}j` : s % 3600 === 0 ? `${s/3600}h` : s % 60 === 0 ? `${s/60}m` : `${s}s`) : '0';
        const modal = new ModalBuilder().setCustomId(`csconf_limits_cap_modal:${type}`);
        if (type === 'max_coins') {
          modal.setTitle('Plafond ・ Coins max détenus');
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('Coins maximum (0 = illimité)').setStyle(TextInputStyle.Short).setValue(String(cfg.limitMaxCoins ?? 0)).setRequired(false)));
        } else if (type === 'max_draws') {
          modal.setTitle('Plafond ・ Tirages max détenus');
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('Tirages maximum (0 = illimité)').setStyle(TextInputStyle.Short).setValue(String(cfg.limitMaxDraws ?? 0)).setRequired(false)));
        } else if (type === 'gains') {
          modal.setTitle('Plafond ・ Gains max par période');
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('Gains max (coins, 0 = illimité)').setStyle(TextInputStyle.Short).setValue(String(cfg.limitGainsMax ?? 0)).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('period').setLabel('Période (ex: 1h, 30m, 1j ・ 0 = off)').setStyle(TextInputStyle.Short).setValue(fmtCd(cfg.limitGainsPeriod ?? 0)).setRequired(false)),
          );
        } else if (type === 'draws') {
          modal.setTitle('Plafond ・ Tirages max par période');
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('Tirages max (0 = illimité)').setStyle(TextInputStyle.Short).setValue(String(cfg.limitDrawsMax ?? 0)).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('period').setLabel('Période (ex: 1h, 30m, 1j ・ 0 = off)').setStyle(TextInputStyle.Short).setValue(fmtCd(cfg.limitDrawsPeriod ?? 0)).setRequired(false)),
          );
        } else if (type === 'invest_max') {
          modal.setTitle('Plafond ・ Investissement max');
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('Montant max investissable (0 = illimité)').setStyle(TextInputStyle.Short).setValue(String(cfg.investmentCapMax ?? 0)).setRequired(false)));
        }
        return interaction.showModal(modal).catch(() => {});
      }

      if (id === 'csconf_commands_sel') {
        const commands = interaction.values?.join(',') || '';
        db.setCasinoConfig(guildId, { restrictedCommands: commands });
        await interaction.deferUpdate().catch(() => {});
        await _refreshCasinoConfigPanel(interaction);
        return;
      }
      if (id === 'csconf_cotes_role_sel') {
        const roleId = interaction.values[0] || '';
        db.setCasinoConfig(guildId, { coteBonusRole: roleId });
        await interaction.update({ content: roleId ? `✓ Rôle bonus: <@&${roleId}>` : '✓ Rôle bonus supprimé', components: [] }).catch(() => {});
        await _refreshCasinoConfigPanel(interaction);
        return;
      }
      if (id === 'csconf_shop_category') {
        const category = interaction.values[0];
        const shopItems = db.getShopItems(guildId);
        const categoryItems = shopItems.filter(item => item.type === category);
        const itemsText = categoryItems.length
          ? categoryItems.map(item => `• **${item.name}** ・ ${embed.fmtCoins(item.price)} coins`).join('\n')
          : '*Aucun item dans cette categorie*';
        const categoryLabel = { title: 'Titres', color: 'Couleurs', role: 'Roles', badge: 'Badges', decor: 'Decorations', item: 'Items', draws: 'Tirages', xp: 'XP' }[category] || category;
        const key = `${guildId}:${interaction.user.id}`;
        _casinoConfigViews.set(key, `shop_category_${category}`);
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const content = `## ${categoryLabel}\n\n${itemsText}\n\n-# Ajoute ou supprime des items de cette categorie.`;
        return interaction.update({
          content,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`csconf_shop_add_cat:${category}`).setLabel('Ajouter').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`csconf_shop_remove_cat:${category}`).setLabel('Supprimer').setStyle(ButtonStyle.Danger).setDisabled(!categoryItems.length),
              new ButtonBuilder().setCustomId('csconf_shop_back').setLabel('Retour').setStyle(ButtonStyle.Secondary),
            ),
          ],
        }).catch(() => {});
      }
      if (id === 'csconf_shop_type_sel') {
        const type = interaction.values[0];
        if (type === 'role' || type === 'color') {
          const { RoleSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
          const select = new RoleSelectMenuBuilder()
            .setCustomId(`csconf_shop_role_sel:${type}`)
            .setPlaceholder(type === 'color' ? 'Choisir le rôle couleur à vendre' : 'Choisir le rôle à vendre');
          return interaction.update({ content: `Sélectionne le rôle ${type === 'color' ? 'couleur ' : ''}à vendre dans la boutique.`, components: [new ActionRowBuilder().addComponents(select)] }).catch(() => {});
        }
        return interaction.showModal(_buildShopAddModal(type)).catch(() => {});
      }
      if (id === 'csconf_gacha_type_sel') {
        const type = interaction.values[0];
        return interaction.showModal(_buildGachaAddModal(type)).catch(() => {});
      }
      if (id === 'csconf_shop_remove_sel') {
        const itemId = parseInt(interaction.values[0], 10);
        db.deleteShopItem(guildId, itemId);
        const key = `${guildId}:${interaction.user.id}`;
        _casinoConfigViews.set(key, 'shop_admin');
        await interaction.update({ content: `✓ Item supprimé.`, components: [] }).catch(() => {});
        await _refreshCasinoConfigPanel(interaction);
        return;
      }
      if (id === 'csconf_gacha_remove_sel') {
        const itemId = parseInt(interaction.values[0], 10);
        db.removeGachaPoolItem(guildId, itemId);
        const key = `${guildId}:${interaction.user.id}`;
        _casinoConfigViews.set(key, 'gacha_admin');
        await interaction.update({ content: `✓ Item bonus supprimé.`, components: [] }).catch(() => {});
        await _refreshCasinoConfigPanel(interaction);
        return;
      }

      if (id === 'csconf_rules_edit_sel') {
        const { getRulesSections } = require('../commands/casino/casino');
        const idx = parseInt(interaction.values[0], 10);
        const sections = getRulesSections(guildId);
        const section = sections[idx];
        if (!section) return interaction.update({ content: 'Section introuvable.', components: [] }).catch(() => {});
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder: AR } = require('discord.js');
        const modal = new ModalBuilder().setCustomId(`csconf_rules_edit_modal:${idx}`).setTitle(`Modifier section ${idx + 1}`);
        modal.addComponents(
          new AR().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Titre').setStyle(TextInputStyle.Short).setValue(section.title).setRequired(true).setMaxLength(100)),
          new AR().addComponents(new TextInputBuilder().setCustomId('content').setLabel('Contenu').setStyle(TextInputStyle.Paragraph).setValue(section.content).setRequired(true).setMaxLength(1800)),
        );
        return interaction.showModal(modal).catch(() => {});
      }

      if (id === 'csconf_rules_del_sel') {
        const { getRulesSections } = require('../commands/casino/casino');
        const idx = parseInt(interaction.values[0], 10);
        const sections = getRulesSections(guildId);
        sections.splice(idx, 1);
        db.setCasinoConfig(guildId, { casinoRules: sections.length ? JSON.stringify(sections) : null });
        const key = `${guildId}:${interaction.user.id}`;
        _casinoConfigViews.set(key, 'rules');
        await interaction.update({ content: `✓ Section supprimée.`, components: [] }).catch(() => {});
        await _refreshCasinoConfigPanel(interaction);
        return;
      }

      if (id === 'csconf_panel_edit_sel') {
        const { getPanelSections } = require('../commands/casino/casino');
        const idx = parseInt(interaction.values[0], 10);
        const sections = getPanelSections(guildId);
        const section = sections[idx];
        if (!section) return interaction.update({ content: 'Section introuvable.', components: [] }).catch(() => {});
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder: AR } = require('discord.js');
        const modal = new ModalBuilder().setCustomId(`csconf_panel_edit_modal:${idx}`).setTitle(`Modifier section panel ${idx + 1}`);
        modal.addComponents(
          new AR().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Titre').setStyle(TextInputStyle.Short).setValue(section.title).setRequired(true).setMaxLength(100)),
          new AR().addComponents(new TextInputBuilder().setCustomId('content').setLabel('Contenu').setStyle(TextInputStyle.Paragraph).setValue(section.content).setRequired(true).setMaxLength(1800)),
        );
        return interaction.showModal(modal).catch(() => {});
      }

      if (id === 'csconf_panel_del_sel') {
        const { getPanelSections } = require('../commands/casino/casino');
        const idx = parseInt(interaction.values[0], 10);
        const sections = getPanelSections(guildId);
        sections.splice(idx, 1);
        db.setCasinoConfig(guildId, { casinoPanelContent: sections.length ? JSON.stringify(sections) : null });
        const key = `${guildId}:${interaction.user.id}`;
        _casinoConfigViews.set(key, 'panel_admin');
        await interaction.update({ content: `✓ Section supprimée.`, components: [] }).catch(() => {});
        await _refreshCasinoConfigPanel(interaction);
        return;
      }
    }

    console.log(`[CASINO-SELECT] No handler matched for ${id}, deferring`);
    return interaction.deferUpdate().catch(() => {});
  } catch (err) {
    console.log(`[CASINO-SELECT] Error: ${err?.message}`);
    return interaction.deferUpdate().catch(() => {});
  }
}

function _buildGachaAddModal(type) {
  const modal = new ModalBuilder().setCustomId('csconf_gacha_add_modal').setTitle(`Ajouter item bonus \u2014 ${type}`);
  const needsRole = ['role', 'color', 'badge', 'decor', 'nitro'].includes(type);
  const needsValue = ['draws', 'xp'].includes(type);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('name').setLabel('Nom de l\'item').setStyle(TextInputStyle.Short).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('type').setLabel('Type').setStyle(TextInputStyle.Short).setValue(type).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('chance').setLabel('Chance d\'obtenir (ex: 5 ou 0.5 pour 0,5%)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('ex: 10')
    ),
  );
  if (needsRole) {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('roleId').setLabel('Role ID Discord').setStyle(TextInputStyle.Short).setRequired(false)
    ));
  }
  if (needsValue) {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('value').setLabel(`Quantit\u00e9 (${type === 'draws' ? 'nb tirages' : 'points XP'})`).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('ex: 5')
    ));
  }
  return modal;
}

function _buildShopAddModal(type, presetValue = '') {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  const modal = new ModalBuilder().setCustomId('csconf_shop_add_modal').setTitle('Ajouter item boutique');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Nom d\'affichage').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('price').setLabel('Prix en coins').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('type').setLabel('Type').setStyle(TextInputStyle.Short).setValue(type).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('Valeur / Role ID / Couleur / Stock').setStyle(TextInputStyle.Short).setValue(presetValue).setRequired(false)),
  );
  return modal;
}

async function _handleCasinoModuleModal(interaction, id) {
  const guildId = interaction.guild?.id;
  if (!guildId) return interaction.deferUpdate().catch(() => {});

  try {
    const key = `${guildId}:${interaction.user.id}`;

    if (id === 'csconf_shop_add_modal') {
      const name = interaction.fields.getTextInputValue('name')?.trim();
      const description = interaction.fields.getTextInputValue('description')?.trim() || '';
      const price = parseInt(interaction.fields.getTextInputValue('price'), 10) || 0;
      const type = interaction.fields.getTextInputValue('type')?.trim()?.toLowerCase();
      const value = interaction.fields.getTextInputValue('value')?.trim() || '';
      if (!name || price < 1) {
        return interaction.reply({ content: 'Nom ou prix invalide.', flags: 64 }).catch(() => {});
      }
      const roleLikeTypes = ['role', 'color', 'badge', 'decor'];
      const cleanValue = value.replace(/[<@&>]/g, '');
      const roleId = roleLikeTypes.includes(type) && cleanValue ? cleanValue : null;
      const colorHex = type === 'color' && value.startsWith('#') ? value : null;
      const titleColorHex = type === 'title' && value.startsWith('#') ? value : null;
      const stock = -1;
      const quantity = (type === 'draws' || type === 'xp') ? (parseInt(value, 10) || 1) : 1;
      console.log(`[CASINO-MODAL] Adding shop item: name=${name}, type=${type}, price=${price}, roleId=${roleId}, quantity=${quantity}, titleColorHex=${titleColorHex}`);
      db.addShopItem(guildId, name, description, price, type, roleId, colorHex, stock, 0, quantity, titleColorHex);
      console.log(`[CASINO-MODAL] Shop item added successfully`);
      _casinoConfigViews.set(key, 'shop_admin');
      await _refreshCasinoConfigPanel(interaction);
      return interaction.reply({ content: `Item boutique **${name}** ajouté.`, flags: 64 }).catch(() => {});
    }

    if (id === 'csconf_gacha_coins_modal') {
      const min = parseInt(interaction.fields.getTextInputValue('min'), 10) || 0;
      const max = parseInt(interaction.fields.getTextInputValue('max'), 10) || min;
      if (min < 0 || max < min) return interaction.reply({ content: 'Valeurs invalides (max doit être ≥ min).', flags: 64 }).catch(() => {});
      db.setGachaCoinConfig(guildId, min, max);
      _casinoConfigViews.set(key, 'gacha_admin');
      await _refreshCasinoConfigPanel(interaction);
      return interaction.reply({ content: `Coins configurés : **${embed.fmtCoins(min)}** → **${embed.fmtCoins(max)}** par tirage.`, flags: 64 }).catch(() => {});
    }

    if (id === 'csconf_gacha_add_modal') {
      const name = interaction.fields.getTextInputValue('name')?.trim();
      const type = interaction.fields.getTextInputValue('type')?.trim()?.toLowerCase();
      const chanceRaw = interaction.fields.getTextInputValue('chance')?.replace(',', '.');
      const chance = parseFloat(chanceRaw) || 0;
      let roleId = null;
      try { const r = interaction.fields.getTextInputValue('roleId')?.trim(); if (r) roleId = r.replace(/[<@&>]/g, ''); } catch {}
      let value = 0;
      try { value = parseInt(interaction.fields.getTextInputValue('value'), 10) || 0; } catch {}
      if (!name || !type || chance <= 0 || chance > 100) return interaction.reply({ content: 'Nom, type ou chance invalide (chance: 0.01 – 100).', flags: 64 }).catch(() => {});
      db.addGachaPoolItem(guildId, name, type, chance, roleId, value);
      _casinoConfigViews.set(key, 'gacha_admin');
      await _refreshCasinoConfigPanel(interaction);
      return interaction.reply({ content: `Item bonus **${name}** ajouté (${chance}% de chance).`, flags: 64 }).catch(() => {});
    }

    if (id === 'csconf_level_add_modal') {
      const level = parseInt(interaction.fields.getTextInputValue('level'), 10);
      const roleId = interaction.fields.getTextInputValue('roleId')?.trim()?.replace(/[<@&>]/g, '');
      if (!level || !roleId) return interaction.reply({ content: 'Niveau ou rôle invalide.', flags: 64 }).catch(() => {});
      db.addCasinoLevelRole(guildId, level, roleId);
      _casinoConfigViews.set(key, 'levels_admin');
      await _refreshCasinoConfigPanel(interaction);
      return interaction.reply({ content: `Rôle niveau **${level}** ajouté.`, flags: 64 }).catch(() => {});
    }

    if (id === 'csconf_rules_add_modal') {
      const { getRulesSections } = require('../commands/casino/casino');
      const title   = interaction.fields.getTextInputValue('title').trim();
      const content = interaction.fields.getTextInputValue('content').trim();
      const sections = getRulesSections(guildId);
      sections.push({ title, content });
      db.setCasinoConfig(guildId, { casinoRules: JSON.stringify(sections) });
      _casinoConfigViews.set(key, 'rules');
      await _refreshCasinoConfigPanel(interaction);
      return interaction.reply({ content: `✓ Section **${title}** ajoutée.`, flags: 64 }).catch(() => {});
    }

    if (id.startsWith('csconf_rules_edit_modal:')) {
      const { getRulesSections } = require('../commands/casino/casino');
      const idx     = parseInt(id.split(':')[1], 10);
      const title   = interaction.fields.getTextInputValue('title').trim();
      const content = interaction.fields.getTextInputValue('content').trim();
      const sections = getRulesSections(guildId);
      if (sections[idx]) {
        sections[idx] = { title, content };
        db.setCasinoConfig(guildId, { casinoRules: JSON.stringify(sections) });
      }
      _casinoConfigViews.set(key, 'rules');
      await _refreshCasinoConfigPanel(interaction);
      return interaction.reply({ content: `✓ Section **${title}** mise à jour.`, flags: 64 }).catch(() => {});
    }

    if (id === 'csconf_panel_add_modal') {
      const { getPanelSections } = require('../commands/casino/casino');
      const title   = interaction.fields.getTextInputValue('title').trim();
      const content = interaction.fields.getTextInputValue('content').trim();
      const sections = getPanelSections(guildId);
      sections.push({ title, content });
      db.setCasinoConfig(guildId, { casinoPanelContent: JSON.stringify(sections) });
      _casinoConfigViews.set(key, 'panel_admin');
      await _refreshCasinoConfigPanel(interaction);
      return interaction.reply({ content: `✓ Section **${title}** ajoutée au panel.`, flags: 64 }).catch(() => {});
    }

    if (id.startsWith('csconf_panel_edit_modal:')) {
      const { getPanelSections } = require('../commands/casino/casino');
      const idx     = parseInt(id.split(':')[1], 10);
      const title   = interaction.fields.getTextInputValue('title').trim();
      const content = interaction.fields.getTextInputValue('content').trim();
      const sections = getPanelSections(guildId);
      if (sections[idx]) {
        sections[idx] = { title, content };
        db.setCasinoConfig(guildId, { casinoPanelContent: JSON.stringify(sections) });
      }
      _casinoConfigViews.set(key, 'panel_admin');
      await _refreshCasinoConfigPanel(interaction);
      return interaction.reply({ content: `✓ Section **${title}** mise à jour.`, flags: 64 }).catch(() => {});
    }

    return interaction.deferUpdate().catch(() => {});
  } catch (err) {
    console.log(`[CASINO-MODAL-ERROR] ${err?.message || err}`);
    return interaction.reply({ content: `Erreur: ${err?.message || 'Impossible de sauvegarder ce module casino.'}`, flags: 64 }).catch(() => {});
  }
}

async function _handleCasinoGainsModal(interaction) {
  const guildId = interaction.guild?.id;
  if (!guildId) return interaction.deferUpdate().catch(() => {});

  try {
    const c_voc_min = interaction.fields.getTextInputValue('c_voc_min');
    const d_voc = interaction.fields.getTextInputValue('d_voc');
    const c_msg = interaction.fields.getTextInputValue('c_msg');
    const collect_bonus = interaction.fields.getTextInputValue('collect_bonus');
    const mul_pub = interaction.fields.getTextInputValue('mul_pub');

    const updates = {};
    if (c_voc_min !== undefined && c_voc_min !== '') updates.coinsPerVocMin = parseInt(c_voc_min) || 0;
    if (d_voc !== undefined && d_voc !== '') updates.drawsPerVocHour = parseInt(d_voc) || 0;
    if (c_msg !== undefined && c_msg !== '') updates.coinsPerMsg = parseInt(c_msg) || 0;
    if (collect_bonus !== undefined && collect_bonus !== '') updates.collectBonusRate = parseFloat(collect_bonus) || 0;
    if (mul_pub !== undefined && mul_pub !== '') updates.publicVocMultiplier = parseInt(mul_pub) || 2;

    db.setCasinoConfig(guildId, updates);
    const key = `${guildId}:${interaction.user.id}`;
    _casinoConfigViews.set(key, 'gains');
    await _refreshCasinoConfigPanel(interaction);

    return interaction.reply({ content: 'Paramètres de gains mis à jour.', flags: 64 }).catch(() => {});
  } catch (err) {
    return interaction.reply({ content: 'Impossible de mettre à jour les paramètres.', flags: 64 }).catch(() => {});
  }
}
