'use strict';

const {
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  AttachmentBuilder,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { levelFromXp, xpForLevel } = require('../../modules/levels');

const LEVEL_RANKS = [
  { min: 1000, icon: '✬', name: 'Absolu' },
  { min: 800,  icon: '✪', name: 'Suprême' },
  { min: 650,  icon: '♔', name: 'Céleste' },
  { min: 500,  icon: '♚', name: 'Transcendant' },
  { min: 400,  icon: '♕', name: 'Divin' },
  { min: 300,  icon: '♛', name: 'Immortel' },
  { min: 250,  icon: '♖', name: 'Mythique' },
  { min: 200,  icon: '♜', name: 'Légende' },
  { min: 150,  icon: '♗', name: 'Champion' },
  { min: 125,  icon: '♝', name: 'Grand Maître' },
  { min: 100,  icon: '♘', name: 'Maître' },
  { min: 75,   icon: '♞', name: 'Élite' },
  { min: 60,   icon: '♟', name: 'Expert' },
  { min: 50,   icon: '♙', name: 'Vétéran' },
  { min: 40,   icon: '◕', name: 'Aguerri' },
  { min: 30,   icon: '◔', name: 'Expérimenté' },
  { min: 20,   icon: '◖', name: 'Avisé' },
  { min: 15,   icon: '◗', name: 'Confirmé' },
  { min: 10,   icon: '●', name: 'Régulier' },
  { min: 5,    icon: '◌', name: 'Apprenti' },
  { min: 1,    icon: '○', name: 'Novice' },
];

const MAX_LEVEL = 1000;

const PRESTIGE_RANKS = [
  { prestige: 4, icon: '✯', name: 'Master'     },
  { prestige: 3, icon: '❖', name: 'Prestige 3' },
  { prestige: 2, icon: '✥', name: 'Prestige 2' },
  { prestige: 1, icon: '✤', name: 'Prestige 1' },
];

function getPrestigeInfo(level) {
  const prestige = Math.floor(level / MAX_LEVEL);
  const displayLevel = level % MAX_LEVEL;
  const isMaster = prestige >= 4;
  return { prestige, displayLevel: isMaster ? MAX_LEVEL : displayLevel, isMaster };
}

function getRankFromLevel(level) {
  const prestige = Math.floor(level / MAX_LEVEL);
  if (prestige > 0) {
    const pRank = PRESTIGE_RANKS.find(r => prestige >= r.prestige);
    if (pRank) return pRank;
  }
  return LEVEL_RANKS.find(r => level >= r.min) ?? LEVEL_RANKS[LEVEL_RANKS.length - 1];
}

let V2_AVAILABLE = false;
try {
  const { ContainerBuilder: CB } = require('discord.js');
  V2_AVAILABLE = !!CB;
} catch {}
const COMPONENTS_V2_FLAG = 1 << 15;

const CASINO_IMAGE_URL = 'https://media.discordapp.net/attachments/1343929434945536091/1344731786504085555/image.png';

// ============ ACHIEVEMENT SYSTEM ============
const ACH_PER_PAGE = 4;

const ACH_CATS = {
  novice:        { label: 'Novice',        desc: 'Tes premiers pas au Mysoul Casino.' },
  intermediaire: { label: 'Intermédiaire', desc: 'Tu commences à trouver tes marques.' },
  confirme:      { label: 'Confirmé',      desc: 'Les bases du casino parfaitement maîtrisées.' },
  expert:        { label: 'Expert',        desc: 'Tu es parmi les meilleurs joueurs.' },
  legendaire:    { label: 'Légendaire',    desc: 'Un niveau réservé à une infime élite.' },
  mystique:      { label: 'Mystique',      desc: 'Des défis hors du commun pour les plus grands.' },
};

const ACHIEVEMENTS = [
  // ── NOVICE ─ premiers pas, seuils relevés ────────────────────────────────
  { key: 'n_first_msg',   cat: 'novice',        name: 'Premier Mot',              desc: 'Envoie ton premier message sur le serveur.',                                                       check: (u)     => u.msgCount >= 1 },
  { key: 'n_first_voc',   cat: 'novice',        name: 'Voix Débutante',           desc: 'Passe ta première minute en salon vocal.',                                                         check: (u)     => u.vocMinutes >= 1 },
  { key: 'n_first_draw',  cat: 'novice',        name: 'La Chance Tourne',         desc: 'Réalise ton premier tirage au Mysoul Casino.',                                                     check: (u)     => u.totalDraws >= 1 },
  { key: 'n_first_win',   cat: 'novice',        name: 'Première Victoire',        desc: 'Remporte ton premier jeu au casino.',                                                              check: (u)     => u.totalGamesWon >= 1 },
  { key: 'n_coins_500',   cat: 'novice',        name: 'Poche Pleine',             desc: 'Accumule 500 Mysoul Coins sur ton compte.',                                                        check: (u)     => u.coins >= 500 },
  { key: 'n_draws_10',    cat: 'novice',        name: 'Tireur en Herbe',          desc: 'Utilise 10 tirages au total.',                                                                     check: (u)     => u.totalDraws >= 10 },
  { key: 'n_msgs_25',     cat: 'novice',        name: 'Bavard Débutant',          desc: 'Envoie 25 messages sur le serveur.',                                                               check: (u)     => u.msgCount >= 25 },
  { key: 'n_voc_2h',      cat: 'novice',        name: 'Habitué du Vocal',         desc: 'Passe 2 heures en salon vocal.',                                                                   check: (u)     => u.vocMinutes >= 120 },

  // ── INTERMÉDIAIRE ─ x1.75 plus dur ──────────────────────────────────────
  { key: 'm_coins_5k',    cat: 'intermediaire', name: 'Les Premiers Milliers',    desc: 'Accumule 5 000 Mysoul Coins sur ton compte.',                                                      check: (u)     => u.coins >= 5000 },
  { key: 'm_draws_30',    cat: 'intermediaire', name: 'Chasseur de Gains',        desc: 'Utilise 30 tirages au total.',                                                                     check: (u)     => u.totalDraws >= 30 },
  { key: 'm_msgs_150',    cat: 'intermediaire', name: 'Habitué du Chat',          desc: 'Envoie 150 messages sur le serveur.',                                                              check: (u)     => u.msgCount >= 150 },
  { key: 'm_voc_10h',     cat: 'intermediaire', name: 'Voix d\'Or',               desc: 'Passe 10 heures en salon vocal.',                                                                  check: (u)     => u.vocMinutes >= 600 },
  { key: 'm_games_20',    cat: 'intermediaire', name: 'Joueur Sérieux',           desc: 'Remporte 20 parties au casino.',                                                                   check: (u)     => u.totalGamesWon >= 20 },
  { key: 'm_spent_2500',  cat: 'intermediaire', name: 'Premier Investissement',   desc: 'Dépense 2 500 Mysoul Coins au shop.',                                                              check: (u)     => u.totalSpent >= 2500 },
  { key: 'm_won_25k',     cat: 'intermediaire', name: 'Chanceux',                 desc: 'Cumule 25 000 Mysoul Coins gagnés via les jeux (gains bruts, pas le solde).',                      check: (u)     => u.totalWon >= 25000 },
  { key: 'm_level_5',     cat: 'intermediaire', name: 'En Progression',           desc: 'Atteins le niveau 5 au Mysoul Casino.',                                                            check: (u)     => u.level >= 5 },

  // ── CONFIRMÉ ─ x2.5 plus dur ─────────────────────────────────────────────
  { key: 'c_coins_50k',   cat: 'confirme',      name: 'Cinquante Mille',          desc: 'Accumule 50 000 Mysoul Coins sur ton compte.',                                                     check: (u)     => u.coins >= 50000 },
  { key: 'c_draws_150',   cat: 'confirme',      name: 'Collectionneur',           desc: 'Utilise 150 tirages au total.',                                                                    check: (u)     => u.totalDraws >= 150 },
  { key: 'c_msgs_600',    cat: 'confirme',      name: 'Pilier du Serveur',        desc: 'Envoie 600 messages sur le serveur.',                                                              check: (u)     => u.msgCount >= 600 },
  { key: 'c_voc_60h',     cat: 'confirme',      name: 'Vocaliste',                desc: 'Passe 60 heures en salon vocal.',                                                                  check: (u)     => u.vocMinutes >= 3600 },
  { key: 'c_games_75',    cat: 'confirme',      name: 'Combattant',               desc: 'Remporte 75 parties au casino.',                                                                   check: (u)     => u.totalGamesWon >= 75 },
  { key: 'c_spent_50k',   cat: 'confirme',      name: 'Grand Spender',            desc: 'Dépense 50 000 Mysoul Coins au shop.',                                                             check: (u)     => u.totalSpent >= 50000 },
  { key: 'c_won_250k',    cat: 'confirme',      name: 'Investisseur Chanceux',    desc: 'Cumule 250 000 Mysoul Coins gagnés via les jeux (gains bruts, pas le solde).',                     check: (u)     => u.totalWon >= 250000 },
  { key: 'c_level_15',    cat: 'confirme',      name: 'Casino Pro',               desc: 'Atteins le niveau 15 au Mysoul Casino.',                                                           check: (u)     => u.level >= 15 },

  // ── EXPERT ─ x3.5 plus dur ───────────────────────────────────────────────
  { key: 'e_coins_500k',  cat: 'expert',        name: 'Demi-Millionnaire',        desc: 'Accumule 500 000 Mysoul Coins sur ton compte.',                                                    check: (u)     => u.coins >= 500000 },
  { key: 'e_draws_600',   cat: 'expert',        name: 'Maître des Tirages',       desc: 'Utilise 600 tirages au total.',                                                                    check: (u)     => u.totalDraws >= 600 },
  { key: 'e_msgs_3k',     cat: 'expert',        name: 'Incontournable',           desc: 'Envoie 3 000 messages sur le serveur.',                                                            check: (u)     => u.msgCount >= 3000 },
  { key: 'e_voc_300h',    cat: 'expert',        name: 'Maître du Vocal',          desc: 'Passe 300 heures en salon vocal.',                                                                 check: (u)     => u.vocMinutes >= 18000 },
  { key: 'e_games_300',   cat: 'expert',        name: 'Guerrier',                 desc: 'Remporte 300 parties au casino.',                                                                  check: (u)     => u.totalGamesWon >= 300 },
  { key: 'e_spent_500k',  cat: 'expert',        name: 'Trésorier',                desc: 'Dépense 500 000 Mysoul Coins au shop.',                                                            check: (u)     => u.totalSpent >= 500000 },
  { key: 'e_won_2m',      cat: 'expert',        name: 'Fortune Dorée',            desc: 'Cumule 2 000 000 Mysoul Coins gagnés via les jeux (gains bruts, pas le solde).',                   check: (u)     => u.totalWon >= 2000000 },
  { key: 'e_level_40',    cat: 'expert',        name: 'Casino Expert',            desc: 'Atteins le niveau 40 au Mysoul Casino.',                                                           check: (u)     => u.level >= 40 },

  // ── LÉGENDAIRE ─ x5 plus dur ─────────────────────────────────────────────
  { key: 'l_coins_5m',    cat: 'legendaire',    name: 'Millionnaire',             desc: 'Accumule 5 000 000 Mysoul Coins sur ton compte.',                                                  check: (u)     => u.coins >= 5000000 },
  { key: 'l_draws_3k',    cat: 'legendaire',    name: 'Oracle du Gacha',          desc: 'Utilise 3 000 tirages au total.',                                                                  check: (u)     => u.totalDraws >= 3000 },
  { key: 'l_msgs_20k',    cat: 'legendaire',    name: 'Légende du Serveur',       desc: 'Envoie 20 000 messages sur le serveur.',                                                           check: (u)     => u.msgCount >= 20000 },
  { key: 'l_voc_1500h',   cat: 'legendaire',    name: 'Roi du Vocal',             desc: 'Passe 1 500 heures en salon vocal.',                                                               check: (u)     => u.vocMinutes >= 90000 },
  { key: 'l_games_2k',    cat: 'legendaire',    name: 'Invincible',               desc: 'Remporte 2 000 parties au casino.',                                                                check: (u)     => u.totalGamesWon >= 2000 },
  { key: 'l_spent_5m',    cat: 'legendaire',    name: 'Sultan des Coins',         desc: 'Dépense 5 000 000 Mysoul Coins au shop.',                                                          check: (u)     => u.totalSpent >= 5000000 },
  { key: 'l_level_80',    cat: 'legendaire',    name: 'Casino Legend',            desc: 'Atteins le niveau 80 au Mysoul Casino.',                                                           check: (u)     => u.level >= 80 },
  { key: 'l_won_50m',     cat: 'legendaire',    name: 'Dieu de la Fortune',       desc: 'Cumule 50 000 000 Mysoul Coins gagnés via les jeux (gains bruts cumulés, pas le solde actuel).',  check: (u)     => u.totalWon >= 50000000 },

  // ── MYSTIQUE ─ défis extrêmes & cross-catégories ─────────────────────────
  { key: 'x_all_novice',      cat: 'mystique', name: 'Diplômé Novice',        desc: 'Débloque les 8 succès de la catégorie Novice.',                                                                           check: (u, ks) => ['n_first_msg','n_first_voc','n_first_draw','n_first_win','n_coins_500','n_draws_10','n_msgs_25','n_voc_2h'].every(k => ks.has(k)) },
  { key: 'x_all_inter',       cat: 'mystique', name: 'Diplômé Intermédiaire', desc: 'Débloque les 8 succès de la catégorie Intermédiaire.',                                                                    check: (u, ks) => ['m_coins_5k','m_draws_30','m_msgs_150','m_voc_10h','m_games_20','m_spent_2500','m_won_25k','m_level_5'].every(k => ks.has(k)) },
  { key: 'x_zero_loss',       cat: 'mystique', name: 'L\'Imbattable',         desc: 'Remporte 100 jeux au casino sans jamais avoir Perdu une seule partie ・ aucun pardon.',                                   check: (u)     => u.totalGamesWon >= 100 && u.totalGamesLost === 0 },
  { key: 'x_rich_vocal',      cat: 'mystique', name: 'Riche & Présent',       desc: 'Possède 2 000 000 Mysoul Coins ET totalise 300 heures de vocal simultanément.',                                          check: (u)     => u.coins >= 2000000 && u.vocMinutes >= 18000 },
  { key: 'x_grind',           cat: 'mystique', name: 'Le Grindeur Absolu',    desc: 'Cumule 2 000 tirages, 10 000 messages ET 1 000 heures de vocal. Le triptyque du dédié.',                                  check: (u)     => u.totalDraws >= 2000 && u.msgCount >= 10000 && u.vocMinutes >= 60000 },
  { key: 'x_level_coins',     cat: 'mystique', name: 'L\'Élite',              desc: 'Atteins le niveau 60 ET possède 5 000 000 Mysoul Coins simultanément sur ton compte.',                                   check: (u)     => u.level >= 60 && u.coins >= 5000000 },
  { key: 'x_50m_total',       cat: 'mystique', name: 'L\'Absolu',             desc: 'Cumule un total de 50 000 000 Mysoul Coins gagnés via les jeux. Les pertes ne comptent pas ・ que les gains bruts.',      check: (u)     => u.totalWon >= 50000000 },
  { key: 'x_all_achievements',cat: 'mystique', name: 'Le Paragon',            desc: 'Débloque la totalité des 47 autres succès. Le seul vrai défi ultime du Mysoul Casino.',                                  check: (u, ks) => ks.size >= 47 },
];

function _getUnlockedKeys(guildId, userId) {
  const user = db.getCasinoUser(guildId, userId);
  const keys = db.getUnlockedAchievementKeys(guildId, userId);
  for (const ach of ACHIEVEMENTS) {
    if (!keys.has(ach.key) && ach.check(user, keys)) {
      db.unlockAchievementByKey(guildId, userId, ach.key);
      keys.add(ach.key);
    }
  }
  return keys;
}

function buildAchHomePanel(guildId, userId) {
  const keys = _getUnlockedKeys(guildId, userId);
  const total = ACHIEVEMENTS.length;
  const unlockedCount = ACHIEVEMENTS.filter(a => keys.has(a.key)).length;
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## Succès Mysoul Casino\n> Explore les catégories, suis ta progression et débloque des succès en jouant.`
  ));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `> **${unlockedCount} / ${total}** succès débloqués`
  ));
  container.addSeparatorComponents(new SeparatorBuilder());
  const catSelect = new StringSelectMenuBuilder()
    .setCustomId('cs_ach_catsel')
    .setPlaceholder('» Choisir une catégorie...')
    .addOptions(
      Object.entries(ACH_CATS).map(([val, cat]) => {
        const catAchs = ACHIEVEMENTS.filter(a => a.cat === val);
        const catUnlocked = catAchs.filter(a => keys.has(a.key)).length;
        return { label: `» ${cat.label}`, value: val, description: `${catUnlocked}/${catAchs.length} débloqués` };
      })
    );
  container.addActionRowComponents(new ActionRowBuilder().addComponents(catSelect));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cs_ach_owned').setLabel('» Voir mes Succès').setStyle(ButtonStyle.Success),
  ));
  return container;
}

