# Commandes Owner (Propriétaire)

Commandes réservées au propriétaire du bot (`BUYER_ID` dans `.env`).

> **⚠️ Attention** : Ces commandes sont puissantes et peuvent être dangereuses. Utilisez-les avec précaution.

## Table des matières
- [eval](#eval) - Évaluation de code
- [exec](#exec) - Exécution shell
- [say](#say) - Envoyer un message
- [activity](#activity) - Changer l'activité
- [status](#status) - Changer le statut
- [serverlist](#serverlist) - Liste des serveurs
- [invite](#invite) - Générer une invitation
- [leave](#leave) - Quitter un serveur
- [reload](#reload) - Recharger les commandes

---

## eval

Exécute du code JavaScript (TRÈS DANGEREUX).

**Usage:** `+eval <code>`

**Alias:** `e`, `ev`

### Fonctionnalités
- Accès complet à Node.js
- Accès au client Discord
- Accès à la base de données
- Retour formaté (inspect)

### Variables Disponibles
| Variable | Description |
|----------|-------------|
| `client` | Instance du client Discord |
| `message` | Message qui a déclenché la commande |
| `db` | Instance de la base de données |
| `require` | Fonction require Node.js |
| `process` | Processus Node.js |

### Exemples
```
+eval client.guilds.cache.size
+eval client.users.cache.get('ID')
+eval db.get('SELECT * FROM guilds').length
```

---

## exec

Exécute une commande shell (TRÈS DANGEREUX).

**Usage:** `+exec <commande>`

**Alias:** `shell`, `cmd`, `$`

### Exemples
```
+exec ls -la
+exec npm list
+exec cat package.json
```

---

## say

Envoie un message via le bot.

**Usage:** `+say [#salon] <message>`

**Alias:** `speak`, `send`

### Exemples
```
+say Bonjour tout le monde !
+say #annonces Une annonce importante !
+say #general Salut {everyone}
```

### Embeds
Possibilité d'envoyer des embeds formatés :
```
+say #salon {embed}
Titre||Description
Couleur: #FF0000
Champ 1: Valeur 1
Champ 2: Valeur 2
```

---

## activity

Change l'activité affichée du bot.

**Usage:** `+activity <type> <texte>`

**Alias:** `setactivity`, `playing`, `watching`, `listening`, `streaming`

### Types d'Activité
| Type | Description | Exemple |
|------|-------------|---------|
| `playing` | Joue à | `+activity playing Minecraft` |
| `watching` | Regarde | `+activity watching des animes` |
| `listening` | Écoute | `+activity listening Spotify` |
| `streaming` | Stream | `+activity streaming sur Twitch` |
| `competing` | Compète | `+activity competing aux JO` |

### Exemples
```
+activity playing +help
+activity watching 100 serveurs
+activity listening vos commandes
```

---

## status

Change le statut de présence du bot.

**Usage:** `+status <online|idle|dnd|invisible>`

**Alias:** `setstatus`, `presence`

### Statuts Disponibles
| Statut | Description | Apparence |
|--------|-------------|-----------|
| `online` | En ligne | 🟢 Vert |
| `idle` | Inactif | 🟡 Jaune |
| `dnd` | Ne pas déranger | 🔴 Rouge |
| `invisible` | Invisible | ⚫ Gris |

### Exemples
```
+status online
+status dnd
```

---

## serverlist

Liste tous les serveurs où le bot est présent.

**Usage:** `+serverlist`

**Alias:** `guilds`, `servers`, `sl`

### Affichage
- ID du serveur
- Nom
- Nombre de membres
- Propriétaire
- Date d'ajout
- Possibilité de quitter

---

## invite

Génère un lien d'invitation pour rejoindre un serveur.

**Usage:** `+invite <guild_id>`

**Alias:** `inv`, `getinvite`

### Fonctionnement
Crée une invitation temporaire dans le premier salon disponible.

### Exemples
```
+invite 1234567890123456789
```

---

## leave

Fait quitter un serveur au bot.

**Usage:** `+leave <guild_id>`

**Alias:** `quit`, `remove`

### Exemples
```
+leave 1234567890123456789
```

> **Confirmation** : Le bot demandera une confirmation avant de quitter.

---

## reload

Recharge les commandes/events sans redémarrer.

**Usage:** `+reload [commands|events|all]`

**Alias:** `rl`, `r`

### Exemples
```
+reload commands    # Recharge toutes les commandes
+reload events      # Recharge tous les events
+reload all         # Recharge tout
```

---

## dm

Envoie un message privé à un utilisateur.

**Usage:** `+dm <user_id> <message>`

**Alias:** `mp`, `message`, `msg`

### Exemples
```
+dm 123456789012345678 Bonjour !
```

---

## blacklist

Gère la liste noire des utilisateurs/serveurs.

**Usage:** `+blacklist <add|remove|list> <id>`

### Exemples
```
+blacklist add 123456789012345678
+blacklist remove 123456789012345678
+blacklist list
```

---

## Maintenance et Debug

### debug
Active le mode debug verbose.

```
+debug on
+debug off
```

### dbquery
Exécute une requête SQL directe.

```
+dbquery SELECT * FROM guilds
```

### statsfull
Statistiques détaillées du bot.

```
+statsfull
```

---

[← Retour à l'index des commandes](./README.md)
