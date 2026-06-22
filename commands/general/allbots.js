'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');

const PAGE_SIZE  = 15;
const IDLE_MS    = 300_000;
const TIMEOUT_MS = 900_000;

module.exports = {
  help: {
    name        : 'allbots',
    description : 'Affiche la liste des bots présents sur le serveur.',
    usage       : 'allbots',
    aliases     : ['botlist', 'bots'],
  },

  async run(client, message) {

    const guild = message.guild;
    if (!guild) return;

    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    if (guild.members.cache.size === 0) {
      await guild.members.fetch().catch(() => null);
    }

    const bots = guild.members.cache
      .filter(member => member.user.bot)
      .sort((a, b) =>
        a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' })
      )
      .map(member => formatBotLine(member));

    if (!bots.length) {

      const sent = await message.channel.send({
        embeds: [
          embed.build(
            guildId,
            null,
            {
              title  : 'Bots du serveur',
              fields : [
                {
                  name  : 'Résultat',
                  value : 'Aucun bot n’a été trouvé sur ce serveur.',
                  inline: false,
                },
              ],
              timestamp : false,
            }
          )
        ],
        allowedMentions: {
          repliedUser: false,
        },
      }).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const pages = chunkArray(bots, PAGE_SIZE);
    let page = 0;

    const buildEmbed = () => embed.build(
      guildId,
      null,
      {
        title  : 'Bots du serveur',
        fields : [
          {
            name  : 'Bots',
            value : String(bots.length),
            inline: true,
          },
          {
            name  : 'Liste',
            value : pages[page].join('\n'),
            inline: false,
          },
        ],
        footer    : `Page ${page + 1}/${pages.length}`,
        timestamp : false,
      }
    );

    const buildRows = (disabled = false) => [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('allbots:prev')
          .setLabel('\u2190')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page === 0),

        new ButtonBuilder()
          .setCustomId('allbots:next')
          .setLabel('\u2192')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page >= pages.length - 1),

        new ButtonBuilder()
          .setCustomId('allbots:close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled),
      ),
    ];

    const sent = await message.channel.send({
      embeds     : [buildEmbed()],
      components : pages.length > 1 ? buildRows() : [],
      allowedMentions: {
        repliedUser: false,
      },
    }).catch(() => null);

    if (!sent) return;

    if (deleteReply && pages.length <= 1) {
      embed.scheduleDelete(sent, deleteDelay);
    }

    if (pages.length <= 1) {
      return;
    }

    embed.registerPrivateInteraction(sent, message.author.id, TIMEOUT_MS);

    const collector = sent.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id,
      idle   : IDLE_MS,
      time   : TIMEOUT_MS,
    });

    collector.on('collect', async interaction => {
      try {

        if (interaction.customId === 'allbots:close') {
          await interaction.deferUpdate().catch(() => {});
          embed.clearPrivateInteraction(sent);
          collector.stop('closed');
          return sent.delete().catch(() => {});
        }

        if (interaction.customId === 'allbots:prev' && page > 0) {
          page--;
        }

        if (interaction.customId === 'allbots:next' && page < pages.length - 1) {
          page++;
        }

        await interaction.update({
          embeds     : [buildEmbed()],
          components : buildRows(),
        });

      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error(err);
        }
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(sent);
      if (reason === 'closed') return;

      sent.edit({
        components: [],
      }).catch(() => {});

    });
  },
};

function formatBotLine(member) {
  const suffix =
    member.displayName &&
    member.displayName !== member.user.username
      ? ` (@${member.user.username})`
      : '';

  return `\u2022 <@${member.id}>${suffix}`;
}

function chunkArray(array, size) {

  const chunks = [];

  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }

  return chunks;

}
