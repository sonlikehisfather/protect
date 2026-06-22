'use strict';


const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
} = require('discord.js');

const embed  = require('../../utils/embed');
const config = require('../../config.json');
const perms  = require('../../utils/permissions');
const db     = require('../../core/database');
const { replaceVariables } = require('../../utils/variables');


const PAGE_SIZE     = 12;
const CAT_PAGE_SIZE = 8;
const IDLE_MS       = 300_000;
const TIMEOUT_MS    = 900_000;

const EMBED_FIELD_VALUE_LIMIT = 1024;
const EMBED_FIELD_SAFE_LIMIT  = 1000;

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

const CATEGORY_LABELS = {
  general      : 'Utilitaire',
  bot          : 'Contrôle du bot',
  owner        : 'Administration bot',
  antiraid     : 'Antiraid',
  server       : 'Gestion du serveur',
  configserver : 'Configuration du serveur',
  logs         : 'Logs',
  config       : 'Paramètres de modération',
  moderation   : 'Modération',
  tickets      : 'Tickets',
  levels       : 'Niveaux',
  casino       : 'Casino',
  games        : 'Jeux',
  giveaways    : 'Giveaways',
  backups      : 'Backups',
  customs      : 'Commandes personnalisées',
};

const CATEGORY_DESCRIPTIONS = {
  general      : 'Commandes utiles et informations',
  bot          : 'Contrôle du bot',
  owner        : 'Administration bot',
  antiraid     : 'Protections et sécurité',
  server       : 'Gestion serveur et outils staff',
  configserver : 'Réglages serveur avancés',
  logs         : 'Configuration des logs',
  config       : 'Réglages de modération',
  moderation   : 'Sanctions, warns, mute, ban',
  tickets      : 'Support et panels tickets',
  levels       : 'XP et classements',
  casino       : 'Système de casino complet',
  games        : 'Jeux et divertissements',
  giveaways    : 'Création et gestion des giveaways',
  backups      : 'Sauvegardes et restaurations serveur',
  customs      : 'Commandes personnalisées du serveur',
};

const CATEGORY_ORDER = [
  'general',
  'bot',
  'owner',
  'antiraid',
  'server',
  'configserver',
  'logs',
  'config',
  'moderation',
  'tickets',
  'levels',
  'casino',
  'games',
  'giveaways',
  'backups',
  'customs',
];

const PERM_ORDER = ['everyone', 'public', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'owner', 'buyer'];

const PERM_LABELS = {
  everyone : 'Public global',
  public   : 'Salons publics',
  '1'      : 'Perm 1',
  '2'      : 'Perm 2',
  '3'      : 'Perm 3',
  '4'      : 'Perm 4',
  '5'      : 'Perm 5',
  '6'      : 'Perm 6',
  '7'      : 'Perm 7',
  '8'      : 'Perm 8',
  '9'      : 'Perm 9',
  owner    : 'Owner',
  buyer    : 'Buyer',
};

const CATEGORY_ALIASES = {
  general      : ['utilitaire', 'utilitaires', 'general', 'général'],
  bot          : ['controle du bot', 'contrôle du bot', 'bot'],
  owner        : ['owner', 'owners'],
  antiraid     : ['antiraid', 'anti raid'],
  server       : ['gestion du serveur', 'server', 'serveur'],
  configserver : ['configuration du serveur', 'configserver', 'config serveur'],
  logs         : ['logs', 'log'],
  config       : ['parametres de moderation', 'paramètres de modération', 'config', 'moderation settings'],
  moderation   : ['moderation', 'modération', 'modo'],
  tickets      : ['tickets', 'ticket'],
  levels       : ['niveaux', 'levels', 'level'],
  casino       : ['casino', 'casinos'],
  games        : ['jeux', 'games', 'game', 'jeu'],
  giveaways    : ['giveaways', 'giveaway'],
  backups      : ['backups', 'backup', 'sauvegardes', 'sauvegarde'],
  customs      : ['customs', 'custom', 'commandes personnalisees', 'commandes personnalisées'],
};


const _displayCommandsCache = new Map();

function _buildPageContainer(pageData, actionRows = []) {
  const parts = [];
  if (pageData?.title) parts.push(`## ${pageData.title}`);
  if (pageData?.intro) parts.push(pageData.intro);
  if (pageData?.fields) {
    for (const field of pageData.fields) {
      parts.push(`### ${field.name}\n${field.value}`);
    }
  }
  if (pageData?.footer) parts.push(`-# ${pageData.footer}`);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(parts.join('\n\n')));

  for (const row of actionRows) {
    if (row && row.components) {
      container.addActionRowComponents(row);
      container.addSeparatorComponents(new SeparatorBuilder());
    }
  }

  return container;
}

