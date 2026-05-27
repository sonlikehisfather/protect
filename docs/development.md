# Guide de Développement

Guide pour contribuer au développement du bot mysoul.

## Sommaire
1. [Environnement de Développement](#environnement-de-développement)
2. [Structure du Code](#structure-du-code)
3. [Créer une Commande](#créer-une-commande)
4. [Créer un Événement](#créer-un-événement)
5. [Tests](#tests)
6. [Style de Code](#style-de-code)

---

## Environnement de Développement

### Prérequis
- Node.js 18+
- npm ou yarn
- Git
- Un bot Discord de test
- Un serveur Discord de test

### Setup

```bash
# 1. Fork le repository
git clone https://github.com/sonlikehisfather/protect.git
cd protect

# 2. Installer les dépendances
npm install

# 3. Configuration
cp .env.example .env
# Éditer .env avec vos tokens de test

# 4. Démarrage développement
npm run dev
```

### Configuration ESLint

Le projet utilise ESLint pour la qualité du code :

```bash
# Linter tout le projet
npm run lint

# Linter un fichier spécifique
npx eslint commands/moderation/ban.js

# Fixer automatiquement
npx eslint . --fix
```

---

## Structure du Code

### Conventions de Nommage

| Élément | Convention | Exemple |
|---------|------------|---------|
| Fichiers | camelCase | `ban.js`, `userInfo.js` |
| Variables | camelCase | `memberCount`, `userId` |
| Constantes | UPPER_SNAKE | `MAX_WARNINGS`, `DEFAULT_PREFIX` |
| Classes | PascalCase | `CustomCommand`, `TicketManager` |
| Fonctions | camelCase | `createEmbed()`, `parseDuration()` |

### Organisation des Imports

```javascript
'use strict';

// 1. Core Node.js
const fs = require('fs');
const path = require('path');

// 2. Packages npm
const { EmbedBuilder } = require('discord.js');
const ms = require('ms');

// 3. Internes - Core
const db = require('../core/database');

// 4. Internes - Utils
const { createEmbed } = require('../utils/embed');
const { parseDuration } = require('../utils/parseDuration');

// 5. Internes - Modules
const tickets = require('../modules/tickets');
```

---

## Créer une Commande

### Template Complet

```javascript
// commands/category/nomCommande.js
'use strict';

const { createEmbed, createErrorEmbed } = require('../../utils/embed');
const db = require('../../core/database');

module.exports = {
  // Métadonnées
  name: 'nomCommande',
  aliases: ['alias1', 'alias2'],
  description: 'Description de ce que fait la commande',
  usage: '<argument_obligatoire> [optionnel]',
  category: 'Categorie',
  cooldown: 5, // secondes
  
  // Permissions
  permissions: ['ManageMessages'],  // Permissions utilisateur requises
  botPermissions: ['SendMessages', 'EmbedLinks'],  // Permissions bot requises
  ownerOnly: false,
  guildOnly: true,
  
  // Exécution
  async execute(message, args, client) {
    try {
      // 1. Validation des arguments
      if (!args.length) {
        return message.reply({
          embeds: [createErrorEmbed('Usage: ' + this.usage)]
        });
      }
      
      // 2. Logique principale
      const result = await doSomething(args);
      
      // 3. Réponse
      const embed = createEmbed({
        title: 'Succès',
        description: `Résultat: ${result}`,
        color: '#00FF00'
      });
      
      await message.reply({ embeds: [embed] });
      
    } catch (error) {
      console.error(`[Command:${this.name}]`, error);
      await message.reply({
        embeds: [createErrorEmbed('Une erreur est survenue.')]
      });
    }
  }
};
```

### Commande Slash

```javascript
// commands/category/slashCommand.js
'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nomcommande')
    .setDescription('Description de la commande')
    .addUserOption(option => option
      .setName('utilisateur')
      .setDescription('L\'utilisateur cible')
      .setRequired(true))
    .addStringOption(option => option
      .setName('raison')
      .setDescription('La raison')
      .setRequired(false)),
  
  permissions: ['ModerateMembers'],
  
  async execute(interaction, client) {
    const user = interaction.options.getUser('utilisateur');
    const reason = interaction.options.getString('raison') || 'Aucune raison';
    
    // Logique...
    
    await interaction.reply({
      embeds: [createEmbed({
        title: 'Action effectuée',
        description: `Sur ${user.tag} pour: ${reason}`
      })]
    });
  }
};
```

---

## Créer un Événement

### Template

```javascript
// events/monEvenement.js
'use strict';

const db = require('../core/database');
const { handleError } = require('../utils/errorHandler');

module.exports = {
  name: 'eventName',  // Nom exact Discord.js
  once: false,        // true pour exécuter une seule fois
  
  async execute(arg1, arg2, client) {
    try {
      // Vérifications rapides d'abord
      if (shouldIgnore(arg1)) return;
      
      // Logique
      await processEvent(arg1, arg2, client);
      
    } catch (error) {
      handleError(error, {
        source: `event.${this.name}`,
        additionalInfo: 'Erreur lors du traitement'
      });
    }
  }
};

function shouldIgnore(arg) {
  // Logique d'ignorance
  return false;
}

async function processEvent(arg1, arg2, client) {
  // Logique principale
}
```

---

## Tests

### Structure des Tests

```
tests/
├── unit/
│   ├── commands/
│   ├── utils/
│   └── modules/
└── integration/
    └── api.test.js
```

### Exemple de Test Unitaire

```javascript
// tests/unit/utils/parseDuration.test.js
const { parseDuration } = require('../../../utils/parseDuration');

describe('parseDuration', () => {
  test('parse 1h', () => {
    expect(parseDuration('1h')).toBe(3600000);
  });
  
  test('parse 1d', () => {
    expect(parseDuration('1d')).toBe(86400000);
  });
  
  test('parse complex', () => {
    expect(parseDuration('1h30m')).toBe(5400000);
  });
  
  test('invalid input', () => {
    expect(parseDuration('invalid')).toBeNull();
  });
});
```

### Exécuter les Tests

```bash
# Tous les tests
npm test

# Tests unitaires uniquement
npm run test:unit

# Tests avec couverture
npm run test:coverage
```

---

## Style de Code

### ESLint Configuration

```javascript
// eslint.config.js
module.exports = {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs'
  },
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'off',  // Console autorisée pour le logging
    'prefer-const': 'error',
    'no-var': 'error'
  }
};
```

### Bonnes Pratiques

1. **Utiliser const/let, pas var**
```javascript
//  Mauvais
var count = 0;

//  Bon
const count = 0;
let current = 1;
```

2. **Async/Await préféré aux promesses**
```javascript
//  Mauvais
doSomething().then(result => {
  return doSomethingElse(result);
}).then(final => {
  console.log(final);
});

//  Bon
const result = await doSomething();
const final = await doSomethingElse(result);
console.log(final);
```

3. **Gestion des erreurs explicite**
```javascript
//  Mauvais
doSomething();

//  Bon
try {
  await doSomething();
} catch (error) {
  handleError(error);
}
```

4. **Commentaires pertinents**
```javascript
//  Bon - explique le POURQUOI
// Nécessaire car Discord rate-limite à 5 requêtes/secondes
await sleep(200);

//  Mauvais - explique le QUOI (évident)
// Attendre 200ms
await sleep(200);
```

---

## Debugging

### Logs

```javascript
// Niveaux de log
console.log('[DEBUG]', 'Message debug');     // Développement
console.info('[INFO]', 'Information');          // Production
console.warn('[WARN]', 'Avertissement');        // Attention
console.error('[ERROR]', 'Erreur');             // Erreur
```

### Mode Debug

```bash
# Activer le debug
DEBUG_LOADER=true npm run dev
DEBUG_SQL=true npm run dev
```

---

[← Retour à la documentation](../README.md)
