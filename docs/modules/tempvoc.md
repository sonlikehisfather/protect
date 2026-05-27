# Module Vocaux Temporaires (TempVoc)

Création automatique de salons vocaux personnalisables par les membres.

## Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────┐
│                    MODULE TEMPVOC                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌──────────────┐                                          │
│   │ Salon Hub    │  "➕ Créer un vocal"                    │
│   │ (Configuration)│                                        │
│   └──────┬───────┘                                          │
│          │ Rejoint                                           │
│          ▼                                                   │
│   ┌──────────────┐      ┌──────────────┐                   │
│   │ Vocal Perso  │◄────▶│  Membre est  │                   │
│   │ Créé Auto    │      │  Owner du salon│                   │
│   └──────┬───────┘      └──────────────┘                   │
│          │                                                   │
│          │ Quitte                                           │
│          ▼                                                   │
│   ┌──────────────┐                                          │
│   │ Suppression  │  (si vide)                                │
│   │ Automatique  │                                          │
│   └──────────────┘                                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Fonctionnalités

-  Création automatique de salons vocaux
-  Gestion par le créateur (owner)
-  Renommage du salon
-  Limite d'utilisateurs ajustable
-  Verrouillage/déverrouillage
-  Expulsion d'utilisateurs
-  Restriction d'accès
-  Suppression automatique si vide

---

## Configuration

### Étape 1 : Créer le Salon Hub
Créez un salon vocal nommé par exemple :
```
➕ Créer un vocal
```

### Étape 2 : Configurer
```
+tempvoc enable
+tempvoc channel ➕ Créer un vocal
+tempvoc category 🔊 Vocaux Privés
```

### Configuration Complète
```
+tempvoc enable
+tempvoc channel ➕ Créer un vocal
+tempvoc category Vocaux Temporaires
+tempvoc defaultlimit 5
+tempvoc defaultname Vocal de {user.username}
```

---

## Utilisation par les Membres

### Création
1. Rejoindre le salon "➕ Créer un vocal"
2. Un nouveau salon est créé automatiquement
3. Le membre est déplacé dans son salon
4. Le membre devient "owner" du salon

### Commandes du Propriétaire

| Commande | Description | Usage |
|----------|-------------|-------|
| `+vc rename` | Renommer le salon | `+vc rename Nouveau Nom` |
| `+vc limit` | Définir la limite | `+vc limit 5` |
| `+vc lock` | Verrouiller | `+vc lock` |
| `+vc unlock` | Déverrouiller | `+vc unlock` |
| `+vc kick` | Expulser | `+vc kick @User` |
| `+vc ban` | Interdire | `+vc ban @User` |
| `+vc unban` | Réautoriser | `+vc unban @User` |
| `+vc claim` | Récupérer ownership | `+vc claim` |
| `+vc transfer` | Transférer ownership | `+vc transfer @User` |
| `+vc hide` | Cacher le salon | `+vc hide` |
| `+vc unhide` | Rendre visible | `+vc unhide` |

---

## Permissions Dynamiques

### Propriétaire du Salon
- Voir le salon ✓
- Se connecter ✓
- Parler ✓
- Stream/Vidéo ✓
- Gérer le salon ✓
- Déplacer membres ✓
- Mute/Unmute membres ✓

### Utilisateurs Standards
- Voir le salon (si caché: non)
- Se connecter (si locké: non)
- Parler ✓

---

## API du Module

```javascript
const tempvoc = require('../modules/tempvoc');

// Créer un vocal temporaire
const channel = await tempvoc.create({
  guild: guild,
  member: member,
  hubChannel: hubChannel,
  category: category
});

// Renommer
await tempvoc.rename(channelId, newName, userId);

// Définir limite
await tempvoc.setLimit(channelId, limit, userId);

// Verrouiller
await tempvoc.lock(channelId, userId);

// Expulser
await tempvoc.kick(channelId, targetId, userId);

// Transférer ownership
await tempvoc.transfer(channelId, newOwnerId, currentOwnerId);

// Vérifier ownership
const isOwner = await tempvoc.isOwner(channelId, userId);
```

---

## Schéma de Base de Données

### Table `tempvoc_channels`

| Colonne | Type | Description |
|---------|------|-------------|
| id | INTEGER PRIMARY KEY | ID unique |
| channel_id | TEXT | ID du salon Discord |
| guild_id | TEXT | ID du serveur |
| owner_id | TEXT | ID du propriétaire |
| created_at | INTEGER | Timestamp création |
| hub_id | TEXT | ID du salon hub parent |

### Table `tempvoc_config`

| Colonne | Type | Description |
|---------|------|-------------|
| guild_id | TEXT PRIMARY KEY | ID serveur |
| enabled | BOOLEAN | Activé ? |
| hub_channel_id | TEXT | ID salon hub |
| category_id | TEXT | ID catégorie |
| default_name | TEXT | Nom par défaut |
| default_limit | INTEGER | Limite par défaut |

---

## Gestion des Salons

### Création Automatique
```javascript
// Événement: voiceStateUpdate
if (newState.channelId === hubChannelId) {
  // Créer nouveau salon
  const newChannel = await guild.channels.create({
    name: `${member.displayName}'s Channel`,
    type: ChannelType.GuildVoice,
    parent: categoryId,
    permissionOverwrites: [
      { id: member.id, allow: [PermissionFlagsBits.ManageChannels] }
    ]
  });
  
  // Déplacer le membre
  await member.voice.setChannel(newChannel);
}
```

### Suppression Automatique
```javascript
// Événement: voiceStateUpdate
if (oldState.channel && oldState.channel.members.size === 0) {
  const isTempVoc = await db.get(
    'SELECT * FROM tempvoc_channels WHERE channel_id = ?',
    [oldState.channel.id]
  );
  
  if (isTempVoc) {
    await oldState.channel.delete();
    await db.run(
      'DELETE FROM tempvoc_channels WHERE channel_id = ?',
      [oldState.channel.id]
    );
  }
}
```

---

## Workflow Utilisateur

### Création et Gestion
```
1. User rejoint "➕ Créer un vocal"
2. Salon "Vocal de User" créé automatiquement
3. User déplacé dans son salon
4. User a les permissions de gestion
5. User peut:
   - Renommer: +vc rename Discussion Gaming
   - Limiter: +vc limit 5
   - Verrouiller: +vc lock
   - Inviter: +vc unlock puis @Friend rejoint
   - Expulser un intrus: +vc kick @Intruder
```

### Transfert d'Ownership
```
1. Owner: +vc transfer @NewOwner
2. NewOwner devient owner
3. Ancien owner perd les permissions de gestion
```

### Récupération (Claim)
```
1. Owner quitte le vocal
2. Plus personne n'est owner
3. Nouveau user: +vc claim
4. Devient le nouvel owner
```

---

## Bonnes Pratiques

### Configuration Recommandée
- Hub : en haut de la catégorie
- Catégorie séparée pour les vocaux créés
- Limite par défaut : illimité (0)
- Nom par défaut : "Vocal de {user.username}"

### Permissions Serveur
Le bot doit avoir :
- `ManageChannels` (créer/supprimer)
- `MoveMembers` (déplacer les users)
- `ManageRoles` (permissions dynamiques)

---

[← Retour aux modules](./README.md)