module.exports = {
  help: {
    name        : 'help',
    description : "Affiche l'aide du bot.",
    usage       : 'help [commande|catégorie|all]',
    aliases     : ['h', 'aide'],
  },

  async run(client, message, args) {
    const guildId = message.guild.id;
    const prefix  = _getPrefix(guildId);
    const conf    = db.getGuildConfig(guildId);


    if (args[0]?.toLowerCase() === 'msg') {
      let helpmsg = null;
      try { helpmsg = require('../owner/helpmsg'); } catch {}
      if (helpmsg?.run) {
        return helpmsg.run(client, message, args.slice(1));
      }
    }

    const helpType         = _getHelpType(conf);
    const helpAliasEnabled = _isHelpAliasEnabled(conf);
    const helpMessage      = conf?.helpMessage || null;

    const deleteCmd   = Boolean(conf?.autoDeleteInfoCmds);
    const deleteReply = Boolean(conf?.autoDeleteInfoReplies);
    const deleteDelay = conf?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const fullQuery  = args.join(' ').trim().toLowerCase();
    const shortQuery = args[0]?.toLowerCase();
    const query      = fullQuery || shortQuery;

    if (query === 'all') {
      return _handlePagination(client, message, guildId, prefix, deleteReply, deleteDelay);
    }

    if (query) {
      const lowered = query.toLowerCase();

      // Check for exact command match first (before category)
      const allCmds = _getDisplayCommands(client, message);
      const exactCommand = allCmds.find(cmd => {
        const name = (cmd.help?.name ?? cmd.name ?? '').toLowerCase();
        if (name === lowered) return true;
        const aliases = cmd.help?.aliases ?? cmd.aliases ?? [];
        return aliases.some(a => a.toLowerCase() === lowered);
      });

      if (exactCommand) {
        return _handleCommandLookup(
          client,
          message,
          query,
          guildId,
          prefix,
          deleteReply,
          deleteDelay,
          helpAliasEnabled
        );
      }

      const categories      = _getCategories(client, message);
      const matchedCategory = _matchCategory(categories, query);

      if (matchedCategory) {
        return _handleSingleCategory(
          client,
          message,
          guildId,
          prefix,
          matchedCategory,
          deleteReply,
          deleteDelay
        );
      }

      return _handleCommandLookup(
        client,
        message,
        query,
        guildId,
        prefix,
        deleteReply,
        deleteDelay,
        helpAliasEnabled
      );
    }

    return _handleHelpMenu(client, message, guildId, prefix, deleteReply, deleteDelay, helpType, helpMessage);
  },
};

async function _handleHelpMenu(client, message, guildId, prefix, deleteReply, deleteDelay, helpType, helpMessage) {
  if (helpType === 'button') {
    return _handleButtonMenu(client, message, guildId, prefix, deleteReply, deleteDelay, helpMessage);
  }

  if (helpType === 'select') {
    return _handleSelectOnlyMenu(client, message, guildId, prefix, deleteReply, deleteDelay, helpMessage);
  }

  return _handleSelectMenu(client, message, guildId, prefix, deleteReply, deleteDelay, helpMessage);
}

