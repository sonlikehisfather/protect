'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { levelFromXp, xpForLevel } = require('../../modules/levels');

const PAGE_SIZE  = 10;
const CUSTOM_ID  = 'leaderboard_page';


const TIMEOUT_MS = 5 * 60 * 1000;

exports.help = {
  name       : 'leaderboard',
  description: 'Afficher le classement des niveaux.',
  use        : 'leaderboard [page]',
  aliases    : ['lb', 'classement'],
  category   : 'levels',
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const page    = Math.max(parseInt(args[0], 10) || 1, 1);

  const payload = _buildLeaderboardPayload(guildId, page);

  if (payload.error) {
    return embed.replyError(message, payload.error);
  }

  const sent = await message.reply({
    embeds: [payload.embed],
    components: [payload.row],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (!sent) return;


  embed.registerPrivateInteraction(sent, message.author.id, TIMEOUT_MS);


  setTimeout(() => {
    embed.clearPrivateInteraction(sent);
    sent.edit({ components: [] }).catch(() => {});
  }, TIMEOUT_MS).unref?.();

  return sent;
};

exports.handleButton = async (interaction) => {
  const [prefix, guildId, action] = interaction.customId.split(':');

  if (prefix !== CUSTOM_ID) return;


  if (action === 'CLOSE') {
    embed.clearPrivateInteraction(interaction.message);
    return interaction.update({ components: [] }).catch(() => {});
  }

  const page    = Math.max(parseInt(action, 10) || 1, 1);
  const payload = _buildLeaderboardPayload(guildId, page);

  if (payload.error) {
    return interaction.update({
      embeds: [
        embed.build(guildId, payload.error, {
          title    : 'Leaderboard',
          timestamp: false,
        }),
      ],
      components: [],
    });
  }

  return interaction.update({
    embeds: [payload.embed],
    components: [payload.row],
  });
};


function _buildLeaderboardPayload(guildId, page) {
  const config  = db.getGuildConfig(guildId);
  const allRows = db.getLeaderboard(guildId, 1000).filter(row => (row.xp ?? 0) > 0);

  if (!allRows.length) {
    return { error: 'Aucun membre classé pour le moment.' };
  }

  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const start      = (safePage - 1) * PAGE_SIZE;
  const rows       = allRows.slice(start, start + PAGE_SIZE);

  const lines = rows.map((row, index) => {
    const position = start + index + 1;

    if (config.levelCumul) {
      const level       = levelFromXp(row.xp);
      const xpIntoLevel = _xpIntoCurrentLevel(level, row.xp);
      const xpNeeded    = _xpNeededForCurrentLevel(level);

      return (
        `\`#${position}\` <@${row.userId}>\n` +
        `Niveau \`${level}\` | XP \`${xpIntoLevel} / ${xpNeeded}\` | Messages \`${row.messages ?? 0}\``
      );
    }

    return (
      `\`#${position}\` <@${row.userId}>\n` +
      `Niveau \`${row.level}\` | XP total \`${row.xp}\` | Messages \`${row.messages ?? 0}\``
    );
  });

  const leaderboardEmbed = embed.build(
    guildId,
    lines.join('\n\n'),
    {
      title    : `Leaderboard - Page ${safePage}/${totalPages}`,
      timestamp: false,
    }
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID}:${guildId}:${safePage - 1}`)
      .setLabel('\u2190')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 1),

    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID}:${guildId}:${safePage + 1}`)
      .setLabel('\u2192')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages),

    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID}:${guildId}:CLOSE`)
      .setLabel('\u2716')
      .setStyle(ButtonStyle.Danger),
  );

  return {
    embed: leaderboardEmbed,
    row,
  };
}

function _xpIntoCurrentLevel(level, xp) {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpForLevel(i);
  return xp - total;
}

function _xpNeededForCurrentLevel(level) {
  return xpForLevel(level);
}
