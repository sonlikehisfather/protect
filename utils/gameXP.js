'use strict';

/**
 * Utilitaire pour gérer les récompenses XP dans les jeux
 */

const db = require('../core/database');

/**
 * Ajoute de l'XP à un utilisateur pour un jeu
 * @param {string} guildId - ID du serveur
 * @param {string} userId - ID de l'utilisateur
 * @param {number} xpAmount - Quantité d'XP à ajouter
 * @returns {number} - XP ajoutés
 */
function awardXP(guildId, userId, xpAmount) {
  if (!guildId || !userId || xpAmount <= 0) return 0;
  
  try {
    db.addXp(guildId, userId, xpAmount);
    return xpAmount;
  } catch (err) {
    console.error('[GameXP] Erreur lors de l\'ajout d\'XP:', err);
    return 0;
  }
}

/**
 * Calcule les XP pour le quiz basé sur le score
 * @param {number} score - Score (0-5)
 * @param {number} total - Total de questions
 * @returns {number} - XP à attribuer
 */
function calculateQuizXP(score, total = 5) {
  const xpTable = {
    5: 100,  // Parfait
    4: 80,   // Excellent
    3: 60,   // Pas mal
    2: 40,   // Moyen
    1: 20,   // Faible
    0: 10,   // Catastrophe
  };
  return xpTable[score] || 10;
}

/**
 * Calcule les XP pour le jeu de devinette
 * @param {number} attemptsUsed - Nombre d'essais utilisés
 * @param {number} maxAttempts - Nombre max d'essais
 * @returns {number} - XP à attribuer
 */
function calculateGuessXP(attemptsUsed, maxAttempts) {
  const remaining = maxAttempts - attemptsUsed;
  return Math.max(remaining * 15, 10); // 15 XP par essai restant, minimum 10
}

/**
 * Calcule les XP pour la roulette
 * @param {boolean} win - Victoire ou non
 * @param {number} multiplier - Multiplicateur (2 ou 14)
 * @returns {number} - XP à attribuer
 */
function calculateRouletteXP(win, multiplier = 0) {
  if (!win) return 10;
  return multiplier === 14 ? 200 : 50; // Jackpot = 200 XP, Normal = 50 XP
}

/**
 * Calcule les XP pour le coinflip
 * @param {boolean} win - Victoire ou non
 * @returns {number} - XP à attribuer
 */
function calculateCoinflipXP(win) {
  return win ? 30 : 10;
}

/**
 * Calcule les XP pour le blackjack
 * @param {boolean} win - Victoire ou non
 * @param {boolean} isBust - Si bust (dépassé 21)
 * @param {boolean} isTie - Si égalité
 * @returns {number} - XP à attribuer
 */
function calculateBlackjackXP(win, isBust = false, isTie = false) {
  if (isTie) return 20; // Égalité = petit bonus
  return win ? 40 : 10;
}

module.exports = {
  awardXP,
  calculateQuizXP,
  calculateGuessXP,
  calculateRouletteXP,
  calculateCoinflipXP,
  calculateBlackjackXP,
};
