# Documentation des Commandes

Référence complète de toutes les commandes disponibles dans le bot mysoul.

## Sommaire des Catégories

- [🛡️ Antiraid](./antiraid.md) - Protection anti-raid et sécurité
- [⚙️ Config](./config.md) - Configuration de la modération
- [🔧 Configserver](./configserver.md) - Configuration serveur
- [📌 Général](./general.md) - Commandes générales
- [🎉 Giveaways](./giveaways.md) - Gestion des giveaways
- [📊 Niveaux](./levels.md) - Système de niveaux
- [🔨 Modération](./moderation.md) - Outils de modération
- [👑 Owner](./owner.md) - Commandes propriétaire
- [🏠 Server](./server.md) - Utilitaires serveur
- [🎫 Tickets](./tickets.md) - Système de tickets

---

## Format de Documentation

Chaque commande est documentée avec :
- **Description** : Ce que fait la commande
- **Usage** : Syntaxe d'utilisation
- **Permissions** : Permissions nécessaires
- **Alias** : Raccourcis disponibles
- **Arguments** : Paramètres acceptés
- **Exemples** : Cas d'utilisation

---

## Types d'Arguments

| Notation | Signification | Exemple |
|----------|---------------|---------|
| `<arg>` | Obligatoire | `<@user>` |
| `[arg]` | Optionnel | `[raison]` |
| `a\|b` | Choix | `ban\|kick` |
| `...` | Multiple | `<@user> ...` |

---

## Système de Permission

### Permissions Utilisateur
- `ownerOnly` : Réservé au propriétaire (`BUYER_ID`)
- `permissions` : Permissions Discord requises
- `guildOnly` : Serveur uniquement (pas en DM)

### Permissions du Bot
- `botPermissions` : Permissions que le bot doit avoir

---

## Système de Cooldown

Chaque commande peut avoir un cooldown en secondes :
- Empêche le spam
- Configuration par commande
- Message d'attente automatique

---

## Type de Commandes

Ce bot utilise **uniquement des commandes avec préfixe** (Legacy) :

- Préfixe configurable (`+` par défaut)
- Ex: `+ban @user raison`
- Pas de slash commands disponibles

> **Note** : Toutes les commandes sont accessibles via le préfixe configuré. Il n'y a pas de commandes slash dans ce bot.

---

## Variables Disponibles

Dans les messages configurables (bienvenue, départ, etc.), ces variables sont disponibles :

| Variable | Description | Exemple |
|----------|-------------|---------|
| `{user.mention}` | Mention de l'utilisateur | @User |
| `{user.username}` | Nom d'utilisateur | User |
| `{user.id}` | ID Discord | 123456789 |
| `{server.name}` | Nom du serveur | Mon Serveur |
| `{server.id}` | ID du serveur | 987654321 |
| `{server.membercount}` | Nombre de membres | 150 |
| `{date}` | Date actuelle | 27/05/2026 |
| `{time}` | Heure actuelle | 15:02 |

---

## Navigation

Choisissez une catégorie ci-dessus pour voir la documentation détaillée de chaque commande.
