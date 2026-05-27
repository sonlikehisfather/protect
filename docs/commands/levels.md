# Commandes Niveaux

Système de niveaux et expérience (XP) pour votre serveur.

## Table des matières
- [rank](#rank) - Voir son niveau
- [leaderboard](#leaderboard) - Classement
- [setlevel](#setlevel) - Définir un niveau (admin)
- [resetlevel](#resetlevel) - Réinitialiser (admin)
- [levelconfig](#levelconfig) - Configuration

---

## rank

Affiche votre carte de niveau ou celle d'un autre membre.

**Usage:** `+rank [@user]`

**Alias:** `level`, `xp`, `card`

### Affichage
- Niveau actuel
- XP actuel / XP nécessaire pour le prochain niveau
- Rang sur le serveur
- Progression visuelle

### Exemples
```
+rank
+rank @mysoul
```

---

## leaderboard

Affiche le classement des niveaux.

**Usage:** `+leaderboard [page]`

**Alias:** `lb`, `top`, `levels`

### Affichage
- Top 10 par défaut
- Navigation par pages
- Niveau, XP, et rang

### Exemples
```
+leaderboard
+leaderboard 2
```

---

## setlevel

Définit le niveau d'un membre (administration).

**Usage:** `+setlevel <@user> <niveau>`

**Permissions:** `Administrator`

### Exemples
```
+setlevel @mysoul 10
```

---

## resetlevel

Réinitialise les niveaux.

**Usage:** `+resetlevel [@user|all]`

**Permissions:** `Administrator`

### Options
| Option | Description |
|--------|-------------|
| `@user` | Reset un utilisateur |
| `all` | Reset tout le serveur |

### Exemples
```
+resetlevel @mysoul
+resetlevel all
```

> **⚠️ Attention** : `resetlevel all` est irréversible !

---

## levelconfig

Configure le système de niveaux.

**Usage:** `+levelconfig <option> [valeur]`

**Permissions:** `Administrator`

### Options

| Option | Description | Valeur |
|--------|-------------|--------|
| `enable/disable` | Active/désactive | - |
| `cooldown` | Cooldown XP (secondes) | `30-300` |
| `min` | XP minimum par message | `5-50` |
| `max` | XP maximum par message | `10-100` |
| `announce` | Annoncer level up | `on/off` |
| `channel` | Salon des annonces | `#salon` |
| `message` | Message de level up | Texte |
| `stackroles` | Cumuler les rôles | `on/off` |

### Exemples
```
+levelconfig enable
+levelconfig cooldown 60
+levelconfig min 10
+levelconfig max 25
+levelconfig announce on
+levelconfig channel #level-up
```

---

## Récompenses de Niveau

### levelreward
Configure les rôles automatiques par niveau.

```
+levelreward add 5 @Niveau5
+levelreward add 10 @Niveau10
+levelreward add 25 @Niveau25
+levelreward list
+levelreward remove 10
```

### Récompenses multiples
Si `stackroles` est activé, les membres gardent tous les rôles gagnés.
Si désactivé, seul le rôle du niveau actuel est gardé.

---

## Fonctionnement du Système

### Gain d'XP
- 1 message = XP aléatoire entre min et max
- Cooldown entre chaque gain (évite le spam)
- Les messages doivent être > 10 caractères
- Les membres ignorés/exclus ne gagnent pas d'XP

### Calcul des Niveaux
- Niveau 1 : 100 XP
- Niveau 2 : 200 XP supplémentaires
- Niveau 3 : 300 XP supplémentaires
- etc.

Formule : `XP_Nécessaire = Niveau × 100`

### Level Up
- Annonce automatique (si activée)
- Attribution du rôle de récompense
- Message personnalisable

---

## Variables dans les Messages

### Message de Level Up
- `{user.mention}` - Mention du membre
- `{user.username}` - Nom
- `{level}` - Nouveau niveau
- `{xp}` - XP total

### Exemple
```
+levelconfig message Félicitations {user.mention} ! Tu as atteint le niveau {level} ! 🎉
```

---

## Ignorer des Salons/Membres

### Ignorer un salon
```
+xpexclude channel #spam
```

### Ignorer un membre
```
+xpexclude user @Bot
```

### Liste des exclusions
```
+xpexclude list
```

---

[← Retour à l'index des commandes](./README.md)
