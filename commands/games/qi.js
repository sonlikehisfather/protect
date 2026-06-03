'use strict';

const {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

const QI_CATEGORIES = [
  {
    min: 0, max: 50, label: 'Légume certifié', emoji: '🥔', color: '#8B4513',
    descs: [
      "T'as essayé d'allumer une bougie avec un stylo. Deux fois.",
      "T'arrives même pas à perdre correctement à Pierre-Feuille-Ciseaux.",
      "T'as demandé si l'eau sans bulles c'était de l'eau plate. On t'a dit oui. T'as pas cru.",
      "T'as relu ton propre message et t'as pas compris ce que t'avais voulu dire.",
      "Le sol te fait de la concurrence intellectuelle.",
    ],
  },
  {
    min: 51, max: 70, label: 'Sous-Sol du Podium', emoji: '🌾', color: '#DAA520',
    descs: [
      "T'es le genre de mec qui relit le mode d'emploi d'un verre d'eau.",
      "Ta seule contribution intellectuelle c'est d'exister et encore c'est discut.",
      "Les gens t'écoutent parler pour se sentir intelligents par comparaison.",
      "T'as séché le cours de respiration à l'école mais t'arrives quand même à survivre, respect.",
      "T'as mis 10 minutes à comprendre une blague que t'avais toi-même racontée.",
    ],
  },
  {
    min: 71, max: 85, label: 'Standard Gris Terne', emoji: '🍞', color: '#C0C0C0',
    descs: [
      "T'es pas con, t'es juste... là. Comme du pain de mie sans beurre.",
      "Dans une pièce de 10 personnes t'es le 6ème. Toujours le 6ème.",
      "Tu réfléchis avant de parler mais ça change rien au résultat.",
      "Ton cerveau est présent mais il pointe rarement.",
      "T'es la définition parfaite de 'ça aurait pu être pire'.",
    ],
  },
  {
    min: 86, max: 100, label: 'Normal (RIP)', emoji: '😐', color: '#808080',
    descs: [
      "T'es normal. C'est l'insulte la plus polie qu'on puisse te faire.",
      "Ni brillant ni con, t'as optimisé ta médiocrité jusqu'à la perfection.",
      "Tu fonctionnes, comme une vieille imprimante. Parfois.",
      "On te remarque pas, on t'oublie pas non plus. T'existes, c'est déjà ça.",
      "Ta vie intellectuelle c'est regarder les réponses après le quiz.",
    ],
  },
  {
    min: 101, max: 115, label: 'Petit Malin', emoji: '🦊', color: '#9B59B6',
    descs: [
      "T'as des éclairs de génie, mais en format économie d'énergie.",
      "T'es le gars qui trouve la solution 3 heures après que quelqu'un l'ait déjà trouvée.",
      "Ton cerveau marche bien, il préfère juste pas trop se fatiguer.",
      "T'es futé mais t'utilises ça pour éviter le travail plutôt que pour bosser.",
      "T'arrives à avoir raison une fois sur deux. C'est une performance.",
    ],
  },
  {
    min: 116, max: 130, label: 'Cerveau Actif', emoji: '🧠', color: '#3498DB',
    descs: [
      "Pendant que les autres bavaient sur leur clavier t'avais déjà fini l'examen.",
      "T'expliques des trucs aux gens et tu vois dans leurs yeux qu'ils comprennent rien. T'es habitué.",
      "Tu lis les conditions générales d'utilisation. Pas en entier, mais quand même.",
      "Tes potes te demandent de faire leur CV. Tu le fais mieux que le leur.",
      "T'es pas Einstein mais t'es clairement pas dans le même couloir que les légumes du bas.",
    ],
  },
  {
    min: 131, max: 145, label: 'Très Intelligent', emoji: '🎓', color: '#E91E63',
    descs: [
      "Pendant qu'ils jouent aux Lego, toi tu construis des arguments logiques au petit-déj.",
      "T'as lu Nietzsche par curiosité. T'étais déçu que ce soit si simple.",
      "Tu corriges les profs poliment. En vrai t'as toujours raison mais t'essaies d'être sympa.",
      "Tu regardes les gens faire des erreurs en sachant déjà comment ça va finir. T'attends juste.",
      "T'as le QI d'un chirurgien mais t'utilises ça pour gagner aux jeux de société.",
    ],
  },
  {
    min: 146, max: 160, label: 'Génie Certifié', emoji: '⚡', color: '#F1C40F',
    descs: [
      "Pendant que les autres bavent sur leurs claviers, toi tu résous leurs problèmes par accident.",
      "Tu baises leurs mères intellectuellement pendant qu'ils cherchent encore l'interrupteur.",
      "T'as 3 longueurs d'avance sur tout le monde. T'attends qu'ils arrivent à ta hauteur depuis des années.",
      "Les gens pensent que t'as de la chance. Non, t'as juste 5 étapes d'avance sur tout le monde.",
      "Tu penses plus vite que les autres parlent. C'est fatiguant mais c'est ton destin.",
    ],
  },
  {
    min: 161, max: 180, label: 'Super-Génie', emoji: '🚀', color: '#FF5722',
    descs: [
      "Pendant qu'ils bavaient encore sur leur cours, t'avais déjà réécrit le programme.",
      "T'as un niveau de pensée tellement supérieur que t'arrives même plus à avoir une conversation normale.",
      "Tu regardes les débats politiques comme un adulte qui regarde des enfants se disputer un jouet.",
      "La NASA t'a contacté. T'as décliné parce que c'était pas assez stimulant.",
      "T'as compris la blague avant qu'on la finisse. Et elle était nulle. T'as quand même ri par politesse.",
    ],
  },
  {
    min: 181, max: 200, label: 'Être Supérieur', emoji: '👽', color: '#00FF00',
    descs: [
      "T'es pas humain. Enfin si, biologiquement, mais c'est là que s'arrête la ressemblance.",
      "Tu dors 4h et ton cerveau tourne encore mieux que leurs cerveaux après 12h de repos.",
      "T'expliques quelque chose une seule fois. Si t'es gentil.",
      "Les autres t'énervent pas, ils te divertissent. Comme un zoo intellectuel.",
      "T'as pensé à 47 solutions possibles pendant qu'ils cherchaient encore à formuler le problème.",
    ],
  },
  {
    min: 201, max: 999, label: 'Entité Cosmique', emoji: '☄️', color: '#FFD700',
    descs: [
      "Chuck Norris a un poster de toi.",
      "T'as pas besoin de réfléchir, les réponses viennent d'elles-mêmes comme des sujets soumis.",
      "Pendant qu'ils bavent encore sur leurs neurones morts, toi t'as déjà résolu des problèmes qui existent pas encore.",
      "Tu transcendes le concept de QI. Le test était trop petit pour toi.",
      "Les dieux de l'Olympe ont créé un compte Discord pour te poser des questions.",
    ],
  },
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

  const guildConfig = require('../../core/database').getGuildConfig(guildId); // eslint-disable-line
  const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
  const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
  const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const target = message.mentions.members?.first() || message.member;
  const isSelf = target.id === message.author.id;

  const qi  = generateQi(target.id);
  const cat  = getCategory(qi);
  const desc = cat.descs[Math.floor(Math.random() * cat.descs.length)];

  const bar = '█'.repeat(Math.min(Math.floor(qi / 10), 25)) + '░'.repeat(Math.max(25 - Math.floor(qi / 10), 0));

  let sent;
  if (V2_AVAILABLE) {
    const body = [
      `## ${cat.emoji} Test de QI`,
      ``,
      `**Sujet** : <@${target.id}>`,
      `**QI** : ${qi}`,
      ``,
      `\`${bar}\``,
      ``,
      `**Catégorie** : ${cat.label}`,
      `> ${desc}`,
    ].join('\n');
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    sent = await message.reply({
      components      : [container],
      flags           : COMPONENTS_V2_FLAG,
      allowedMentions : { parse: [] },
    }).catch(() => null);
  } else {
    sent = await message.reply({
      embeds: [
        embed.build(guildId, null, {
          title  : `${cat.emoji} Test de QI`,
          fields : [
            { name: 'Sujet',     value: `<@${target.id}>`,  inline: true  },
            { name: 'QI',        value: `**${qi}**`,         inline: true  },
            { name: 'Barre',     value: `\`${bar}\``,       inline: false },
            { name: 'Catégorie', value: `**${cat.label}**`, inline: true  },
            { name: 'Verdict',   value: desc,                inline: false },
          ],
          color  : cat.color,
          timestamp: false,
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};