async function _handleSelectMenu(client, message, guildId, prefix, deleteReply, deleteDelay, helpMessage) {
  const categories = _getCategories(client, message);

  if (!categories.length) {
    const sent = await embed.replyError(
      message,
      'Aucune commande disponible.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const categoryPages = _buildCategoryPages(client, message, categories, guildId, prefix);

  let currentCategory = categories[0];
  let currentPage     = 0;

  const buildRows = (disabled = false) => {
    const pages   = categoryPages[currentCategory] ?? [];
    const maxPage = Math.max(0, pages.length - 1);

    return [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('help:category')
          .setPlaceholder('Sélectionner une catégorie')
          .setDisabled(disabled)
          .addOptions(
            categories.slice(0, 25).map(cat => ({
              label       : _getCategoryLabel(cat),
              description : _getCategoryDescription(cat),
              value       : cat,
              default     : currentCategory === cat,
            }))
          )
      ),

      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('help:prev_cat')
          .setLabel('\u2190')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || currentPage === 0),

        new ButtonBuilder()
          .setCustomId('help:next_cat')
          .setLabel('\u2190')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || currentPage >= maxPage),

        new ButtonBuilder()
          .setCustomId('help:home')
          .setLabel('\ud83c\udfe0')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),

        new ButtonBuilder()
          .setCustomId('help:close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled),
      ),
    ];
  };

  const msg = await message.reply({
    components      : [_buildPageContainer((categoryPages[currentCategory] ?? [])[0], buildRows())],
    flags           : COMPONENTS_V2_FLAG,
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!msg) return;

  embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

  const collector = msg.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : IDLE_MS,
    time   : TIMEOUT_MS,
  });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'help:close') {
        await i.deferUpdate().catch(() => {});
        embed.clearPrivateInteraction(msg);
        collector.stop('closed');
        await message.delete().catch(() => {});
        return msg.delete().catch(() => {});
      }

      if (i.customId === 'help:home') {
        currentCategory = categories[0];
        currentPage     = 0;
      }

      if (i.customId === 'help:category') {
        currentCategory = i.values[0];
        currentPage     = 0;
      }

      if (i.customId === 'help:prev_cat' && currentPage > 0) {
        currentPage--;
      }

      if (i.customId === 'help:next_cat') {
        const maxPage = Math.max(0, (categoryPages[currentCategory]?.length ?? 1) - 1);
        if (currentPage < maxPage) currentPage++;
      }

      const pages   = categoryPages[currentCategory] ?? [];
      const maxPage = Math.max(0, pages.length - 1);
      currentPage   = Math.max(0, Math.min(currentPage, maxPage));

      await i.update({
        components : [_buildPageContainer(pages[currentPage], buildRows())],
        flags      : COMPONENTS_V2_FLAG,
      });

    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) {
        console.error('[help] collect error :', err.message);
      }
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(msg);
    if (reason === 'closed') return;
    msg.edit({ components: [] }).catch(() => {});
  });
}

async function _handleSelectOnlyMenu(client, message, guildId, prefix, deleteReply, deleteDelay, helpMessage) {
  const categories = _getCategories(client, message);

  if (!categories.length) {
    const sent = await embed.replyError(
      message,
      'Aucune commande disponible.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const categoryPages = _buildCategoryPages(client, message, categories, guildId, prefix);

  let currentCategory = categories[0];
  let currentPage     = 0;

  const buildRows = (disabled = false) => {
    const rows = [];

    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('help:select_category')
          .setPlaceholder('Sélectionner une catégorie')
          .setDisabled(disabled)
          .addOptions(
            categories.slice(0, 25).map(cat => ({
              label       : _getCategoryLabel(cat),
              description : _getCategoryDescription(cat),
              value       : cat,
              default     : currentCategory === cat,
            }))
          )
      )
    );

    const pages = categoryPages[currentCategory] ?? [];

    if (pages.length > 1) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('help:select_page')
            .setPlaceholder('Sélectionner une page')
            .setDisabled(disabled)
            .addOptions(
              pages.slice(0, 25).map((_, index) => ({
                label   : `Page ${index + 1}`,
                value   : String(index),
                default : currentPage === index,
              }))
            )
        )
      );
    }

    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('help:select_home')
          .setLabel('\ud83c\udfe0')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),

        new ButtonBuilder()
          .setCustomId('help:select_close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled)
      )
    );

    return rows;
  };

  const msg = await message.reply({
    components      : [_buildPageContainer((categoryPages[currentCategory] ?? [])[0], buildRows())],
    flags           : COMPONENTS_V2_FLAG,
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!msg) return;

  embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

  const collector = msg.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : IDLE_MS,
    time   : TIMEOUT_MS,
  });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'help:select_close') {
        await i.deferUpdate().catch(() => {});
        embed.clearPrivateInteraction(msg);
        collector.stop('closed');
        return msg.delete().catch(() => {});
      }

      if (i.customId === 'help:select_home') {
        currentCategory = categories[0];
        currentPage     = 0;
      }

      if (i.customId === 'help:select_category') {
        currentCategory = i.values[0];
        currentPage     = 0;
      }

      if (i.customId === 'help:select_page') {
        currentPage = Number(i.values[0]) || 0;
      }

      const pages   = categoryPages[currentCategory] ?? [];
      const maxPage = Math.max(0, pages.length - 1);

      currentPage = Math.max(0, Math.min(currentPage, maxPage));

      return i.update({
        components : [_buildPageContainer(pages[currentPage], buildRows())],
        flags      : COMPONENTS_V2_FLAG,
      });
    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) {
        console.error('[help] select mode error :', err.message);
      }
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(msg);
    if (reason === 'closed') return;
    msg.edit({ components: [] }).catch(() => {});
  });
}