function buildAchCategoryPanel(guildId, userId, cat, page) {
  const catData = ACH_CATS[cat] || ACH_CATS.novice;
  const keys = _getUnlockedKeys(guildId, userId);
  const catAchs = ACHIEVEMENTS.filter(a => a.cat === cat);
  const totalPages = Math.max(1, Math.ceil(catAchs.length / ACH_PER_PAGE));
  const currentPage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = catAchs.slice(currentPage * ACH_PER_PAGE, (currentPage + 1) * ACH_PER_PAGE);
  const catUnlocked = catAchs.filter(a => keys.has(a.key)).length;

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## Succès ${catData.label}\n> ${catData.desc}`
  ));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `> Page **${currentPage + 1}** / **${totalPages}** • **${catUnlocked}** / **${catAchs.length}** débloqués`
  ));
  container.addSeparatorComponents(new SeparatorBuilder());
  let achText = '';
  for (const ach of slice) {
    const icon = keys.has(ach.key) ? '◆' : '◇';
    achText += `${icon} **${ach.name}**\n> ${ach.desc}\n\n`;
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(achText.trimEnd()));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cs_ach_page:${cat}:${currentPage - 1}`).setLabel('« Préc').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`cs_ach_page:${cat}:${currentPage + 1}`).setLabel('» Suiv').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages - 1),
    new ButtonBuilder().setCustomId('cs_ach_home').setLabel('↩ Retour').setStyle(ButtonStyle.Secondary),
  ));
  return container;
}

function buildAchOwnedPanel(guildId, userId) {
  const keys = _getUnlockedKeys(guildId, userId);
  const owned = ACHIEVEMENTS.filter(a => keys.has(a.key));
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## Mes Succès\n> **${owned.length} / ${ACHIEVEMENTS.length}** succès débloqués au Mysoul Casino.`
  ));
  container.addSeparatorComponents(new SeparatorBuilder());

  if (!owned.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `> Aucun succès débloqué pour l'instant.\n\n-# Joue, parle, passe du temps en vocal et explore les fonctionnalités du casino pour en débloquer.`
    ));
  } else {
    const bycat = {};
    owned.forEach(a => { if (!bycat[a.cat]) bycat[a.cat] = []; bycat[a.cat].push(a); });
    const catsWithUnlocked = Object.entries(ACH_CATS).filter(([val]) => bycat[val]);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `> Sélectionne une catégorie pour voir tes succès débloqués.`
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('cs_ach_owned_catsel')
        .setPlaceholder('» Choisir une catégorie...')
        .addOptions(catsWithUnlocked.map(([val, cat]) => {
          const count = bycat[val].length;
          const total = ACHIEVEMENTS.filter(a => a.cat === val).length;
          return { label: `${cat.label}`, value: val, description: `${count}/${total} débloqués` };
        }))
    ));
  }
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cs_ach_home').setLabel('↩ Retour').setStyle(ButtonStyle.Secondary),
  ));
  return container;
}

function buildAchOwnedCategoryPanel(guildId, userId, cat) {
  const keys = _getUnlockedKeys(guildId, userId);
  const catData = ACH_CATS[cat] || ACH_CATS.novice;
  const catAchs = ACHIEVEMENTS.filter(a => a.cat === cat && keys.has(a.key));
  const catTotal = ACHIEVEMENTS.filter(a => a.cat === cat).length;
  const owned = ACHIEVEMENTS.filter(a => keys.has(a.key));
  const bycat = {};
  owned.forEach(a => { if (!bycat[a.cat]) bycat[a.cat] = []; bycat[a.cat].push(a); });
  const catsWithUnlocked = Object.entries(ACH_CATS).filter(([val]) => bycat[val]);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## Mes Succès ${catData.label}\n> **${catAchs.length} / ${catTotal}** débloqués dans cette catégorie.`
  ));
  container.addSeparatorComponents(new SeparatorBuilder());
  if (!catAchs.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `> Aucun succès débloqué dans cette catégorie.`
    ));
  } else {
    let text = '';
    catAchs.forEach(a => { text += `◆ **${a.name}** ・ ${a.desc}\n`; });
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text.trimEnd()));
  }
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cs_ach_owned_catsel')
      .setPlaceholder('» Choisir une catégorie...')
      .addOptions(catsWithUnlocked.map(([val, c]) => {
        const count = bycat[val].length;
        const total = ACHIEVEMENTS.filter(a => a.cat === val).length;
        return { label: c.label, value: val, description: `${count}/${total} débloqués`, default: val === cat };
      }))
  ));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cs_ach_home').setLabel('↩ Retour').setStyle(ButtonStyle.Secondary),
  ));
  return container;
}

async function handleAchievementInteraction(interaction, id) {
  try {
    const guildId = interaction.guild?.id;
    const userId = interaction.user.id;
    if (!guildId) return interaction.deferUpdate().catch(() => {});

    if (id === 'cs_ach_home') {
      return interaction.update({ flags: COMPONENTS_V2_FLAG, components: [buildAchHomePanel(guildId, userId)] }).catch(() => {});
    }
    if (id === 'cs_ach_owned') {
      return interaction.update({ flags: COMPONENTS_V2_FLAG, components: [buildAchOwnedPanel(guildId, userId)] }).catch(() => {});
    }
    if (id === 'cs_ach_owned_catsel' && interaction.isStringSelectMenu()) {
      const cat = interaction.values[0];
      return interaction.update({ flags: COMPONENTS_V2_FLAG, components: [buildAchOwnedCategoryPanel(guildId, userId, cat)] }).catch(() => {});
    }
    if (id === 'cs_ach_catsel' && interaction.isStringSelectMenu()) {
      const cat = interaction.values[0];
      return interaction.update({ flags: COMPONENTS_V2_FLAG, components: [buildAchCategoryPanel(guildId, userId, cat, 0)] }).catch(() => {});
    }
    if (id.startsWith('cs_ach_page:')) {
      const parts = id.split(':');
      const cat = parts[1];
      const page = parseInt(parts[2], 10);
      return interaction.update({ flags: COMPONENTS_V2_FLAG, components: [buildAchCategoryPanel(guildId, userId, cat, page)] }).catch(() => {});
    }
    return interaction.deferUpdate().catch(() => {});
  } catch (err) {
    console.error(`[CASINO-ACH] error (${id}):`, err?.message);
    return interaction.deferUpdate().catch(() => {});
  }
}

// ============ PANEL TEXT ============
const PANEL_SECTIONS = [
  {
    title: 'MySoul Casino',
    subtitle: '',
    content:
      '> *Bienvenue au casino officiel du serveur ・ gagne des coins, monte en rang et débloque des récompenses exclusives.*',
  },
  {
    title: 'Shop',
    subtitle: '・Boutique',
    content:
      '> Dépense tes **Mysoul Coins** pour acquérir des rôles décoratifs, des accès exclusifs, des tirages supplémentaires et bien plus.',
  },
  {
    title: 'Profil',
    subtitle: '・Statistiques',
    content:
      '> Consulte tes coins, ton XP casino, ton niveau, ton ratio de jeux et ta progression vers le prochain rang.',
  },
  {
    title: 'Tirage',
    subtitle: '・Gacha',
    content:
      '> Utilise tes tirages pour tenter d\'obtenir des rôles rares, des coins, de l\'XP ou des items de collection.',
  },
  {
    title: 'Inventaire',
    subtitle: '・Mes items',
    content:
      '> Retrouve tous tes rôles décoratifs, badges, couleurs et items achetés ou gagnés via les tirages.',
  },
  {
    title: 'Succès',
    subtitle: '・Achievements',
    content:
      '> Débloque des succès en progressant sur le serveur ・ vocal, messages, dépenses, victoires et plus encore.',
  },
];

function getPanelSections(guildId) {
  const cfg = db.getCasinoConfig(guildId);
  if (cfg.casinoPanelContent) {
    try { return JSON.parse(cfg.casinoPanelContent); } catch {}
  }
  return PANEL_SECTIONS;
}

// ============ RULES TEXT ============
const RULES_SECTIONS = [
  {
    title: '§ Règlement',
    content:
      '> L’usage de **doubles comptes** pour se donner des coins ou piller des membres est interdit.\n' +
      '> La **communication avec son adversaire** lors d’un duel pour contourner le système est interdite.\n' +
      '> L’utilisation de **selfbot / scripts** pour automatiser des commandes casino est interdite.\n' +
      '> L’**AFK vocal** ou le **spam de messages** dans le but d’augmenter ses gains sera sanctionné.',
  },
  {
    title: '◆ Comment obtenir des Tirages ?',
    content:
      '> ▱ **Vocal** ・ 2 tirages / heure *(x2 en salon public)*\n' +
      '> ▱ **Événements** ・ Giveaways casino, tournois\n' +
      '> ▱ **Statut** ・ 1 tirage / 2h avec le statut `.gg/shibuya`\n' +
      '> ▱ **Boutique** ・ 10 tirages pour 15 000 coins',
  },
  {
    title: '※ Comment obtenir des Coins ?',
    content:
      '> ▱ **Tirage** ・ ~700 coins en moyenne par tirage\n' +
      '> ▱ **Vocal** ・ 2 000 coins / heure *(x2 en public)*\n' +
      '> ▱ **Messages** ・ 2 000 coins / 100 messages\n' +
      '> ▱ **Don** ・ Un membre peut t’envoyer des coins *(taxe 10%)*\n' +
      '> ▱ **Mini-jeux** ・ daily, collect, coinflip, blackjack, roulette, gift, russian, mine, plinko, tower, chicken…',
  },
];

exports.help = {
  name       : 'casino',
  description: 'Panel casino avec profil, tirage, shop, inventaire, succes.',
  use        : 'casino',
  usage      : 'casino [panel|rules|config]',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const member = message.member;
  const isAdmin = member.permissions.has(PermissionFlagsBits.ManageGuild);
  const isManager = db.isCasinoManager(guildId, member.id);

  if (args[0] === 'config') {
    if (!isAdmin && !isManager) return embed.replyError(message, 'Permission refusee.');
    return sendConfigPanel(message);
  }

  if (args[0] === 'rules' || args[0] === 'reglement') {
    return sendRulesPanel(message);
  }

  const cfg = db.getCasinoConfig(guildId);
  if (!cfg.enabled && !isAdmin && !isManager) {
    return embed.replyError(message, 'Le casino n\'est pas active.');
  }

  if (db.isCasinoBlacklisted(guildId, member.id)) {
    return embed.replyError(message, 'Vous etes blackliste du casino.');
  }

  // Check required role
  if (cfg.roleRequired) {
    const hasRole = member.roles.cache.has(cfg.roleRequired);
    if (!hasRole) {
      const panelCh = cfg.panelChannelId;
      const panelMsgId = cfg.panelMessageId;
      const link = (panelCh && panelMsgId)
        ? `https://discord.com/channels/${guildId}/${panelCh}/${panelMsgId}`
        : panelCh ? `<#${panelCh}>` : 'le salon casino';
      return embed.replyError(message, `Tu dois avoir le role <@&${cfg.roleRequired}> pour utiliser cette commande.\n> Va cliquer sur le bouton **Profil** du panel casino : ${link}`);
    }
  }

  // Check allowed channels
  if (cfg.allowedChannels) {
    const allowed = cfg.allowedChannels.split(',');
    if (!allowed.includes(message.channel.id) && !isAdmin && !isManager) {
      return embed.replyError(message, 'Commande interdite dans ce salon.');
    }
  }

  if (args[0] === 'panel') {
    if (!isAdmin && !isManager) return embed.replyError(message, 'Permission refusee.');
    return publishCasinoPanel(message);
  }

  const panelChannel = cfg.panelChannelId ? `<#${cfg.panelChannelId}>` : 'le salon casino configure';
  return embed.reply(message, `Utilise le panel dans ${panelChannel} pour acceder au shop, profil, tirages et inventaire.`);
};

