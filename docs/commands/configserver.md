# Commandes de Configuration Serveur

Configuration complète du serveur et de ses fonctionnalités.

## Table des matières
- [autorole](#autorole) - Rôles automatiques
- [joinsettings](#joinsettings) - Messages de bienvenue
- [leavesettings](#leavesettings) - Messages de départ
- [modmail](#modmail) - Configuration modmail
- [tempvoc](#tempvoc) - Vocaux temporaires
- [rolemenu](#rolemenu) - Menus de rôles
- [variables](#variables) - Variables disponibles

---

## autorole

Configure les rôles attribués automatiquement aux nouveaux membres.

**Usage:** `+autorole <add|remove|list|clear> [@role]`

**Permissions:** `Administrator`

### Sous-commandes

| Commande | Description |
|----------|-------------|
| `add @role` | Ajoute un rôle automatique |
| `remove @role` | Retire un rôle automatique |
| `list` | Liste les rôles automatiques |
| `clear` | Supprime tous les rôles auto |

### Exemples
```
+autorole add @Membre
+autorole add @Nouveau
+autorole list
+autorole remove @Nouveau
```

---

## joinsettings

Configure les messages de bienvenue.

**Usage:** `+joinsettings <option> [valeur]`

**Permissions:** `Administrator`

### Options

| Option | Description | Exemple |
|--------|-------------|---------|
| `enable/disable` | Active/désactive | `+joinsettings enable` |
| `channel` | Salon des messages | `+joinsettings channel #bienvenue` |
| `message` | Message personnalisé | `+joinsettings message Bienvenue {user.mention}!` |
| `dm` | Message en privé | `+joinsettings dm Merci de rejoindre {server.name}!` |
| `dmenable/dmdisable` | Active/désactive DM | `+joinsettings dmenable` |

### Variables Disponibles
- `{user.mention}` - Mention du membre
- `{user.username}` - Nom d'utilisateur
- `{user.id}` - ID utilisateur
- `{server.name}` - Nom du serveur
- `{server.membercount}` - Nombre de membres
- `{date}`, `{time}` - Date et heure

### Exemples
```
+joinsettings enable
+joinsettings channel #bienvenue
+joinsettings message Bienvenue {user.mention} sur {server.name}! Nous sommes maintenant {server.membercount} membres.
+joinsettings dmenable
+joinsettings dm Bienvenue sur {server.name}! Lis les règles pour commencer.
```

---

## leavesettings

Configure les messages de départ.

**Usage:** `+leavesettings <option> [valeur]`

**Permissions:** `Administrator`

### Options

| Option | Description |
|--------|-------------|
| `enable/disable` | Active/désactive |
| `channel` | Salon des messages |
| `message` | Message personnalisé |

### Variables Identiques
Mêmes variables que `joinsettings`.

### Exemples
```
+leavesettings enable
+leavesettings channel #departs
+leavesettings message {user.username} a quitté {server.name}. Nous sommes maintenant {server.membercount} membres.
```

---

## modmail

Configure le système de modmail.

**Usage:** `+modmail <option> [valeur]`

**Permissions:** `Administrator`

### Options

| Option | Description |
|--------|-------------|
| `enable/disable` | Active/désactive |
| `category` | Catégorie des tickets |
| `role` | Rôle qui voit les tickets |
| `message` | Message de confirmation |

### Fonctionnement
Quand un membre envoie un MP au bot :
1. Un salon est créé dans la catégorie configurée
2. Le rôle staff est mentionné
3. Toute réponse dans ce salon est transmise au membre

### Exemples
```
+modmail enable
+modmail category 📩 ModMail
+modmail role @Staff
+modmail message Votre message a été transmis au staff de {server.name}.
```

---

## tempvoc

Configure les vocaux temporaires.

**Usage:** `+tempvoc <option> [valeur]`

**Permissions:** `Administrator`

### Options

| Option | Description |
|--------|-------------|
| `enable/disable` | Active/désactive |
| `channel` | Salon "Créer un vocal" |
| `category` | Catégorie des vocaux |

### Fonctionnement
1. Créer un salon vocal "➕ Créer un vocal"
2. Configurer avec `+tempvoc channel`
3. Quand un membre rejoint, un vocal privé est créé
4. Le créateur peut gérer son salon (nom, limite, etc.)

### Exemples
```
+tempvoc enable
+tempvoc channel ➕ Créer un vocal
+tempvoc category 🔊 Vocaux Temporaires
```

---

## rolemenu

Crée un menu de rôles par réactions.

**Usage:** `+rolemenu <create|add|remove|delete|list>`

**Permissions:** `ManageRoles`
**Bot Permissions:** `ManageRoles`, `AddReactions`

### Sous-commandes

| Commande | Description |
|----------|-------------|
| `create` | Crée un nouveau menu |
| `add <id> :emoji: @role` | Ajoute un rôle au menu |
| `remove <id> :emoji:` | Retire une option |
| `delete <id>` | Supprime le menu |
| `list` | Liste les menus actifs |

### Exemples
```
# Créer un menu
+rolemenu create

# Ajouter des options (utiliser l'ID retourné)
+rolemenu add abc123 :game_die: @Gamer
+rolemenu add abc123 :art: @Artiste
+rolemenu add abc123 :musical_note: @Musicien

# Voir les menus
+rolemenu list

# Supprimer
+rolemenu delete abc123
```

---

## variables

Affiche la liste des variables disponibles pour les messages.

**Usage:** `+variables`

### Variables Utilisateur
- `{user.mention}` - Mention
- `{user.username}` - Nom
- `{user.id}` - ID
- `{user.tag}` - Tag complet (User#1234)
- `{user.createdate}` - Date création compte
- `{user.joindate}` - Date arrivée sur le serveur

### Variables Serveur
- `{server.name}` - Nom
- `{server.id}` - ID
- `{server.membercount}` - Nombre de membres
- `{server.boostcount}` - Nombre de boosts
- `{server.boostlevel}` - Niveau de boost

### Variables Temps
- `{date}` - Date formatée
- `{time}` - Heure formatée
- `{timestamp}` - Timestamp Unix

---

## checkconfig

Affiche un résumé de la configuration actuelle.

**Usage:** `+checkconfig`

**Alias:** `configserver`

**Permissions:** `Administrator`

Affiche :
- Salon de logs
- Préfixe
- Rôles automatiques
- Statut des modules

---

[← Retour à l'index des commandes](./README.md)