async function _handleButtonMenu(client, message, guildId, prefix, deleteReply, deleteDelay, helpMessage) {
  const categories = _getCategories(client, message);

  if (!categories.length) {
    const sent = await embed.replyError(
      message,
      'Aucune commande disponible.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const categoryPages = _buildCategoryPages(client, message, categories, guildId, prefix);

  let currentCategory = categories[0];
  let currentPage     = 0;

  const buildRows = (disabled = false) => {
    const pages   = categoryPages[currentCategory] ?? [];
    const maxPage = Math.max(0, pages.length - 1);

    return [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('help:btncatselect')
          .setPlaceholder('Sélectionner une catégorie')
          .setDisabled(disabled)
          .addOptions(
            categories.slice(0, 25).map(cat => ({
              label       : _getCategoryLabel(cat),
              description : _getCategoryDescription(cat),
              value       : cat,
              default     : currentCategory === cat,
            }))
          )
      ),

      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('help:btnprev')
          .setLabel('\u2190')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || currentPage === 0),

        new ButtonBuilder()
          .setCustomId('help:btnnext')
          .setLabel('\u2190')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || currentPage >= maxPage),

        new ButtonBuilder()
          .setCustomId('help:btnhome')
          .setLabel('\ud83c\udfe0')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),

        new ButtonBuilder()
          .setCustomId('help:btnclose')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled)
      ),
    ];
  };

  const msg = await message.reply({
    components      : [_buildPageContainer((categoryPages[currentCategory] ?? [])[0], buildRows())],
    flags           : COMPONENTS_V2_FLAG,
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!msg) return;

  embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

  const collector = msg.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : IDLE_MS,
    time   : TIMEOUT_MS,
  });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'help:btnclose') {
        await i.deferUpdate().catch(() => {});
        embed.clearPrivateInteraction(msg);
        collector.stop('closed');
        await message.delete().catch(() => {});
        return msg.delete().catch(() => {});
      }

      if (i.customId === 'help:btnhome') {
        currentCategory = categories[0];
        currentPage     = 0;
      }

      if (i.customId === 'help:btncatselect') {
        currentCategory = i.values[0];
        currentPage     = 0;
      }

      if (i.customId === 'help:btnprev' && currentPage > 0) {
        currentPage--;
      }

      if (i.customId === 'help:btnnext') {
        const maxPage = Math.max(0, (categoryPages[currentCategory]?.length ?? 1) - 1);
        if (currentPage < maxPage) currentPage++;
      }

      const pages   = categoryPages[currentCategory] ?? [];
      const maxPage = Math.max(0, pages.length - 1);

      currentPage = Math.max(0, Math.min(currentPage, maxPage));

      return i.update({
        components : [_buildPageContainer(pages[currentPage], buildRows())],
        flags      : COMPONENTS_V2_FLAG,
      });
    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) {
        console.error('[help] button mode error :', err.message);
      }
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(msg);
    if (reason === 'closed') return;
    msg.edit({ components: [] }).catch(() => {});
  });
}

async function _handlePagination(client, message, guildId, prefix, deleteReply, deleteDelay) {
  const allCommands = _getDisplayCommands(client, message);

  if (!allCommands.length) {
    const sent = await embed.replyError(
      message,
      'Aucune commande disponible.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const isBuyerUser = perms.isBuyer(message.author.id);
  const groups      = _groupByPerm(allCommands, guildId);

  const orderedPerms = PERM_ORDER.filter(p => {
    if (p === 'buyer' && !isBuyerUser) return false;
    return Array.isArray(groups[p]) && groups[p].length > 0;
  });

  if (!orderedPerms.length) {
    const sent = await embed.replyError(
      message,
      'Aucune commande disponible.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const pages     = [];
  const permStart  = {};
  const permLength = {};

  for (const perm of orderedPerms) {
    const permPages = _buildPermPages(groups[perm], perm, guildId, prefix);
    permStart[perm]  = pages.length;
    permLength[perm] = permPages.length;
    for (const p of permPages) pages.push(p);
  }

  let current = 0;

  const currentPerm = () => {
    let result = orderedPerms[0];
    for (const p of orderedPerms) {
      if (permStart[p] <= current) result = p;
      else break;
    }
    return result;
  };

  const buildRows = (disabled = false) => {
    const active = currentPerm();

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('help:perm:select')
        .setPlaceholder('Aller à une permission')
        .setDisabled(disabled)
        .addOptions(
          orderedPerms.slice(0, 25).map(p => {
            const label = `${PERM_LABELS[p] ?? p} (${groups[p].length} commandes)`;
            return {
              label   : label.slice(0, 100),
              value   : p,
              default : active === p,
            };
          })
        )
    );

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('help:perm:prev')
        .setLabel('\u2190')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || current === 0),

      new ButtonBuilder()
        .setCustomId('help:perm:next')
        .setLabel('\u2190')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || current >= pages.length - 1),

      new ButtonBuilder()
        .setCustomId('help:perm:close')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    );

    return [selectRow, buttonRow];
  };

  const msg = await message.reply({
    components      : [_buildPageContainer(pages[current], buildRows())],
    flags           : COMPONENTS_V2_FLAG,
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!msg) return;

  embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

  const collector = msg.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : IDLE_MS,
    time   : TIMEOUT_MS,
  });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'help:perm:close') {
        await i.deferUpdate().catch(() => {});
        embed.clearPrivateInteraction(msg);
        collector.stop('closed');
        await message.delete().catch(() => {});
        return msg.delete().catch(() => {});
      }

      if (i.customId === 'help:perm:select') {
        const target = i.values?.[0];
        if (target && permStart[target] !== undefined) {
          current = permStart[target];
        }
      }

      if (i.customId === 'help:perm:prev' && current > 0) current--;
      if (i.customId === 'help:perm:next' && current < pages.length - 1) current++;

      await i.update({
        components : [_buildPageContainer(pages[current], buildRows())],
        flags      : COMPONENTS_V2_FLAG,
      });

    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) {
        console.error('[help] perm pagination error :', err.message);
      }
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(msg);
    if (reason === 'closed') return;
    msg.edit({ components: [] }).catch(() => {});
  });
}

