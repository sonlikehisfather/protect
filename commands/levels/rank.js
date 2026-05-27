'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { levelFromXp, xpForLevel } = require('../../modules/levels');

exports.help = {
  name       : 'rank',
  description: 'Afficher votre niveau ou celui d\'un membre.',
  use        : 'rank [@membre]',
  aliases    : ['levelrank', 'rang'],
  category   : 'levels',
};

exports.run = async (client, message, args) => {

  const guildId = message.guild.id;

  const member =
    message.mentions.members.first()
    ?? message.member;

  const data = db.getLevel(guildId, member.id);

  if (!data) {
    return embed.replyError(
      message,
      'Aucune donnée trouvée pour ce membre.'
    );
  }


  const config = db.getGuildConfig(guildId);

  let level = data.level;

  if (config.levelCumul) {
    level = levelFromXp(data.xp);
  }


  const leaderboard =
    db.getLeaderboard(guildId, 500);

  let position = leaderboard.findIndex(
    row => row.userId === member.id
  );

  position = position === -1
    ? 'Non classé'
    : `#${position + 1}`;


  let xpIntoLevel;
  let xpNeeded;

  if (config.levelCumul) {
    const currentLevelXp = _totalXpForLevel(level);
    const nextLevelXp    = _totalXpForLevel(level + 1);

    xpIntoLevel = data.xp - currentLevelXp;
    xpNeeded    = nextLevelXp - currentLevelXp;
  } else {
    let remaining = data.xp;
    for (let i = 0; i < level; i++) {
      remaining -= xpForLevel(i);
    }

    xpIntoLevel = remaining;
    xpNeeded    = xpForLevel(level);
  }

  const fields = [

    {
      name  : 'Utilisateur',
      value : `<@${member.id}>`,
      inline: false,
    },

    {
      name  : 'Position',
      value : `\`${position}\``,
      inline: true,
    },

    {
      name  : 'Niveau',
      value : `\`${level}\``,
      inline: true,
    },

    {
      name  : 'XP',
      value : `\`${xpIntoLevel} / ${xpNeeded}\``,
      inline: false,
    },

    {
      name  : 'Messages',
      value : `\`${data.messages ?? 0}\``,
      inline: true,
    },

  ];

  return message.reply({
    embeds: [
      embed.build(guildId, null, {
        title    : 'Rank',
        fields,
        timestamp: false,
      }),
    ],
    allowedMentions: { repliedUser: false },
  });

};


function _totalXpForLevel(level) {

  let total = 0;

  for (let i = 0; i < level; i++) {
    total += xpForLevel(i);
  }

  return total;

}
