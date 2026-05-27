# API Interne - Utilitaires

Documentation des utilitaires et fonctions disponibles dans le dossier `utils/`.

## Sommaire

- [embed.js](./embed.md) - Création d'embeds Discord
- [errorHandler.js](./error-handler.md) - Gestion des erreurs
- [logger.js](./logger.md) - Logging console
- [parseDuration.js](./parse-duration.md) - Parsing des durées
- [commandCooldown.js](./cooldown.md) - Gestion des cooldowns
- [targetResolver.js](./target-resolver.md) - Résolution de cibles
- [memberResolver.js](./member-resolver.md) - Résolution de membres
- [permissions.js](./permissions.md) - Vérification permissions
- [imageResolver.js](./image-resolver.md) - Résolution d'images
- [modDm.js](./mod-dm.md) - Messages DM de modération
- [parseJsonArray.js](./parse-json.md) - Parsing JSON
- [safeTimers.js](./safe-timers.md) - Timers sécurisés
- [transcript.js](./transcript.md) - Génération de transcripts
- [variables.js](./variables.md) - Variables de messages
- [verifyLogger.js](./verify-logger.md) - Vérification logs
- [verifyTimeouts.js](./verify-timeouts.md) - Gestion timeouts
- [welcomeSender.js](./welcome-sender.md) - Envoi de messages de bienvenue
- [soutienSync.js](./soutien-sync.md) - Synchronisation rôle soutien
- [giveawayEligibility.js](./giveaway-eligibility.md) - Éligibilité giveaways
- [applyMute.js](./apply-mute.md) - Application des mutes
- [punishSteps.js](./punish-steps.md) - Étapes de punition

---

## Utilisation Générale

Tous les utilitaires s'importent ainsi :

```javascript
const util = require('../utils/nomDuFichier');

// Utilisation
util.fonction(arguments);
```

---

## Créer un Nouvel Utilitaire

Structure recommandée :

```javascript
// utils/monUtilitaire.js
'use strict';

/**
 * Description de l'utilitaire
 * @param {Type} param - Description
 * @returns {Type} Description du retour
 */
function maFonction(param) {
  // Implémentation
  return result;
}

module.exports = {
  maFonction,
  // Autres exports
};
```

---

[← Retour à la documentation](../README.md)
