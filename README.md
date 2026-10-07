# Protect

Bot Discord multifonction écrit en Node.js avec Discord.js v14 et SQLite. Il regroupe des outils de modération, de protection anti-raid, de gestion de serveur, de tickets, de modmail, de jeux et d’administration FiveM.

![Discord.js 14.26.4](https://img.shields.io/badge/discord.js-14.26.4-5865F2?logo=discord&logoColor=white)
![Node.js 24](https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js&logoColor=white)
![SQLite](https://img.shields.io/badge/database-SQLite-003B57?logo=sqlite&logoColor=white)
![License MIT](https://img.shields.io/badge/license-MIT-green.svg)

## Fonctionnalités

- Modération : sanctions, avertissements, rôles, salons, permissions, logs et étapes de punition configurables.
- Protection : anti-raid, anti-ban, anti-role, anti-webhook, anti-token, anti-unban, anti-spam, anti-liens et filtres de mots.
- Configuration par serveur : préfixe, logs, bienvenue/départ, auto-rôles, vérification, réponses personnalisées, auto-modération et paramètres de commandes.
- Tickets et assistance : tickets configurables, transcripts, modmail, gestion des inactifs et sauvegardes de serveur.
- Communauté : giveaways, niveaux/XP, compteurs, suivi des invitations, anniversaires et statistiques vocales.
- Jeux et économie : casino, jeux, monnaie et profils associés.
- FiveM : commandes et outils d’administration dédiés.
- Administration du bot : commandes owner, blacklist globale, activité, permissions et gestion multi-serveurs.

Le bot utilise des commandes préfixées. À la date de cette mise à jour, le loader détecte 275 commandes dans 15 catégories et 43 modules d’événements. Les alias sont chargés avec leur commande. Il n’y a pas de dossier `slashCommands` dans cette version.

## Catégories de commandes

| Catégorie | Nombre | Exemples |
| --- | ---: | --- |
| Anti-raid | 20 | `antiban`, `antibot`, `antirole` |
| Sauvegardes | 1 | `backup` |
| Casino | 35 | `casino`, `blackjack`, `roulette` |
| Configuration modération | 13 | `antilink`, `antispam`, `badword` |
| Configuration serveur | 26 | `autorole`, `welcome`, `verify` |
| FiveM | 11 | `fconfig`, `fown`, `presence` |
| Jeux | 8 | `8ball`, `quiz`, `roll` |
| Générales | 44 | `help`, `serverinfo`, `ping` |
| Giveaways | 4 | `gstart`, `greroll` |
| Niveaux | 4 | `level`, `rank`, `leaderboard` |
| Logs | 2 | `logs`, `logs doc` |
| Modération | 42 | `ban`, `mute`, `warn` |
| Owner | 33 | `owner`, `bl`, `backup` |
| Serveur | 23 | `button`, `v2`, `autoreact` |
| Tickets | 9 | `ticket`, `claim`, `rename` |

Utilise `+help` pour afficher l’aide chargée par le bot. Le préfixe par défaut est `+`; il peut être changé globalement dans `config.json` ou configuré séparément pour chaque serveur. Les réglages par serveur sont conservés dans SQLite.

## Prérequis

- Node.js 24.x recommandé. `better-sqlite3` est un module natif; la version installée déclare Node 20.x et 22.x à 25.x comme versions compatibles. Node 26 n’est pas déclaré compatible par cette version.
- npm fourni avec Node.js.
- Une application et un bot créés dans le [Discord Developer Portal](https://discord.com/developers/applications).
- Git pour cloner le dépôt.

Dans le Developer Portal, active les intents privilégiés **Message Content**, **Server Members** et **Presence**. Le bot demande également des intents pour les serveurs, messages, modération, réactions, événements programmés, webhooks, voix et messages privés. Accorde-lui uniquement les permissions Discord nécessaires aux fonctions que tu comptes utiliser; la modération et la gestion des tickets demandent notamment des permissions sur les membres, rôles et salons.

## Installation

```sh
git clone https://github.com/sonlikehisfather/protect.git
cd protect
npm ci
```

Crée un fichier `.env` à la racine du dépôt :

```env
TOKEN=token_du_bot
CLIENT_ID=id_de_l_application
BUYER_ID=id_discord_du_buyer
NODE_ENV=development
DEV_GUILD_ID=id_du_serveur_de_test
OPENROUTER_API_KEY=cle_api_openrouter
```

`TOKEN`, `CLIENT_ID` et `BUYER_ID` sont obligatoires au démarrage. `DEV_GUILD_ID` est facultatif. `OPENROUTER_API_KEY` est nécessaire uniquement pour utiliser `+ask`; crée ta clé dans les [paramètres OpenRouter](https://openrouter.ai/settings/keys). Ne partage pas le fichier `.env` et ne committe jamais ses valeurs.

### Commande `+ask`

`+ask <question>` appelle le routeur de modèles gratuits `openrouter/free`. La commande est réservée aux buyers par défaut. Un buyer ou le propriétaire du serveur peut accorder l'accès à un membre ou un rôle avec `+setperm ask @membre` ou `+setperm ask @role`. Les réponses ont un délai minimal de 10 secondes par personne.

Seul le texte fourni après `+ask` est transmis à OpenRouter; la commande n'envoie pas l'historique du salon. Le routage demande des fournisseurs qui refusent la collecte des données (`data_collection: deny`), ce qui peut réduire les modèles disponibles. La formule gratuite OpenRouter est soumise à ses limites, notamment 50 requêtes par jour sans crédits. Voir les [limites OpenRouter](https://openrouter.ai/docs/api_reference/limits) et le [routage selon les règles de données](https://openrouter.ai/docs/guides/routing/provider-selection).

### Variables facultatives de diagnostic

Toutes sont désactivées par défaut. Définis uniquement celles qui sont utiles :

| Variable | Valeur d’activation |
| --- | --- |
| `DEBUG_LOADER` | `true` |
| `DEBUG_ACTIVITY` | `true` ou `1` |
| `DEBUG_ANTILINK` | `true` |
| `DEBUG_ERRORS` | `true` |
| `DEBUG_FCONFIG` | `true` |
| `DEBUG_MUTEBACKUP` | `1` |
| `DEBUG_REMINDERS` | `1` |
| `DEBUG_ROLEMENU` | `true` |
| `DEBUG_SANCTIONS` | `1` |
| `DEBUG_SOUTIEN` | `true` |
| `DEBUG_TEMPROLES` | `1` |

## Configuration

`config.json` contient les valeurs globales de repli :

```json
{
  "prefix": "+",
  "color": "#2B2D31"
}
```

Les options serveur, notamment les salons de logs, les messages, les sanctions, les tickets et la vérification, sont gérées par les commandes de configuration et stockées dans `database.sqlite`. La configuration d’un serveur ne remplace pas celle d’un autre.

## Démarrage

Pour utiliser le Node.js installé sur la machine :

```sh
npm run start:system
```

En développement avec redémarrage automatique :

```sh
npm run dev:system
```

Les commandes `npm start` et `npm run dev` utilisent le runtime portable sous `.local-node/`. Ce dossier est local et ignoré par Git; après un clone, utilise les scripts `:system` sauf si tu as installé ce runtime portable. Le bot refuse de démarrer si les variables obligatoires manquent ou si une autre instance est déjà active.

## Données et sauvegardes

- `database.sqlite` contient les données persistantes. SQLite crée également les fichiers temporaires `database.sqlite-wal` et `database.sqlite-shm`.
- Les migrations de base de données sont exécutées par le bot au démarrage.
- Les sauvegardes de serveurs créées par la commande `backup` sont placées dans `data/backups/`.
- Les fichiers de configuration locale, les bases SQLite et les sauvegardes sont exclus de Git. Prévois une sauvegarde externe de ces données si elles sont importantes.

## Structure du dépôt

```text
commands/   Commandes préfixées, classées par catégorie
core/       Client Discord, loader et base SQLite
events/     Gestionnaires d’événements Discord
modules/    Automodération, tickets, niveaux, modmail et autres systèmes
utils/      Permissions, logs, embeds, résolution de membres et aides internes
data/       Données générées, notamment les sauvegardes
index.js    Entrée du programme
config.json Configuration globale de repli
```

## Dépannage

- **Variables manquantes** : vérifie que `.env` est à la racine et contient `TOKEN`, `CLIENT_ID` et `BUYER_ID`.
- **Erreur de binding SQLite ou module natif** : vérifie que le processus utilise Node 24.x et réinstalle les dépendances avec `npm ci`. Évite de compiler `better-sqlite3` avec un runtime non pris en charge.
- **Intents manquants** : active les intents privilégiés dans le Developer Portal et vérifie les intents demandés par l’application.
- **Commande ignorée ou conflit** : consulte les avertissements `[Loader]` au démarrage; les commandes avec un nom déjà pris ne sont pas chargées.
- **Sauvegarde absente** : vérifie le contenu de `data/backups/` et les droits d’écriture du processus.

## Licence

Ce projet est distribué sous licence [MIT](./LICENSE).