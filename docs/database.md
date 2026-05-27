# Documentation de la Base de Données

mysoul utilise **SQLite** via `better-sqlite3` pour le stockage persistant.

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                  SQLITE DATABASE                             │
│              (database.sqlite)                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐          │
│  │ guilds     │  │ users      │  │ tickets    │          │
│  │ configs    │  │ levels     │  │ modmail    │          │
│  └────────────┘  └────────────┘  └────────────┘          │
│                                                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐          │
│  │ warns      │  │ giveaways  │  │ tempvoc    │          │
│  │ custom_cmds│  │ automod    │  │ logs       │          │
│  └────────────┘  └────────────┘  └────────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

### Connection
```javascript
const db = require('./core/database');

// La connexion est gérée automatiquement
// Le fichier est créé à: ./database.sqlite
```

### Options
```javascript
// Options par défaut de better-sqlite3
{
  verbose: process.env.DEBUG_SQL ? console.log : null,
  // WAL mode pour meilleures performances
}
```

---

## Schéma des Tables

### Table `guilds`

Configuration par serveur.

| Colonne | Type | Description |
|---------|------|-------------|
| id | TEXT PRIMARY KEY | ID Discord du serveur |
| prefix | TEXT | Préfixe personnalisé |
| language | TEXT | Langue du serveur |
| log_channel | TEXT | ID salon de logs |
| mod_role | TEXT | ID rôle modérateur |
| mute_role | TEXT | ID rôle mute |
| ticket_category | TEXT | ID catégorie tickets |
| ticket_role | TEXT | ID rôle staff tickets |
| modmail_category | TEXT | ID catégorie modmail |
| modmail_role | TEXT | ID rôle modmail |
| tempvoc_hub | TEXT | ID salon hub tempvoc |
| tempvoc_category | TEXT | ID catégorie tempvoc |
| welcome_channel | TEXT | ID salon bienvenue |
| welcome_message | TEXT | Message de bienvenue |
| leave_channel | TEXT | ID salon départ |
| leave_message | TEXT | Message de départ |
| autoroles | TEXT | IDs rôles auto (JSON) |
| antiraid_enabled | BOOLEAN | Antiraid activé ? |
| levels_enabled | BOOLEAN | Système niveaux ? |
| created_at | INTEGER | Timestamp création |
| updated_at | INTEGER | Timestamp mise à jour |

---

### Table `users`

Données utilisateurs.

| Colonne | Type | Description |
|---------|------|-------------|
| id | TEXT PRIMARY KEY | ID Discord |
| guild_id | TEXT | ID serveur (composite key) |
| xp | INTEGER | Points d'expérience |
| level | INTEGER | Niveau actuel |
| warns | INTEGER | Nombre de warns |
| messages | INTEGER | Nombre de messages |
| voice_time | INTEGER | Temps en vocal (secondes) |
| last_message | INTEGER | Timestamp dernier message |
| cooldown_until | INTEGER | Fin du cooldown XP |
| created_at | INTEGER | Timestamp création |
| updated_at | INTEGER | Timestamp mise à jour |

**Index**: `(id, guild_id)` UNIQUE

---

### Table `warns`

Avertissements des membres.

| Colonne | Type | Description |
|---------|------|-------------|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | ID unique |
| guild_id | TEXT | ID serveur |
| user_id | TEXT | ID membre averti |
| moderator_id | TEXT | ID modérateur |
| reason | TEXT | Raison du warn |
| created_at | INTEGER | Timestamp |

**Index**: `user_id`, `guild_id`

---

### Table `tickets`

Tickets de support.

| Colonne | Type | Description |
|---------|------|-------------|
| id | INTEGER PRIMARY KEY | ID unique |
| guild_id | TEXT | ID serveur |
| channel_id | TEXT | ID salon ticket |
| creator_id | TEXT | ID créateur |
| created_at | INTEGER | Timestamp ouverture |
| closed_at | INTEGER | Timestamp fermeture |
| closed_by | TEXT | ID qui a fermé |
| transcript_url | TEXT | Lien transcript |
| reason | TEXT | Raison initiale |

---

### Table `giveaways`

Giveaways actifs et terminés.

| Colonne | Type | Description |
|---------|------|-------------|
| id | INTEGER PRIMARY KEY | ID unique |
| message_id | TEXT | ID message Discord |
| guild_id | TEXT | ID serveur |
| channel_id | TEXT | ID salon |
| creator_id | TEXT | ID créateur |
| prize | TEXT | Récompense |
| winner_count | INTEGER | Nombre gagnants |
| ends_at | INTEGER | Timestamp fin |
| ended | BOOLEAN | Terminé ? |
| winners | TEXT | IDs gagnants (JSON array) |
| requirements | TEXT | Conditions (JSON object) |
| participants | TEXT | IDs participants (JSON array) |

---

### Table `tempvoc_channels`

Vocaux temporaires actifs.

| Colonne | Type | Description |
|---------|------|-------------|
| id | INTEGER PRIMARY KEY | ID unique |
| channel_id | TEXT | ID salon Discord |
| guild_id | TEXT | ID serveur |
| owner_id | TEXT | ID propriétaire |
| created_at | INTEGER | Timestamp création |
| hub_id | TEXT | ID salon hub parent |

---

### Table `custom_commands`

Commandes personnalisées.

| Colonne | Type | Description |
|---------|------|-------------|
| id | INTEGER PRIMARY KEY | ID unique |
| guild_id | TEXT | ID serveur |
| name | TEXT | Nom de la commande |
| response | TEXT | Réponse/Action |
| type | TEXT | Type: 'text', 'embed', 'image' |
| cooldown | INTEGER | Cooldown en secondes |
| roles | TEXT | Rôles autorisés (JSON) |
| channels | TEXT | Salons autorisés (JSON) |
| created_at | INTEGER | Timestamp création |
| uses | INTEGER | Nombre d'utilisations |

