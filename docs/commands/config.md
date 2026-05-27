# Commandes Config (Modération)

Configuration des outils de modération.

## Table des matières
- [muteconfig](#muteconfig) - Configuration du mute
- [punish](#punish) - Punitions automatiques
- [slowmode](#slowmode-config) - Configuration slowmode
- [warnpunish](#warnpunish) - Configuration warn → punition
- [piconly](#piconly) - Salons images uniquement
- [noderank](#noderank) - Exclure du système de niveaux

---

## muteconfig

Configure le rôle et la méthode de mute.

**Usage:** `+muteconfig [@role|create]`

**Permissions:** `Administrator`

### Options

| Option | Description |
|--------|-------------|
| `@role` | Utiliser un rôle existant |
| `create` | Créer automatiquement le rôle |

### Exemples
```
+muteconfig create
+muteconfig @Muet
```

### Création Automatique
Lors de `create` :
1. Crée le rôle "Muted"
2. Configure les permissions sur tous les salons
3. Empêche d'envoyer des messages / parler

---

## punish

Configure les punitions automatiques selon le nombre de warns.

**Usage:** `+punish <add|remove|list> [warns] [action] [durée]`

**Permissions:** `Administrator`

### Actions Disponibles
- `warn` - Avertissement supplémentaire
- `mute` - Mute temporaire
- `kick` - Expulsion
- `ban` - Bannissement

### Exemples
```
+punish add 3 mute 1h          # 3 warns = mute 1h
+punish add 5 kick             # 5 warns = kick
+punish add 7 ban              # 7 warns = ban
+punish list                   # Voir les règles
+punish remove 5               # Supprimer règle des 5 warns
```

### Workflow
1. Membre reçoit un warn
2. Comptage des warns actifs
3. Déclenchement de la punition configurée
4. Envoi d'un message explicatif

---

## slowmode (config)

Configure le slowmode par défaut.

**Usage:** `+config slowmode <durée>`

**Permissions:** `ManageChannels`

### Exemples
```
+config slowmode 5s
+config slowmode 30s
+config slowmode 1m
```

---

## warnpunish

Alias de `punish`. Voir [punish](#punish).

---

## piconly

Configure un salon pour n'accepter que les images.

**Usage:** `+piconly <#salon|on|off>`

**Permissions:** `ManageChannels`

### Fonctionnement
- Messages sans pièce jointe image = suppression
- Notification à l'utilisateur
- Logs dans le salon de logs

### Exemples
```
+piconly #mèmes
+piconly on
+piconly off
```

---

## noderank

Exclut des salons/membres du système de niveaux.

**Usage:** `+noderank <channel|user> <add|remove|list>`

**Permissions:** `Administrator`

### Exemples
```
+noderank channel #spam
+noderank user @Bot
+noderank channel list
```

---

[← Retour à l'index des commandes](./README.md)
