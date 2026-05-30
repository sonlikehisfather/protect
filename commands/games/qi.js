'use strict';


const embed = require('../../utils/embed');

const QI_CATEGORIES = [
  { min: 0,   max: 50,  label: 'Légende de la gaffe',       emoji: '🥔', color: '#8B4513', desc: 'Tu confonds la 6ème et la 4ème dimension. C\'est pas grave... enfin si.' },
  { min: 51,  max: 70,  label: 'Champion du village',       emoji: '🌾', color: '#DAA520', desc: 'Tu brilles par ton absence de réflexion. On t\'aime quand même.' },
  { min: 71,  max: 85,  label: 'Standard basique',          emoji: '🍞', color: '#C0C0C0', desc: 'Tu es parfaitement... moyen. Dans une foule, tu disparais.' },
  { min: 86,  max: 100, label: 'Normal',                    emoji: '😐', color: '#808080', desc: 'Ni bon, ni mauvais. Tu fais le job, mais sans plus.' },
  { min: 101, max: 115, label: 'Assez futé',                emoji: '🦊', color: '#9B59B6', desc: 'Tu surprends parfois avec une réponse intelligente.' },
  { min: 116, max: 130, label: 'Intelligent',               emoji: '🧠', color: '#3498DB', desc: 'Tu résous des équations pendant que les autres comptent sur leurs doigts.' },
  { min: 131, max: 145, label: 'Très intelligent',          emoji: '🎓', color: '#E91E63', desc: 'Einstein te regarderait avec respect. Ou jalousie.' },
  { min: 146, max: 160, label: 'Génie',                     emoji: '⚡', color: '#F1C40F', desc: 'Tes neurones ont des abdos. T\'es une machine à penser.' },
  { min: 161, max: 180, label: 'Super-Génie',               emoji: '🚀', color: '#FF5722', desc: 'NASA veut te recruter. SpaceX aussi. T\'es trop fort.' },
  { min: 181, max: 200, label: 'Surhumain',                 emoji: '👽', color: '#00FF00', desc: 'Tu viens d\'une autre planète. Personne ne te comprend.' },
  { min: 201, max: 999, label: 'Divinité',                  emoji: '☄️', color: '#FFD700', desc: 'Tu transcends l\'humanité. Chuck Norris te demande des conseils.' },
];

function getCategory(qi) {
  return QI_CATEGORIES.find(cat => qi >= cat.min && qi <= cat.max) || QI_CATEGORIES[0];
}

function generateQi(userId) {
  const rand = Math.random();
  let qi;
  
  if (rand < 0.05) qi = Math.floor(Math.random() * 50);        // 5% très bas
  else if (rand < 0.15) qi = Math.floor(Math.random() * 20) + 51;  // 10% bas
  else if (rand < 0.35) qi = Math.floor(Math.random() * 15) + 71;  // 20% moyen-bas
  else if (rand < 0.55) qi = Math.floor(Math.random() * 15) + 86;  // 20% moyen
  else if (rand < 0.75) qi = Math.floor(Math.random() * 15) + 101; // 20% moyen-haut
  else if (rand < 0.90) qi = Math.floor(Math.random() * 15) + 116; // 15% intelligent
  else if (rand < 0.97) qi = Math.floor(Math.random() * 15) + 131; // 7% très intelligent
  else if (rand < 0.995) qi = Math.floor(Math.random() * 20) + 146; // 2.5% génie
  else qi = Math.floor(Math.random() * 50) + 166; // 0.5% surhumain/dieu

  return Math.min(qi, 250);
}

exports.help = {
  name        : 'qi',
  description : 'Découvre ton QI et ta catégorie mentale.',
  use         : 'qi [@membre]',
  usage       : 'qi [@membre]',
  aliases     : ['iq', 'intel', 'intelligence'],
  category    : 'games',
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;

  const guildConfig = require('../../core/database').getGuildConfig(guildId);
  const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
  const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
  const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const target = message.mentions.members?.first() || message.member;
  const isSelf = target.id === message.author.id;

  const qi = generateQi(target.id);
  const cat = getCategory(qi);

  const bar = '█'.repeat(Math.min(Math.floor(qi / 10), 25)) + '░'.repeat(Math.max(25 - Math.floor(qi / 10), 0));

  const sent = await message.reply({
    embeds: [
      embed.build(guildId, null, {
        title  : `${cat.emoji} Test de QI`,
        fields : [
          { name: 'Sujet', value: `<@${target.id}>`, inline: true },
          { name: 'QI', value: `**${qi}**`, inline: true },
          { name: 'Barre', value: `\`${bar}\``, inline: false },
          { name: 'Catégorie', value: `**${cat.label}**`, inline: true },
          { name: 'Verdict', value: cat.desc, inline: false },
        ],
        color  : cat.color,
        timestamp: false,
      }),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};
