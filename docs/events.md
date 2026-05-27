# Documentation des Événements

Liste complète des événements Discord gérés par le bot.

## Vue d'ensemble

Les événements sont situés dans `events/` et chargés automatiquement par `core/loader.js`.

## Liste des Événements

### Cycle de Vie du Bot

| Événement | Fichier | Description |
|-----------|---------|-------------|
| `ready` | `ready.js` | Bot connecté et prêt |
| `shardResume` | `shardResume.js` | Connexion shard restaurée |

### Messages

| Événement | Fichier | Description |
|-----------|---------|-------------|
| `messageCreate` | `messageCreate.js` | Message reçu |
| `messageUpdate` | `messageUpdate.js` | Message modifié |
| `messageDelete` | `messageDelete.js` | Message supprimé |
| `messageReactionAdd` | `messageReactionAdd.js` | Réaction ajoutée |
| `messageReactionRemove` | `messageReactionRemove.js` | Réaction retirée |

### Membres

| Événement | Fichier | Description |
|-----------|---------|-------------|
| `guildMemberAdd` | `guildMemberAdd.js` | Membre rejoint |
| `guildMemberRemove` | `guildMemberRemove.js` | Membre quitte |
| `guildMemberUpdate` | `guildMemberUpdate.js` | Membre modifié (rôle, nick...) |

### Serveur

| Événement | Fichier | Description |
|-----------|---------|-------------|
| `guildCreate` | `guildCreate.js` | Bot rejoint un serveur |
| `guildDelete` | `guildDelete.js` | Bot quitte un serveur |
| `guildUpdate` | `guildUpdateGuard.js` | Serveur modifié + protection |
| `guildBanAdd` | `guildBanAdd.js` | Membre banni |
| `guildBanRemove` | `guildBanRemove.js` | Membre débanni |

### Salons

| Événement | Fichier | Description |
|-----------|---------|-------------|
| `channelCreate` | `channelCreate.js` | Salon créé |
| `channelDelete` | `channelDelete.js` | Salon supprimé |
| `channelCreate` | `channelCreateGuard.js` | Protection anti-raid création |
| `channelDelete` | `channelDeleteGuard.js` | Protection anti-raid suppression |

### Vocaux

| Événement | Fichier | Description |
|-----------|---------|-------------|
| `voiceStateUpdate` | `voiceStateUpdate.js` | Changement état vocal (join/leave/move) |

### Interactions

| Événement | Fichier | Description |
|-----------|---------|-------------|
| `interactionCreate` | `interactionCreate.js` | Slash command, bouton, modal, select menu |

### Sécurité (Anti-Raid)

| Événement | Fichier | Description |
|-----------|---------|-------------|
| `guildBanAdd` | `antibanGuard.js` | Protection anti-ban massif |
| `guildBanRemove` | `antiunbanGuard.js` | Protection anti-unban massif |
| `guildMemberUpdate` | `antiroleGuard.js` | Protection anti-attribution rôles |
| `webhookUpdate` | `antiwebhookGuard.js` | Protection anti-webhooks |
| `raw` | (index.js) | Protection anti-token (DM) |

### Autres

| Événement | Fichier | Description |
|-----------|---------|-------------|
| `roleDelete` | `roleDelete.js` | Rôle supprimé |
| `presenceUpdate` | `presenceUpdate.js` | Présence mise à jour |
| `userUpdate` | `userUpdate.js` | Utilisateur mis à jour (nom, avatar...) |

---

## Format d'un Événement

```javascript
// events/eventName.js
'use strict';

module.exports = {
  name: 'eventName',     // Nom exact de l'event Discord.js
  once: false,           // true = exécuter une seule fois
  
  async execute(arg1, arg2, client) {
    // arg1, arg2 = arguments de l'événement Discord.js
    // client = instance du client Discord
    
    try {
      // Logique de l'événement
    } catch (error) {
      // Gestion d'erreur
      console.error(`[Event:${this.name}]`, error);
    }
  }
};
```

### Exemple : messageCreate

```javascript
// events/messageCreate.js
'use strict';

const db = require('../core/database');
const { handleCommand } = require('../utils/commandHandler');

module.exports = {
  name: 'messageCreate',
  once: false,
  
  async execute(message, client) {
    // Ignorer les bots
    if (message.author.bot) return;
    
    // Ignorer les DM (gérés par modmail)
    if (!message.guild) return;
    
    // Gérer les commandes
    if (message.content.startsWith(client.config.prefix)) {
      await handleCommand(message, client);
    }
    
    // Gain d'XP (niveaux)
    await addXP(message.author.id, message.guild.id, client);
  }
};

async function addXP(userId, guildId, client) {
  const xpGain = Math.floor(Math.random() * 15) + 10;
  
  const result = db.run(
    `UPDATE users SET xp = xp + ?, messages = messages + 1 
     WHERE id = ? AND guild_id = ?`,
    [xpGain, userId, guildId]
  );
  
  // Vérifier level up...
}
```

---

## Gestion des Erreurs

Les événements sont wrappés par `errorHandler` :

```javascript
// Dans index.js
errorHandler.init(client);

// Les erreurs non catchées dans les events sont loggées
```

### Pattern de Gestion

```javascript
module.exports = {
  name: 'guildMemberAdd',
  once: false,
  
  async execute(member, client) {
    try {
      // 1. Récupérer la config du serveur
      const config = db.get('SELECT * FROM guilds WHERE id = ?', [member.guild.id]);
      if (!config) return;
      
      // 2. Autorôles
      if (config.autoroles) {
        const roles = JSON.parse(config.autoroles);
        for (const roleId of roles) {
          await member.roles.add(roleId).catch(() => {});
        }
      }
      
      // 3. Message de bienvenue
      if (config.welcome_channel) {
        const channel = await client.channels.fetch(config.welcome_channel);
        if (channel) {
          const message = formatMessage(config.welcome_message, member);
          await channel.send(message);
        }
      }
      
    } catch (error) {
      console.error(`[Event:${this.name}]`, error);
    }
  }
};
```

---

## Priorité des Événements

Ordre de chargement :
1. `ready` - Initialisation complète
2. `guildCreate` - Configuration par défaut
3. `messageCreate` / `interactionCreate` - Commandes
4. Événements de modération/sécurité
5. Événements de logs
6. Autres événements

---

## Performance

### Bonnes Pratiques

1. **Vérifications rapides d'abord**
```javascript
if (message.author.bot) return;  // O(1)
if (!message.guild) return;       // O(1)
// Requêtes BDD après
```

2. **Async/Await approprié**
```javascript
// Mauvais: bloque le thread
const data = db.get('SELECT * FROM ...');

// Bon: better-sqlite3 est synchrone
const data = db.get('SELECT * FROM ...');
```

3. **Gestion des erreurs**
```javascript
await member.roles.add(roleId).catch(() => {
  // Rôle inexistant ou permissions insuffisantes
});
```

---

## Événements Personnalisés

Pour créer un nouvel événement :

1. Créer le fichier dans `events/`
2. Suivre le format standard
3. Le fichier sera chargé automatiquement

```javascript
// events/customEvent.js
'use strict';

module.exports = {
  name: 'customEvent',
  once: false,
  
  async execute(data, client) {
    // Implémentation
  }
};
```

---

[← Retour à la documentation](../README.md)