function buildCasinoHomePanel(guildId) {
  const sections = getPanelSections(guildId);
  const container = new ContainerBuilder();

  for (const s of sections) {
    if (!s.title && !s.subtitle) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(s.content));
    } else {
      let header = `### ${s.title || ''}`;
      if (s.subtitle) header += `\n-# *${s.subtitle}*`;
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${header}\n${s.content}`));
    }
    container.addSeparatorComponents(new SeparatorBuilder());
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# *Utilise les boutons ci-dessous pour accéder à chaque section.*'));

  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cs_panel_shop').setLabel('Shop').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cs_panel_profile').setLabel('Profil').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cs_panel_draw').setLabel('Tirage').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cs_panel_inventory').setLabel('Inventaire').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cs_panel_achievements').setLabel('Succès').setStyle(ButtonStyle.Secondary),
  ));

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [container],
  };
}

async function publishCasinoPanel(message) {
  const guildId = message.guild.id;
  const cfg = db.getCasinoConfig(guildId);
  const channel = cfg.panelChannelId
    ? await message.guild.channels.fetch(cfg.panelChannelId).catch(() => null)
    : message.channel;

  if (!channel?.send) return embed.replyError(message, 'Salon panel introuvable.');

  if (cfg.panelMessageId && cfg.panelChannelId) {
    try {
      const oldMsg = await channel.messages.fetch(cfg.panelMessageId).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});
    } catch {}
  }

  const sent = await channel.send(buildCasinoHomePanel(guildId));
  db.setCasinoConfig(guildId, { panelMessageId: sent.id, panelChannelId: channel.id });
  const reply = await embed.reply(message, `Panel casino envoye dans <#${channel.id}>.`);
  if (reply) embed.scheduleDelete(reply, 5);
  if (message?.deletable) message.delete().catch(() => {});
}

function checkCasinoAccess(interaction) {
  const guildId = interaction.guild?.id;
  const member = interaction.member;
  if (!guildId || !member) return 'Interaction invalide.';

  const cfg = db.getCasinoConfig(guildId);
  const isAdmin = member.permissions?.has(PermissionFlagsBits.ManageGuild);
  const isManager = db.isCasinoManager(guildId, member.id);

  if (!cfg.enabled && !isAdmin && !isManager) return 'Le casino n\'est pas active.';
  if (db.isCasinoBlacklisted(guildId, member.id)) return 'Vous etes blackliste du casino.';
  if (cfg.roleRequired && !member.roles.cache.has(cfg.roleRequired)) {
    const panelCh = cfg.panelChannelId;
    const panelMsgId = cfg.panelMessageId;
    const link = (panelCh && panelMsgId)
      ? `https://discord.com/channels/${guildId}/${panelCh}/${panelMsgId}`
      : panelCh ? `<#${panelCh}>` : 'le salon casino';
    return `Tu dois avoir le role <@&${cfg.roleRequired}> pour utiliser le casino.\n> Va cliquer sur le bouton **Profil** du panel casino pour l'obtenir : ${link}`;
  }

  return null;
}

function checkCasinoChannel(message, commandName) {
  const guildId = message.guild?.id;
  if (!guildId) return null;

  const perms = require('../../utils/permissions');
  if (perms.isBuyer(message.author.id) || perms.isOwner(guildId, message.author.id)) return null;

  const cfg = db.getCasinoConfig(guildId);

  if (cfg.roleRequired) {
    const hasRole = message.member?.roles?.cache?.has(cfg.roleRequired);
    if (!hasRole) {
      const panelCh = cfg.panelChannelId;
      const panelMsgId = cfg.panelMessageId;
      const link = (panelCh && panelMsgId)
        ? `https://discord.com/channels/${guildId}/${panelCh}/${panelMsgId}`
        : panelCh ? `<#${panelCh}>` : 'le salon casino';
      return `Tu dois avoir le role <@&${cfg.roleRequired}> pour utiliser cette commande.\n> Va cliquer sur le bouton **Profil** du panel casino : ${link}`;
    }
  }

  if (!cfg.allowedChannels) return null;

  const allowed = cfg.allowedChannels.split(',').filter(Boolean);
  if (!allowed.length) return null;

  const restrictedList = cfg.restrictedCommands ? cfg.restrictedCommands.split(',').filter(Boolean) : [];
  if (restrictedList.length && !restrictedList.includes(commandName)) return null;

  if (!allowed.includes(message.channel.id)) {
    const mentions = allowed.map(id => `<#${id}>`).join(', ');
    return `Commande casino interdite ici. ${mentions}`;
  }

  return null;
}

function getGameCote(guildId, member, gameName) {
  return getGameCoteInfo(guildId, member, gameName).cote;
}

function getGameCoteInfo(guildId, member, gameName) {
  const cfg = db.getCasinoConfig(guildId);

  // Check bonus role
  const bonusRole = cfg.coteBonusRole;
  const hasBonusRole = bonusRole ? member?.roles?.cache?.has(bonusRole) : false;

  // Check status multiplier
  let hasStatusBonus = false;
  if (cfg.statusMultiplier && cfg.statusText) {
    const activity = member?.presence?.activities?.find(a => a.type === 4);
    const state = activity?.state?.toLowerCase() || '';
    const keywords = cfg.statusText.split('|').map(t => t.trim().toLowerCase()).filter(Boolean);
    hasStatusBonus = keywords.some(kw => state.includes(kw));
  }

  let base, roleBonus, statusBonus;
  if (gameName === 'blackjack') {
    base        = cfg.coteBlackjack ?? 2.0;
    roleBonus   = hasBonusRole    ? (cfg.coteBlackjackBonus   ?? 2.5) - base : 0;
    statusBonus = hasStatusBonus  ? (cfg.coteBlackjackStatus  ?? 2.5) - base : 0;
  } else {
    base        = cfg.coteCoinflip ?? 2.0;
    roleBonus   = hasBonusRole    ? (cfg.coteCoinflipBonus    ?? 2.5) - base : 0;
    statusBonus = hasStatusBonus  ? (cfg.coteCoinflipStatus   ?? 2.5) - base : 0;
  }

  const cote    = base + roleBonus + statusBonus;
  const bonuses = [];
  if (hasBonusRole)   bonuses.push(`rôle bonus (+${roleBonus.toFixed(2)})`);
  if (hasStatusBonus) bonuses.push(`statut (+${statusBonus.toFixed(2)})`);

  return { cote, bonuses, base };
}

const _cooldownStore = new Map(); // key: `${guildId}:${userId}:${cmd}` → timestamp ms

// Period gain/draw tracking: key = `${guildId}:${userId}:gains|draws` → { total, periodStart }
const _periodStore = new Map();

function checkGainsPeriodLimit(guildId, userId, type, amount) {
  const cfg = db.getCasinoConfig(guildId);
  const maxKey    = type === 'gains' ? 'limitGainsMax' : 'limitDrawsMax';
  const periodKey = type === 'gains' ? 'limitGainsPeriod' : 'limitDrawsPeriod';
  const max    = cfg[maxKey] ?? 0;
  const period = cfg[periodKey] ?? 0;
  if (!max || !period) return false;

  const key  = `${guildId}:${userId}:${type}`;
  const now  = Date.now();
  const data = _periodStore.get(key) || { total: 0, periodStart: now };

  if ((now - data.periodStart) > period * 1000) {
    data.total = 0;
    data.periodStart = now;
  }

  if (data.total + amount > max) return true;
  data.total += amount;
  _periodStore.set(key, data);
  return false;
}

function checkCasinoLimits(message, commandName, amount = null) {
  const guildId = message.guild?.id;
  const userId  = message.author?.id;
  if (!guildId || !userId) return null;

  const cfg = db.getCasinoConfig(guildId);

  // Cooldown check
  const cdKey = { blackjack: 'cooldownBj', coinflip: 'cooldownCf', daily: 'cooldownDaily', collect: 'cooldownCollect', roulette: 'cooldownRl', vol: 'cooldownVol', gift: 'cooldownGift', russian: 'cooldownRussian', mine: 'cooldownMine', plinko: 'cooldownPlinko', tower: 'cooldownTower', dice: 'cooldownDice', chicken: 'cooldownChicken', withdraw: 'cooldownWithdraw' }[commandName];
  if (cdKey && cfg[cdKey] > 0) {
    const storeKey = `${guildId}:${userId}:${commandName}`;
    const last = _cooldownStore.get(storeKey) || 0;
    const elapsed = (Date.now() - last) / 1000;
    const remaining = cfg[cdKey] - elapsed;
    if (remaining > 0) {
      const s = Math.ceil(remaining);
      const label = s >= 3600 ? `${Math.ceil(s/3600)}h` : s >= 60 ? `${Math.ceil(s/60)}min ${s%60}s` : `${s}s`;
      return `Cooldown actif. Réessaie dans **${label}**.`;
    }
  }

  // Bet limits
  if (amount !== null) {
    const minKey = { blackjack: 'limitBjMin', coinflip: 'limitCfMin', roulette: 'limitRlMin', russian: 'limitRussianMin', mine: 'limitMineMin', plinko: 'limitPlinkoMin', tower: 'limitTowerMin', dice: 'limitDiceMin', chicken: 'limitChickenMin' }[commandName];
    const maxKey = { blackjack: 'limitBjMax', coinflip: 'limitCfMax', roulette: 'limitRlMax', russian: 'limitRussianMax', mine: 'limitMineMax', plinko: 'limitPlinkoMax', tower: 'limitTowerMax', dice: 'limitDiceMax', chicken: 'limitChickenMax' }[commandName];
    if (minKey && cfg[minKey] > 0 && amount < cfg[minKey]) {
      return `Mise minimum : **${embed.fmtCoins(cfg[minKey])}** coins.`;
    }
    if (maxKey && cfg[maxKey] > 0 && amount > cfg[maxKey]) {
      return `Mise maximum : **${embed.fmtCoins(cfg[maxKey])}** coins.`;
    }
  }

  // Max coins check
  if (cfg.limitMaxCoins > 0) {
    const user = db.getCasinoUser(guildId, userId);
    if (user.coins >= cfg.limitMaxCoins) {
      return `Tu as atteint le plafond de **${embed.fmtCoins(cfg.limitMaxCoins)}** coins.`;
    }
  }

  return null;
}

function setCooldown(guildId, userId, commandName) {
  _cooldownStore.set(`${guildId}:${userId}:${commandName}`, Date.now());
}

function getCooldowns(guildId, userId) {
  const cfg = db.getCasinoConfig(guildId);
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const result = [];

  const inMemoryCmds = [
    { name: 'blackjack', cdKey: 'cooldownBj',  label: 'Blackjack' },
    { name: 'coinflip',  cdKey: 'cooldownCf',  label: 'Coinflip' },
    { name: 'roulette',  cdKey: 'cooldownRl',  label: 'Roulette' },
    { name: 'vol',       cdKey: 'cooldownVol', label: 'Vol' },
    { name: 'gift',      cdKey: 'cooldownGift', label: 'Gift' },
    { name: 'russian',   cdKey: 'cooldownRussian', label: 'Russian' },
    { name: 'mine',      cdKey: 'cooldownMine', label: 'Mine' },
    { name: 'plinko',    cdKey: 'cooldownPlinko', label: 'Plinko' },
    { name: 'tower',     cdKey: 'cooldownTower', label: 'Tower' },
    { name: 'chicken',   cdKey: 'cooldownChicken', label: 'Chicken' },
    { name: 'dice',      cdKey: 'cooldownDice',  label: 'Dice' },
  ];

  for (const cmd of inMemoryCmds) {
    const cdSecs = cfg[cmd.cdKey] ?? 0;
    if (cdSecs <= 0) { result.push({ name: cmd.label, remaining: 0, ready: true }); continue; }
    const last = _cooldownStore.get(`${guildId}:${userId}:${cmd.name}`) || 0;
    const elapsed = (now - last) / 1000;
    const remaining = Math.ceil(cdSecs - elapsed);
    result.push({ name: cmd.label, remaining: Math.max(0, remaining), ready: remaining <= 0 });
  }

  // Daily (DB-based, fixed 24h)
  const lastDaily = db.getLastDaily(guildId, userId);
  const dailyCd = 24 * 60 * 60;
  const dailyRemaining = (lastDaily + dailyCd) - nowSec;
  result.push({ name: 'Daily', remaining: Math.max(0, dailyRemaining), ready: dailyRemaining <= 0 });

  // Collect (DB-based, configurable)
  const collectCd = cfg.cooldownCollect ?? 0;
  if (collectCd > 0) {
    const lastCollect = db.getLastCollect(guildId, userId);
    const collectRemaining = (lastCollect + collectCd) - nowSec;
    result.push({ name: 'Collect', remaining: Math.max(0, collectRemaining), ready: collectRemaining <= 0 });
  } else {
    result.push({ name: 'Collect', remaining: 0, ready: true });
  }

  return result;
}

