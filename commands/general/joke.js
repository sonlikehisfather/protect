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

const db    = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

const JOKES = [
  { q: 'Quelle est la déesse du wifi ?',                                      a: 'Le Box divine !' },
  { q: 'Pourquoi les plongeurs plongent-ils toujours en arrière ?',           a: 'Parce que sinon ils tomberaient dans le bateau !' },
  { q: 'Qu\'est-ce qu\'un crocodile qui surveille la cour d\'école ?',        a: 'Un sac à dents !' },
  { q: 'Pourquoi les français mangent-ils des escargots ?',                   a: 'Parce qu\'ils n\'aiment pas le fast-food !' },
  { q: 'Qu\'est-ce qu\'un canif ?',                                           a: 'Le petit du caniche !' },
  { q: 'Comment appelle-t-on un chat tombé dans un pot de peinture le jour de Noël ?', a: 'Un chat-peint de Noël !' },
  { q: 'Qu\'est-ce qu\'un hippopotame qui se cache dans les feuilles ?',      a: 'Un hippopotame ! Il est nul à ce jeu.' },
  { q: 'Pourquoi l\'épouvantail a eu une récompense ?',                       a: 'Parce qu\'il était exceptionnel dans son domaine !' },
  { q: 'Qu\'est-ce qu\'un homme qui vend des médicaments ?',                  a: 'Un pharmacien, non ?' },
  { q: 'Comment s\'appelle un boomerang qui ne revient pas ?',                a: 'Un bâton !' },
  { q: 'Pourquoi les vampires ne peuvent pas être comptables ?',              a: 'Parce qu\'ils ont peur des stakes (enjeux) !' },
  { q: 'Qu\'est-ce qu\'un caniche qui aboie dans un couloir ?',               a: 'Un couloir de nage !' },
  { q: 'Quel est le comble pour un électricien ?',                            a: 'De ne pas être dans le courant !' },
  { q: 'Pourquoi les poissons n\'utilisent pas Facebook ?',                   a: 'Parce qu\'ils ont peur des filets !' },
  { q: 'Qu\'est-ce qu\'un chat en Alaska ?',                                  a: 'Un chat-grincheux !' },
  { q: 'Comment appelle-t-on un chien sans pattes ?',                         a: 'Peu importe, il viendra pas de toute façon !' },
  { q: 'Quel est le sport préféré des boulangers ?',                          a: 'Le pétanque !' },
  { q: 'Pourquoi les vaches portent des cloches ?',                           a: 'Parce que leurs cornes ne fonctionnent pas !' },
  { q: 'Qu\'est-ce qu\'un lapin qui tombe dans du ciment ?',                  a: 'Un lapinciment !' },
  { q: 'Qu\'est-ce qu\'un volcan en colère ?',                                a: 'Ça, ça va pas être de la lave !' },
  { q: 'Quel est le comble pour un jardinier ?',                              a: 'De perdre la boule !' },
  { q: 'Comment appelle-t-on un chat qui fait de la musique ?',               a: 'DJ Miaou !' },
  { q: 'Qu\'est-ce qu\'un éléphant dans une cabine téléphonique ?',           a: 'Coincé !' },
  { q: 'Pourquoi les girafes ont un long cou ?',                              a: 'Parce que leurs pieds puent !' },
  { q: 'Qu\'est-ce qu\'un zombie végétarien ?',                               a: 'Graaaains ! (grains)' },
  { q: 'Quel est le comble pour un coiffeur ?',                               a: 'D\'être à la rue !' },
  { q: 'Comment appelle-t-on un fake billet ?',                               a: 'Un faux billet, mais aussi… un billet Raté !' },
  { q: 'Qu\'est-ce qu\'une fée qui pète ?',                                   a: 'Fée-tus !' },
  { q: 'Pourquoi les informaticiens portent des lunettes ?',                  a: 'Parce qu\'ils ne peuvent pas C # !' },
  { q: 'Qu\'est-ce qu\'un crocodile qui fait du vélo ?',                      a: 'Un cyclodile !' },
  { q: 'Comment appelle-t-on un chat qui mange du citron ?',                  a: 'Un chat-grincheux !' },
  { q: 'Qu\'est-ce qu\'un canif ?',                                           a: 'Le petit du caniche ! (bis)' },
  { q: 'Pourquoi Superman porte ses slips par-dessus son pantalon ?',         a: 'Parce qu\'il met ses sous-vêtements avant sa combinaison !' },
  { q: 'Qu\'est-ce qu\'un chat sur une plage en hiver ?',                     a: 'Un chat-grin de sable !' },
  { q: 'Quel est le comble pour un plombier ?',                               a: 'D\'être dans la panade !' },
  { q: 'Comment appelle-t-on 2000 mouches dans un verre ?',                   a: 'Du mouches à boire... 2000 !' },
  { q: 'Pourquoi les fantômes sont mauvais en mensonge ?',                    a: 'Parce qu\'on peut voir à travers eux !' },
  { q: 'Qu\'est-ce qu\'un ours polaire qui fond ?',                           a: 'Une flaque d\'ours !' },
  { q: 'Comment appelle-t-on un chat qui a mangé un canard ?',                a: 'Un chat-canard !' },
  { q: 'Qu\'est-ce qu\'un chien qui vend des médicaments ?',                  a: 'Un pharmachien !' },
  { q: 'Pourquoi les plantes ne vont jamais en prison ?',                     a: 'Parce qu\'elles ont toujours de bonnes racines !' },
  { q: 'Comment appelle-t-on un cheval qui ne sort que la nuit ?',            a: 'Nightmare !' },
  { q: 'Qu\'est-ce qu\'un boulanger en colère ?',                             a: 'Quelqu\'un qui a du pain sur la planche !' },
  { q: 'Pourquoi les maths sont tristes ?',                                   a: 'Parce qu\'elles ont trop de problèmes !' },
  { q: 'Qu\'est-ce qu\'un origami en colère ?',                               a: 'Il fout tout en l\'air !' },
  { q: 'Comment appelle-t-on une vache qui joue de la guitare ?',             a: 'Un bœuf-session !' },
  { q: 'Qu\'est-ce qu\'un pingouin sur un skateboard ?',                      a: 'Cool, mais inutile !' },
  { q: 'Pourquoi les livres de maths sont toujours tristes ?',                a: 'Parce qu\'ils ont trop de problèmes !' },
  { q: 'Comment appelle-t-on un chat qui fait du sport ?',                    a: 'Un chat-mpion !' },
  { q: 'Qu\'est-ce qu\'un chat sur une horloge ?',                            a: 'Une sou-chat à temps !' },
  { q: 'Pourquoi les poulpes sont-ils si intelligents ?',                     a: 'Parce qu\'ils sont bien dans leurs tentacules !' },
  { q: 'Qu\'est-ce qu\'un caniche sous la pluie ?',                           a: 'Un caniche mouillé… il n\'y a pas de miracle !' },
  { q: 'Comment appelle-t-on un cerf qui a les dents du bonheur ?',           a: 'Un cerf-souriant !' },
  { q: 'Quel est le comble pour un astronaute ?',                             a: 'De perdre la tête !' },
  { q: 'Pourquoi les abeilles font-elles du miel ?',                          a: 'Parce que la cire c\'est trop dur à tartiner !' },
  { q: 'Qu\'est-ce qu\'un cerf au volant ?',                                  a: 'Un conducteur qui a des bois !' },
  { q: 'Comment appelle-t-on un chien qui fait du vélo ?',                    a: 'Tour de chien !' },
  { q: 'Pourquoi les robots ne pleurent jamais ?',                            a: 'Parce qu\'ils ont des données, pas des larmes !' },
  { q: 'Qu\'est-ce qu\'un chat dans un ordinateur ?',                         a: 'Une souris virtuelle !' },
  { q: 'Comment appelle-t-on un renard dans un bois de nuit ?',               a: 'Perdu !' },
  { q: 'Qu\'est-ce qu\'un chat qui joue aux cartes ?',                        a: 'Un chat-batteur !' },
  { q: 'Pourquoi les toilettes sont-elles toujours propres dans les films ?', a: 'Parce que c\'est du cinéma !' },
  { q: 'Comment appelle-t-on un monstre bien élevé ?',                        a: 'Monstre-poli !' },
  { q: 'Qu\'est-ce qu\'un chat qui mange une pizza ?',                        a: 'Un chat-leureux !' },
  { q: 'Pourquoi les lions mangent-ils cru ?',                                a: 'Parce qu\'ils n\'ont pas de micro-ondes !' },
  { q: 'Comment appelle-t-on un vampire en pyjama ?',                         a: 'Dracula de nuit !' },
  { q: 'Qu\'est-ce qu\'un lapin vert dans un champ ?',                        a: 'Un lapin qui s\'est roulé dans l\'herbe !' },
  { q: 'Pourquoi les fantômes sont-ils toujours humides ?',                   a: 'Parce qu\'ils font Boooouh et il pleut !' },
  { q: 'Comment appelle-t-on un chat sous la neige ?',                        a: 'Un chat-froid !' },
  { q: 'Qu\'est-ce qu\'un cheval qui ne dort pas dehors ?',                   a: 'Un cheval de box !' },
  { q: 'Pourquoi les papillons ne vont-ils jamais à l\'école ?',              a: 'Parce qu\'ils préfèrent les boîtes de nuit !' },
  { q: 'Comment appelle-t-on un dinosaure avec un excellent vocabulaire ?',   a: 'Un thé-saurus !' },
  { q: 'Qu\'est-ce qu\'une sorcière à la plage ?',                            a: 'Je ne sais pas, mais son balai rouille !' },
  { q: 'Pourquoi les squelettes ne se battent jamais entre eux ?',            a: 'Ils n\'ont pas le cran !' },
  { q: 'Comment appelle-t-on un chien magicien ?',                            a: 'Labrador-abra !' },
  { q: 'Qu\'est-ce qu\'un canard avec une toque ?',                           a: 'Un chef cuisi-canard !' },
  { q: 'Pourquoi les footballeurs sont-ils bons en calcul ?',                 a: 'Parce qu\'ils savent toujours où est le but !' },
  { q: 'Comment appelle-t-on un singe sans banane ?',                         a: 'Déprimé !' },
  { q: 'Qu\'est-ce qu\'un chat dans les airs ?',                              a: 'Un chat-volant !' },
  { q: 'Pourquoi la lune ne mange-t-elle pas ?',                              a: 'Parce qu\'elle est déjà pleine !' },
  { q: 'Comment appelle-t-on une mouche sans ailes ?',                        a: 'Une marche !' },
  { q: 'Qu\'est-ce qu\'un chien qui tombe dans la peinture fraîche ?',        a: 'Un Dalmatien !' },
  { q: 'Pourquoi les icebergs vont-ils rarement au cinéma ?',                 a: 'Parce qu\'ils ont peur de fondre de rire !' },
  { q: 'Comment appelle-t-on un cheval qui fait de la gym ?',                 a: 'Un cheval d\'arçon !' },
  { q: 'Qu\'est-ce qu\'une araignée sur un ordinateur ?',                     a: 'Un bug !' },
  { q: 'Pourquoi les oiseaux volent-ils vers le sud en hiver ?',              a: 'Parce que c\'est trop loin à pied !' },
  { q: 'Comment appelle-t-on un cerf qui n\'a pas de dents ?',                a: 'Bambi !' },
  { q: 'Qu\'est-ce qu\'un crocodile qui surveille les enfants ?',             a: 'Un garde du corps… à dents !' },
  { q: 'Pourquoi les boulangers travaillent-ils tôt le matin ?',              a: 'Pour avoir du pain sur la planche avant tout le monde !' },
  { q: 'Comment appelle-t-on un chat qui aime la pop ?',                      a: 'Un chat-rtiste !' },
  { q: 'Qu\'est-ce qu\'un chien sous la pluie ?',                             a: 'Un chien mouillé… comme tout le monde !' },
  { q: 'Pourquoi les vaches ont-elles des cloches autour du cou ?',           a: 'Parce que leurs cornes ne sonnent pas !' },
  { q: 'Comment appelle-t-on un chat qui rit ?',                              a: 'MDR-fé !' },
  { q: 'Qu\'est-ce qu\'un pingouin au soleil ?',                              a: 'Un pingouin bronzé… et surpris !' },
  { q: 'Pourquoi les arbres ne vont-ils jamais en vacances ?',                a: 'Parce qu\'ils ont du mal à déraciner !' },
  { q: 'Comment appelle-t-on un mouton qui tond la pelouse ?',                a: 'Eco-responsable !' },
  { q: 'Qu\'est-ce qu\'un chat qui joue aux échecs ?',                        a: 'Un chat-mpion des cases !' },
];

