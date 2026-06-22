'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const PER_PAGE   = 10;
const IDLE_MS    = 120_000;
const TIMEOUT_MS = 300_000;

module.exports = {
  help: {
    name        : 'customlist',
    description : 'Liste les custom commands du serveur.',
    use         : 'customlist',
    usage       : 'customlist',
    aliases     : ['cclist', 'listcustoms'],
    category    : 'configserver',
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

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const customs = db.getAllCustomCommands(guildId);

    if (!customs || customs.length === 0) {
      const sent = await embed.reply(
        message,
        'Aucune custom command configurée.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const totalPages = Math.ceil(customs.length / PER_PAGE);
    let page = 0;

    const buildEmbed = () => {
      const start = page * PER_PAGE;
      const slice = customs.slice(start, start + PER_PAGE);

      const lines = slice.map((c, i) => {
        const index   = start + i + 1;
        const status  = c.enabled ? 'on' : 'off';
        const content = c.response
          ? _truncate(c.response, 40)
          : c.embedData ? 'embed' : 'vide';

        return `\`${index}.\` **${c.name}** - ${status} - ${content}`;
      });

      return embed.build(
        guildId,
        lines.join('\n'),
        {
          title     : `Custom commands (${customs.length})`,
          timestamp : false,
        }
      ).setFooter({ text: `Page ${page + 1}/${totalPages}` });
    };

    if (totalPages <= 1) {
      const sent = await message.reply({
        embeds          : [buildEmbed()],
        allowedMentions : { repliedUser: false, parse: [] },
      }).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const buildRows = (disabled = false) => [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('local:cclist:prev')
          .setLabel('\u2190')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page <= 0),

        new ButtonBuilder()
          .setCustomId('local:cclist:next')
          .setLabel('\u2192')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page >= totalPages - 1),

        new ButtonBuilder()
          .setCustomId('local:cclist:close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled)
      ),
    ];

    const msg = await message.reply({
      embeds          : [buildEmbed()],
      components      : buildRows(false),
      allowedMentions : { repliedUser: false, parse: [] },
    }).catch(() => null);

    if (!msg) return;

    embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

    const collector = msg.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id && i.message.id === msg.id,
      idle   : IDLE_MS,
      time   : TIMEOUT_MS,
    });

    collector.on('collect', async interaction => {
      try {
        if (interaction.customId === 'local:cclist:close') {
          collector.stop('closed');
          embed.clearPrivateInteraction(msg);
          await interaction.deferUpdate().catch(() => {});
          return msg.delete().catch(() => {});
        }

        if (interaction.customId === 'local:cclist:prev' && page > 0) page--;
        if (interaction.customId === 'local:cclist:next' && page < totalPages - 1) page++;

        return interaction.update({
          embeds     : [buildEmbed()],
          components : buildRows(false),
        });
      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error('[customlist] Erreur collector :', err?.message ?? err);
        }
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(msg);
      if (reason === 'closed') return;
      msg.edit({ components: [] }).catch(() => {});
    });
  },
};

function _truncate(value, max) {
  const text = String(value || '');
  const cut  = text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
  return embed.breakLongTokens(cut);
}