function buildCasinoPage(guildId, userId, page) {
  const user = db.getCasinoUser(guildId, userId);
  const equipped = db.getEquippedItemDetails(guildId, userId);

  if (page === 'shop') {
    const items = _getAvailableShopItems(guildId, userId);
    const cfg = db.getCasinoConfig(guildId);
    const userShields = db.getShields(guildId, userId);
    const lines = [];
    lines.push(`◊ **Boucliers possédés :** ${userShields}`);
    lines.push('');
    if (items.length) {
      lines.push(`**${items.length} item(s) disponible(s)** dans la boutique.`);
    } else {
      lines.push('*Aucun item disponible actuellement.*');
    }
    lines.push('');
    lines.push(`Sélectionne une catégorie ci-dessous pour voir les propositions et prix.`);
    return embed.build(guildId, lines.join('\n'), { title: '◈ Shop' });
  }

  if (page === 'profile') {
    const vocHours = Math.floor(user.vocMinutes / 60);
    const vocMins = user.vocMinutes % 60;
    const levelData = db.getLevel(guildId, userId);
    const levelConfig = db.getGuildConfig(guildId);
    const realLevel = levelConfig?.levelCumul ? levelFromXp(levelData.xp) : levelData.level;
    const rank = getRankFromLevel(realLevel);
    const prestInfo = getPrestigeInfo(realLevel);
    const levelDisplay = prestInfo.isMaster ? 'Master' : (prestInfo.prestige > 0 ? `${rank.name} ・ Niv. ${prestInfo.displayLevel}` : `Niveau ${realLevel}`);
    return embed.build(guildId, [
      `◆ **Fortune**`,
      `❃ Coins : **${embed.fmtCoins(user.coins)}**  •  Tirages : **${user.draws}**`,
      ``,
      `◆ **Progression**`,
      `❃ ${levelDisplay}  •  XP : **${embed.fmtCoins(levelData.xp)}**`,
      `❃ Palier : **${rank.icon} ${rank.name}**`,
      ``,
      `◆ **Activité**`,
      `❃ Vocal : **${vocHours}h ${vocMins}m**  •  Messages : **${user.msgCount}**`,
    ].join('\n'), { title: '◈ Profil' });
  }

  if (page === 'inventory') {
    const inv = db.getInventory(guildId, userId);
    if (!inv.length) return embed.build(guildId, 'Inventaire vide.', { title: '◈ Inventaire' });
    const lines = inv.slice(0, 20).map(item => `**#${item.itemId}** ${item.name} x${item.quantity} (${item.type})`);
    return embed.build(guildId, `${lines.join('\n')}\n\nLa gestion d'équipement se fera directement depuis ce panel.`, { title: '◈ Inventaire' });
  }

  if (page === 'achievements') {
    const achs = db.getAchievements(guildId);
    const unlocked = db.getUserAchievements(guildId, userId);
    const unlockedIds = new Set(unlocked.map(a => a.id));
    if (!achs.length) return embed.build(guildId, 'Aucun succès configuré.', { title: '◈ Succès' });
    let desc = `**${unlocked.length}/${achs.length}** succès débloqués\n\n`;
    achs.forEach(ach => {
      desc += `${unlockedIds.has(ach.id) ? '◆' : '◇'} **${ach.name}** ・ ${ach.description}\n`;
    });
    return embed.build(guildId, desc, { title: '◈ Succès' });
  }

  return embed.build(guildId, `Tu as **${user.draws}** tirage(s).\n\nClique sur **Lancer un tirage** pour tenter ta chance.`, { title: '◈ Tirage' });
}

const _UNIQUE_TYPES = new Set(['color', 'role', 'badge', 'decor', 'nitro', 'title']);

function _getAvailableShopItems(guildId, userId) {
  const items = db.getShopItems(guildId);
  if (!userId) return items;
  const inv = db.getInventory(guildId, userId);
  const ownedIds = new Set(inv.filter(i => _UNIQUE_TYPES.has(i.type)).map(i => i.itemId));
  return items.filter(item => !_UNIQUE_TYPES.has(item.type) || !ownedIds.has(item.id));
}

function buildShopCategoryRow(guildId, userId) {
  const items = _getAvailableShopItems(guildId, userId);
  const categoryMap = { title: 'Titres', role: 'Roles', badge: 'Badges', decor: 'Decorations', item: 'Items', draws: 'Tirages', xp: 'XP' };
  const options = [];
  
  for (const [type, label] of Object.entries(categoryMap)) {
    const count = items.filter(i => i.type === type).length;
    if (count > 0) {
      options.push({
        label,
        value: type,
        description: `${count} item(s) disponible(s)`,
      });
    }
  }
  
  options.push({
    label: 'Boucliers anti-vol',
    value: 'shields',
    description: 'Proteger contre les vols',
  });
  
  if (!options.length) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cs_shop_category')
      .setPlaceholder('Choisir une categorie')
      .addOptions(options.slice(0, 25)),
  );
}

function buildShopItemsRow(guildId, userId, category = null) {
  let items = _getAvailableShopItems(guildId, userId);
  if (category) items = items.filter(i => i.type === category);
  items = items.slice(0, 25);
  if (!items.length) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cs_shop_select')
      .setPlaceholder('Choisir un item à acheter')
      .addOptions(items.map(item => ({
        label: item.name.slice(0, 100),
        value: String(item.id),
        description: `${embed.fmtCoins(item.price)} coins`.slice(0, 100),
      }))),
  );
}

function buildShopShieldsRow(guildId) {
  const cfg = db.getCasinoConfig(guildId);
  const packs = [
    { qty: 1,  price: cfg.shieldPrice1  ?? 500 },
    { qty: 3,  price: cfg.shieldPrice3  ?? 1200 },
    { qty: 5,  price: cfg.shieldPrice5  ?? 1800 },
    { qty: 10, price: cfg.shieldPrice10 ?? 3000 },
  ];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cs_shop_shield_select')
      .setPlaceholder('Choisir un lot de boucliers')
      .addOptions(packs.map(p => ({
        label: `x${p.qty} bouclier${p.qty > 1 ? 's' : ''}`,
        value: String(p.qty),
        description: `${embed.fmtCoins(p.price)} coins`.slice(0, 100),
      }))),
  );
}

function buildDrawRow(disabled = false, drawsLeft = 0) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cs_panel_draw_run:1').setLabel('x1').setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cs_panel_draw_run:10').setLabel('x10').setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cs_panel_draw_run:100').setLabel('x100').setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cs_panel_draw_run:all').setLabel('All').setStyle(ButtonStyle.Secondary).setDisabled(disabled || drawsLeft < 1),
    ),
  ];
}