function _groupByPerm(commands, guildId) {
  let dbPerms = [];
  try { dbPerms = db.getAllCmdPerms(guildId) || []; } catch { dbPerms = []; }

  const permMap = new Map(
    dbPerms.map(r => [r.commandName ?? r.name, r.perm])
  );

  const groups = {};

  for (const cmd of commands) {
    const name = cmd.help?.name ?? cmd.name;
    if (!name) continue;


    const isVirtualOrCustom = !cmd.help || cmd.category === 'customs';
    const perm = isVirtualOrCustom
      ? 'everyone'
      : (permMap.get(name) ?? 'everyone');

    if (!groups[perm]) groups[perm] = [];
    groups[perm].push(cmd);
  }

  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => {
      const an = a.help?.name ?? a.name ?? '';
      const bn = b.help?.name ?? b.name ?? '';
      return an.localeCompare(bn);
    });
  }

  return groups;
}


function _truncateText(value, limit) {
  const text = String(value ?? '');
  let cut;
  if (text.length <= limit) cut = text;
  else if (limit <= 3) cut = text.slice(0, limit);
  else cut = `${text.slice(0, limit - 3).trimEnd()}...`;
  return embed.breakLongTokens(cut);
}

function _buildCommandHeader(cmd, prefix, limit = EMBED_FIELD_SAFE_LIMIT) {
  const raw          = cmd.help ? _getCommandUsage(cmd.help) : (cmd.usage ?? cmd.name ?? 'commande');
  const contentLimit = Math.max(1, limit - 6);

  return `**\`${_truncateText(`${prefix}${raw}`, contentLimit)}\`**`;
}

function _buildCommandLine(cmd, prefix) {
  const description = cmd.help?.description ?? cmd.description ?? 'Aucune description';
  const header      = _buildCommandHeader(cmd, prefix);
  const descLimit   = EMBED_FIELD_SAFE_LIMIT - header.length - 1;

  if (descLimit <= 0) {
    return _truncateText(header, EMBED_FIELD_SAFE_LIMIT);
  }

  return `${header}\n${_truncateText(description, descLimit)}`;
}

function _buildCommandLinePages(commands, prefix, maxItemsPerPage) {
  const pages = [];
  let current = [];
  let currentLength = 0;

  for (const cmd of commands) {
    const line            = _buildCommandLine(cmd, prefix);
    const separatorLength = current.length ? 2 : 0;

    const wouldExceedItems = current.length >= maxItemsPerPage;
    const wouldExceedLimit = currentLength + separatorLength + line.length > EMBED_FIELD_VALUE_LIMIT;

    if (current.length && (wouldExceedItems || wouldExceedLimit)) {
      pages.push(current);
      current       = [];
      currentLength = 0;
    }

    current.push(line);
    currentLength += (current.length > 1 ? 2 : 0) + line.length;
  }

  if (current.length) {
    pages.push(current);
  }

  return pages;
}

