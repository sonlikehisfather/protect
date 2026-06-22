'use strict';

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const config = require('../../config.json');

const IDLE_MS    = 300_000;
const TIMEOUT_MS = 900_000;
const PAGE_SIZE  = 10;

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
  games        : 'Jeux',
  giveaways    : 'Giveaways',
  backups      : 'Backups',
  customs      : 'Commandes personnalisées',
};

const CATEGORY_ORDER = [
  'general', 'bot', 'owner', 'antiraid', 'server', 'configserver',
  'logs', 'config', 'moderation', 'tickets', 'levels', 'games', 'giveaways', 'backups', 'customs',
];

module.exports = {
  help: {
    name        : 'alias',
    description : 'Affiche toutes les commandes et leurs alias.',
    usage       : 'alias',
    aliases     : ['aliases'],
  },

  async run(client, message, args) {
    const guildId = message.guild.id;
    const conf    = db.getGuildConfig(guildId);
    const prefix  = conf?.prefix ?? config.prefix ?? '+';

    const deleteCmd   = Boolean(conf?.autoDeleteInfoCmds);
    const deleteReply = Boolean(conf?.autoDeleteInfoReplies);
    const deleteDelay = Number(conf?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const categories    = _getCategories(client);
    const categoryPages = _buildCategoryPages(client, categories, guildId, prefix);

    if (!categories.length) {
      const sent = await embed.replyError(message, 'Aucune commande disponible.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let currentCategory = categories[0];
    let currentPage     = 0;

    const buildPayload = (disabled = false) => {
      const pages   = categoryPages[currentCategory] ?? [];
      const maxPage = Math.max(0, pages.length - 1);
      const lines   = pages[currentPage] ?? [];

      const text = [
        `## Catégorie • ${_getCategoryLabel(currentCategory)}`,
        '',
        lines.join('\n') || '*Aucune commande.*',
        '',
        `-# Page ${currentPage + 1}/${Math.max(1, pages.length)} • ${_getCategoryLabel(currentCategory)}`,
      ].join('\n');

      const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('al:category')
              .setPlaceholder('Sélectionner une catégorie')
              .setDisabled(disabled)
              .addOptions(
                categories.slice(0, 25).map(cat => ({
                  label   : _getCategoryLabel(cat),
                  value   : cat,
                  default : currentCategory === cat,
                }))
              )
          )
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('al:prev')
              .setLabel('\u2190')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(disabled || currentPage === 0),
            new ButtonBuilder()
              .setCustomId('al:next')
              .setLabel('\u2192')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(disabled || currentPage >= maxPage),
            new ButtonBuilder()
              .setCustomId('al:home')
              .setLabel('\uD83C\uDFE0')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(disabled),
            new ButtonBuilder()
              .setCustomId('al:close')
              .setLabel('\u2716')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(disabled),
          )
        );

      return {
        components      : [container],
        flags           : MessageFlags.IsComponentsV2,
        allowedMentions : { parse: [] },
      };
    };

    const msg = await message.reply(buildPayload()).catch(() => null);

    if (!msg) return;

    embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

    const collector = msg.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id,
      idle   : IDLE_MS,
      time   : TIMEOUT_MS,
    });

    collector.on('collect', async i => {
      try {
        if (i.customId === 'al:close') {
          await i.deferUpdate().catch(() => {});
          embed.clearPrivateInteraction(msg);
          collector.stop('closed');
          await message.delete().catch(() => {});
          return msg.delete().catch(() => {});
        }

        if (i.customId === 'al:home') {
          currentCategory = categories[0];
          currentPage     = 0;
        }

        if (i.customId === 'al:category') {
          currentCategory = i.values[0];
          currentPage     = 0;
        }

        if (i.customId === 'al:prev' && currentPage > 0) currentPage--;

        if (i.customId === 'al:next') {
          const maxPage = Math.max(0, (categoryPages[currentCategory]?.length ?? 1) - 1);
          if (currentPage < maxPage) currentPage++;
        }

        const pages   = categoryPages[currentCategory] ?? [];
        const maxPage = Math.max(0, pages.length - 1);
        currentPage   = Math.max(0, Math.min(currentPage, maxPage));

        await i.update(buildPayload()).catch(() => {});

      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error('[alias] collect error:', err.message);
        }
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(msg);
      if (reason === 'closed') return;
      msg.edit(buildPayload(true)).catch(() => {});
    });
  },
};

function _getUniqueCommands(client) {
  const unique = new Map();
  for (const cmd of client.commands.values()) {
    if (!cmd.help?.name) continue;
    if (!unique.has(cmd.help.name)) unique.set(cmd.help.name, cmd);
  }
  return [...unique.values()].sort((a, b) => a.help.name.localeCompare(b.help.name));
}

function _getCategories(client) {
  const cats = new Set();
  for (const cmd of _getUniqueCommands(client)) {
    if (cmd.help?.category) cats.add(cmd.help.category);
  }
  return [...cats].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return _getCategoryLabel(a).localeCompare(_getCategoryLabel(b));
  });
}

function _getCategoryLabel(cat) {
  return CATEGORY_LABELS[cat] ?? (cat.charAt(0).toUpperCase() + cat.slice(1));
}

function _buildCategoryPages(client, categories, guildId, prefix) {
  const result = {};

  for (const cat of categories) {
    const cmds = _getUniqueCommands(client).filter(cmd => cmd.help?.category === cat);
    const chunks = [];

    for (let i = 0; i < cmds.length; i += PAGE_SIZE) {
      chunks.push(cmds.slice(i, i + PAGE_SIZE));
    }

    result[cat] = chunks.map(chunk =>
      chunk.map(cmd => {
        const aliases = cmd.help.aliases?.length
          ? cmd.help.aliases.map(a => `\`${a}\``).join(', ')
          : '*Aucun*';
        return `\`${prefix}${cmd.help.name}\` → ${aliases}`;
      })
    );

    if (!result[cat].length) result[cat] = [[]];
  }

  return result;
}