async function handleInteraction(interaction, id) {
  try {
    if (id !== 'cs_panel_profile') {
      const error = checkCasinoAccess(interaction);
      if (error) return interaction.reply({ embeds: [embed.build(interaction.guild?.id, error, { })], flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    if (id.startsWith('cs_panel_draw_run')) {
      const rawCount = id.split(':')[1];
      const user = db.getCasinoUser(guildId, userId);
      if (user.draws < 1) {
        return interaction.reply({ embeds: [embed.build(guildId, 'Tu n\'as pas assez de tirages.', { title: '◈ Tirage' })], flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      let count;
      if (rawCount === 'all') {
        count = user.draws;
      } else {
        count = parseInt(rawCount) || 1;
        if (count > user.draws) {
          return interaction.reply({
            embeds: [embed.build(guildId, `Tu n\'as que **${user.draws}** tirage(s) restant(s).`, { title: '◈ Tirage' })],
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('cs_panel_draw_run:all').setLabel(`All (${user.draws})`).setStyle(ButtonStyle.Secondary),
              ),
            ],
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }
      }

      const results = [];
      let totalCoins = 0;
      const itemSummary = {};
      for (let i = 0; i < count; i++) {
        db.useCasinoDraw(guildId, userId);
        const result = db.drawGacha(guildId, userId);
        if (result?.coins) totalCoins += result.coins;
        if (result?.item) {
          const key = result.item.name;
          if (!itemSummary[key]) itemSummary[key] = { count: 0, chance: result.item.chance };
          itemSummary[key].count++;
        }
        results.push(result);
      }
      const updated = db.getCasinoUser(guildId, userId);

      let rewardText = '';
      if (totalCoins > 0) rewardText += `**+${embed.fmtCoins(totalCoins)}** Mysoul Coins\n`;
      const itemKeys = Object.keys(itemSummary);
      if (itemKeys.length) {
        rewardText += itemKeys.map(name => `◆ **${name}** x${itemSummary[name].count} *(${itemSummary[name].chance}%)*`).join('\n');
      }
      if (!rewardText) rewardText = '*Pool non configuré*';

      const header = count > 1 ? `◈ Résultat ${count} Tirages` : '◈ Résultat Tirage';

      const cfg = db.getCasinoConfig(guildId);
      sendCasinoLog(interaction.guild, cfg, 'logChannelGames', {
        icon  : '◆',
        title : `Tirage x${count}`,

        user  : userId,
        lines : [
          totalCoins > 0 ? `+${embed.fmtCoins(totalCoins)} coins` : null,
          itemKeys.length ? itemKeys.map(n => `◆ ${n} x${itemSummary[n].count}`).join(' • ') : null,
          `Solde : ${embed.fmtCoins(updated.coins)} coins | ${updated.draws} tirages`,
        ].filter(Boolean),
      });

      return interaction.reply({
        embeds: [embed.build(guildId, `${rewardText}\n\n◇ Solde : **${embed.fmtCoins(updated.coins)}** coins  •  **${updated.draws}** tirage(s) restant(s)`, { title: header })],
        components: buildDrawRow(updated.draws < 1, updated.draws),
        flags: MessageFlags.Ephemeral,
      }).catch(() => {})
    }

    if (id === 'cs_panel_achievements') {
      return interaction.reply({ flags: COMPONENTS_V2_FLAG | MessageFlags.Ephemeral, components: [buildAchHomePanel(guildId, userId)] }).catch(() => {});
    }

    if (id === 'cs_panel_inventory') {
      return interaction.reply({ flags: COMPONENTS_V2_FLAG | MessageFlags.Ephemeral, components: [_buildInventoryPage(guildId, userId)] }).catch(() => {});
    }

    if (id === 'cs_panel_profile') {
      const cfg = db.getCasinoConfig(guildId);
      if (cfg.roleRequired && !interaction.member.roles.cache.has(cfg.roleRequired)) {
        try {
          await interaction.member.roles.add(cfg.roleRequired).catch(err => {
            console.error('[CASINO] Failed to add required role:', err?.message);
          });
        } catch (err) {
          console.error('[CASINO] Role add exception:', err?.message);
        }
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      const user        = db.getCasinoUser(guildId, userId);
      const levelData   = db.getLevel(guildId, userId);
      const levelConfig = db.getGuildConfig(guildId);
      const realLevel   = levelConfig?.levelCumul ? levelFromXp(levelData?.xp ?? 0) : (levelData?.level ?? 1);
      const rank        = getRankFromLevel(realLevel);
      const equipped    = db.getEquippedItemDetails(guildId, userId);
      try {
        const { generateProfileCard } = require('../../utils/profileCard');
        const buffer = await generateProfileCard(interaction.member, user, realLevel, levelData, rank, equipped, guildId, userId);
        const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
        return interaction.editReply({ files: [attachment] }).catch(() => {});
      } catch (cardErr) {
        console.error('[PROFILE-CARD] Error generating card:', cardErr?.message);
        return interaction.editReply({ embeds: [buildCasinoPage(guildId, userId, 'profile')] }).catch(() => {});
      }
    }

    const page = id === 'cs_panel_shop' ? 'shop'
      : id === 'cs_panel_inventory' ? 'inventory'
        : 'draw';

    const payload = {
      embeds: [buildCasinoPage(guildId, userId, page)],
      flags: MessageFlags.Ephemeral,
    };

    if (page === 'shop') {
      const categoryRow = buildShopCategoryRow(guildId, userId);
      if (categoryRow) payload.components = [categoryRow];
    }
    if (page === 'draw') {
      const drawsLeft = db.getCasinoUser(guildId, userId).draws;
      payload.components = buildDrawRow(drawsLeft < 1, drawsLeft);
    }
    return interaction.reply(payload).catch(() => {});
  } catch (err) {
    console.error(`[CASINO] handleInteraction error (${id}):`, err?.message);
    return interaction.reply({ embeds: [embed.build(interaction.guild?.id, 'Une erreur est survenue.')], flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

async function handleShopSelect(interaction) {
  const error = checkCasinoAccess(interaction);
  if (error) return interaction.reply({ embeds: [embed.build(interaction.guild?.id, error, { })], flags: MessageFlags.Ephemeral }).catch(() => {});

  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const itemId = parseInt(interaction.values?.[0], 10);
  const result = db.buyShopItem(guildId, userId, itemId);

  if (!result.ok) {
    const reason = result.reason === 'nomoney' ? 'Solde insuffisant.'
      : result.reason === 'notfound' ? 'Item introuvable.'
        : result.reason === 'outofstock' ? 'Rupture de stock.'
          : result.reason === 'alreadyowned' ? 'Tu possèdes déjà cet item.'
            : 'Achat impossible.';
    return interaction.reply({ embeds: [embed.build(guildId, reason, { title: '◈ Boutique' })], flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  const user = db.getCasinoUser(guildId, userId);
  return interaction.reply({
    embeds: [embed.build(guildId, `Tu as acheté **${result.item.name}**.\n\nSolde : **${embed.fmtCoins(user.coins)}** coins`, { title: '◈ Achat confirmé' })],
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

async function handleShopCategory(interaction) {
  const error = checkCasinoAccess(interaction);
  if (error) return interaction.reply({ embeds: [embed.build(interaction.guild?.id, error, { })], flags: MessageFlags.Ephemeral }).catch(() => {});

  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const category = interaction.values?.[0];
  const categoryLabels = { title: 'Titres', role: 'Roles', badge: 'Badges', decor: 'Decorations', item: 'Items', draws: 'Tirages', xp: 'XP' };

  if (category === 'shields') {
    const cfg = db.getCasinoConfig(guildId);
    const userShields = db.getShields(guildId, userId);
    const packs = [
      { qty: 1,  price: cfg.shieldPrice1  ?? 500 },
      { qty: 3,  price: cfg.shieldPrice3  ?? 1200 },
      { qty: 5,  price: cfg.shieldPrice5  ?? 1800 },
      { qty: 10, price: cfg.shieldPrice10 ?? 3000 },
    ];
    const lines = packs.map(p => `◊ **x${p.qty}** bouclier${p.qty > 1 ? 's' : ''} ・ **${embed.fmtCoins(p.price)}** coins`);
    lines.push('');
    lines.push(`Tu as actuellement **${userShields}** bouclier(s).`);
    lines.push('1 bouclier = 1 vol bloqué.');
    const shieldsRow = buildShopShieldsRow(guildId);
    return interaction.reply({
      embeds: [embed.build(guildId, `${lines.join('\n')}\n\nChoisis un lot à acheter :`, { title: '◊ Boucliers anti-vol' })],
      components: [shieldsRow],
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  // Handle category items
  const items = _getAvailableShopItems(guildId, userId).filter(i => i.type === category);
  if (!items.length) {
    return interaction.reply({ embeds: [embed.build(guildId, 'Aucun item disponible dans cette catégorie.', { title: `◈ ${categoryLabels[category] || category}` })], flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  const lines = items.slice(0, 15).map(item => `**${item.name}** ・ ${embed.fmtCoins(item.price)} coins`);
  const itemsRow = buildShopItemsRow(guildId, userId, category);
  return interaction.reply({
    embeds: [embed.build(guildId, `${lines.join('\n')}\n\nChoisis un item à acheter :`, { title: `◈ ${categoryLabels[category] || category}` })],
    components: itemsRow ? [itemsRow] : [],
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

async function handleShopShieldSelect(interaction) {
  const error = checkCasinoAccess(interaction);
  if (error) return interaction.reply({ embeds: [embed.build(interaction.guild?.id, error, { })], flags: MessageFlags.Ephemeral }).catch(() => {});

  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const qty = parseInt(interaction.values?.[0], 10) || 1;
  const cfg = db.getCasinoConfig(guildId);
  const priceKey = { 1: 'shieldPrice1', 3: 'shieldPrice3', 5: 'shieldPrice5', 10: 'shieldPrice10' }[qty] ?? 'shieldPrice1';
  const price = cfg[priceKey] ?? 500;
  const user = db.getCasinoUser(guildId, userId);

  if (user.coins < price) {
    return interaction.reply({ embeds: [embed.build(guildId, `Solde insuffisant. Prix : **${embed.fmtCoins(price)}** coins. Solde : **${embed.fmtCoins(user.coins)}**`, { title: '◊ Boucliers' })], flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  const currentShields = db.getShields(guildId, userId);
  if (currentShields >= 10) {
    return interaction.reply({ embeds: [embed.build(guildId, `Tu as déjà le maximum de **10** boucliers.`, { title: '◊ Boucliers' })], flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  db.removeCasinoCoins(guildId, userId, price, 'spend');
  db.addShields(guildId, userId, qty);
  const newShields = db.getShields(guildId, userId);
  const updated = db.getCasinoUser(guildId, userId);
  return interaction.reply({
    embeds: [embed.build(guildId, `Tu as acheté **${qty}** bouclier(s) pour **${embed.fmtCoins(price)}** coins.\n\nBoucliers : **${newShields}**\nSolde : **${embed.fmtCoins(updated.coins)}** coins`, { title: '◊ Achat confirmé' })],
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

// ============ CONFIG PANEL (Components V2 Premium) ============
function buildConfigPanel(guild, view = 'overview') {
  const guildId = guild.id;
  const config = db.getCasinoConfig(guildId);

  const status = config.enabled ? '**ACTIF**' : '**DESACTIVE**';
  const panelCh = config.panelChannelId ? `<#${config.panelChannelId}>` : '*Non defini*';
  const logGains = config.logChannelGains ? `<#${config.logChannelGains}>` : '*Non defini*';
  const logGames = config.logChannelGames ? `<#${config.logChannelGames}>` : '*Non defini*';
  const allowedList = config.allowedChannels ? config.allowedChannels.split(',').filter(Boolean) : [];
  const allowed = allowedList.length ? allowedList.slice(0, 8).map(id => `<#${id}>`).join(', ') : '*Tous les salons*';
  const roleReq = config.roleRequired ? `<@&${config.roleRequired}>` : '*Aucun*';
  const roleMul = config.roleMultiplierId ? `<@&${config.roleMultiplierId}>` : '*Aucun*';
  const statMul = config.statusMultiplier ? '**Actif**' : '*Desactive*';
  const vocRate = `**${config.coinsPerVocMin ?? 0}** coins/min + **${config.drawsPerVocHour}** tirage/h`;
  const collectBonus = `**+${Math.round((config.collectBonusRate ?? 0.5) * 100)}%** bonus`;
  const msgRate = `**${config.coinsPerMsg * config.msgsForCoins}** coins/${config.msgsForCoins} msgs`;
  const dailyRate = `**${config.dailyCoins}** coins + **${config.dailyDraws}** tirage/jour`;
  const shopItems = db.getShopItems(guildId);
  const gachaPool = db.getGachaPool(guildId);
  const levelRoles = db.getCasinoLevelRoles(guildId);
  const shopPreview = shopItems.length ? shopItems.slice(0, 6).map(item => `• **${item.name}** ・ ${embed.fmtCoins(item.price)} coins (${item.type})`).join('\n') : '*Aucun item configuré*';
  const gachaPreview = gachaPool.length ? gachaPool.slice(0, 6).map(item => `• **#${item.id}** ${item.name} ・ ${item.type} / poids ${item.weight}`).join('\n') : '*Aucune récompense configurée*';
  const levelPreview = levelRoles.length ? levelRoles.slice(0, 6).map(item => `• Niveau **${item.level}** ・ <@&${item.roleId}>`).join('\n') : '*Aucun rôle de niveau configuré*';
  const container = new ContainerBuilder();
  if (view === 'overview') {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Administration Casino\n> Statut : ${status}`),
    );
    container.addSeparatorComponents(new SeparatorBuilder());
  }
  const nav = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('csconf_view')
      .setPlaceholder('Choisir une section à configurer')
      .addOptions(
        { label: 'Vue generale', value: 'overview', description: 'Statut, salon panel et resume', default: view === 'overview' },
        { label: 'Salons & Logs', value: 'channels', description: 'Panel, salons autorises, logs', default: view === 'channels' },
        { label: 'Roles & Acces', value: 'roles', description: 'Role requis et multiplicateurs', default: view === 'roles' },
        { label: 'Commandes', value: 'commands', description: 'Commandes restreintes aux salons', default: view === 'commands' },
        { label: 'Cotes des Jeux', value: 'cotes', description: 'Multiplicateurs de gains par jeu', default: view === 'cotes' },
        { label: 'Gains & Economie', value: 'gains', description: 'Vocal, messages, daily, tirages', default: view === 'gains' },
        { label: 'Limites & Cooldowns', value: 'limits', description: 'Mises, cooldowns, plafonds', default: view === 'limits' },
        { label: 'Modules Casino', value: 'modules', description: 'Shop, tirages, niveaux', default: view === 'modules' },
        { label: 'Boutique Admin', value: 'shop_admin', description: 'Gerer les items de boutique', default: view === 'shop_admin' },
        { label: 'Tirages Admin', value: 'gacha_admin', description: 'Gerer les recompenses des tirages', default: view === 'gacha_admin' },
        { label: 'Niveaux Admin', value: 'levels_admin', description: 'Gerer les roles par niveau', default: view === 'levels_admin' },
        { label: 'Panel', value: 'panel_admin', description: 'Modifier les sections du panel casino', default: view === 'panel_admin' },
        { label: 'Reglement', value: 'rules', description: 'Modifier le reglement du casino', default: view === 'rules' },
      ),
  );
  container.addActionRowComponents(nav);
  container.addSeparatorComponents(new SeparatorBuilder());
  if (view === 'channels') {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Salons & Logs\n\n` +
      `> **Salon Panel :** ${panelCh}\n` +
      `> **Salons autorises :** ${allowed}\n` +
      `> **Log gains :** ${logGains}\n` +
      `> **Log jeux :** ${logGames}\n\n` +
      `-# Selectionne une action ci-dessous, puis choisis le salon.`
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('csconf_panelch').setLabel('Salon Panel').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('csconf_allowed').setLabel('Salons Autorises').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('csconf_logs').setLabel('Logs').setStyle(ButtonStyle.Secondary),
    ));
  } else if (view === 'roles') {
    const statusText = config.statusText || '*Non configuré*';
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Roles & Acces\n\n` +
      `> **Role requis :** ${roleReq}\n` +
      `> **Multiplicateur statut :** ${statMul}\n` +
      `> **Texte(s) statut :** \`${statusText}\`\n\n` +
      `-# Le role bonus se configure dans la section **Cotes des Jeux**.`
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('csconf_roles').setLabel('Modifier Roles').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('csconf_statusmul').setLabel(config.statusMultiplier ? 'Desactiver Statut' : 'Activer Statut').setStyle(config.statusMultiplier ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('csconf_statustext').setLabel('Config Texte Statut').setStyle(ButtonStyle.Secondary),
    ));
  } else if (view === 'commands') {
    const restrictedList = config.restrictedCommands ? config.restrictedCommands.split(',').filter(Boolean) : [];
    const restrictedText = restrictedList.length ? restrictedList.map(c => `\`${c}\``).join(', ') : '*Aucune restriction*';
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Commandes restreintes\n\n` +
      `> Commandes bloquees hors salons autorises :\n${restrictedText}\n\n` +
      `-# Selectionne les commandes a restreindre ci-dessous.`
    ));
    const cmdOptions = ['blackjack', 'coinflip', 'roulette', 'daily', 'collect', 'don', 'top', 'timer', 'vol', 'jackpot', 'russian', 'mine', 'plinko', 'tower', 'chicken', 'dice', 'invest', 'claims', 'withdraw', 'analytics', 'compare'].map(cmd => ({
      label: cmd.charAt(0).toUpperCase() + cmd.slice(1),
      value: cmd,
      description: `Restreindre +${cmd} au salon casino`,
      default: restrictedList.includes(cmd),
    }));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('csconf_commands_sel')
        .setPlaceholder('Choisir commandes restreintes')
        .setMinValues(0)
        .setMaxValues(cmdOptions.length)
        .addOptions(cmdOptions),
    ));
  } else if (view === 'cotes') {
    const bjCote = config.coteBlackjack ?? 2.0;
    const cfCote = config.coteCoinflip ?? 2.0;
    const bjBonus = config.coteBlackjackBonus ?? 2.5;
    const cfBonus = config.coteCoinflipBonus ?? 2.5;
    const bjStatus = config.coteBlackjackStatus ?? 2.5;
    const cfStatus = config.coteCoinflipStatus ?? 2.5;
    const bonusRole = config.coteBonusRole ? `<@&${config.coteBonusRole}>` : '*Non défini*';
    const statusActive = config.statusMultiplier ? '**Actif**' : '*Désactivé*';

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Cotes des Jeux\n\n` +
      `### Cotes normales\n` +
      `> Blackjack \`x${bjCote}\` • Coinflip \`x${cfCote}\` • Roulette \`x1.05→x10\`\n\n` +
      `### Cotes bonus role (${bonusRole})\n` +
      `> Blackjack \`x${bjBonus}\` • Coinflip \`x${cfBonus}\`\n\n` +
      `### Cotes bonus statut (${statusActive})\n` +
      `> Blackjack \`x${bjStatus}\` • Coinflip \`x${cfStatus}\`\n\n` +
      `### XP par jeu\n` +
      `> Blackjack : victoire \`${config.xpBjWin ?? 50}\` / defaite \`${config.xpBjLoss ?? 15}\` / egalite \`${config.xpBjPush ?? 5}\`\n` +
      `> Coinflip : victoire \`${config.xpCfWin ?? 30}\` / defaite \`${config.xpCfLoss ?? 10}\`\n` +
      `> Roulette : victoire \`${config.xpRlWin ?? 40}\` / defaite \`${config.xpRlLoss ?? 15}\`\n` +
      `> *L'XP de victoire est multipliee par la cote (bonus role + statut inclus)*`
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('csconf_cotes_bj').setLabel('Cotes Normales').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('csconf_cotes_bonus').setLabel('Cotes Bonus Role').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('csconf_cotes_role').setLabel('Selection Role').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('csconf_cotes_status').setLabel('Bonus Statut').setStyle(ButtonStyle.Secondary),
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('csconf_xp_config').setLabel('XP BJ+PF').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('csconf_xp_roulette').setLabel('XP Roulette').setStyle(ButtonStyle.Success),
    ));
  } else if (view === 'gains') {
    const statusActive = config.statusMultiplier ? '**Actif**' : '*Désactivé*';
    const statusVocMul = config.statusVocMultiplier ?? 2.0;
    const statusMsgMul = config.statusMsgMultiplier ?? 2.0;
    const giftMin = config.giftMin ?? 100;
    const giftMax = config.giftMax ?? 1000;
    const dailyMinVal = config.dailyMin && config.dailyMin > 0 ? config.dailyMin : null;
    const dailyMaxVal = config.dailyMax && config.dailyMax > 0 ? config.dailyMax : null;
    const dailyRange = dailyMinVal && dailyMaxVal
      ? `**${embed.fmtCoins(dailyMinVal)}** ・ **${embed.fmtCoins(dailyMaxVal)}** coins`
      : dailyRate;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Gains & Economie\n\n` +
      `### Vocal\n` +
      `> ${vocRate} *(x${config.publicVocMultiplier} en public)*\n` +
      `> Collect : ${collectBonus} sur le temps accumule\n\n` +
      `### Messages\n` +
      `> ${msgRate}\n\n` +
      `### Daily\n` +
      `> ${dailyRange}${dailyMinVal && dailyMaxVal ? ` + \`x${config.dailyDraws}\` tirage/jour` : ''}\n\n` +
      `### Gift\n` +
      `> **${embed.fmtCoins(giftMin)}** → **${embed.fmtCoins(giftMax)}** coins\n\n` +
      `### Bonus statut (${statusActive})\n` +
      `> Vocal \`x${statusVocMul}\` • Messages \`x${statusMsgMul}\`\n\n` +
      `### Jackpot\n` +
      `> Cagnotte : **${embed.fmtCoins(config.jackpotAmount ?? 0)}** coins\n` +
      `> Cout par tentative : **${embed.fmtCoins(config.jackpotCost ?? 1000)}** coins\n\n` +
      `### Bonus creation de profil\n` +
      `> Coins attribues a la creation : **${embed.fmtCoins(config.creationBonus ?? 0)}**\n\n` +
      `-# Clique sur le bouton correspondant pour modifier.`
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('csconf_gains').setLabel('Modifier Gains').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('csconf_gains_status').setLabel('Bonus Statut').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('csconf_gains_gift').setLabel('Config Gift').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('csconf_gains_daily_range').setLabel('Plage Daily').setStyle(ButtonStyle.Secondary),
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('csconf_jackpot_cost').setLabel('Cout Jackpot').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('csconf_jackpot_reset').setLabel('Reset Cagnotte').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('csconf_creation_bonus').setLabel('Bonus Creation').setStyle(ButtonStyle.Success),
    ));
  } else if (view === 'limits') {
    const fmtSec = s => s > 0 ? (s >= 3600 ? `${s/3600}h` : s >= 60 ? `${s/60}min` : `${s}s`) : '*Aucun*';
    const fmtVal = v => v > 0 ? `**${embed.fmtCoins(v)}**` : '*Illimité*';
    const fmtPer = s => s > 0 ? (s >= 86400 ? `${s/86400}j` : s >= 3600 ? `${s/3600}h` : s >= 60 ? `${s/60}min` : `${s}s`) : null;
    const gainsLabel = config.limitGainsMax > 0 && config.limitGainsPeriod > 0
      ? `${fmtVal(config.limitGainsMax)} coins / ${fmtPer(config.limitGainsPeriod)}` : '*Illimité*';
    const drawsLabel = config.limitDrawsMax > 0 && config.limitDrawsPeriod > 0
      ? `${fmtVal(config.limitDrawsMax)} tirages / ${fmtPer(config.limitDrawsPeriod)}` : '*Illimité*';
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Limites & Cooldowns\n\n` +
      `### Mises\n` +
      `> Blackjack ${fmtVal(config.limitBjMin)} → ${fmtVal(config.limitBjMax)}\n` +
      `> Coinflip ${fmtVal(config.limitCfMin)} → ${fmtVal(config.limitCfMax)}\n` +
      `> Roulette ${fmtVal(config.limitRlMin)} → ${fmtVal(config.limitRlMax)}\n` +
      `> Russian ${fmtVal(config.limitRussianMin)} → ${fmtVal(config.limitRussianMax)}\n` +
      `> Mine ${fmtVal(config.limitMineMin)} → ${fmtVal(config.limitMineMax)} ・ ${config.limitMineBombs ?? 3} bombes\n` +
      `> Plinko ${fmtVal(config.limitPlinkoMin)} → ${fmtVal(config.limitPlinkoMax)}\n` +
      `> Tower ${fmtVal(config.limitTowerMin)} → ${fmtVal(config.limitTowerMax)}\n` +
      `> Dice ${fmtVal(config.limitDiceMin)} → ${fmtVal(config.limitDiceMax)}\n\n` +
      `### Cooldowns\n` +
      `> Blackjack \`${fmtSec(config.cooldownBj)}\` • Coinflip \`${fmtSec(config.cooldownCf)}\` • Roulette \`${fmtSec(config.cooldownRl)}\`\n` +
      `> Collect \`${fmtSec(config.cooldownCollect)}\` • Daily \`24h\` • Vol \`${fmtSec(config.cooldownVol)}\` • Gift \`${fmtSec(config.cooldownGift)}\`\n` +
      `> Russian \`${fmtSec(config.cooldownRussian)}\` • Mine \`${fmtSec(config.cooldownMine)}\` • Plinko \`${fmtSec(config.cooldownPlinko)}\` • Tower \`${fmtSec(config.cooldownTower)}\`\n` +
      `> Dice \`${fmtSec(config.cooldownDice)}\`\n\n` +
      `### Investissements\n` +
      `> Min ${fmtVal(config.investmentMin || 10000)} • Max ${fmtVal(config.investmentMax || 1000000)}\n` +
      `> Taux ${((config.investmentRate || 0.05) * 100).toFixed(1)}% • Cooldown claim \`${fmtSec(config.investmentClaimCooldown || 86400)}\`\n` +
      `> Pénalité retrait \`${((config.withdrawalPenalty ?? 0.1) * 100).toFixed(0)}%\`\n\n` +
      `### Plafonds\n` +
      `> Coins max ${fmtVal(config.limitMaxCoins)} • Tirages max ${fmtVal(config.limitMaxDraws)}\n` +
      `> Gains max ${gainsLabel} • Tirages/periode ${drawsLabel}`
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('csconf_limits_sel')
        .setPlaceholder('Choisir une catégorie à configurer')
        .addOptions(
          { label: 'Mises min/max', value: 'mises', description: 'Mise minimale et maximale par jeu' },
          { label: 'Cooldowns', value: 'cooldowns', description: 'Intervalle entre chaque commande' },
          { label: 'Investissements', value: 'investments', description: 'Min, max, taux, cooldown claim' },
          { label: 'Plafonds', value: 'plafonds', description: 'Max coins, max gains/tirages par periode' },
        ),
    ));
  } else if (view === 'modules') {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Modules Casino\n\n` +
      `### Boutique\n` +
      `> items, roles, icones, tirages, acces\n\n` +
      `### Tirages\n` +
      `> pool de recompenses et probabilites\n\n` +
      `### Niveaux\n` +
      `> roles gagnes via progression\n\n` +
      `### Panel\n` +
      `> contenu du panel casino public\n\n` +
      `-# Selectionne un module pour ouvrir sa page d'administration.`
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('csconf_shop').setLabel('Boutique').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('csconf_gacha').setLabel('Tirages').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('csconf_lvlroles').setLabel('Niveaux').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('csconf_panel').setLabel('Panel').setStyle(ButtonStyle.Secondary),
    ));
  } else if (view === 'shop_admin') {
    const sP1 = config.shieldPrice1 ?? 500;
    const sP3 = config.shieldPrice3 ?? 1200;
    const sP5 = config.shieldPrice5 ?? 1800;
    const sP10 = config.shieldPrice10 ?? 3000;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Boutique Admin\n\n` +
      `> **Items actifs :** ${shopItems.length}\n\n` +
      `${shopPreview}\n\n` +
      `### ◊ Boucliers anti-vol\n` +
      `> x1 : **${embed.fmtCoins(sP1)}** coins ・ x3 : **${embed.fmtCoins(sP3)}** coins\n` +
      `> x5 : **${embed.fmtCoins(sP5)}** coins ・ x10 : **${embed.fmtCoins(sP10)}** coins\n\n` +
      `-# Ajoute ou supprime des items directement depuis le panel.`
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('csconf_shop_add').setLabel('Ajouter Item').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('csconf_shop_remove').setLabel('Supprimer Item').setStyle(ButtonStyle.Danger).setDisabled(!shopItems.length),
      new ButtonBuilder().setCustomId('csconf_shield_prices').setLabel('Prix Boucliers').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('csconf_back_modules').setLabel('Retour Modules').setStyle(ButtonStyle.Secondary),
    ));
  } else if (view === 'gacha_admin') {
    const coinsConfig = gachaPool.find(i => i.type === 'coins');
    const coinsLine = coinsConfig ? `Coins : **${embed.fmtCoins(coinsConfig.value ?? 0)}** a **${embed.fmtCoins(coinsConfig.valueMax ?? coinsConfig.value ?? 0)}** par tirage` : 'Coins : *Non configure*';
    const itemLines = gachaPool.filter(i => i.type !== 'coins');
    const itemsText = itemLines.length
      ? itemLines.slice(0, 8).map(i => `• **#${i.id}** ${i.name} ・ ${i.chance}% (${i.type})`).join('\n')
      : '*Aucun item bonus configuré*';
    const totalChance = itemLines.reduce((s, i) => s + (i.chance ?? 0), 0);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Tirages Admin\n\n` +
      `> ${coinsLine}\n\n` +
      `**Items bonus** (total: ${totalChance.toFixed(1)}%):\n${itemsText}\n\n` +
      `-# Les items de type unique (couleur, role, badge...) ne peuvent etre obtenus qu'une seule fois.`
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('csconf_gacha_coins').setLabel('Config Coins').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('csconf_gacha_add').setLabel('Ajouter Item Bonus').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('csconf_gacha_remove').setLabel('Supprimer Item').setStyle(ButtonStyle.Danger).setDisabled(!itemLines.length),
      new ButtonBuilder().setCustomId('csconf_back_modules').setLabel('Retour').setStyle(ButtonStyle.Secondary),
    ));
  } else if (view === 'levels_admin') {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Niveaux Admin\n\n` +
      `> **Roles configures :** ${levelRoles.length}\n\n` +
      `${levelPreview}\n\n` +
      `-# Ajoute ou retire les recompenses de progression depuis le panel.`
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('csconf_level_add').setLabel('Ajouter Role Niveau').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('csconf_level_remove').setLabel('Supprimer Role Niveau').setStyle(ButtonStyle.Danger).setDisabled(!levelRoles.length),
      new ButtonBuilder().setCustomId('csconf_back_modules').setLabel('Retour Modules').setStyle(ButtonStyle.Secondary),
    ));
  } else if (view === 'panel_admin') {
    const guildId2 = guild.id;
    const sections = getPanelSections(guildId2);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Panel Casino Admin\n\n` +
      `> ${sections.length ? sections.map((s, i) => `**${i + 1}.** ${s.title}`).join('\n> ') : '*Aucune section ・ les sections par defaut seront utilisees.*'}\n\n` +
      `-# Utilise les boutons pour ajouter, modifier ou supprimer une section du panel.`
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('csconf_panel_add').setLabel('Ajouter section').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('csconf_panel_edit').setLabel('Modifier section').setStyle(ButtonStyle.Primary).setDisabled(!sections.length),
      new ButtonBuilder().setCustomId('csconf_panel_del').setLabel('Supprimer section').setStyle(ButtonStyle.Danger).setDisabled(!sections.length),
      new ButtonBuilder().setCustomId('csconf_panel_reset').setLabel('Reinitialiser').setStyle(ButtonStyle.Secondary).setDisabled(!sections.length),
    ));
  } else if (view === 'rules') {
    const guildId2 = guild.id;
    const sections = getRulesSections(guildId2);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Reglement du Casino\n\n` +
      `> ${sections.length ? sections.map((s, i) => `**${i + 1}.** ${s.title}`).join('\n> ') : '*Aucune section ・ les sections par defaut seront utilisees.*'}\n\n` +
      `-# Utilise les boutons pour ajouter, modifier ou supprimer une section.`
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('csconf_rules_add').setLabel('Ajouter section').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('csconf_rules_edit').setLabel('Modifier section').setStyle(ButtonStyle.Primary).setDisabled(!sections.length),
      new ButtonBuilder().setCustomId('csconf_rules_del').setLabel('Supprimer section').setStyle(ButtonStyle.Danger).setDisabled(!sections.length),
      new ButtonBuilder().setCustomId('csconf_rules_reset').setLabel('Reinitialiser').setStyle(ButtonStyle.Secondary).setDisabled(!sections.length),
    ));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Vue generale\n\n` +
      `> **Casino :** ${status}\n` +
      `> **Salon Panel :** ${panelCh}\n` +
      `> **Salons autorises :** ${allowed}\n` +
      `> **Role requis :** ${roleReq}\n` +
      `> **Role multiplicateur :** ${roleMul}\n` +
      `> **Logs :** gains ${logGains} / jeux ${logGames}\n` +
      `> **Gains :** ${vocRate} / ${msgRate}`
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('csconf_toggle').setLabel(config.enabled ? 'Desactiver Casino' : 'Activer Casino').setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('csconf_publish').setLabel('Publier Panel').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('csconf_close').setLabel('Fermer').setStyle(ButtonStyle.Secondary),
    ));
  }
  return container;
}

async function sendConfigPanel(message) {
  const guildId = message.guild.id;
  const userId = message.author.id;

  const container = buildConfigPanel(message.guild);

  const panel = await message.reply({
    flags: COMPONENTS_V2_FLAG,
    components: [container],
  }).catch(() => null);

  // Register panel for later editing
  if (panel) {
    const interactionCreate = require('../../events/interactionCreate');
    if (interactionCreate.registerCasinoConfigPanel) {
      interactionCreate.registerCasinoConfigPanel(guildId, userId, panel);
    }
  }

  // Collector disabled - buttons handled globally in interactionCreate.js
  // if (panel) handleConfigInteractions(panel, message);
}

exports.sendConfigPanel = sendConfigPanel;
exports.buildConfigPanel = buildConfigPanel;
exports.buildCasinoHomePanel = buildCasinoHomePanel;
exports.handlePanelInteractions = handlePanelInteractions;
exports.handlePanelNav = handlePanelNav;
exports.handlePanelDraw = handlePanelDraw;
exports.handleInteraction = handleInteraction;
async function handleInventoryCategory(interaction) {
  const error = checkCasinoAccess(interaction);
  if (error) return interaction.reply({ embeds: [embed.build(interaction.guild?.id, error, { })], flags: MessageFlags.Ephemeral }).catch(() => {});

  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const category = interaction.values?.[0];
  const categoryLabels = { title: 'Titres', role: 'Roles', badge: 'Badges', decor: 'Decorations', item: 'Items', draws: 'Tirages', xp: 'XP' };

  if (category === 'shields') {
    const userShields = db.getShields(guildId, userId);
    return interaction.reply({
      embeds: [embed.build(guildId, `Tu as **${userShields}** bouclier(s).\n\n1 bouclier = 1 vol bloqué.`, { title: '◊ Boucliers anti-vol' })],
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  // Handle category items
  const inv = db.getInventory(guildId, userId);
  const items = inv.filter(i => i.type === category);
  if (!items.length) {
    return interaction.reply({ embeds: [embed.build(guildId, 'Aucun item dans cette catégorie.', { title: `◈ ${categoryLabels[category] || category}` })], flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  const lines = items.map(item => `**${item.name}** x${item.quantity}`);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cs_inv_select:${category}`)
    .setPlaceholder('Choisir un item')
    .addOptions(items.map(item => ({
      label: item.name.slice(0, 100),
      value: String(item.itemId),
      description: `x${item.quantity}`,
    })));

  return interaction.reply({
    embeds: [embed.build(guildId, `${lines.join('\n')}\n\nChoisis un item :`, { title: `◈ ${categoryLabels[category] || category}` })],
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

async function handleInventorySelect(interaction) {
  console.log(`[1] handleInventorySelect called`);
  const error = checkCasinoAccess(interaction);
  if (error) return interaction.reply({ embeds: [embed.build(interaction.guild?.id, error, { })], flags: MessageFlags.Ephemeral }).catch(() => {});

  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const itemId = parseInt(interaction.values?.[0], 10);
  const category = interaction.customId.split(':')[1];

  console.log(`[2] handleInventorySelect: guildId=${guildId}, userId=${userId}, itemId=${itemId}, category=${category}`);

  const inv = db.getInventory(guildId, userId);
  console.log(`[3] Inventory fetched: ${inv.length} items`);
  
  const item = inv.find(i => i.itemId === itemId);
  console.log(`[4] Item found: ${item ? item.name : 'NOT FOUND'}`);
  
  if (!item) {
    console.log(`[ERROR] Item not found: ${itemId}`);
    return interaction.reply({ embeds: [embed.build(guildId, 'Item non trouvé.', { })], flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  if (category === 'xp') {
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cs_inv_use_xp:${itemId}`).setLabel('Utiliser').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cs_inv_remove:${itemId}`).setLabel('Clear').setStyle(ButtonStyle.Danger),
    );
    return interaction.reply({
      embeds: [embed.build(guildId, `**${item.name}** x${item.quantity}\n\nChoisis une action :`, { title: 'XP' })],
      components: [buttons],
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  if (['role', 'color', 'badge', 'decor'].includes(category)) {
    const user = await interaction.guild?.members.fetch(userId).catch(() => null);
    const hasRole = user?.roles.cache.has(item.roleId);
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cs_inv_toggle_role:${itemId}`).setLabel(hasRole ? 'Retirer du profil' : 'Ajouter au profil').setStyle(hasRole ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cs_inv_remove:${itemId}`).setLabel('Clear').setStyle(ButtonStyle.Danger),
    );
    return interaction.reply({
      embeds: [embed.build(guildId, `**${item.name}** x${item.quantity}\n\n${hasRole ? '✓ Actuellement équipé' : 'Non équipé'}\n\nChoisis une action :`, { title: category === 'color' ? 'Couleur' : category === 'badge' ? 'Badge' : category === 'decor' ? 'Décoration' : 'Rôle' })],
      components: [buttons],
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  if (category === 'title') {
    const user = db.getCasinoUser(guildId, userId);
    const isActive = Number(user?.activeTitle) === Number(itemId);
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cs_inv_toggle_title:${itemId}`).setLabel(isActive ? 'Retirer du profil' : 'Afficher sur profil').setStyle(isActive ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cs_inv_remove:${itemId}`).setLabel('Clear').setStyle(ButtonStyle.Danger),
    );
    return interaction.reply({
      embeds: [embed.build(guildId, `**${item.name}** x${item.quantity}\n\n${isActive ? '✓ Actuellement affiché' : 'Non affiché'}\n\nChoisis une action :`, { title: 'Titre' })],
      components: [buttons],
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cs_inv_remove:${itemId}`).setLabel('Clear').setStyle(ButtonStyle.Danger),
  );
  return interaction.reply({
    embeds: [embed.build(guildId, `**${item.name}** x${item.quantity}`, { title: 'Item' })],
    components: [buttons],
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

async function handleInventoryAction(interaction, id) {
  const error = checkCasinoAccess(interaction);
  if (error) return interaction.reply({ embeds: [embed.build(interaction.guild?.id, error, { })], flags: MessageFlags.Ephemeral }).catch(() => {});

  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const itemId = parseInt(id.split(':')[1], 10);
  console.log(`[INV-ACTION] start id=${id} guild=${guildId} user=${userId} item=${itemId}`);

  const inv = db.getInventory(guildId, userId);
  const item = inv.find(i => Number(i.itemId) === Number(itemId));
  if (!item) {
    console.log(`[INV-ACTION] item not found item=${itemId} inv=${inv.map(i => i.itemId).join(',')}`);
    return interaction.reply({ content: 'Item non trouvé dans ton inventaire.', flags: 64 }).catch(() => {});
  }

  if (id.startsWith('cs_inv_use_xp:')) {
    const xpAmount = parseInt(item.rewardQuantity || item.stock || item.quantity || 1, 10) || 1;
    db.addCasinoXP(guildId, userId, xpAmount);
    db.removeInventoryItem(guildId, userId, itemId, 1);
    const user = db.getCasinoUser(guildId, userId);
    console.log(`[INV-ACTION] xp used amount=${xpAmount} total=${user?.xp}`);
    return interaction.reply({ content: `✓ **${xpAmount} XP** utilisé. Total : **${user?.xp ?? 0} XP**`, flags: 64 }).catch(() => {});
  }

  if (id.startsWith('cs_inv_toggle_role:')) {
    const roleId = item.roleId || (/^\d{17,20}$/.test(String(item.colorHex || '')) ? item.colorHex : null);
    if (!roleId) {
      console.log(`[INV-ACTION] missing roleId for item=${itemId} type=${item.type}`);
      return interaction.reply({ content: 'Cet item n’a aucun rôle configuré.', flags: 64 }).catch(() => {});
    }
    const member = await interaction.guild.members.fetch(userId).catch(e => {
      console.error('[INV-ACTION] member fetch failed:', e);
      return null;
    });
    if (!member) return interaction.reply({ content: 'Membre introuvable.', flags: 64 }).catch(() => {});

    const hasRole = member.roles.cache.has(roleId);
    try {
      if (hasRole) {
        await member.roles.remove(roleId, 'Casino inventory toggle');
        console.log(`[INV-ACTION] role removed role=${roleId}`);
      } else {
        await member.roles.add(roleId, 'Casino inventory toggle');
        console.log(`[INV-ACTION] role added role=${roleId}`);
      }
      
      const newHasRole = !hasRole;
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cs_inv_toggle_role:${itemId}`).setLabel(newHasRole ? 'Retirer du profil' : 'Ajouter au profil').setStyle(newHasRole ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cs_inv_remove:${itemId}`).setLabel('Clear').setStyle(ButtonStyle.Danger),
      );
      return interaction.update({
        embeds: [embed.build(guildId, `**${item.name}** x${item.quantity}\n\n${newHasRole ? '✓ Actuellement équipé' : 'Non équipé'}\n\nChoisis une action :`, { title: item.type === 'color' ? 'Couleur' : item.type === 'badge' ? 'Badge' : item.type === 'decor' ? 'Décoration' : 'Rôle' })],
        components: [buttons],
      }).catch(() => {});
    } catch (e) {
      console.error('[INV-ACTION] role toggle failed:', e);
      return interaction.reply({ content: `Impossible de modifier le rôle : ${e.message}`, flags: 64 }).catch(() => {});
    }
  }

  if (id.startsWith('cs_inv_toggle_title:')) {
    const user = db.getCasinoUser(guildId, userId);
    const activeTitle = user?.activeTitle == null ? null : Number(user.activeTitle);
    const nextTitle = activeTitle === Number(itemId) ? null : itemId;
    db.setActiveTitle(guildId, userId, nextTitle);
    console.log(`[INV-ACTION] title set old=${activeTitle} new=${nextTitle}`);
    
    const isActive = nextTitle === Number(itemId);
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cs_inv_toggle_title:${itemId}`).setLabel(isActive ? 'Retirer du profil' : 'Afficher sur profil').setStyle(isActive ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cs_inv_remove:${itemId}`).setLabel('Clear').setStyle(ButtonStyle.Danger),
    );
    return interaction.update({
      embeds: [embed.build(guildId, `**${item.name}** x${item.quantity}\n\n${isActive ? '✓ Actuellement affiché' : 'Non affiché'}\n\nChoisis une action :`, { title: 'Titre' })],
      components: [buttons],
    }).catch(() => {});
  }

  if (id.startsWith('cs_inv_remove:')) {
    db.removeInventoryItem(guildId, userId, itemId, item.quantity);
    console.log(`[INV-ACTION] item removed item=${itemId} qty=${item.quantity}`);
    return interaction.reply({ content: `✓ **${item.name}** supprimé de ton inventaire.`, flags: 64 }).catch(() => {});
  }

  return interaction.reply({ content: 'Action inconnue.', flags: 64 }).catch(() => {});
}

exports.handleShopSelect = handleShopSelect;
exports.handleShopCategory = handleShopCategory;
exports.handleShopShieldSelect = handleShopShieldSelect;
exports.handleInventoryCategory = handleInventoryCategory;
exports.handleInventorySelect = handleInventorySelect;
exports.handleInventoryAction = handleInventoryAction;
exports.handleAchievementInteraction = handleAchievementInteraction;
exports.checkCasinoChannel = checkCasinoChannel;
exports.getRankFromLevel = getRankFromLevel;
exports.getPrestigeInfo = getPrestigeInfo;
exports.MAX_LEVEL = MAX_LEVEL;
exports.getGameCote = getGameCote;
exports.getGameCoteInfo = getGameCoteInfo;
exports.getRulesSections = getRulesSections;
exports.getPanelSections = getPanelSections;
exports.checkCasinoLimits = checkCasinoLimits;
exports.setCooldown = setCooldown;
exports.getCooldowns = getCooldowns;
exports.checkGainsPeriodLimit = checkGainsPeriodLimit;

// ============ CASINO LOG (V2) ============
function sendCasinoLog(guild, cfg, channelType, opts) {
  if (!cfg || !cfg[channelType]) return;
  const logCh = guild.channels.cache.get(cfg[channelType]);
  if (!logCh) return;

  const { icon, title, lines, user } = opts;

  const parts = [
    `### ${icon} ${title}`,
    '',
  ];

  if (user) parts.push(`<@${user}>`);
  for (const line of lines) parts.push(line);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(parts.join('\n')));

  logCh.send({
    components      : [container],
    flags           : COMPONENTS_V2_FLAG,
    allowedMentions : { parse: [] },
  }).catch(() => {});
}

exports.sendCasinoLog = sendCasinoLog;

// ============ RULES PANEL ============
function getRulesSections(guildId) {
  const cfg = db.getCasinoConfig(guildId);
  if (cfg.casinoRules) {
    try { return JSON.parse(cfg.casinoRules); } catch {}
  }
  return RULES_SECTIONS;
}

async function sendRulesPanel(message) {
  const guildId  = message.guild.id;
  const sections = getRulesSections(guildId);
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('# ◈ Règlement du Casino')
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(1));

  for (let i = 0; i < sections.length; i++) {
    const { title, content } = sections[i];
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${title}\n${content}`)
    );
    if (i < sections.length - 1) {
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(1));
    }
  }

  await message.channel.send({
    components: [container],
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

// ============ INTERACTION HANDLERS ============
function handleConfigInteractions(panel, message) {
  const { author, guild } = message;
  const guildId = guild.id;

  const collector = panel.createMessageComponentCollector({
    filter : i => i.user.id === author.id,
    idle   : 180_000,
    time   : 600_000,
  });

  collector.on('collect', async interaction => {
    const cid = interaction.customId;

    // Close
    if (cid === 'csconf_close') {
      collector.stop('closed');
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      return;
    }

    // Toggle
    if (cid === 'csconf_toggle') {
      const cfg = db.getCasinoConfig(guildId);
      db.enableCasino(guildId, !cfg.enabled);
      await interaction.deferUpdate().catch(() => {});
      await sendConfigPanel(message);
      panel.delete().catch(() => {});
      return;
    }

    // Panel channel
    if (cid === 'csconf_panelch') {
      const select = new ChannelSelectMenuBuilder()
        .setCustomId('csconf_panelch_sel')
        .setChannelTypes(ChannelType.GuildText)
        .setPlaceholder('Choisir le salon du panel');
      await interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    // Allowed channels
    if (cid === 'csconf_allowed') {
      const select = new ChannelSelectMenuBuilder()
        .setCustomId('csconf_allowed_sel')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1).setMaxValues(10)
        .setPlaceholder('Choisir les salons autorises');
      await interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    // Logs
    if (cid === 'csconf_logs') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('csconf_logs_sel')
        .setPlaceholder('Type de log')
        .addOptions(
          { label: 'Gains', value: 'gains', description: 'Vocal, messages, tirages, daily' },
          { label: 'Jeux', value: 'games', description: 'Roulette, blackjack, duels' },
        );
      await interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    // Roles
    if (cid === 'csconf_roles') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('csconf_roles_sel')
        .setPlaceholder('Type de role')
        .addOptions(
          { label: 'Role requis', value: 'required', description: 'Role pour jouer au casino' },
          { label: 'Role multiplicateur', value: 'multiplier', description: 'Role qui double les gains' },
        );
      await interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    // Gains settings
    if (cid === 'csconf_gains') {
      const modal = new ModalBuilder().setCustomId('csconf_gains_modal').setTitle('Parametres gains');
      const cfg = db.getCasinoConfig(guildId);
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_voc_min').setLabel('Coins/min vocal').setStyle(TextInputStyle.Short).setValue(String(cfg.coinsPerVocMin ?? 0)).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('d_voc').setLabel('Tirages/h vocal').setStyle(TextInputStyle.Short).setValue(String(cfg.drawsPerVocHour)).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_msg').setLabel('Coins/msg').setStyle(TextInputStyle.Short).setValue(String(cfg.coinsPerMsg)).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('collect_bonus').setLabel('Bonus collect (0.5 = +50%)').setStyle(TextInputStyle.Short).setValue(String(cfg.collectBonusRate ?? 0.5)).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mul_pub').setLabel('Multiplicateur vocal public').setStyle(TextInputStyle.Short).setValue(String(cfg.publicVocMultiplier)).setRequired(false)),
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }

    // Select menu handlers
    if (interaction.isChannelSelectMenu()) {
      if (cid === 'csconf_panelch_sel') {
        db.setCasinoConfig(guildId, { panelChannelId: interaction.values[0] });
        await interaction.update({ content: '✓ Panel channel mis a jour', components: [] }).catch(() => {});
        return;
      }
      if (cid === 'csconf_allowed_sel') {
        db.setCasinoConfig(guildId, { allowedChannels: interaction.values.join(',') });
        await interaction.update({ content: '✓ Salons autorises mis a jour', components: [] }).catch(() => {});
        return;
      }
      if (cid === 'csconf_logch_sel') {
        const type = interaction.message.components[0].components[0].placeholder?.includes('Gains') ? 'logChannelGains' : 'logChannelGames';
        db.setCasinoConfig(guildId, { [type]: interaction.values[0] });
        await interaction.update({ content: '✓ Log channel mis a jour', components: [] }).catch(() => {});
        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (cid === 'csconf_logs_sel') {
        const type = interaction.values[0];
        const select = new ChannelSelectMenuBuilder()
          .setCustomId('csconf_logch_sel')
          .setChannelTypes(ChannelType.GuildText)
          .setPlaceholder(type === 'gains' ? 'Channel gains' : 'Channel jeux');
        await interaction.update({ components: [new ActionRowBuilder().addComponents(select)] }).catch(() => {});
        return;
      }
      if (cid === 'csconf_roles_sel') {
        const type = interaction.values[0];
        const select = new RoleSelectMenuBuilder()
          .setCustomId(type === 'required' ? 'csconf_rolereq_sel' : 'csconf_rolemul_sel')
          .setPlaceholder(type === 'required' ? 'Role requis' : 'Role multiplicateur');
        await interaction.update({ components: [new ActionRowBuilder().addComponents(select)] }).catch(() => {});
        return;
      }
    }

    if (interaction.isRoleSelectMenu()) {
      if (cid === 'csconf_rolereq_sel') {
        db.setCasinoConfig(guildId, { roleRequired: interaction.values[0] });
        await interaction.update({ content: '✓ Role requis mis a jour', components: [] }).catch(() => {});
        return;
      }
      if (cid === 'csconf_rolemul_sel') {
        db.setCasinoConfig(guildId, { roleMultiplierId: interaction.values[0] });
        await interaction.update({ content: '✓ Role multiplicateur mis a jour', components: [] }).catch(() => {});
        return;
      }
    }
  });

  collector.on('end', () => panel.edit({ components: [] }).catch(() => {}));
}

function _buildNavMenu(current) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cs_page_nav')
      .setPlaceholder('▸ Navigation...')
      .addOptions(
        { label: '» Accueil', value: 'home', description: 'Vue d\'ensemble', default: current === 'home' },
        { label: '» Profil', value: 'profile', description: 'Stats détaillées', default: current === 'profile' },
        { label: '» Jeux', value: 'games', description: 'Tirages', default: current === 'games' },
        { label: '» Boutique', value: 'shop', description: 'Acheter', default: current === 'shop' },
        { label: '» Inventaire', value: 'inventory', description: 'Vos items', default: current === 'inventory' },
        { label: '» Succès', value: 'achievements', description: 'Vos succès', default: current === 'achievements' },
        { label: '» Classement', value: 'leaderboard', description: 'Top 10', default: current === 'leaderboard' },
      ),
  );
}

function _buildHomePage(guildId, userId, member) {
  const user = db.getCasinoUser(guildId, userId);
  const vocHours = Math.floor(user.vocMinutes / 60);
  const vocMins = user.vocMinutes % 60;
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    '## ═══════════════════════════\n##      Myoul Casino\n## ═══════════════════════════'),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `### ◆ ${(member?.displayName || member?.user?.username || 'Joueur').toUpperCase()} ・ Niveau ${user.level}\n\n❃ **${embed.fmtCoins(user.coins)}** coins | **${user.draws}** tirages\n❃ Vocal: ${vocHours}h ${vocMins}m | Messages: ${user.msgCount}`
  ));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(_buildNavMenu('home'));
  return container;
}

function _buildProfilePage(guildId, userId) {
  const user = db.getCasinoUser(guildId, userId);
  const vocHours = Math.floor(user.vocMinutes / 60);
  const levelData = db.getLevel(guildId, userId);
  const levelConfig = db.getGuildConfig(guildId);
  const realLevel = levelConfig?.levelCumul ? levelFromXp(levelData.xp) : levelData.level;
  const winRate = user.totalGamesWon + user.totalGamesLost > 0
    ? Math.round((user.totalGamesWon / (user.totalGamesWon + user.totalGamesLost)) * 100) : 0;
  const rank = getRankFromLevel(realLevel);
  const nextRankEntry = [...LEVEL_RANKS].reverse().find(r => r.min > realLevel);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `### ◈ Profil  ・  ${rank.icon} **${rank.name}**
` +
    `❃ Niveau : **${realLevel}**  •  XP : **${embed.fmtCoins(levelData.xp)}**` +
    (nextRankEntry ? `  •  *(prochain palier : **${nextRankEntry.name}** à lvl ${nextRankEntry.min})*` : `  •  *Rang maximum atteint !*`)
  ));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `### ◆ Fortune
` +
    `❃ Coins : **${embed.fmtCoins(user.coins)}**  •  Tirages : **${user.draws}** *(total : ${user.totalDraws})*
` +
    `❃ Boucliers : **${db.getShields(guildId, userId)}** ◊`
  ));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `### ◆ Activité
` +
    `❃ Vocal : **${vocHours}h ${user.vocMinutes % 60}m**  •  Messages : **${user.msgCount}**
` +
    `❃ Jeux : **${user.totalGamesWon}V / ${user.totalGamesLost}D** *(${winRate}% de victoires)*
` +
    `❃ Gains : **${embed.fmtCoins(user.totalWon)}**  •  Dépensés : **${embed.fmtCoins(user.totalSpent)}**`
  ));
  container.addActionRowComponents(_buildNavMenu('profile'));
  return container;
}

function _buildGamesPage(guildId, userId) {
  const user = db.getCasinoUser(guildId, userId);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## IIIIIIIIIIIIIIIIIIIIIIIIIII\n##              JEUX\n## IIIIIIIIIIIIIIIIIIIIIIIIIII'));
  container.addSeparatorComponents(new SeparatorBuilder());
  if (user.draws < 1) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ◆ TIRAGE\n Pas assez de tirages\n❃ Gagnez en vocal | Achetez au shop`));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ◆ TIRAGE (${user.draws} dispo)\nTentez votre chance! Récompenses: coins, tirages, XP, items...`));
  }
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ◆ MINI-JEUX\n❃ +daily ・ Bonus quotidien\n❃ +roulette ・ Roulette casino\n❃ +duel ・ Affrontez un joueur\n❃ +dice ・ 2 des ・ Over/Under/Lucky7/Doubles`));
  container.addActionRowComponents(_buildNavMenu('games'));
  if (user.draws > 0) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cs_do_tirage:1').setLabel('x1').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cs_do_tirage:10').setLabel('x10').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cs_do_tirage:100').setLabel('x100').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cs_do_tirage:all').setLabel('All').setStyle(ButtonStyle.Secondary),
    ));
  }
  return container;
}

function _buildShopPage(guildId, userId) {
  const items = _getAvailableShopItems(guildId, userId);
  const categoryMap = { title: 'Titres', role: 'Roles', badge: 'Badges', decor: 'Decorations', item: 'Items', draws: 'Tirages', xp: 'XP' };
  const options = [];
  
  for (const [type, label] of Object.entries(categoryMap)) {
    const count = items.filter(i => i.type === type).length;
    if (count > 0) {
      options.push({
        label,
        value: type,
        description: `${count} item(s) disponible(s)`,
      });
    }
  }
  
  options.push({
    label: 'Boucliers anti-vol',
    value: 'shields',
    description: 'Proteger contre les vols',
  });
  
  const totalItems = items.length;
  const container = new ContainerBuilder();
  
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## Boutique\n\n> **Items disponibles :** ${totalItems}\n\n-# Selectionne une categorie pour voir les items.`
  ));
  
  if (options.length > 1) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('cs_shop_category')
        .setPlaceholder('Choisir une categorie')
        .addOptions(options.slice(0, 25)),
    ));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*Aucun item disponible*'));
  }
  
  container.addActionRowComponents(_buildNavMenu('shop'));
  return container;
}

