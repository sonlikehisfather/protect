'use strict';

const embed  = require('../../utils/embed');
const config = require('../../config.json');

exports.help = {
  name       : 'ghelp',
  description: 'Affiche l\'aide des commandes giveaway.',
  usage      : 'ghelp',
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  let prefix = config.prefix ?? '+';
  try {
    const db = require('../../core/database');
    prefix = db.getGuildConfig(guildId)?.prefix ?? prefix;
  } catch {}

  const e = embed.build(guildId, null, {
    title : 'Aide - Giveaways',
    fields: [
      {
        name  : `\`${prefix}gstart <durée> <gagnants> <prix> [#salon] [--config]\``,
        value : 'Créer un giveaway. Ajoutez `--config` pour ouvrir le panel de personnalisation (couleur, image, description, emoji…).',
        inline: false,
      },
      {
        name  : `\`${prefix}gend <id>\``,
        value : 'Terminer un giveaway en cours.',
        inline: false,
      },
      {
        name  : `\`${prefix}greroll <id>\``,
        value : 'Reroll un giveaway terminé.',
        inline: false,
      },
      {
        name  : `\`${prefix}ghelp\``,
        value : 'Affiche cette aide.',
        inline: false,
      },
    ],
    footer   : 'L\'ID correspond à l\'ID du message du giveaway.',
    timestamp: false,
  });

  return message.reply({ embeds: [e], allowedMentions: { repliedUser: false } });
};
