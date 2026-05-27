# Documentation des Modules

Les modules sont des fonctionnalités avancées qui étendent les capacités du bot.

## Sommaire des Modules

- [🎫 Tickets](./tickets.md) - Système de tickets support
- [📬 ModMail](./modmail.md) - Communication DM → Serveur
- [🎉 Giveaways](./giveaways.md) - Tirages au sort
- [📊 Niveaux](./levels.md) - Système d'XP et niveaux
- [🔊 Vocaux Temporaires](./tempvoc.md) - Création automatique de salons vocaux
- [🤖 AutoMod](./automod.md) - Modération automatique
- [⚡ Custom Commands](./custom-commands.md) - Commandes sans code
- [📝 Transcripts](./transcripts.md) - Archivage des conversations

---

## Architecture des Modules

### Structure d'un Module

```javascript
// modules/nomModule.js

// Configuration/État
const config = new Map();

// Fonctions principales
async function init(client) {
  // Initialisation
}

async function fonctionPrincipale(arg1, arg2) {
  // Logique métier
}

// Helper functions
function helper() {
  // Fonction utilitaire
}

// Export
module.exports = {
  init,
  fonctionPrincipale,
  // ... autres fonctions publiques
};
```

### Intégration avec le Bot

Les modules sont :
1. **Chargés** au démarrage via `index.js`
2. **Écoutent** les événements Discord si nécessaire
3. **Accèdent** à la base de données pour la persistance
4. **Exposent** une API pour les commandes

---

## États des Modules

| Module | Status | Configuration Requise |
|--------|--------|------------------------|
| Tickets |  Stable | Catégorie + Rôle staff |
| ModMail |  Stable | Catégorie + Rôle staff |
| Giveaways |  Stable | Aucune |
| Niveaux |  Stable | Optionnel (activé par défaut) |
| TempVoc |  Stable | Salon hub + Catégorie |
| AutoMod |  Stable | Configuration règles |
| Custom Commands |  Stable | Aucune |
| Transcripts |  Stable | Intégré aux tickets/modmail |

---

## Communication Inter-Modules

Les modules peuvent interagir via le client :

```javascript
// Dans une commande ou un autre module
const tickets = require('../modules/tickets');
const modmail = require('../modules/modmail');

// Utilisation
tickets.createTicket(member, category);
modmail.handleMessage(user, content);
```

---

## Base de Données

Chaque module utilise la table correspondante dans SQLite :

| Module | Table Principale |
|--------|------------------|
| Tickets | `tickets` |
| ModMail | `modmail_threads` |
| Giveaways | `giveaways` |
| Niveaux | `user_levels` |
| TempVoc | `tempvoc_channels` |
| AutoMod | `automod_config`, `automod_violations` |
| Custom Commands | `custom_commands` |

---

## Performance

### Optimisations
- Utilisation de `better-sqlite3` (synchrone, rapide)
- Cache en mémoire pour les configurations fréquentes
- Nettoyage automatique des données obsolètes

### Limites
- Giveaways : 10 actifs par serveur
- Tickets : limité par permissions Discord (500 salons/catégorie)
- TempVoc : nettoyage automatique des salons inactifs

---

## Navigation

Choisissez un module dans le sommaire pour sa documentation détaillée.