function buildInventoryCategoryRow(guildId, userId) {
  const inv = db.getInventory(guildId, userId);
  const categoryMap = { title: 'Titres', role: 'Roles', badge: 'Badges', decor: 'Decorations', item: 'Items', draws: 'Tirages', xp: 'XP' };
  const options = [];
  
  for (const [type, label] of Object.entries(categoryMap)) {
    const count = inv.filter(i => i.type === type).length;
    if (count > 0) {
      options.push({
        label,
        value: type,
        description: `${count} item(s)`,
      });
    }
  }
  
  const userShields = db.getShields(guildId, userId);
  if (userShields > 0) {
    options.push({
      label: 'Boucliers anti-vol',
      value: 'shields',
      description: `${userShields} bouclier(s)`,
    });
  }
  
  if (!options.length) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cs_inv_category')
      .setPlaceholder('Choisir une categorie')
      .addOptions(options.slice(0, 25)),
  );
}

function _buildInventoryPage(guildId, userId) {
  const inv = db.getInventory(guildId, userId);
  const userShields = db.getShields(guildId, userId);
  const totalItems = inv.length + (userShields > 0 ? 1 : 0);
  const container = new ContainerBuilder();
  
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## Inventaire\n\n> **Objets :** ${totalItems}\n\n-# Selectionne une categorie pour voir tes items.`
  ));
  
  const categoryRow = buildInventoryCategoryRow(guildId, userId);
  if (categoryRow) {
    container.addActionRowComponents(categoryRow);
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*Aucun item dans l\'inventaire*'));
  }
  
  return container;
}

