# Utilitaire embed.js

Création et personnalisation d'embeds Discord.

## Fonctions Exportées

### `createEmbed(options)`

Crée un embed Discord avec les options fournies.

```javascript
const { createEmbed } = require('../utils/embed');

const embed = createEmbed({
  title: 'Titre',
  description: 'Description',
  color: '#FF0000',
  fields: [
    { name: 'Champ 1', value: 'Valeur 1', inline: true },
    { name: 'Champ 2', value: 'Valeur 2', inline: true }
  ],
  footer: { text: 'Pied de page', iconURL: 'url' },
  thumbnail: 'url_miniature',
  image: 'url_image',
  author: { name: 'Auteur', iconURL: 'url', url: 'lien' },
  timestamp: true  // ou Date spécifique
});
```

### `createSuccessEmbed(message)`

Embed de succès préformaté (vert).

```javascript
const { createSuccessEmbed } = require('../utils/embed');

const embed = createSuccessEmbed('Opération réussie !');
// Affiche ✓ Opération réussie ! en vert
```

### `createErrorEmbed(message)`

Embed d'erreur préformaté (rouge).

```javascript
const { createErrorEmbed } = require('../utils/embed');

const embed = createErrorEmbed('Une erreur est survenue.');
// Affiche ✗ Une erreur est survenue. en rouge
```

### `createInfoEmbed(title, description)`

Embed d'information préformaté (bleu).

```javascript
const { createInfoEmbed } = require('../utils/embed');

const embed = createInfoEmbed('Information', 'Voici les détails...');
```

### `createWarningEmbed(message)`

Embed d'avertissement préformaté (orange).

```javascript
const { createWarningEmbed } = require('../utils/embed');

const embed = createWarningEmbed('Attention !');
```

### `addPagination(embeds, page, total)`

Ajoute une pagination à un embed.

```javascript
const { addPagination } = require('../utils/embed');

const embed = createEmbed({ title: 'Page 1' });
addPagination(embed, 1, 5);
// Ajoute "Page 1/5" dans le footer
```

---

## Exemples Complets

### Embed de Commande Help

```javascript
const embed = createEmbed({
  title: `Commande: ${command.name}`,
  description: command.description,
  color: '#5865F2',
  fields: [
    {
      name: '📝 Usage',
      value: `\`${command.usage || 'Aucun'}\``,
      inline: false
    },
    {
      name: '🔗 Alias',
      value: command.aliases?.join(', ') || 'Aucun',
      inline: true
    },
    {
      name: '⏱️ Cooldown',
      value: `${command.cooldown || 0}s`,
      inline: true
    },
    {
      name: '🔒 Permissions',
      value: command.permissions?.join(', ') || 'Aucune',
      inline: false
    }
  ],
  footer: { text: 'Utilisez +help pour la liste complète' },
  timestamp: true
});
```

### Embed de Log

```javascript
const embed = createEmbed({
  title: '🔨 Bannissement',
  description: `**${member.user.tag}** a été banni.`,
  color: '#FF0000',
  fields: [
    { name: 'Utilisateur', value: `${member.user.tag} (${member.id})`, inline: true },
    { name: 'Modérateur', value: `${moderator.tag}`, inline: true },
    { name: 'Raison', value: reason || 'Aucune', inline: false }
  ],
  thumbnail: member.user.displayAvatarURL({ dynamic: true }),
  footer: { text: `ID: ${member.id}` },
  timestamp: true
});
```

---

[← Retour à l'index API](./README.md)
