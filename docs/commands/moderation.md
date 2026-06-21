# Commandes de Modération

Outils complets de modération pour gérer votre communauté.

## Table des matières
- [ban](#ban) - Bannissement
- [kick](#kick) - Expulsion
- [mute](#mute) - Muet temporaire
- [unmute](#unmute) - Démuter
- [warn](#warn) - Avertissement
- [warnlist](#warnlist) - Liste des avertissements
- [clearwarn](#clearwarn) - Supprimer un warn
- [clear](#clear) - Supprimer des messages
- [lock](#lock) - Verrouiller un salon
- [unlock](#unlock) - Déverrouiller
- [slowmode](#slowmode) - Mode lent
- [nick](#nick) - Changer un pseudo

---

## ban

Bannit un membre du serveur.

**Usage :** `+ban <@user|id> [durée] [raison]`

**Permissions:** `BanMembers`
**Bot Permissions:** `BanMembers`

### Paramètres
| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| user | Mention/ID | Oui | Membre à bannir |
| durée | Durée | Non | Durée du ban (ex: 1d, 1w, permanent) |
| raison | Texte | Non | Raison du bannissement |

### Exemples
```
+ban @Spammeur
+ban @Spammeur Pub non autorisée
+ban @Spammeur 7j Répétition d'infractions
+ban 123456789012345678 1d Calme nécessaire
```

---

## kick

Expulse un membre du serveur (il peut revenir).

**Usage :** `+kick <@user> [raison]`

**Permissions:** `KickMembers`
**Bot Permissions:** `KickMembers`

### Exemples
```
+kick @Utilisateur
+kick @Utilisateur Comportement inapproprié
```

---

## mute

Réduit un membre au silence (timeout Discord ou rôle mute).

**Usage :** `+mute <@user> <durée> [raison]`

**Permissions:** `ModerateMembers`
**Bot Permissions:** `ModerateMembers`, `ManageRoles`

### Durées Acceptées
| Format | Exemple | Signification |
|--------|---------|---------------|
| s | 30s | Secondes |
| m | 5m | Minutes |
| h | 2h | Heures |
| d | 1d | Jours |
| w | 1w | Semaines |
| mo | 1mo | Mois |
| y | 1y | Années |

### Exemples
```
+mute @Spammeur 1h Spam excessif
+mute @Troll 1d Comportement toxique
+mute @User 30m Hors-sujet répété
```

---

## unmute

Retire le silence d'un membre.

**Usage :** `+unmute <@user> [raison]`

**Permissions:** `ModerateMembers`

### Exemples
```
+unmute @Utilisateur
+unmute @Utilisateur Comportement amélioré
```

---

## warn

Émet un avertissement à un membre.

**Usage :** `+warn <@user> <raison>`

**Permissions:** `ModerateMembers`

### Système de Punitions Automatiques
Si configuré avec `+punish`, les warns accumulés déclenchent des sanctions automatiques.

### Exemples
```
+warn @User Langage inapproprié
+warn @User 2ème avertissement
```

---

## warnlist

Affiche les avertissements d'un membre.

**Usage :** `+warnlist [@user]`

**Permissions:** `ModerateMembers`

### Sans argument
Affiche la liste de tous les membres avec des warns sur le serveur.

### Exemples
```
+warnlist
+warnlist @Utilisateur
```

---

## clearwarn

Supprime un ou tous les avertissements.

**Usage :** `+clearwarn <@user> [id|all]`

**Permissions:** `ModerateMembers`

### Exemples
```
+clearwarn @Utilisateur 3      # Supprime le warn #3
+clearwarn @Utilisateur all     # Supprime tous les warns
```

---

## clear

Supprime des messages en masse.

**Usage :** `+clear <nombre> [@user]`

**Alias:** `purge`, `clean`

**Permissions:** `ManageMessages`
**Bot Permissions:** `ManageMessages`, `ReadMessageHistory`

### Limites
- Maximum 1000 messages par commande
- Messages de plus de 14 jours ignorés (limitation Discord)

### Exemples
```
+clear 50                       # Supprime 50 derniers messages
+clear 100 @Spammeur            # Supprime 100 messages du user
+clear 10 @Bot all              # Supprime tous les messages du bot
```

---

## lock

Verrouille un salon (empêche d'écrire).

**Usage :** `+lock [#salon] [durée]`

**Permissions:** `ManageChannels`
**Bot Permissions:** `ManageChannels`

### Exemples
```
+lock                          # Verrouille ce salon
+lock #général                 # Verrouille #général
+lock 1h                       # Verrouille temporairement
```

---

## unlock

Déverrouille un salon.

**Usage :** `+unlock [#salon]`

**Permissions:** `ManageChannels`

### Exemples
```
+unlock
+unlock #général
```

---

## slowmode

Active le mode lent sur un salon.

**Usage :** `+slowmode <durée|off> [#salon]`

**Alias:** `sm`

**Permissions:** `ManageChannels`

### Durées
- `off` ou `0` : Désactive
- `5s`, `10s`, `30s` : Secondes
- `1m`, `5m`, `10m` : Minutes
- `1h`, `6h` : Heures
- Maximum: 6 heures

### Exemples
```
+slowmode 5s                    # 5 secondes entre chaque message
+slowmode 1m #général
+slowmode off
```

---

## nick

Change le pseudonyme d'un membre.

**Usage :** `+nick <@user> [nouveau_nom]`

**Permissions:** `ManageNicknames`
**Bot Permissions:** `ManageNicknames`

### Exemples
```
+nick @User NouveauPseudo      # Change le pseudo
+nick @User                    # Réinitialise le pseudo
```

---

## Bonnes Pratiques

### Workflow de Modération
1. **Avertir** en premier (`+warn`) pour infractions mineures
2. **Mute** temporairement pour calmer une situation
3. **Kick** pour infractions modérées
4. **Ban** pour infractions graves ou répétées

### Documentation
- Toujours spécifier une raison claire
- Utiliser `+warnlist` pour vérifier l'historique
- Documenter les cas exceptionnels

---

[← Retour à l'index des commandes](./README.md)