function _buildAchievementsPage(guildId, userId) {
  const keys = _getUnlockedKeys(guildId, userId);
  const total = ACHIEVEMENTS.length;
  const unlockedCount = ACHIEVEMENTS.filter(a => keys.has(a.key)).length;
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## Succès\n> **${unlockedCount}/${total}** succès débloqués\n\n-# Clique sur **Succès** depuis le panel public pour explorer les catégories et suivre ta progression.`
  ));
  container.addActionRowComponents(_buildNavMenu('achievements'));
  return container;
}

function _buildLeaderboardPage(guildId) {
  const top = db.getCasinoTop(guildId, 10);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ\n##         CLASSEMENT TOP 10\n## ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ'));
  container.addSeparatorComponents(new SeparatorBuilder());
  let desc = '';
  if (!top.length) desc = '*Aucun joueur*';
  else top.forEach((u, i) => { const rank = i === 0 ? '◆ #1' : i === 1 ? '◆ #2' : i === 2 ? '◆ #3' : `${i + 1}.`; desc += `${rank} <@${u.userId}> ・ **${embed.fmtCoins(u.coins)}** coins\n`; });
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(desc));
  container.addActionRowComponents(_buildNavMenu('leaderboard'));
  return container;
}

function _executeDraw(guildId, userId, drawCount = 1, guild = null) {
  const user = db.getCasinoUser(guildId, userId);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    drawCount > 1 ? `## Resultat ${drawCount} Tirages` : '## Resultat Tirage'
  ));
  container.addSeparatorComponents(new SeparatorBuilder());
  if (user.draws < 1) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('> Pas assez de tirages'));
  } else {
    const actualCount = Math.min(drawCount, user.draws);
    let totalCoins = 0;
    const itemSummary = {};
    for (let i = 0; i < actualCount; i++) {
      db.useCasinoDraw(guildId, userId);
      const reward = db.drawGacha(guildId, userId);
      if (reward?.coins) totalCoins += reward.coins;
      if (reward?.item) {
        const key = reward.item.name;
        if (!itemSummary[key]) itemSummary[key] = { count: 0, chance: reward.item.chance };
        itemSummary[key].count++;
      }
    }
    const updated = db.getCasinoUser(guildId, userId);
    let text = '';
    if (totalCoins > 0) text += `> **+${embed.fmtCoins(totalCoins)}** Mysoul Coins\n`;
    const itemKeys = Object.keys(itemSummary);
    if (itemKeys.length) {
      text += itemKeys.map(name => `◆ **${name}** x${itemSummary[name].count} *(${itemSummary[name].chance}%)*`).join('\n');
    }
    if (!text) text = '> Pool non configure';
    text += `\n\n> Solde : **${embed.fmtCoins(updated.coins)}** coins | **${updated.draws}** tirages`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

    const cfg = db.getCasinoConfig(guildId);
    if (guild) sendCasinoLog(guild, cfg, 'logChannelGames', {
      icon  : '◆',
      title : `Tirage x${actualCount}`,

      user  : userId,
      lines : [
        totalCoins > 0 ? `+${embed.fmtCoins(totalCoins)} coins` : null,
        itemKeys.length ? itemKeys.map(n => `◆ ${n} x${itemSummary[n].count}`).join(' • ') : null,
        `Solde : ${embed.fmtCoins(updated.coins)} coins | ${updated.draws} tirages`,
      ].filter(Boolean),
    });
  }
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(_buildNavMenu('games'));
  return container;
}

