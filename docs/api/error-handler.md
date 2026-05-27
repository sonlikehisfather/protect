# Utilitaire errorHandler.js

Gestion centralisée des erreurs du bot.

## Fonctions Exportées

### `init(client)`

Initialise le gestionnaire d'erreurs sur le client.

```javascript
const errorHandler = require('../utils/errorHandler');

// Dans index.js
errorHandler.init(client);
```

**Effets :**
- Intercepte les erreurs non catchées dans les promesses
- Log les erreurs Discord.js
- Formate les messages d'erreur

### `handle(error, context)`

Gère une erreur spécifique avec contexte.

```javascript
const { handle } = require('../utils/errorHandler');

try {
  await someOperation();
} catch (error) {
  handle(error, {
    source: 'command.ban',
    guildId: message.guild.id,
    userId: message.author.id,
    additionalInfo: 'Tentative de ban échouée'
  });
}
```

**Contexte optionnel :**
| Propriété | Description |
|-----------|-------------|
| `source` | Source de l'erreur (ex: 'command.ban') |
| `guildId` | ID du serveur |
| `userId` | ID de l'utilisateur |
| `additionalInfo` | Informations supplémentaires |

### `createErrorEmbed(error)`

Crée un embed d'erreur formaté.

```javascript
const { createErrorEmbed } = require('../utils/errorHandler');

const embed = createErrorEmbed(error);
// Renvoie un embed avec le message et la stack trace
```

---

## Types d'Erreurs Gérés

### Erreurs Discord.js

| Code | Signification | Action |
|------|---------------|--------|
| `50001` | Missing Access | Log + ignore |
| `50013` | Missing Permissions | Log + ignore |
| `10008` | Unknown Message | Log silencieux |
| `10011` | Unknown Role | Log silencieux |
| `10003` | Unknown Channel | Log silencieux |

### Erreurs Base de Données

```javascript
// SQLite errors
SQLITE_CONSTRAINT_UNIQUE  // Contrainte unique violée
SQLITE_CONSTRAINT_FOREIGNKEY  // Clé étrangère invalide
```

### Erreurs Réseau

```javascript
ECONNRESET    // Connexion reset
ETIMEDOUT     // Timeout
ENOTFOUND     // DNS lookup failed
```

---

## Configuration

### Niveaux de Log

```javascript
// .env
LOG_LEVEL=debug  // debug, info, warn, error
DEBUG_ERRORS=true  // Afficher les stack traces
```

### Format de Log

```
[2024-05-27 15:30:45] [ERROR] [command.ban] Une erreur est survenue
    Guild: 123456789
    User: 987654321
    Error: DiscordAPIError: Missing Permissions
    Stack: ...
```

---

## Exemple d'Utilisation dans une Commande

```javascript
const { handle } = require('../utils/errorHandler');

module.exports = {
  name: 'ban',
  
  async execute(message, args, client) {
    try {
      const member = await resolveMember(args[0]);
      if (!member) {
        return message.reply('Membre introuvable.');
      }
      
      await member.ban({ reason: args.slice(1).join(' ') });
      await message.reply('Membre banni avec succès.');
      
    } catch (error) {
      handle(error, {
        source: 'command.ban',
        guildId: message.guild.id,
        userId: message.author.id,
        targetId: args[0]
      });
      
      await message.reply('Impossible de bannir ce membre.');
    }
  }
};
```

---

[← Retour à l'index API](./README.md)
