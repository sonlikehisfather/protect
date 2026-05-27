# Module Giveaways

Système complet de tirages au sort avec conditions d'éligibilité.

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                     MODULE GIVEAWAYS                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────┐   │
│  │  Création   │───▶│  Giveaway    │───▶│   Tirage    │   │
│  │  (+giveaway)│    │  Actif       │    │   (Auto)    │   │
│  └─────────────┘    └──────────────┘    └─────────────┘   │
│                             │                               │
│                             ▼                               │
│                    ┌────────────────┐                      │
│                    │  Participants  │                      │
│                    │  (Réaction 🎉) │                      │
│                    └────────────────┘                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Fonctionnalités

-  Durée configurable
-  Nombre de gagnants ajustable
-  Conditions d'éligibilité avancées
-  Relance (reroll) des gagnants
-  Giveaways actifs multiples
-  Statistiques et logs

---

## Création d'un Giveaway

### Basique
```
+giveaway 1d 1 Nitro Classic
```

### Avec Conditions
```
+giveaway 1w 3 Pass Premium --role @Membre --level 5
```

### Paramètres
| Paramètre | Description | Valeurs |
|-----------|-------------|---------|
| `durée` | Temps avant tirage | `1m` à `1y` |
| `gagnants` | Nombre de gagnants | `1` à `10` |
| `prix` | Récompense | Texte libre |

### Options Avancées
| Option | Description | Exemple |
|--------|-------------|---------|
| `--role` | Rôle requis | `--role @VIP` |
| `--level` | Niveau minimum | `--level 10` |
| `--age` | Âge compte (jours) | `--age 30d` |
| `--message` | Messages min (7j) | `--message 100` |
| `--server` | Serveur requis | `--server ID` |

---

## Conditions d'Éligibilité

### Vérifications Automatiques
1. **Rôle** : Possède le rôle requis
2. **Niveau** : Niveau XP supérieur au minimum
3. **Âge compte** : Date de création Discord
4. **Messages** : Nombre de messages (7 derniers jours)
5. **Serveur** : Présence sur un autre serveur spécifique

### Éligibilité Dynamique
Les vérifications se font :
- Au moment de la réaction (primaire)
- Au moment du tirage (secondaire)

Si un gagnant devient inéligible (quitte serveur, perd rôle), un nouveau est tiré.

---

## Système de Tirage

### Algorithme
```javascript
// Sélection aléatoire pondérée
function drawWinners(participants, count) {
  const winners = [];
  const pool = [...participants];
  
  while (winners.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(index, 1)[0]);
  }
  
  return winners;
}
```

### Processus
1. Collecte des participants (réactions 🎉)
2. Vérification finale de l'éligibilité
3. Tirage aléatoire
4. Vérification des gagnants
5. Annonce des résultats
6. Notification des gagnants (MP optionnel)

---

## API du Module

```javascript
const giveaways = require('../modules/giveaways');

// Créer un giveaway
const giveaway = await giveaways.create({
  guildId: '123456789',
  channelId: '987654321',
  duration: 86400000, // 1 jour en ms
  winnerCount: 1,
  prize: 'Nitro',
  requirements: {
    role: 'roleId',
    level: 5,
    accountAge: 7 * 24 * 60 * 60 * 1000 // 7 jours
  }
});

// Terminer manuellement
await giveaways.end(giveawayId);

// Relancer un gagnant
await giveaways.reroll(giveawayId, newWinnerCount);

// Supprimer
await giveaways.delete(giveawayId);

// Vérifier éligibilité
const eligible = await giveaways.checkEligibility(userId, requirements);
```

---

## Schéma de Base de Données

### Table `giveaways`

| Colonne | Type | Description |
|---------|------|-------------|
| id | INTEGER PRIMARY KEY | ID unique |
| message_id | TEXT | ID message Discord |
| guild_id | TEXT | ID serveur |
| channel_id | TEXT | ID salon |
| creator_id | TEXT | ID créateur |
| prize | TEXT | Récompense |
| winner_count | INTEGER | Nombre gagnants |
| ends_at | INTEGER | Timestamp fin |
| ended | BOOLEAN | Terminé ? |
| winners | TEXT | IDs gagnants (JSON) |
| requirements | TEXT | Conditions (JSON) |
| participants | TEXT | IDs participants (JSON) |

---

## Événements du Giveaway

### Embed de Création
```
🎉 GIVEAWAY 🎉

Récompense: Nitro Classic
Lancé par: @Username
Se termine: Dans 1 jour

Appuyez sur 🎉 pour participer !
```

### Embed de Fin
```
🎉 GIVEAWAY TERMINÉ 🎉

Récompense: Nitro Classic
Gagnant(s): @User1 @User2
Nombre de participants: 42
```

---

## Workflow Complet

### 1. Création
```
+giveaway 3d 2 Rôles VIP --role @Membre
```

### 2. Participation
Les membres réagissent avec 🎉

### 3. Vérifications
Chaque participant est vérifié :
- A le rôle @Membre ✓
- Niveau suffisant ✓
- Pas blacklisté ✓

### 4. Tirage (automatique après 3 jours)
2 gagnants sélectionnés aléatoirement

### 5. Résultats
- Annonce dans le salon
- Mention des gagnants
- MP aux gagnants (si activé)

### 6. Relance (si nécessaire)
```
+greroll 123456789 1
```

---

## Limites et Bonnes Pratiques

### Limites
| Paramètre | Limite |
|-----------|--------|
| Giveaways actifs | 10 par serveur |
| Durée max | 1 an |
| Gagnants max | 10 |
| Participants | Illimité |

### Conseils
- Utilisez des conditions raisonnables
- Durées de 1-7 jours recommandées
- Toujours spécifier un rôle minimum
- Vérifiez les gagnants avant distribution

---

[← Retour aux modules](./README.md)