const _PANEL_PAGES = {
  home: (gid, uid, member) => _buildHomePage(gid, uid, member),
  games: (gid, uid) => _buildGamesPage(gid, uid),
  shop: (gid, uid) => _buildShopPage(gid, uid),
  inventory: (gid, uid) => _buildInventoryPage(gid, uid),
  achievements: (gid, uid) => _buildAchievementsPage(gid, uid),
  leaderboard: (gid) => _buildLeaderboardPage(gid),
};

async function handlePanelNav(interaction) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const page = interaction.values?.[0] || 'home';

  if (page === 'profile') {
    const user = db.getCasinoUser(guildId, userId);
    const levelData = db.getLevel(guildId, userId);
    const levelConfig = db.getGuildConfig(guildId);
    const realLevel = levelConfig?.levelCumul ? levelFromXp(levelData.xp) : levelData.level;
    const rank = getRankFromLevel(realLevel);
    const equipped = db.getEquippedItemDetails(guildId, userId);
    try {
      await interaction.deferUpdate().catch(() => {});
      const { generateProfileCard } = require('../../utils/profileCard');
      const buffer = await generateProfileCard(interaction.member, user, realLevel, levelData, rank, equipped, guildId, userId);
      const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
      await interaction.followUp({ files: [attachment], flags: MessageFlags.Ephemeral }).catch(() => {});
    } catch (cardErr) {
      console.error('[PROFILE-CARD] Nav error:', cardErr?.message);
      await interaction.update({ flags: COMPONENTS_V2_FLAG, components: [_buildProfilePage(guildId, userId)] }).catch(() => {});
    }
    return;
  }

  const builder = _PANEL_PAGES[page];
  if (!builder) {
    await interaction.update({ flags: COMPONENTS_V2_FLAG, components: [_buildHomePage(guildId, userId, interaction.member)] }).catch(() => {});
    return;
  }
  await interaction.update({ flags: COMPONENTS_V2_FLAG, components: [builder(guildId, userId, interaction.member)] }).catch((err) => {
    console.log(`[CASINO-NAV] Update failed: ${err?.message}`);
  });
}

async function handlePanelDraw(interaction, id) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const count = parseInt(id.split(':')[1]) || 1;
  await interaction.update({ flags: COMPONENTS_V2_FLAG, components: [_executeDraw(guildId, userId, count, interaction.guild)] }).catch((err) => {
    console.log(`[CASINO-DRAW] Update failed: ${err?.message}`);
  });
}

function handlePanelInteractions(panel, message) {
  const { author, guild } = message;
  const guildId = guild.id;
  let userId = author.id;

  console.log(`[CASINO] Creating collector for user ${userId} on panel ${panel.id}`);

  const collector = panel.createMessageComponentCollector({
    filter: () => true,
    idle: 300_000,
    time: 900_000,
  });

  collector.on('collect', async interaction => {
    const cid = interaction.customId;
    userId = interaction.user.id;
    console.log(`[CASINO-COLLECTOR] Received interaction: ${cid} from user ${interaction.user.id}`);

    if (cid === 'cs_page_nav' && interaction.isStringSelectMenu()) {
      return handlePanelNav(interaction);
    }

    if (cid.startsWith('cs_do_tirage')) {
      return handlePanelDraw(interaction, cid);
    }
  });

  collector.on('end', (reason) => {
    console.log(`[CASINO-COLLECTOR] Ended: ${reason}`);
  });
}