function _joinCommandLines(lines) {
  const value = lines.join('\n\n');

  if (!value) return 'Aucune commande.';
  if (value.length <= EMBED_FIELD_VALUE_LIMIT) return value;


  return _truncateText(value, EMBED_FIELD_VALUE_LIMIT);
}


function _buildPermPages(commands, perm, guildId, prefix) {
  const label = PERM_LABELS[perm] ?? perm;
  const pages = _buildCommandLinePages(commands, prefix, PAGE_SIZE);

  if (!pages.length) return [];

  return pages.map((lines, idx) => {
    return {
      title  : `Permission \u2022 ${label}`,
      intro  : null,
      fields : [
        {
          name  : 'Commandes',
          value : _joinCommandLines(lines),
        },
      ],
      footer : `Page ${idx + 1}/${pages.length} \u2022 ${label}`,
    };
  });
}

async function _handleSingleCategory(client, message, guildId, prefix, category, deleteReply, deleteDelay) {
  const pages = _buildCategoryPages(client, message, [category], guildId, prefix)[category] ?? [];

  if (!pages.length) {
    const sent = await embed.replyError(
      message,
      `Aucune commande disponible dans la catégorie \`${category}\`.`,
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  let current = 0;

  const buildRows = (disabled = false) => [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('help:prev_single')
        .setLabel('\u2190')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || current === 0),

      new ButtonBuilder()
        .setCustomId('help:next_single')
        .setLabel('\u2190')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || current >= pages.length - 1),

      new ButtonBuilder()
        .setCustomId('help:home_single')
        .setLabel('\ud83c\udfe0')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId('help:close_single')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    ),
  ];

  const msg = await message.reply({
    components      : [_buildPageContainer(pages[current], buildRows())],
    flags           : COMPONENTS_V2_FLAG,
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!msg) return;

  embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

  const collector = msg.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : IDLE_MS,
    time   : TIMEOUT_MS,
  });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'help:close_single' || i.customId === 'help:home_single') {
        await i.deferUpdate().catch(() => {});
        embed.clearPrivateInteraction(msg);
        collector.stop('closed');
        await message.delete().catch(() => {});
        return msg.delete().catch(() => {});
      }

      if (i.customId === 'help:prev_single' && current > 0) current--;
      if (i.customId === 'help:next_single' && current < pages.length - 1) current++;

      await i.update({
        components : [_buildPageContainer(pages[current], buildRows())],
        flags      : COMPONENTS_V2_FLAG,
      });

    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) {
        console.error('[help] collect error :', err.message);
      }
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(msg);
    if (reason === 'closed') return;
    msg.edit({ components: [] }).catch(() => {});
  });
}

