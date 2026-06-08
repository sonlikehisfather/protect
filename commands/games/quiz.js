'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const embed = require('../../utils/embed');
const db    = require('../../core/database');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

const QUESTIONS = [
  // ==== SCIENCES ====
  { q: 'Le Soleil est une étoile.', a: true },
  { q: 'La Terre est plate.', a: false },
  { q: 'L\'eau bout à 100°C au niveau de la mer.', a: true },
  { q: 'L\'araignée est un insecte.', a: false },
  { q: 'Les tomates sont des fruits.', a: true },
  { q: 'Les bananes poussent sur des arbres.', a: false },
  { q: 'Un kilogramme de plumes pèse moins qu\'un kilo de plomb.', a: false },
  { q: 'La lumière voyage plus vite que le son.', a: true },
  { q: 'Les humains n\'utilisent que 10% de leur cerveau.', a: false },
  { q: 'L\'or est un métal liquide à température ambiante.', a: false },
  { q: 'Les diamants sont faits de carbone pur.', a: true },
  { q: 'La Grande Muraille de Chine est visible depuis l\'espace.', a: false },
  { q: 'Les éléphants sont les plus grands mammifères terrestres.', a: true },
  { q: 'Les requins sont des mammifères.', a: false },
  { q: 'La photosynthèse produit de l\'oxygène.', a: true },
  { q: 'Les abeilles meurent après avoir piqué.', a: true },
  { q: 'La vitesse de la lumière est d\'environ 300 000 km/s.', a: true },
  { q: 'Les pandas mangent uniquement du bambou.', a: true },
  { q: 'Le cerveau humain pèse environ 1.5 kg.', a: true },
  { q: 'Les chauves-souris sont aveugles.', a: false },
  { q: 'Les girafes ont autant de vertèbres cervicales que les humains.', a: true },
  { q: 'Les crocodiles peuvent vivre 100 ans.', a: true },
  { q: 'Les hippocampes mâles portent les bébés.', a: true },
  { q: 'La faille de San Andreas est la plus grande faille terrestre.', a: false },
  { q: 'Les volcans du système solaire les plus actifs sont sur Io, satellite de Jupiter.', a: true },
  { q: 'La lave du volcan Kilauea à Hawaï peut atteindre 1200°C.', a: true },
  { q: 'Les bactéries sont plus grandes que les virus.', a: true },
  { q: 'L\'ADN humain est à 50% identique à celui d\'une banane.', a: true },
  { q: 'Les coraux sont des animaux.', a: true },
  { q: 'Les narvals ont une seule défense.', a: true },
  { q: 'Les morses vivent dans l\'Antarctique.', a: false },
  { q: 'Les caméléons changent de couleur uniquement pour se camoufler.', a: false },
  { q: 'Les colibris peuvent voler en arrière.', a: true },
  { q: 'Les limaces ont 4 nez.', a: true },
  { q: 'Les étoiles de mer n\'ont pas de cerveau.', a: true },
  { q: 'Les koalas ont des empreintes digitales presque identiques aux humains.', a: true },

  // ==== HISTOIRE ====
  { q: 'L\'humanité a marché sur la Lune en 1969.', a: true },
  { q: 'La Joconde est exposée au Louvre.', a: true },
  { q: 'Napoléon était petit (moins d\'1m60).', a: false },
  { q: 'La Révolution française a commencé en 1789.', a: true },
  { q: 'Christophe Colomb a découvert l\'Amérique en 1492.', a: true },
  { q: 'Les pyramides d\'Égypte ont été construites par des esclaves.', a: false },
  { q: 'Jules César a été empereur de Rome.', a: false },
  { q: 'La Première Guerre mondiale a duré de 1914 à 1918.', a: true },
  { q: 'Le mur de Berlin est tombé en 1991.', a: false },
  { q: 'Marie Curie a reçu deux prix Nobel.', a: true },
  { q: 'L\'homme de Néandertal est un ancêtre direct de l\'homme moderne.', a: false },
  { q: 'L\'Empire romain a duré plus de 1000 ans.', a: true },
  { q: 'Vercingétorix a vaincu César à Alésia.', a: false },
  { q: 'La peste noire a tué un tiers de la population européenne.', a: true },
  { q: 'Louis XIV surnommé le Roi Soleil a régné 72 ans.', a: true },
  { q: 'La Bastille était une prison pour criminels dangereux.', a: false },
  { q: 'Marie-Antoinette a dit "Qu\'ils mangent de la brioche".', a: false },
  { q: 'L\'empire mongol était le plus grand empire terrestre de l\'histoire.', a: true },
  { q: 'Les samouraïs étaient des guerriers chinois.', a: false },
  { q: 'La Seconde Guerre mondiale a commencé en 1939.', a: true },
  { q: 'Le Titanic a coulé en 1910.', a: false },
  { q: 'Leonard de Vinci a peint la Chapelle Sixtine.', a: false },
  { q: 'Mozart a composé sa première symphonie à 8 ans.', a: true },
  { q: 'Isaac Newton a découvert la gravité quand une pomme lui est tombée sur la tête.', a: true },
  { q: 'La Renaissance a commencé en Italie.', a: true },
  { q: 'L\'ancienne capitale du Japon était Kyoto.', a: true },
  { q: 'Les Vikings portaient des casques à cornes.', a: false },
  { q: 'La Grande Dépression a commencé en 1929.', a: true },
  { q: 'Albert Einstein a reçu le prix Nobel de physique.', a: true },
  { q: 'La première photographie date de 1826.', a: true },

  // ==== GÉOGRAPHIE ====
  { q: 'Le Mont Everest est en France.', a: false },
  { q: 'Paris est la capitale de l\'Italie.', a: false },
  { q: 'Le Nil est le plus long fleuve du monde.', a: true },
  { q: 'L\'Australie est un continent.', a: true },
  { q: 'La Russie est le plus grand pays du monde.', a: true },
  { q: 'Les pingouins vivent au Pôle Nord.', a: false },
  { q: 'Le Sahara est le plus grand désert du monde.', a: false },
  { q: 'Le Japon est un archipel.', a: true },
  { q: 'La Tour Eiffel a été construite pour l\'Exposition universelle de 1889.', a: true },
  { q: 'La capitale de l\'Australie est Sydney.', a: false },
  { q: 'L\'Antarctique est le continent le plus froid.', a: true },
  { q: 'Le Vatican est le plus petit pays du monde.', a: true },
  { q: 'Le lac Baïkal est le lac le plus profond du monde.', a: true },
  { q: 'La Méditerranée est une mer intérieure.', a: true },
  { q: 'Les Émirats arabes unis sont dans l\'Afrique.', a: false },
  { q: 'La capitale du Canada est Toronto.', a: false },
  { q: 'La frontière entre les USA et le Mexique est la plus longue du monde.', a: false },
  { q: 'La Grande Barrière de Corail est en Australie.', a: true },
  { q: 'L\'Everest s\'élève à plus de 8 800 mètres.', a: true },
  { q: 'Le désert de Gobi est en Inde.', a: false },
  { q: 'La capitale de la Thaïlande est Bangkok.', a: true },
  { q: 'L\'Islande est couverte de glace.', a: false },
  { q: 'La plus grande île du monde est le Groenland.', a: true },
  { q: 'Le fleuve Amazone déverse plus d\'eau que tous les autres fleuves réunis.', a: true },
  { q: 'Le kilimandjaro est le plus haut sommet d\'Afrique.', a: true },

  // ==== CULTURE GÉNÉRALE ====
  { q: 'Les koalas sont des ours.', a: false },
  { q: 'Les dauphins sont des mammifères.', a: true },
  { q: 'Le chocolat est toxique pour les chiens.', a: true },
  { q: 'La Joconde n\'a pas de sourcils.', a: true },
  { q: 'Les chevaux peuvent dormir debout.', a: true },
  { q: 'Les chats ont 9 vies.', a: false },
  { q: 'Les escargots peuvent dormir 3 ans.', a: true },
  { q: 'Les perroquets peuvent parler.', a: true },
  { q: 'Les tortues peuvent sortir de leur carapace.', a: false },
  { q: 'Les rennes existent vraiment.', a: true },
  { q: 'Les loutres se tiennent la main quand elles dorment.', a: true },
  { q: 'Les mâles des hippocampes portent les œufs.', a: true },
  { q: 'Les mouches ont une durée de vie de 24 heures.', a: false },
  { q: 'Les pandas ont 6 doigts.', a: true },
  { q: 'Les poulpes ont trois cœurs.', a: true },
  { q: 'Les serpents sont sourds.', a: true },
  { q: 'Les éléphants ont peur des souris.', a: false },
  { q: 'Les chouettes sont les seuls oiseaux qui voient le bleu.', a: false },
  { q: 'Les singes peuvent voir toutes les couleurs.', a: true },
  { q: 'Les papillons goûtent avec leurs pattes.', a: true },
  { q: 'Les fourmis ne dorment jamais.', a: false },
  { q: 'Les poissons rouges ont une mémoire de 3 secondes.', a: false },
  { q: 'Les autruches enterrent leur tête dans le sable.', a: false },
  { q: 'Les taureaux voient rouge.', a: false },
  { q: 'Les dauphins dorment avec un œil ouvert.', a: true },
  { q: 'Les grenouilles boivent par la peau.', a: true },
  { q: 'Les flamants roses sont roses car ils mangent des crevettes.', a: true },
  { q: 'Les hiboux sont des symboles de sagesse dans toutes les cultures.', a: false },

  // ==== SPORTS ====
  { q: 'La FIFA organise la Coupe du Monde de football.', a: true },
  { q: 'Le tennis se joue avec des balles jaunes.', a: true },
  { q: 'Le marathon fait 42.195 kilomètres.', a: true },
  { q: 'Le basketball a été inventé au Canada.', a: false },
  { q: 'La NBA est une ligue européenne.', a: false },
  { q: 'Le Tour de France se termine sur les Champs-Élysées.', a: true },
  { q: 'Les JO d\'été de 2024 sont à Paris.', a: true },
  { q: 'Le rugby se joue avec un ballon ovale.', a: true },
  { q: 'Le golf se joue sur 18 trous.', a: true },
  { q: 'La boxe anglaise autorise les coups de pied.', a: false },
  { q: 'Le hockey sur glace se joue avec une rondelle.', a: true },
  { q: 'Le cricket est le sport le plus populaire en Inde.', a: true },
  { q: 'Le badminton se joue avec une volante.', a: true },
  { q: 'La natation synchronisée est un sport olympique.', a: true },
  { q: 'Le football américain utilise un ballon rond.', a: false },
  { q: 'Le judo vient du Japon.', a: true },
  { q: 'La Formule 1 est le championnat de rallye.', a: false },
  { q: 'Les fléchettes se jouent avec des fléchettes en plastique.', a: false },
  { q: 'Le sumo est un sport japonais.', a: true },
  { q: 'La lutte libre est un sport olympique.', a: true },
  { q: 'Le curling se joue sur glace.', a: true },
  { q: 'Le polo se joue à cheval.', a: true },
  { q: 'L\'escrime utilise trois types d\'armes.', a: true },
  { q: 'La gymnastique rythmique utilise des agrès.', a: true },
  { q: 'Le saut à ski se fait avec des skis courts.', a: false },

  // ==== ALIMENTATION ====
  { q: 'Le miel ne périme jamais.', a: true },
  { q: 'Les carottes rendent la vue meilleure.', a: false },
  { q: 'Le chocolat noir est bon pour le cœur.', a: true },
  { q: 'Les pommes de terre sont des légumes.', a: false },
  { q: 'Le café est un fruit.', a: true },
  { q: 'Les fraises sont des baies.', a: true },
  { q: 'Les cacahuètes sont des noix.', a: false },
  { q: 'Le safran est l\'épice la plus chère du monde.', a: true },
  { q: 'Le pain blanc est plus ancien que le pain complet.', a: false },
  { q: 'Les œufs sont des produits laitiers.', a: false },
  { q: 'Le thé vert contient de la caféine.', a: true },
  { q: 'Le wasabi japonais authentique est rare.', a: true },
  { q: 'Les pâtes instantanées ont été inventées au Japon.', a: true },
  { q: 'Le sushi traditionnel ne contient pas de saumon.', a: true },
  { q: 'La pizza Margherita est aux couleurs de l\'Italie.', a: true },
  { q: 'Le foie gras vient du foie d\'oie ou de canard.', a: true },
  { q: 'Le vinaigre balsamique traditionnel vieillit au moins 12 ans.', a: true },
  { q: 'Le chocolat blanc contient du cacao.', a: false },
  { q: 'Les cornichons sont des concombres fermentés.', a: true },
  { q: 'Le ketchup était à l\'origine une sauce chinoise.', a: true },
  { q: 'Les baies de goji viennent de la Chine.', a: true },
  { q: 'L\'avocat est un fruit.', a: true },
  { q: 'Le sushi peut se manger avec les doigts.', a: true },
  { q: 'Le fromage le plus populaire au monde est le cheddar.', a: false },
  { q: 'Le pain quotidien des Romains était à base d\'orge.', a: true },

  // ==== TECHNOLOGIE ====
  { q: 'Le premier iPhone est sorti en 2007.', a: true },
  { q: 'Google a été fondé dans un garage.', a: true },
  { q: 'Le WiFi utilise des ondes radio.', a: true },
  { q: 'Bitcoin est une monnaie physique.', a: false },
  { q: 'Le premier email a été envoyé en 1971.', a: true },
  { q: 'Le QR code est japonais.', a: true },
  { q: 'Les robots Asimo sont fabriqués par Toyota.', a: false },
  { q: 'La première souris d\'ordinateur était en bois.', a: true },
  { q: 'Le clavier QWERTY a été conçu pour ralentir la frappe.', a: true },
  { q: 'Le premier site web est toujours en ligne.', a: true },
  { q: 'Les virus informatiques peuvent infecter les humains.', a: false },
  { q: 'L\'intelligence artificielle existe depuis les années 1950.', a: true },
  { q: 'Les écrans OLED consomment plus que les LCD.', a: false },
  { q: 'Le cloud computing stocke des données sur des serveurs distants.', a: true },
  { q: 'Les mots de passe plus longs sont plus sécurisés.', a: true },
  { q: 'Le premier jeu vidéo était Pong.', a: false },
  { q: 'Les émojis sont japonais.', a: true },
  { q: 'Le dark web et le deep web sont la même chose.', a: false },
  { q: 'La 5G est plus rapide que la 4G.', a: true },
  { q: 'Les ordinateurs quantiques utilisent des bits classiques.', a: false },
  { q: 'Le premier disque dur avait une capacité de 5 Mo.', a: true },
  { q: 'Linux a été créé par Linus Torvalds.', a: true },
  { q: 'Les CAPTCHA sont utilisés pour empêcher les bots.', a: true },
  { q: 'Le phishing est une technique de piratage.', a: true },
  { q: 'Les hologrammes existent vraiment.', a: true },

  // ==== ESPACE ====
  { q: 'Pluton est toujours considéré comme une planète.', a: false },
  { q: 'La Lune s\'éloigne de la Terre chaque année.', a: true },
  { q: 'Un jour sur Vénus dure plus longtemps qu\'une année sur Vénus.', a: true },
  { q: 'Mars est la planète la plus chaude.', a: false },
  { q: 'Jupiter a 79 lunes connues.', a: true },
  { q: 'Les anneaux de Saturne sont faits de glace et de roche.', a: true },
  { q: 'La Voie lactée est une galaxie spirale.', a: true },
  { q: 'Le Soleil représente 99% de la masse du système solaire.', a: true },
  { q: 'Un trou noir absorbe la lumière.', a: true },
  { q: 'La Station spatiale internationale tourne autour de la Terre en 90 minutes.', a: true },
  { q: 'Neptune est la planète la plus venteuse.', a: true },
  { q: 'Mercure est la planète la plus proche du Soleil mais pas la plus chaude.', a: true },
  { q: 'Uranus tourne sur le côté.', a: true },
  { q: 'La ceinture d\'astéroïdes est entre Mars et Jupiter.', a: true },
  { q: 'Une supernova est l\'explosion d\'une étoile.', a: true },
  { q: 'La gravité zéro n\'existe pas dans l\'espace.', a: true },
  { q: 'Les astronautes grandissent dans l\'espace.', a: true },
  { q: 'La sonde Voyager 1 a quitté le système solaire.', a: true },
  { q: 'Le télescope Hubble est en orbite depuis 1990.', a: true },
  { q: 'Espace signifie vide total.', a: false },
  { q: 'Les comètes sont des boules de glace sale.', a: true },
  { q: 'La poussière lunaire sent le poudre à canon.', a: true },
  { q: 'Un jour sur Mercure dure 176 jours terrestres.', a: true },
  { q: 'Titan est une lune de Saturne avec une atmosphère.', a: true },
  { q: 'Les étoiles filantes sont des météorites.', a: true },
];

