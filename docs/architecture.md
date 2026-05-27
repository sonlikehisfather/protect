# Architecture du Bot mysoul

Ce document décrit en détail l'architecture technique du bot mysoul, son organisation et le flux de données.

## Sommaire
1. [Vue d'ensemble](#vue-densemble)
2. [Flux de Données](#flux-de-données)
3. [Structure des Dossiers](#structure-des-dossiers)
4. [Noyau (Core)](#noyau-core)
5. [Système de Commandes](#système-de-commandes)
6. [Système d'Événements](#système-dévénements)
7. [Base de Données](#base-de-données)
8. [Modules Avancés](#modules-avancés)

---

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────┐
│                        DISCORD API                              │
└────────────────────┬──────────────────────────────────────────────┘
                     │
                     │ Gateway WebSocket
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DISCORD.JS CLIENT                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Events     │  │  Commands    │  │   Modules    │          │
│  │  (events/)   │  │ (commands/)  │  │  (modules/)  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                            ▼                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Core       │  │    Utils     │  │  Database    │          │
│  │(client.js)   │  │   (utils/)   │  │(database.js) │         │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                     │
                     │ better-sqlite3
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DATABASE SQLITE                                │
│                    (database.sqlite)                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Flux de Données

### 1. Démarrage du Bot (index.js)

```javascript
index.js
    │
    ├──▶ Chargement .env (dotenv)
    │
    ├──▶ Vérification variables requises
    │
    ├──▶ Création client Discord (core/client.js)
    │
    ├──▶ Initialisation errorHandler
    │
    ├──▶ Chargement des modules/events/commands (core/loader.js)
    │
    └──▶ Connexion à Discord (client.login)
```

### 2. Traitement d'un Message

```
Message Discord
     │
     ▼
event: messageCreate (events/messageCreate.js)
     │
     ├──▶ Vérifications (bot, permissions, cooldown)
     │
     ├──▶ Parsing du préfixe et de la commande
     │
     ├──▶ Recherche dans client.commands (Collection)
     │
     └──▶ Exécution de la commande
              │
              ├──▶ Accès BDD (si nécessaire)
              ├──▶ Actions Discord (reply, send, etc.)
              └──▶ Logging
```

### 3. Traitement d'une Interaction (Slash Command)

```
Interaction Discord
     │
     ▼
event: interactionCreate (events/interactionCreate.js)
     │
     ├──▶ Vérification type (Command/Button/Modal/Select)
     │
     ├──▶ Pour Slash Command:
     │        └──▶ Recherche dans client.slashCommands
     │
     └──▶ Exécution avec gestion des sous-commandes
```

---

## Structure des Dossiers

### Organisation Détaillée

```
mysoul/
│
├── 📁 commands/              # Commandes préfixées
│   ├── 📁 antiraid/          # 7 commandes - Protection serveur
│   │   ├── antiraid.js       # Configuration globale
│   │   ├── antiban.js        # Protection anti-ban massif
│   │   ├── antirole.js       # Protection anti-modif rôles
│   │   ├── antiwebhook.js    # Protection anti-webhooks
│   │   └── ...
│   │
│   ├── 📁 config/            # 13 commandes - Config modération
│   │   ├── muteconfig.js     # Configuration des mutes
│   │   ├── punish.js         # Configuration auto-punitions
│   │   ├── slowmode.js       # Configuration ralentissement
│   │   └── ...
│   │
│   ├── 📁 configserver/      # 26 commandes - Config serveur
│   │   ├── autorole.js       # Rôles automatiques
│   │   ├── joinsettings.js   # Messages de bienvenue
│   │   ├── leavesettings.js  # Messages de départ
│   │   ├── modmail.js        # Configuration modmail
│   │   ├── tempvoc.js        # Vocaux temporaires
│   │   └── ...
│   │
│   ├── 📁 general/           # 26 commandes - Générales
│   │   ├── help.js           # Aide commandes
│   │   ├── userinfo.js       # Info utilisateur
│   │   ├── serverinfo.js     # Info serveur
│   │   ├── calc.js           # Calculateur
│   │   └── ...
│   │
│   ├── 📁 giveaways/         # 4 commandes - Giveaways
│   │   ├── giveaway.js       # Créer un giveaway
│   │   ├── gend.js           # Terminer
│   │   ├── greroll.js        # Relancer
│   │   └── gdelete.js        # Supprimer
│   │
│   ├── 📁 levels/            # 4 commandes - Niveaux
│   │   ├── rank.js           # Voir son niveau
│   │   ├── leaderboard.js    # Classement
│   │   ├── setlevel.js       # Définir niveau (admin)
│   │   └── resetlevel.js     # Réinitialiser niveau
│   │
│   ├── 📁 moderation/        # 36 commandes - Modération
│   │   ├── ban.js            # Bannissement
│   │   ├── kick.js           # Expulsion
│   │   ├── mute.js           # Mute temporaire
│   │   ├── warn.js           # Avertissement
│   │   ├── warnlist.js       # Liste des warns
│   │   ├── clear.js          # Purge messages
│   │   ├── lock.js           # Verrouiller salon
│   │   └── ...
│   │
│   ├── 📁 owner/             # 29 commandes - Propriétaire uniquement
│   │   ├── eval.js           # Évaluation code
│   │   ├── say.js            # Envoyer message
│   │   ├── activity.js       # Changer activité
│   │   ├── serverlist.js     # Liste des serveurs
│   │   └── ...
│   │
│   ├── 📁 server/            # 17 commandes - Utilitaires serveur
│   │   ├── embed.js          # Créateur d'embed
│   │   ├── autoreact.js      # Réactions auto
│   │   ├── poll.js           # Sondage
│   │   └── ...
│   │
│   └── 📁 tickets/           # 8 commandes - Système de tickets
│       ├── ticket.js         # Créer un ticket
│       ├── close.js          # Fermer un ticket
│       ├── add.js            # Ajouter membre
│       ├── remove.js         # Retirer membre
│       └── ...
│
├── 📁 core/                  # Noyau du bot
│   ├── client.js             # Factory client Discord
│   ├── database.js           # Wrapper SQLite
│   └── loader.js             # Chargeur dynamique
│
├── 📁 events/                # 29 gestionnaires d'événements
│   ├── ready.js              # Bot prêt
│   ├── messageCreate.js      # Message reçu
│   ├── interactionCreate.js   # Interaction reçue
│   ├── guildMemberAdd.js     # Membre rejoint
│   ├── guildMemberRemove.js # Membre quitte
│   ├── messageDelete.js      # Message supprimé
│   ├── messageUpdate.js      # Message modifié
│   ├── *[Guard].js           # Protection anti-raid
│   └── ...
│
├── 📁 modules/               # Modules avancés
│   ├── automod.js            # Auto-modération
│   ├── tickets.js            # Logique tickets
│   ├── modmail.js            # Système modmail
│   ├── giveaways.js          # Logique giveaways
│   ├── levels.js             # Système de niveaux
│   ├── tempvoc.js            # Vocaux temporaires
│   ├── customCommands.js     # Commandes personnalisées
│   └── ...
│
├── 📁 utils/                 # 23 utilitaires
│   ├── errorHandler.js       # Gestion erreurs
│   ├── embed.js              # Builder d'embeds
│   ├── logger.js             # Logging console
│   ├── parseDuration.js      # Parsing durées (1h30m)
│   ├── commandCooldown.js    # Gestion cooldowns
│   └── ...
│
├── index.js                  # Point d'entrée
├── config.json               # Configuration globale
└── .env                      # Variables d'environnement
```

---

## Noyau (Core)

### client.js

Factory pattern pour créer le client Discord avec tous les intents nécessaires.

```javascript
// Crée un client avec:
// - Intents complets (Guilds, Messages, Members, etc.)
// - Partials pour gérer les données incomplètes
// - Collections pour commands, slashCommands, cooldowns
```

**Intents activés :**
- `Guilds` - Création/modification serveurs
- `GuildMessages` - Messages dans les serveurs
- `MessageContent` - Contenu des messages (nécessaire pour les commandes préfixées)
- `GuildMembers` - Gestion des membres
- `GuildModeration` - Modération (ban/kick)
- `GuildVoiceStates` - États vocaux
- `GuildMessageReactions` - Réactions aux messages
- `GuildWebhooks` - Gestion webhooks
- `GuildScheduledEvents` - Événements planifiés
- `GuildPresences` - Présences utilisateurs
- `DirectMessages` - Messages privés (modmail)

### database.js

Wrapper autour de `better-sqlite3` avec :
- Connexion automatique
- Préparation des requêtes
- Gestion des transactions
- Schéma intégré (tables créées automatiquement)

### loader.js

Système de chargement dynamique avec hot-reload support.

```javascript
loadAll(client)
    ├──▶ loadEvents(client)     // Charge tous les events/
    ├──▶ loadCommands(client)   // Charge tous les commands/
    └──▶ loadSlashCommands()    // Déploie les slash commands
```

---

## Système de Commandes

### Format d'une Commande

```javascript
// commands/category/command.js
module.exports = {
  name: 'commandname',           // Nom unique
  aliases: ['alias1', 'alias2'],  // Alias optionnels
  description: 'Description',     // Pour l'aide
  usage: '<arg1> [arg2]',        // Syntaxe
  category: 'Category',          // Catégorie
  cooldown: 5,                   // Secondes de cooldown
  permissions: ['BanMembers'],   // Permissions requises
  botPermissions: ['SendMessages'],
  ownerOnly: false,              // Commande propriétaire
  guildOnly: true,               // Serveur uniquement
  
  async execute(message, args, client) {
    // Logique de la commande
  }
};
```

### Format d'une Commande Slash

```javascript
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('command')
    .setDescription('Description')
    .addStringOption(opt => opt
      .setName('option')
      .setDescription('Une option')
      .setRequired(true)),
  
  async execute(interaction, client) {
    // Logique
  }
};
```

---

## Système d'Événements

### Format d'un Événement

```javascript
// events/eventName.js
module.exports = {
  name: 'eventName',      // Nom de l'event Discord.js
  once: false,            // Exécuter une seule fois ?
  
  async execute(arg1, arg2, client) {
    // Gestion de l'événement
  }
};
```

### Événements Principaux

| Événement | Description | Fichier |
|-----------|-------------|---------|
| `ready` | Bot connecté | `ready.js` |
| `messageCreate` | Message reçu | `messageCreate.js` |
| `interactionCreate` | Interaction reçue | `interactionCreate.js` |
| `guildMemberAdd` | Membre rejoint | `guildMemberAdd.js` |
| `guildMemberRemove` | Membre part | `guildMemberRemove.js` |
| `messageDelete` | Message supprimé | `messageDelete.js` |
| `messageUpdate` | Message édité | `messageUpdate.js` |

---

## Base de Données

### Tables Principales

| Table | Description |
|-------|-------------|
| `guilds` | Configuration par serveur |
| `users` | Données utilisateurs (niveaux, économie) |
| `warns` | Avertissements |
| `tickets` | Tickets actifs |
| `giveaways` | Giveaways en cours |
| `custom_commands` | Commandes personnalisées |
| `tempvoc` | Vocaux temporaires |
| `automod` | Configuration auto-modération |
| `logs` | Logs d'actions |

### Pattern d'Accès

```javascript
const db = require('../core/database');

// SELECT
db.get('SELECT * FROM guilds WHERE id = ?', [guildId]);

// INSERT/UPDATE
db.run('INSERT OR REPLACE INTO guilds (id, prefix) VALUES (?, ?)', [guildId, prefix]);

// TRANSACTION
db.transaction(() => {
  db.run('...');
  db.run('...');
})();
```

---

## Modules Avancés

### Architecture Modulaire

Chaque module dans `modules/` est indépendant et expose une API claire :

```javascript
// Exemple: modules/tickets.js
module.exports = {
  createTicket: async (member, category) => { ... },
  closeTicket: async (channel, closer) => { ... },
  addUser: async (channel, user) => { ... },
  removeUser: async (channel, user) => { ... },
  generateTranscript: async (channel) => { ... }
};
```

### Communication Inter-Modules

Les modules communiquent via le client :

```javascript
// Accès à un module depuis une commande
const tickets = require('../modules/tickets');

// Ou via le client (si enregistré)
client.modules.tickets.createTicket(...);
```

---

## Cycle de Vie des Requêtes

```
┌─────────────┐
│   Entrée    │  Message ou Interaction Discord
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Validation  │  Vérifications initiales
│  (events)   │  - Bot ? Ignorer
└──────┬──────┘  - Permissions ?
       │        - Cooldown ?
       ▼
┌─────────────┐
│   Parsing   │  Extraction commande + arguments
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Recherche  │  Trouver dans client.commands
│   Commande  │  ou client.slashCommands
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Exécution   │  Appel de execute()
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Sortie    │  Réponse Discord
│             │  + Log + Mise à jour BDD
└─────────────┘
```

Cette architecture assure un code maintenable, modulaire et performant.
