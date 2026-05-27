# Guide de Démarrage Rapide

Ce guide vous accompagne dans la mise en place rapide du bot mysoul sur votre serveur Discord.

## Sommaire
1. [Création du Bot Discord](#1-création-du-bot-discord)
2. [Installation Locale](#2-installation-locale)
3. [Configuration Initiale](#3-configuration-initiale)
4. [Premier Démarrage](#4-premier-démarrage)
5. [Commandes Essentielles](#5-commandes-essentielles)

---

## 1. Création du Bot Discord

### Étape 1 : Créer une Application
1. Rendez-vous sur [Discord Developer Portal](https://discord.com/developers/applications)
2. Cliquez sur **"New Application"**
3. Nommez votre application (ex: `mysoul Bot`)
4. Acceptez les termes et créez

### Étape 2 : Récupérer les Identifiants
1. Dans le menu de gauche, cliquez sur **"General Information"**
2. Copiez l'**Application ID** (c'est le `CLIENT_ID`)
3. Allez dans **"Bot"** → cliquez **"Reset Token"** pour obtenir le `TOKEN`
4. **Conservez ce token secret !**

### Étape 3 : Activer les Intents
Toujours dans l'onglet **"Bot"**, activez ces **Privileged Gateway Intents** :
-  **PRESENCE INTENT**
-  **SERVER MEMBERS INTENT**
-  **MESSAGE CONTENT INTENT**

Ces intents sont essentiels pour que le bot fonctionne correctement.

### Étape 4 : Inviter le Bot
1. Allez dans **"OAuth2"** → **"URL Generator"**
2. Cochez **bot** dans les scopes
3. Dans les permissions, sélectionnez **Administrator** (recommandé pour un bot complet)
4. Copiez l'URL générée et ouvrez-la dans votre navigateur
5. Sélectionnez votre serveur et autorisez

---

## 2. Installation Locale

### Prérequis
- Node.js 18+ : [Télécharger](https://nodejs.org/)
- Git : [Télécharger](https://git-scm.com/)

### Cloner et Installer

```bash
# Cloner le repository
git clone https://github.com/sonlikehisfather/protect.git
cd mysoul

# Installer les dépendances
npm install

# Créer le fichier .env
cp .env.example .env  # Sur Windows: copy .env.example .env
```

---

## 3. Configuration Initiale

### Fichier `.env`

Éditez le fichier `.env` créé :

```env
# === OBLIGATOIRE ===
TOKEN=MTAxMjM0NTY3ODkwMTIzNDU2Nw.G1t2f3.aBcDeFgHiJkLmNoPqRsTuVwXyZ
CLIENT_ID=1012345678901234567
BUYER_ID=987654321098765432

# === OPTIONNEL ===
DEV_GUILD_ID=1234567890123456789
NODE_ENV=development
DEBUG_LOADER=false
```

| Variable | Où la trouver |
|----------|---------------|
| `TOKEN` | Discord Developer Portal → Bot → Reset Token |
| `CLIENT_ID` | Discord Developer Portal → General Information → Application ID |
| `BUYER_ID` | Discord (activation du mode développeur) → Clic droit sur votre profil → Copy User ID |
| `DEV_GUILD_ID` | Clic droit sur votre serveur de test → Copy Server ID |

### Fichier `config.json`

```json
{
  "prefix": "+",
  "color": "#2B2D31"
}
```

Personnalisez selon vos préférences :
- `prefix` : caractère déclenchant les commandes textuelles
- `color` : couleur des embeds Discord (format hexadécimal)

---

## 4. Premier Démarrage

### Mode Développement (recommandé pour les tests)
```bash
npm run dev
```

Vous verrez des logs comme :
```
[Loader] 156 commande(s) préfixée(s) chargée(s)
[INFO] Bot connecté en tant que mysoul#1234
```

> **Note :** Ce bot utilise uniquement des commandes avec préfixe (`+commande`). Il n'y a pas de slash commands.

### Vérification
1. Allez sur votre serveur Discord
2. Tapez `+help` ou `+ping`
3. Le bot doit répondre !

---

## 5. Commandes Essentielles

### Configuration Rapide

```bash
# Voir la configuration actuelle
+configserver

# Définir le rôle modérateur
+configserver modrole @Modérateur

# Configurer le salon de logs
+configserver logchannel #logs

# Activer les messages de bienvenue
+joinsettings enable
+joinsettings channel #bienvenue
+joinsettings message Bienvenue {user.mention} sur {server.name} !
```

### Commandes de Base

| Commande | Description | Exemple |
|----------|-------------|---------|
| `+help` | Liste des commandes | `+help` ou `+help ban` |
| `+ping` | Latence du bot | `+ping` |
| `+botinfo` | Informations sur le bot | `+botinfo` |
| `+userinfo [@user]` | Infos sur un membre | `+userinfo @mysoul` |
| `+serverinfo` | Infos sur le serveur | `+serverinfo` |

### Commandes de Modération

| Commande | Description | Syntaxe |
|----------|-------------|---------|
| `+ban` | Bannir un membre | `+ban @user raison` |
| `+kick` | Expulser un membre | `+kick @user raison` |
| `+mute` | Réduire au silence | `+mute @user 1h raison` |
| `+warn` | Avertir un membre | `+warn @user raison` |
| `+clear` | Supprimer des messages | `+clear 50` |
| `+lock` | Verrouiller un salon | `+lock` ou `+lock #salon` |
| `+unlock` | Déverrouiller | `+unlock` |

---

## Prochaines Étapes

- 📖 Consulter la [documentation des commandes](./commands/README.md)
- 🔧 Configurer le [système de tickets](./modules/tickets.md)
- 📬 Activer le [modmail](./modules/modmail.md)
- 🎉 Créer des [giveaways](./modules/giveaways.md)

---

## Dépannage Rapide

| Problème | Solution |
|----------|----------|
| `Variables manquantes dans .env` | Vérifier que toutes les variables requises sont présentes |
| `Connexion impossible` | Vérifier que le TOKEN est correct et non révoqué |
| `Commandes slash non visibles` | Attendre jusqu'à 1h en production, immédiat en dev |
| `Permission denied` | Vérifier les permissions du bot dans les salons |

Pour plus d'aide, consultez la [FAQ](./faq.md).
