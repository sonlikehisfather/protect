# Module AutoMod

Système de modération automatique pour protéger votre serveur.

## Vue d'ensemble

Le module AutoMod surveille les messages et applique automatiquement des sanctions selon les règles configurées.

## Fonctionnalités

-  **Filtre de mots interdits** - Détection et action sur les insultes
-  **Anti-spam** - Détection de flood
-  **Anti-liens** - Blocage des liens non autorisés
-  **Limite de mentions** - Protection contre les mentions massives
-  **Limite d'emojis** - Évite le spam d'emojis
-  **Anti-capitales** - Messages en majuscules excessives

---

## Configuration

### Activation Globale

```
+automod enable
```

### Filtre de Mots

```
+automod badwords on
+automod badwords add mot1,mot2,mot3
+automod badwords remove mot1
+automod badwords list
```

### Anti-Spam

```
+automod antispam on
+automod antispam limit 5      # messages
+automod antispam window 10    # secondes
```

### Anti-Liens

```
+automod antilink on
+automod antilink whitelist discord.gg,votresite.com
```

### Limites

```
+automod maxmentions 5
+automod maxemojis 10
+automod maxcaps 70           # pourcentage de majuscules
```

### Action par Défaut

```
+automod action warn          # warn, mute, kick, ban, delete
+automod action mute
+automod mutetime 10m         # durée du mute auto
```

---

## Détection

### Types de Violations

| Type | Description | Détection |
|------|-------------|-----------|
| `BADWORDS` | Mots interdits | Regex avec variations |
| `SPAM` | Messages répétés | N messages en X secondes |
| `LINKS` | Liens non autorisés | Regex URL + whitelist |
| `MENTIONS` | Trop de mentions | > N mentions/message |
| `EMOJIS` | Trop d'emojis | > N emojis/message |
| `CAPS` | Majuscules excessives | > N% du message |

### Exceptions

Ces rôles/salons sont ignorés :
- Membres avec permission `ManageMessages`
- Rôles dans la whitelist AutoMod
- Salons dans la whitelist AutoMod

---

## API du Module

```javascript
const automod = require('../modules/automod');

// Vérifier un message
const result = await automod.checkMessage({
  content: message.content,
  author: message.author,
  guild: message.guild,
  channel: message.channel
});

// Résultat
if (result.violated) {
  // result.type: 'BADWORDS' | 'SPAM' | etc.
  // result.action: 'warn' | 'mute' | etc.
  // result.reason: Raison détaillée
}

// Ajouter un mot interdit
await automod.addBadWord(guildId, 'motinterdit');

// Whitelist un salon
await automod.whitelistChannel(guildId, channelId);
```

---

## Schéma de Base de Données

### Table `automod_config`

| Colonne | Type | Description |
|---------|------|-------------|
| guild_id | TEXT PK | ID serveur |
| enabled | BOOLEAN | Activé ? |
| badwords_enabled | BOOLEAN | Filtre mots ? |
| badwords_list | TEXT | Mots interdits (JSON) |
| badwords_action | TEXT | Action mots |
| antispam_enabled | BOOLEAN | Anti-spam ? |
| antispam_limit | INTEGER | Messages avant spam |
| antispam_window | INTEGER | Fenêtre temps (sec) |
| antilink_enabled | BOOLEAN | Anti-liens ? |
| antilink_whitelist | TEXT | Domaines autorisés |
| max_mentions | INTEGER | Limite mentions |
| max_emojis | INTEGER | Limite emojis |
| max_caps_percent | INTEGER | % max majuscules |
| default_action | TEXT | Action par défaut |
| mute_duration | INTEGER | Durée mute (sec) |
| ignored_roles | TEXT | Rôles ignorés |
| ignored_channels | TEXT | Salons ignorés |

### Table `automod_violations`

| Colonne | Type | Description |
|---------|------|-------------|
| id | INTEGER PK | ID unique |
| guild_id | TEXT | ID serveur |
| user_id | TEXT | ID utilisateur |
| channel_id | TEXT | ID salon |
| message_id | TEXT | ID message |
| violation_type | TEXT | Type de violation |
| content | TEXT | Contenu du message |
| action_taken | TEXT | Action effectuée |
| created_at | INTEGER | Timestamp |

---

## Workflow de Détection

```
Message envoyé
     │
     ▼
┌─────────────────┐
│ Vérifications   │
│ - Bot ? Ignorer │
│ - Admin ? Pass  │
│ - Whitelist ?   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Scan contenu    │
│ - Mots interdits│
│ - Spam detect   │
│ - Liens         │
│ - Mentions      │
│ - Emojis        │
│ - Caps          │
└────────┬────────┘
         │
         ▼
    Violation ?
   ┌────┴────┐
   │         │
   Non      Oui
   │         │
   ▼         ▼
  Pass    Agir
          │
          ├─ Supprimer message
          ├─ Warn/Mute/Kick/Ban
          └─ Log l'action
```

---

## Messages de Notification

### Message AutoMod (DM)

```
⚠️ Votre message sur {server.name} a été supprimé.

Raison: {reason}
Contenu: {content_preview}

Récidive = sanctions plus lourdes
```

### Log Staff

```
🛡️ AutoMod | {violation_type}

Utilisateur: @User (ID)
Salon: #salon
Action: {action}
Raison: {reason}
Message: {content}
```

---

[← Retour aux modules](./README.md)
