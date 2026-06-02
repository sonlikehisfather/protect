'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');
const config = require('../../config.json');

const PAGE_SIZE  = 10;
const IDLE_MS    = 300_000;
const TIMEOUT_MS = 900_000;

module.exports = {
  help: {
    name        : 'serverlist',
    description : 'Affiche la liste des serveurs où se trouve le bot.',
    use         : 'serverlist [page]',
    usage       : 'serverlist [page]',
    aliases     : ['servers', 'guilds', 'guildlist'],
    category    : 'owner',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const guildConfig = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
    const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
    const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);
    const prefix      = guildConfig?.prefix ?? config.prefix ?? '+';

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const guilds = _getSortedGuilds(client);

    if (!guilds.length) {
      return _sendError(
        message,
        'Aucun serveur trouvé.',
        deleteReply,
        deleteDelay
      );
    }

    const maxPage = Math.max(1, Math.ceil(guilds.length / PAGE_SIZE));
    let page = _parsePage(args[0], maxPage);

    const buildRows = (disabled = false) => [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('local:serverlist:prev')
          .setLabel('\u25C0')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page <= 1),

        new ButtonBuilder()
          .setCustomId('local:serverlist:next')
          .setLabel('\u25B6')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page >= maxPage),

        new ButtonBuilder()
          .setCustomId('local:serverlist:close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled)
      ),
    ];

    const msg = await message.reply({
      embeds          : [_buildServerListEmbed(guildId, guilds, page, maxPage, prefix)],
      components      : maxPage > 1 ? buildRows(false) : [],
      allowedMentions : { repliedUser: false },
    }).catch(() => null);

    if (!msg) return;

    if (maxPage <= 1) {
      if (deleteReply) {
        embed.scheduleDelete(msg, deleteDelay);
      }

      return;
    }

    embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

    const collector = msg.createMessageComponentCollector({
      filter: interaction =>
        interaction.user.id === message.author.id &&
        interaction.message.id === msg.id,
      idle: IDLE_MS,
      time: TIMEOUT_MS,
    });

    collector.on('collect', async interaction => {
      try {
        if (interaction.customId === 'local:serverlist:close') {
          collector.stop('closed');
          embed.clearPrivateInteraction(msg);
          await interaction.deferUpdate().catch(() => {});
          await message.delete().catch(() => {});
          return msg.delete().catch(() => {});
        }

        if (interaction.customId === 'local:serverlist:prev' && page > 1) {
          page--;
        }

        if (interaction.customId === 'local:serverlist:next' && page < maxPage) {
          page++;
        }

        return interaction.update({
          embeds     : [_buildServerListEmbed(guildId, guilds, page, maxPage, prefix)],
          components : buildRows(false),
        });
      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error('[serverlist] Erreur collector :', err?.message ?? err);
        }
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(msg);

      if (reason === 'closed') return;

      msg.edit({
        components: [],
      }).catch(() => {});

      if (deleteReply) {
        embed.scheduleDelete(msg, deleteDelay);
      }
    });
  },
};

function _getSortedGuilds(client) {
  return [...client.guilds.cache.values()]
    .sort((a, b) => {
      const joinedA = Number(a.joinedTimestamp || 0);
      const joinedB = Number(b.joinedTimestamp || 0);

      if (joinedA && joinedB && joinedA !== joinedB) {
        return joinedA - joinedB;
      }

      return a.name.localeCompare(b.name);
    });
}

function _buildServerListEmbed(guildId, guilds, page, maxPage, prefix) {
  const start = (page - 1) * PAGE_SIZE;
  const current = guilds.slice(start, start + PAGE_SIZE);

  const totalMembers = guilds.reduce((acc, guild) =>
    acc + Number(guild.memberCount || 0),
  0);

  const lines = current.map((guild, index) => {
    const number = start + index + 1;
    const members = Number(guild.memberCount || 0);

    return (
      `\`${number}.\` **${_escape(guild.name)}**\n` +
      `ID : \`${guild.id}\` - Membres : \`${members}\``
    );
  });

  return embed.build(
    guildId,
    lines.join('\n\n') || 'Aucun serveur sur cette page.',
    {
      title: 'Liste des serveurs',
      fields: [
        {
          name  : 'Résumé',
          value :
            `Serveurs : \`${guilds.length}\`\n` +
            `Membres : \`${totalMembers}\`\n` +
            `Page : \`${page}/${maxPage}\``,
          inline: false,
        },
        {
          name  : 'Commandes utiles',
          value :
            `\`${prefix}invite <ID/nombre>\`\n` +
            `\`${prefix}leave <ID/nombre>\``,
          inline: false,
        },
      ],
      footer    : `Page ${page}/${maxPage}`,
      timestamp : false,
    }
  );
}

function _parsePage(value, maxPage) {
  const page = Number.parseInt(value, 10);

  if (!Number.isInteger(page) || page <= 0) {
    return 1;
  }

  return Math.max(1, Math.min(page, maxPage));
}

function _escape(value) {
  return String(value || '')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\'')
    .slice(0, 80);
}

async function _sendError(message, content, deleteReply, deleteDelay) {
  const sent = await embed.replyError(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