module.exports = {
  help: {
    name        : 'joke',
    description : 'Affiche une blague aléatoire.',
    usage       : 'joke',
    aliases     : ['blague', 'j'],
    category    : 'general',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    if (!V2_AVAILABLE) {
      const joke = JOKES[Math.floor(Math.random() * JOKES.length)];
      const s = await embed.reply(message, `**${joke.q}**\n||\`${joke.a}\`||`, { timestamp: false }).catch(() => null);
      if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
      return;
    }

    const joke = JOKES[Math.floor(Math.random() * JOKES.length)];

    const _buildPanel = (revealed) => {
      const container = new ContainerBuilder();

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## Blague\n\n${joke.q}`),
      );

      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(1));

      if (revealed) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`**Réponse**\n${joke.a}`),
        );
      } else {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent('**Réponse**\n||···||'),
        );
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('local:joke:reveal')
              .setLabel('Révéler la réponse')
              .setStyle(ButtonStyle.Primary),
          ),
        );
      }

      return {
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      };
    };

    const panel = await message.channel.send(_buildPanel(false)).catch(() => null);
    if (!panel) return;

    const collector = panel.createMessageComponentCollector({
      time: 120_000,
    });

    collector.on('collect', async (i) => {
      if (i.customId !== 'local:joke:reveal') return;
      collector.stop('revealed');
      await i.deferUpdate().catch(() => {});
      await panel.edit(_buildPanel(true)).catch(() => {});
      if (deleteReply) embed.scheduleDelete(panel, deleteDelay);
    });

    collector.on('end', (_, reason) => {
      if (reason === 'revealed') return;
      panel.edit({ ..._buildPanel(true), components: [] }).catch(() => {});
      if (deleteReply) embed.scheduleDelete(panel, deleteDelay);
    });
  },
};