exports.help = {
  name        : 'quiz',
  description : 'Quiz Vrai/Faux — 5 questions de culture générale.',
  use         : 'quiz',
  usage       : 'quiz',
  aliases     : ['question', 'trivia'],
  category    : 'games',
};

exports.run = async (client, message, args) => {
  const guildId     = message.guild.id;
  const guildConfig = db.getGuildConfig(guildId);
  const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
  const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
  const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

  if (deleteCmd) await message.delete().catch(() => {});

  const questions = QUESTIONS.sort(() => Math.random() - 0.5).slice(0, 5);
  let current = 0;
  let score   = 0;

  const _btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('quiz:true').setLabel('✔ VRAI').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('quiz:false').setLabel('✖ FAUX').setStyle(ButtonStyle.Danger),
  );

  const _buildV2Question = () => {
    const q    = questions[current];
    const body = [
      `## ❓ Question ${current + 1}/5`,
      ``,
      `**${q.q}**`,
      ``,
      `*Cette affirmation est VRAIE ou FAUSSE ?*`,
      ``,
      `🎯 Score : **${score}/${current}**`,
    ].join('\n');
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(1))
      .addActionRowComponents(_btnRow);
    return { components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
  };

  const sent = V2_AVAILABLE
    ? await message.reply(_buildV2Question()).catch(() => null)
    : await message.reply({
        embeds: [embed.build(guildId, null, {
          title : `❓ Question 1/5`,
          fields: [
            { name: '📜 Question',    value: `**${questions[0].q}**`,                            inline: false },
            { name: '🎯 Score',       value: `${score}/${current}`,                              inline: true  },
          ],
          color: '#9B59B6', timestamp: false,
        })],
        components: [_btnRow],
        allowedMentions: { parse: [] },
      }).catch(() => null);

  if (!sent) return;

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId.startsWith('quiz:') && i.user.id === message.author.id,
    time: 60_000,
  });

  collector.on('collect', async interaction => {
    await interaction.deferUpdate().catch(() => {});

    const q         = questions[current];
    const answered  = interaction.customId === 'quiz:true';
    const isCorrect = answered === q.a;
    const answer    = q.a ? 'VRAI' : 'FAUX';

    if (isCorrect) score++;
    current++;

    if (V2_AVAILABLE) {
      const feedbackBody = isCorrect
        ? `✔ **Bonne réponse !**\n> **${q.q}** est bien **${answer}** !`
        : `✖ **Mauvaise réponse !**\n> La réponse était **${answer}**.`;
      const feedbackContainer = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(feedbackBody));
      await sent.edit({ components: [feedbackContainer], flags: COMPONENTS_V2_FLAG }).catch(() => {});
      await new Promise(r => setTimeout(r, 1200));
    }

    if (current >= questions.length) {
      collector.stop('done');
      return;
    }

    if (V2_AVAILABLE) {
      await sent.edit(_buildV2Question()).catch(() => {});
    } else {
      const q2 = questions[current];
      await sent.edit({
        embeds: [embed.build(guildId, null, {
          title : `❓ Question ${current + 1}/5`,
          fields: [
            { name: '📜 Question', value: `**${q2.q}**`,      inline: false },
            { name: '🎯 Score',    value: `${score}/${current}`, inline: true  },
          ],
          color: '#9B59B6', timestamp: false,
        })],
      }).catch(() => {});
    }
  });

  collector.on('end', async (_, reason) => {
    let emoji, title, desc, xpGain;
    if (score === 5)       { emoji = '🥇'; title = 'PARFAIT !';         desc = `**5/5** — Incroyable !`;          xpGain = 100; }
    else if (score === 4)  { emoji = '🌟'; title = 'EXCELLENT !';       desc = `**4/5** — Presque parfait !`;     xpGain = 80;  }
    else if (score === 3)  { emoji = '👍'; title = 'PAS MAL !';         desc = `**3/5** — Bonne culture générale.`; xpGain = 60; }
    else if (score >= 1)   { emoji = '📖'; title = 'PEUT MIEUX FAIRE';  desc = `**${score}/5** — Continue !`;    xpGain = 40;  }
    else                   { emoji = '🤦'; title = 'CATASTROPHE';       desc = `**0/5** — Ouvre un livre !`;     xpGain = 10;  }

    db.addXp(guildId, message.author.id, xpGain);
    desc += `\n\n✨ **+${xpGain} XP** gagnés !`;

    if (V2_AVAILABLE) {
      const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${emoji} ${title}\n\n${desc}`));
      await sent.edit({ components: [container], flags: COMPONENTS_V2_FLAG }).catch(() => {});
    } else {
      await sent.edit({
        embeds: [embed.build(guildId, desc, { title: `${emoji} ${title}`, timestamp: false })],
        components: [],
      }).catch(() => {});
    }
  });

  if (deleteReply) embed.scheduleDelete(sent, deleteDelay);
};
