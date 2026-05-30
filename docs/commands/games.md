# 🎮 Système de Jeux & XP

## Overview

Le bot inclut plusieurs mini-jeux avec un **système de récompense XP** intégré. Gagne de l'XP en jouant et progresse dans les niveaux !

---

## Commandes disponibles

| Commande | Description | Récompense XP |
|----------|-------------|---------------|
| `+quiz` | Quiz de 5 questions générales | 100/80/60/40/20/10 selon score |
| `+guess` | Devine le nombre (Plus ou Moins) | +15 par essai restant |
| `+roulette` | Roulette casino | 200 (jackpot), 50 (win), 10 (perdu) |
| `+blackjack` | Jeu de cartes 21 | 40 (win), 20 (égalité), 10 (perdu) |
| `+coinflip` | Pile ou face | 30 (win), 10 (perdu) |
| `+roll` | Lancer de dé | 5 XP par lancer |
| `+8ball` | Boule magique | 5 XP par question |
| `+qi` | Test de QI rapide | - |

---

## Détails des jeux

### +quiz
- 5 questions aléatoires parmi 200+
- 4 réponses possibles par question
- Temps limité : 60s par question
- Score affiché à la fin avec récompense XP

### +guess
- Devine un nombre entre 0 et N (défaut: 100)
- Le bot indique si c'est + ou -
- Essais limités selon la difficulté
- Plus tu trouves vite, plus tu gagnes d'XP

### +roulette
- 3 options : Rouge (×2), Noir (×2), Zéro (×14)
- Jackpot (Zéro) = 200 XP
- Win normal = 50 XP
- Perdu = 10 XP

---

## Configuration

Aucune configuration requise. Le système XP des jeux fonctionne automatiquement avec le système de niveaux global.

---

## Aliases

- `+quiz` : aucun
- `+guess` : `+devine`, `+nombre`, `+plusmoins`
- `+roulette` : aucun
- `+blackjack` : `+bj`, `+21`
- `+coinflip` : `+pf`, `+pileface`
- `+roll` : `+dice`, `+dé`
- `+8ball` : `+8b`, `+magic`
- `+qi` : `+iq`

---

## Permissions

Tous les membres peuvent utiliser les commandes de jeux.

---

## Notes

- L'XP des jeux s'ajoute à l'XP des messages
- Pas de cooldown entre les jeux
- Les jeux sont en solo (pas de multi-joueur)
- `+qi` n'accorde pas d'XP (test rapide uniquement)
