'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { levelFromXp, xpForLevel } = require('../../modules/levels');

exports.help = {
  name       : 'rank',
  description: 'Affiche ton niveau avec une belle interface.',
  use        : 'rank [@membre]',
  usage      : 'rank @membre',
  aliases    : ['profile', 'lvl', 'rang'],
  category   : 'levels',
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const member = message.mentions.members.first() ?? message.member;
  
  const data = db.getLevel(guildId, member.id);
  
  if (!data) {
    return embed.replyError(message, 'Aucune donnée trouvée pour ce membre.');
  }

  const config = db.getGuildConfig(guildId);
  let level = data.level;
  
  if (config?.levelCumul) {
    level = levelFromXp(data.xp);
  }

  const leaderboard = db.getLeaderboard(guildId, 500);
  let position = leaderboard.findIndex(row => row.userId === member.id);
  position = position === -1 ? 'Non classé' : `#${position + 1}`;

  let xpIntoLevel, xpNeeded, totalXp = data.xp;
  
  if (config?.levelCumul) {
    const currentLevelXp = _totalXpForLevel(level);
    const nextLevelXp = _totalXpForLevel(level + 1);
    xpIntoLevel = data.xp - currentLevelXp;
    xpNeeded = nextLevelXp - currentLevelXp;
  } else {
    let remaining = data.xp;
    for (let i = 0; i < level; i++) {
      remaining -= xpForLevel(i);
    }
    xpIntoLevel = remaining;
    xpNeeded = xpForLevel(level);
  }

  const percentage = Math.min(Math.round((xpIntoLevel / xpNeeded) * 100), 100);
  const progressBar = _createProgressBar(percentage);
  
  let rankColor;
  if (level >= 50) rankColor = '#1ABC9C';      
  else if (level >= 30) rankColor = '#3498DB'; 
  else if (level >= 15) rankColor = '#9B59B6'; 
  else if (level >= 5) rankColor = '#5865F2';  
  else rankColor = '#95A5A6';                   

  const rankEmbed = embed.build(guildId, null, {
    title: `${member.displayName}`,
    description: `Level **${level}** ・ ${position}`,
    color: rankColor,
    thumbnail: member.displayAvatarURL({ dynamic: true, size: 128 }),
    fields: [
      { 
        name: 'Progression', 
        value: `${progressBar}  ${percentage}%\n**${xpIntoLevel.toLocaleString()}** / **${xpNeeded.toLocaleString()}** XP`, 
        inline: false 
      },
      { 
        name: 'XP Total', 
        value: `${totalXp.toLocaleString()}`, 
        inline: true 
      },
      { 
        name: 'Messages', 
        value: `${(data.messages ?? 0).toLocaleString()}`, 
        inline: true 
      },
      { 
        name: 'Restant', 
        value: `${(xpNeeded - xpIntoLevel).toLocaleString()} XP`, 
        inline: true 
      },
    ],
    timestamp: false,
  });

  return message.reply({
    embeds: [rankEmbed],
    allowedMentions: { repliedUser: false },
  });
};

function _createProgressBar(percentage) {
  const filled = Math.round(percentage / 10);
  const empty = 10 - filled;
  
  return `${'●'.repeat(filled)}${'○'.repeat(empty)}`;
}


function _totalXpForLevel(level) {

  let total = 0;

  for (let i = 0; i < level; i++) {
    total += xpForLevel(i);
  }

  return total;

}
