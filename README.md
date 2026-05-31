# mysoul - Bot Discord Multifonction

<p align="center">
  <img src="https://img.shields.io/badge/Discord.js-v14.26.2-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord.js">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/SQLite-better--sqlite3-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/License-ISC-yellow?style=for-the-badge" alt="License">
</p>

## Table des matières

- [Introduction](#introduction)
- [Fonctionnalités](#fonctionnalités)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Démarrage](#démarrage)
- [Architecture](#architecture)
- [Documentation](#documentation)
- [Contribution](#contribution)
- [Support](#support)

## Introduction

**mysoul** est un bot Discord avancé et multifonction, conçu pour offrir une expérience de modération, de gestion communautaire et d'automatisation complète pour vos serveurs Discord. Développé avec [Discord.js v14](https://discord.js.org/) et utilisant SQLite comme base de données locale, mysoul combine performance et simplicité.

## Fonctionnalités

### 🔧 Modération
- **Commandes de modération** : ban, kick, mute, warn, lock, slowmode, etc.
- **Système de warn** avec configuration automatique des punitions
- **Logs complets refaits** : messages supprimés/modifiés, arrivées/départs, bans/unbans, rôles, salons
- **Protection anti-raid** : antiban, antirole, antiwebhook, antitoken
- **Sécurité serveur** : SecurInvite (vérification des serveurs non autorisés)

### 🎫 Gestion
- **Système de tickets** avec catégories personnalisables et transcripts
- **Modmail** pour communication DM → serveur
- **Giveaways** avec conditions d'éligibilité configurables
- **Vocaux temporaires** créés automatiquement

### ⚙️ Configuration Serveur
- **Auto-rôles** à l'arrivée des membres
- **Messages de bienvenue/départ** personnalisables avec variables
- **Commandes personnalisées** créables sans code
- **Auto-modération** : filtres de mots interdits, anti-spam
- **Menu de rôles** réaction-based

### 📊 Niveaux & Économie
- **Système de niveaux avancé** : XP par message, multiplicateurs par rôle, cooldowns par salon
- **Commande +rank** : interface moderne avec barre de progression et classement
- **Système XP des jeux** : gagne de l'XP en jouant aux mini-jeux
- **Leaderboards** et récompenses de niveaux
- **Rôles de niveau** : attribution automatique selon le niveau atteint

### 👑 Administration
- **Commandes owner-only** : évaluation, diffusion de messages, gestion d'activité
- **Panel serveurs** : liste des serveurs avec création d'invitation et gestion à distance
- **Notifications buyer** : alerte DM quand le bot rejoint un serveur
- **Multi-serveur** support avec gestion centralisée
- **Configuration par serveur** persistante en BDD

### 🎮 Jeux & Fun
- **+quiz** : quiz général avec 200+ questions, système de score et récompenses XP
- **+guess** : jeu du Plus ou Moins avec chat interactif
- **+blackjack** : jeu de cartes classique
- **+roulette** : roulette casino avec multiplicateurs
- **+coinflip** : pile ou face
- **+roll** : lancer de dés
- **+8ball** : boule magique
- **+qi** : test de QI rapide

### 💾 Backup & Sécurité
- **Backup Supabase** : synchronisation automatique des données vers le cloud
- **Purge automatique** : nettoyage des données des serveurs inactifs
- **Sauvegarde locale** : base SQLite avec persistance des données

## Prérequis

- **Node.js** v18.0.0 ou supérieur
- **npm** v8.0.0 ou supérieur
- Un **bot Discord** avec token ([créer un bot](https://discord.com/developers/applications))
- (Optionnel) [Supabase](https://supabase.com/) pour backup cloud

## Installation

1. **Cloner le repository**
   ```bash
   git clone https://github.com/sonlikehisfather/protect.git
   cd mysoul
   ```

2. **Installer les dépendances**
   ```bash
   npm install
   ```

3. **Créer le fichier `.env`**
   ```env
   TOKEN=votre_token_discord
   CLIENT_ID=votre_client_id
   BUYER_ID=votre_id_discord
   DEV_GUILD_ID=id_serveur_dev_optionnel
   NODE_ENV=development
   ```

## Configuration

### Variables d'environnement (.env)

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `TOKEN` |  | Token du bot Discord |
| `CLIENT_ID` |  | ID de l'application Discord |
| `BUYER_ID` |  | ID Discord du propriétaire |
| `DEV_GUILD_ID` |  | ID du serveur de développement (optionnel) |
| `NODE_ENV` |  | `development` ou `production` |
| `SUPABASE_URL` |  | URL Supabase pour backup cloud (optionnel) |
| `SUPABASE_KEY` |  | Clé API Supabase (optionnel) |

### Configuration du bot (config.json)

```json
{
  "prefix": "+",
  "color": "#2B2D31"
}
```

| Option | Description | Défaut |
|--------|-------------|--------|
| `prefix` | Préfixe des commandes textuelles | `+` |
| `color` | Couleur des embeds | `#2B2D31` |
| `ownerId` | ID Discord du propriétaire (backup) | - |

### Configuration des logs (`logs.json`)

```json
{
  "messageDelete": true,
  "messageUpdate": true,
  "memberAdd": true,
  "memberRemove": true,
  "roleCreate": true,
  "roleDelete": true,
  "channelCreate": true,
  "channelDelete": true
}
```

## Démarrage

### Mode développement (avec auto-reload)
```bash
npm run dev
```

### Mode production
```bash
npm start
```

## Architecture

```
mysoul/
├── 📁 commands/          # Commandes préfixées organisées par catégorie
│   ├── antiraid/        # Commandes de protection
│   ├── config/          # Configuration modération
│   ├── configserver/    # Configuration serveur
│   ├── general/         # Commandes générales
│   ├── giveaways/       # Gestion des giveaways
│   ├── levels/          # Système de niveaux
│   ├── moderation/      # Commandes de modération
│   ├── owner/           # Commandes propriétaire
│   ├── server/          # Commandes utilitaires serveur
│   └── tickets/         # Gestion des tickets
├── 📁 core/             # Noyau du bot
│   ├── client.js        # Création du client Discord
│   ├── database.js      # Gestion SQLite
│   └── loader.js        # Chargement commands/events
├── 📁 events/           # Événements Discord
├── 📁 modules/          # Modules avancés (tickets, modmail, giveaways...)
├── 📁 utils/            # Utilitaires
├── 📁 docs/             # Documentation détaillée
├── index.js             # Point d'entrée
└── config.json          # Configuration globale
```

## Documentation

La documentation complète est disponible dans le dossier [`docs/`](./docs/) :

- **[Getting Started](./docs/getting-started.md)** - Guide de démarrage rapide
- **[Architecture](./docs/architecture.md)** - Détails de l'architecture
- **[Commandes](./docs/commands/README.md)** - Documentation de toutes les commandes
- **[Événements](./docs/events.md)** - Liste des événements gérés
- **[Modules](./docs/modules/README.md)** - Documentation des modules avancés
- **[Base de données](./docs/database.md)** - Schéma et requêtes SQL
- **[API Interne](./docs/api/README.md)** - Référence des utilitaires
- **[Développement](./docs/development.md)** - Guide pour contributeurs
- **[Déploiement](./docs/deployment.md)** - Mise en production
- **[FAQ](./docs/faq.md)** - Questions fréquentes

## Contribution

Les contributions sont les bienvenues ! Veuillez consulter [CONTRIBUTING.md](./docs/CONTRIBUTING.md) pour les guidelines.

1. Fork le projet
2. Créer une branche (`git checkout -b feature/ma-feature`)
3. Commit vos changements (`git commit -m 'Ajout de ma feature'`)
4. Push sur la branche (`git push origin feature/ma-feature`)
5. Ouvrir une Pull Request

## Support

Pour toute question ou problème :

- 📖 Consulter la [FAQ](./docs/faq.md)
- 🐛 Ouvrir une [Issue](https://github.com/sonlikehisfather/protect/issues)
- 💬 Rejoindre le serveur Discord de support (à configurer)

---

<p align="center">
  <sub>Développé avec ❤️ pour la communauté Discord</sub>
</p>
