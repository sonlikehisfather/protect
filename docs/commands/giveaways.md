# Commandes Giveaways

Créez et gérez des tirages au sort facilement.

## Table des matières
- [giveaway](#giveaway) - Créer un giveaway
- [gend](#gend) - Terminer prématurément
- [greroll](#greroll) - Relancer un gagnant
- [gdelete](#gdelete) - Supprimer un giveaway
- [glist](#glist) - Liste des giveaways
- [ginfo](#ginfo) - Informations sur un giveaway

---

## giveaway

Crée un nouveau giveaway.

**Usage :** `+giveaway <durée> <gagnants> <prix>`

**Alias:** `gstart`, `start`, `gcreate`

**Permissions:** `ManageMessages`

### Paramètres
| Paramètre | Description | Exemple |
|-----------|-------------|---------|
| `durée` | Temps avant tirage | `1h`, `1d`, `1w` |
| `gagnants` | Nombre de gagnants | `1`, `3`, `5` |
| `prix` | Récompense | `Nitro`, `Rôle VIP` |

### Exemples
```
+giveaway 1h 1 Nitro Classic
+giveaway 1d 3 Rôle @VIP
+giveaway 1w 1 Pass Premium
+giveaway 30m 5 Invitations
```

---

## Options Avancées

### Channel
Spécifiez un salon différent :
```
+giveaway #giveaways 1d 1 Nitro
```

### Conditions d'Éligibilité
Ajoutez des restrictions :
```
+giveaway 1d 1 Nitro --role @Membre
+giveaway 1d 1 Nitro --level 5
+giveaway 1d 1 Nitro --age 7d
```

| Option | Description |
|----------|-------------|
| `--role @role` | Rôle requis pour participer |
| `--level X` | Niveau minimum requis |
| `--age Xd` | Âge minimum du compte (jours) |
| `--server` | Doit être sur un autre serveur |
| `--message X` | X messages minimum (7j) |

---

## gend

Termine un giveaway prématurément.

**Usage :** `+gend <message_id>`

**Alias:** `end`, `gstop`

**Permissions:** `ManageMessages`

### Exemples
```
+gend 1234567890123456789
```

---

## greroll

Relance un nouveau gagnant.

**Usage :** `+greroll <message_id> [nombre]`

**Alias:** `reroll`

**Permissions:** `ManageMessages`

### Fonctionnement
- Sélectionne un nouveau gagnant parmi les participants
- Le gagnant précédent reste gagnant
- Utile si le gagnant ne réclame pas son prix

### Exemples
```
+greroll 1234567890123456789
+greroll 1234567890123456789 2    # Relance 2 gagnants
```

---

## gdelete

Supprime un giveaway.

**Usage :** `+gdelete <message_id>`

**Alias:** `gdel`

**Permissions:** `ManageMessages`

### Exemples
```
+gdelete 1234567890123456789
```

---

## glist

Liste les giveaways actifs sur le serveur.

**Usage :** `+glist`

**Alias:** `giveaways`, `gactive`

### Affichage
- ID du message
- Prix
- Temps restant
- Nombre de participants

---

## ginfo

Affiche les détails d'un giveaway.

**Usage :** `+ginfo <message_id>`

### Informations Affichées
- Prix et nombre de gagnants
- Temps restant / Date de fin
- Nombre de participants
- Conditions d'éligibilité
- Organisateur

---

## Participer aux Giveaways

Les membres participent en **réagissant avec 🎉** au message du giveaway.

### Notification
Les gagnants sont :
- Mentionnés dans le message de fin
- Notifiés en MP (si activé)

---

## Conseils

### Durées Recommandées
| Type | Durée | Pourquoi |
|------|-------|----------|
| Petit prix | 1-6h | Engagement rapide |
| Prix moyen | 1-3j | Bonne participation |
| Gros prix | 1-2 semaines | Maximiser la visibilité |

### Conditions Équilibrées
- Ne soyez pas trop restrictif
- `--role @Membre` est souvent suffisant
- Évitez `--level` trop élevé pour les petits serveurs

---

[← Retour à l'index des commandes](./README.md)