**Index**: `(guild_id, name)` UNIQUE

---

### Table `automod_config`

Configuration auto-modération.

| Colonne | Type | Description |
|---------|------|-------------|
| guild_id | TEXT PRIMARY KEY | ID serveur |
| enabled | BOOLEAN | Activé ? |
| badwords_enabled | BOOLEAN | Filtre mots interdits ? |
| badwords_list | TEXT | Liste mots interdits (JSON) |
| antispam_enabled | BOOLEAN | Anti-spam ? |
| antispam_limit | INTEGER | Messages/min avant action |
| antilink_enabled | BOOLEAN | Anti-liens ? |
| antilink_whitelist | TEXT | Domaines whitelistés (JSON) |
| max_mentions | INTEGER | Limite mentions/message |
| max_emojis | INTEGER | Limite emojis/message |
| action | TEXT | Action: 'warn', 'mute', 'kick', 'ban' |

---

### Table `logs`

Logs d'actions (optionnel).

| Colonne | Type | Description |
|---------|------|-------------|
| id | INTEGER PRIMARY KEY | ID unique |
| guild_id | TEXT | ID serveur |
| user_id | TEXT | ID utilisateur concerné |
| moderator_id | TEXT | ID modérateur |
| action | TEXT | Type d'action |
| reason | TEXT | Raison |
| created_at | INTEGER | Timestamp |

---

## Requêtes Courantes

### Guildes

```sql
-- Obtenir la configuration d'un serveur
SELECT * FROM guilds WHERE id = ?;

-- Mettre à jour un paramètre
UPDATE guilds SET prefix = ?, updated_at = ? WHERE id = ?;

-- Insérer ou mettre à jour (UPSERT)
INSERT INTO guilds (id, prefix, created_at, updated_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  prefix = excluded.prefix,
  updated_at = excluded.updated_at;
```

### Utilisateurs

```sql
-- Obtenir les stats d'un membre
SELECT * FROM users WHERE id = ? AND guild_id = ?;

-- Ajouter XP
UPDATE users 
SET xp = xp + ?, messages = messages + 1, updated_at = ?
WHERE id = ? AND guild_id = ?;

-- Leaderboard
SELECT * FROM users 
WHERE guild_id = ? 
ORDER BY xp DESC 
LIMIT 10;
```

### Warns

```sql
-- Liste des warns d'un membre
SELECT * FROM warns WHERE guild_id = ? AND user_id = ?;

-- Compter les warns
SELECT COUNT(*) as count FROM warns 
WHERE guild_id = ? AND user_id = ?;

-- Supprimer un warn spécifique
DELETE FROM warns WHERE id = ?;
```

### Giveaways

```sql
-- Giveaways actifs d'un serveur
SELECT * FROM giveaways 
WHERE guild_id = ? AND ended = false;

-- Terminer un giveaway
UPDATE giveaways 
SET ended = true, winners = ? 
WHERE id = ?;
```

---

## API JavaScript

### Wrapper Database

```javascript
// core/database.js

const db = {
  // Exécuter une requête (INSERT, UPDATE, DELETE)
  run(sql, params) {
    return this.connection.prepare(sql).run(params);
  },
  
  // Obtenir une ligne
  get(sql, params) {
    return this.connection.prepare(sql).get(params);
  },
  
  // Obtenir plusieurs lignes
  all(sql, params) {
    return this.connection.prepare(sql).all(params);
  },
  
  // Transaction
  transaction(fn) {
    return this.connection.transaction(fn);
  }
};
```

### Utilisation dans les Commandes

```javascript
const db = require('../core/database');

// SELECT simple
const user = db.get(
  'SELECT * FROM users WHERE id = ? AND guild_id = ?',
  [userId, guildId]
);

// UPDATE
const result = db.run(
  'UPDATE users SET xp = xp + ? WHERE id = ? AND guild_id = ?',
  [xpGain, userId, guildId]
);

// Transaction (plusieurs opérations atomiques)
db.transaction(() => {
  db.run('INSERT INTO warns ...', [...]);
  db.run('UPDATE users SET warns = warns + 1 ...', [...]);
})();
```

---

## Sauvegarde et Restauration

### Backup Manuel
```bash
# Copier le fichier
cp database.sqlite database.backup.$(date +%Y%m%d).sqlite

# Ou avec SQLite
sqlite3 database.sqlite ".backup database.backup.sqlite"
```

### Export/Import
```bash
# Export vers SQL
cat database.sqlite | sqlite3 "" ".dump" > backup.sql

# Import
sqlite3 new_database.sqlite < backup.sql
```

---

## Performance

### Optimisations SQLite
- **WAL Mode** : Write-Ahead Logging pour meilleures performances en écriture
- **Indexes** : Sur les colonnes fréquemment recherchées
- **Prepared Statements** : Requêtes pré-compilées

### Cache
- Les configurations sont mises en cache en mémoire
- Rafraîchissement sur modification

---

## Migration

Pour ajouter une nouvelle table ou colonne :

```javascript
// core/database.js - section d'initialisation

function initTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS nouvelle_table (
      id INTEGER PRIMARY KEY,
      colonne1 TEXT,
      colonne2 INTEGER,
      created_at INTEGER
    )
  `);
  
  // Migration: ajouter colonne si elle n'existe pas
  try {
    db.run('ALTER TABLE existing_table ADD COLUMN nouvelle_colonne TEXT');
  } catch (e) {
    // Colonne existe déjà
  }
}
```

---

[← Retour à la documentation](../README.md)