async function _handleCommandLookup(client, message, input, guildId, prefix, deleteReply, deleteDelay, helpAliasEnabled = true) {
  const lowered = input.toLowerCase();

  const virtualCommand = _getVirtualCommands(client, message).find(cmd =>
    cmd.name.toLowerCase() === lowered
  );

  if (virtualCommand) {
    const vUsage = virtualCommand.usage ?? virtualCommand.name;
    const vIntro = virtualCommand.multi === true
      ? '*Les arguments peuvent \u00eatre des mentions, des noms ou des IDs Discord.\nS\'ils ne sont pas des mentions, s\u00e9pare-les par `,`*'
      : /[<\[]/.test(vUsage)
      ? '*Les arguments peuvent \u00eatre des mentions, des noms ou des IDs Discord.*'
      : null;

    const sent = await message.reply({
      components: [
        _buildPageContainer({
          title  : `Commande • ${virtualCommand.name}`,
          intro  : vIntro,
          fields : [
            {
              name  : 'Description',
              value : virtualCommand.description ?? 'Aucune description.',
            },
            {
              name  : 'Utilisation',
              value : `\`${prefix}${virtualCommand.usage ?? virtualCommand.name}\``,
            },
            {
              name  : 'Catégorie',
              value : _getCategoryLabel(virtualCommand.category ?? 'general'),
            },
            {
              name  : 'Aliases',
              value : 'Aucun',
            },
          ],
        }),
      ],
      flags           : COMPONENTS_V2_FLAG,
      allowedMentions : { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  let command =
    client.commands.get(lowered) ??
    _getUniqueCommands(client, message).find(cmd =>
      cmd.help?.aliases?.includes(lowered)
    );

  if (!command && lowered.includes(' ')) {
    const firstWord = lowered.split(' ')[0];

    command =
      client.commands.get(firstWord) ??
      _getUniqueCommands(client, message).find(cmd =>
        cmd.help?.aliases?.includes(firstWord)
      );
  }

  if (!command) {
    const sent = await embed.replyError(
      message,
      `Commande ou catégorie \`${input}\` introuvable.`,
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (!perms.check(message, command.help.name)) {
    const sent = await embed.replyError(
      message,
      'Commande introuvable ou inaccessible.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const h     = command.help;
  const usage = _getCommandUsage(h);
  const intro = h.multi === true
    ? '*Les arguments peuvent \u00eatre des mentions, des noms ou des IDs Discord.\nS\'ils ne sont pas des mentions, s\u00e9pare-les par `,`*'
    : /[<\[]/.test(usage)
    ? '*Les arguments peuvent \u00eatre des mentions, des noms ou des IDs Discord.*'
    : null;

  const sent = await message.reply({
    components: [
      _buildPageContainer({
        title  : `Commande • ${h.name}`,
        intro  : intro,
        fields : [
          {
            name  : 'Description',
            value : h.description ?? 'Aucune description.',
          },
          {
            name  : 'Utilisation',
            value : `\`${prefix}${usage}\``,
          },
          {
            name  : 'Catégorie',
            value : _getCategoryLabel(h.category ?? 'general'),
          },
          {
            name  : 'Aliases',
            value : helpAliasEnabled
            ? (
              h.aliases?.length
              ? h.aliases.map(a => `\`${a}\``).join(', ')
              : 'Aucun'
            )
            : 'Masqués',
          },
        ],
      }),
    ],
    flags           : COMPONENTS_V2_FLAG,
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

function _buildHomeData(client, message, guildId, prefix, helpMessage = null) {
  const cmdCount = _getDisplayCommands(client, message).length;
  const catCount = _getCategories(client, message).length;

  const description = helpMessage
    ? _interpolateHelpMessage(helpMessage, message, prefix, client)
    : null;

  return {
    title  : `${client.user.username} • Panel des commandes`,
    intro  : description,
    fields : [
      {
        name  : 'Infos',
        value :
          `Préfixe : \`${prefix}\` • Commandes : **${cmdCount}** • Catégories : **${catCount}**`,
      },
      {
        name  : 'Raccourcis',
        value :
          `\`${prefix}help all\` • toutes les catégories\n` +
          `\`${prefix}help <catégorie>\` • ouvre une catégorie\n` +
          `\`${prefix}help <commande>\` • détails d'une commande`,
      },
    ],
    footer : `Utilise ${prefix}help <commande> pour plus de détails`,
  };
}

function _interpolateHelpMessage(text, message, prefix, client) {
  if (!text) return text;

  const guild  = message.guild;
  const member = message.member ?? guild?.members?.cache?.get(message.author.id) ?? null;

  return replaceVariables(String(text), {
    user   : message.author,
    member,
    guild,
    client,
    prefix : prefix ?? '+',
    extras : { bot: client.user?.username ?? 'bot' },
  });
}

function _getUniqueCommands(client, message) {
  const unique = new Map();

  for (const cmd of client.commands.values()) {
    if (!cmd.help?.name) continue;
    if (!perms.check(message, cmd.help.name)) continue;
    if (!unique.has(cmd.help.name)) unique.set(cmd.help.name, cmd);
  }

  return [...unique.values()].sort((a, b) =>
    a.help.name.localeCompare(b.help.name)
  );
}

function _getVirtualCommands(client, message) {
  const commands = [];

  for (const cmd of _getUniqueCommands(client, message)) {
    if (!Array.isArray(cmd.help?.subcommands)) continue;

    for (const sub of cmd.help.subcommands) {
      if (!sub?.name || !sub?.category) continue;

      commands.push({
        name        : sub.name,
        description : sub.description ?? 'Aucune description.',
        usage       : sub.usage ?? sub.name,
        category    : sub.category,
      });
    }
  }

  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

function _getDisplayCommands(client, message) {
  const cacheKey = `${message.guild.id}-${message.author.id}-${message.channel.id}`;

  if (!_displayCommandsCache.has(cacheKey)) {
    const commands = [
      ..._getUniqueCommands(client, message),
      ..._getVirtualCommands(client, message),
      ..._getCustomCommands(message),
    ].filter(cmd => (cmd.help?.name ?? cmd.name) !== 'help');
    _displayCommandsCache.set(cacheKey, commands);

    setTimeout(() => _displayCommandsCache.delete(cacheKey), 5000);
  }

  return _displayCommandsCache.get(cacheKey);
}

function _getCustomCommands(message) {
  let ccRuntime = null;
  try { ccRuntime = require('../../modules/customCommands'); } catch { return []; }
  if (!ccRuntime?.canUseCustom) return [];

  const guildId = message.guild.id;
  let allCustoms;
  try { allCustoms = db.getAllCustomCommands(guildId); } catch { return []; }
  if (!Array.isArray(allCustoms)) return [];

  const results = [];
  for (const cc of allCustoms) {
    const check = ccRuntime.canUseCustom(
      message.guild, message.member, message.author.id, cc, message.channel.id,
    );
    if (!check.ok) continue;

    results.push({
      name        : cc.name,
      description : cc.description || 'Commande personnalisee',
      usage       : cc.name,
      category    : 'customs',
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function _getCategories(client, message) {
  const cats = new Set();

  for (const cmd of _getDisplayCommands(client, message)) {
    if (cmd.help?.category) cats.add(cmd.help.category);
    else if (cmd.category) cats.add(cmd.category);
  }

  return [...cats].sort((a, b) => {
    const indexA = CATEGORY_ORDER.indexOf(a);
    const indexB = CATEGORY_ORDER.indexOf(b);

    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;

    return _getCategoryLabel(a).localeCompare(_getCategoryLabel(b));
  });
}

function _matchCategory(categories, input) {
  const normalizedInput = _normalizeCategory(input);

  return categories.find(cat => {
    if (_normalizeCategory(cat) === normalizedInput) return true;
    if (_normalizeCategory(_getCategoryLabel(cat)) === normalizedInput) return true;

    const aliases = CATEGORY_ALIASES[cat] || [];
    return aliases.some(alias => _normalizeCategory(alias) === normalizedInput);
  }) ?? null;
}

function _getCommandsByCategory(client, message, category) {
  return _getDisplayCommands(client, message).filter(cmd => {
    if (cmd.help?.category) return cmd.help.category === category;
    return cmd.category === category;
  });
}

function _chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function _buildCategoryPages(client, message, categories, guildId, prefix) {
  const result = {};

  for (const cat of categories) {
    const commands = _getCommandsByCategory(client, message, cat);
    const pages    = _buildCommandLinePages(commands, prefix, CAT_PAGE_SIZE);

    result[cat] = pages.map((lines, idx) => {
      const intro = '*Les arguments peuvent \u00eatre des mentions, des noms ou des IDs Discord.\nS\'ils ne sont pas des mentions, s\u00e9pare-les par \`,\`*';

      return {
        title  : `Catégorie \u2022 ${_getCategoryLabel(cat)}`,
        intro  : intro,
        fields : [
          {
            name  : 'Commandes',
            value : _joinCommandLines(lines),
          },
        ],
        footer : `Page ${idx + 1}/${pages.length} \u2022 ${_getCategoryLabel(cat)}`,
      };
    });
  }

  return result;
}

function _buildAllCategoryEmbeds(client, message, categories, guildId, prefix) {
  const result = [];

  for (const cat of categories) {
    const commands = _getCommandsByCategory(client, message, cat);
    const pages    = _buildCommandLinePages(commands, prefix, CAT_PAGE_SIZE);

    const intro = '*Les arguments peuvent \u00eatre des mentions, des noms ou des IDs Discord.\nS\'ils ne sont pas des mentions, s\u00e9pare-les par \`,\`*';

    for (let i = 0; i < pages.length; i++) {
      result.push({
        title  : `Catégorie \u2022 ${_getCategoryLabel(cat)}`,
        intro  : intro,
        fields : [
          {
            name  : 'Commandes',
            value : _joinCommandLines(pages[i]),
          },
        ],
        footer : `Page ${i + 1}/${pages.length} \u2022 ${_getCategoryLabel(cat)}`,
      });
    }
  }

  return result;
}

function _getCommandUsage(help) {
  return help?.usage ?? help?.use ?? help?.name ?? 'commande';
}

function _getCategoryLabel(cat) {
  return CATEGORY_LABELS[cat] ?? _capitalize(cat);
}

function _getCategoryDescription(cat) {
  return CATEGORY_DESCRIPTIONS[cat] ?? 'Commandes disponibles';
}

function _capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function _normalizeCategory(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function _getHelpType(config) {
  const type = String(config?.helpType || 'hybrid').toLowerCase();

  if (['button', 'select', 'hybrid'].includes(type)) {
    return type;
  }

  return 'hybrid';
}

function _isHelpAliasEnabled(config) {
  return Number(config?.helpAliasEnabled ?? 1) === 1;
}

function _getPrefix(guildId) {
  try {
    return db.getGuildConfig(guildId)?.prefix ?? config.prefix ?? '+';
  } catch {
    return config.prefix ?? '+';
  }
}
