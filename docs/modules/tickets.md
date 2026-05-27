# Module Tickets

Système complet de tickets de support avec transcripts et gestion avancée.

## Vue d'ensemble

```
┌──────────────────────────────────────────────────────────┐
│                    MODULE TICKETS                         │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐     ┌──────────────┐     ┌─────────────┐  │
│  │ Création │────▶│ Salon Ticket │────▶│ Transcript  │  │
│  │  (+ticket)   │     │   (Privé)    │     │ (Archive)   │  │
│  └──────────┘     └──────────────┘     └─────────────┘  │
│        │                   │                           │
│        │            ┌──────┴──────┐                    │
│        │            ▼             ▼                    │
│  ┌──────────┐    ┌────────┐    ┌──────────┐          │
│  │  Panel   │    │ Add/   │    │  Fermeture│          │
│  │ (Bouton) │    │ Remove │    │  (+close) │          │
│  └──────────┘    └────────┘    └──────────┘          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## Fonctionnalités

-  Création de tickets via commande ou bouton
-  Salons privés avec accès staff
-  Gestion des membres (ajout/retrait)
-  Transcripts HTML complets
-  Limites de tickets par utilisateur
-  Catégories multiples
-  Logs et statistiques

---

## Configuration

### Étape 1 : Catégorie
```
+configserver ticketcategory ID_DE_LA_CATÉGORIE
```

### Étape 2 : Rôle Staff
```
+configserver ticketrole @Staff
```

### Étape 3 : Options avancées
```
+ticketconfig limit 3              # Max 3 tickets par user
+ticketconfig transcript on        # Transcript automatique
+ticketconfig dmtranscript on      # Envoyer en DM
```

---

## Création d'un Ticket

### Par Commande
```
+ticket Problème avec mon rôle
```

### Par Panel (Bouton)
```
+ticketpanel
```

Crée un embed avec un bouton 🔓 Ouvrir un ticket.

---

## Structure du Salon Ticket

### Permissions
| Rôle | Permissions |
|------|-------------|
| @everyone | Aucune (invisible) |
| Créateur du ticket | Voir, Écrire, Joindre |
| Rôle Staff | Voir, Gérer, Webhooks |
| Bot | Toutes |

### Embed Initial
```
🎫 Nouveau Ticket
Créé par: @User
Raison: Problème avec mon rôle
Date: 27/05/2026 15:30
```

---

## Transcripts

### Format
Les transcripts sont générés en **HTML** avec :
- Messages formatés (couleurs Discord)
- Images et fichiers joints
- Réactions
- Horodatage précis
- Avatars et noms

### Stockage
- Envoyés dans le salon de logs configuré
- Lien temporaire (7 jours par défaut)
- Option de téléchargement

### Exemple de Transcript
```html
<!DOCTYPE html>
<html>
<head>
  <title>Ticket #1234 - Transcript</title>
  <!-- Style Discord-like -->
</head>
<body>
  <div class="message">
    <img src="avatar.png" class="avatar">
    <span class="username">User#1234</span>
    <span class="timestamp">15:30:00</span>
    <div class="content">Bonjour, j'ai un problème...</div>
  </div>
  <!-- ... -->
</body>
</html>
```

---

## API du Module

### Utilisation dans d'autres fichiers

```javascript
const tickets = require('../modules/tickets');

// Créer un ticket
const ticket = await tickets.createTicket(member, {
  reason: 'Raison du ticket',
  category: 'support'
});

// Fermer un ticket
await tickets.closeTicket(channel, closer, reason);

// Ajouter un membre
await tickets.addUser(ticketId, user);

// Retirer un membre
await tickets.removeUser(ticketId, user);

// Générer transcript
const transcript = await tickets.generateTranscript(channel);
```

### Événements

Le module écoute les événements Discord :
- `channelDelete` : Nettoyage si salon supprimé manuellement
- `guildMemberRemove` : Fermeture auto si créateur quitte

---

## Schéma de Base de Données

### Table `tickets`

| Colonne | Type | Description |
|---------|------|-------------|
| id | INTEGER PRIMARY KEY | ID unique |
| guild_id | TEXT | ID du serveur |
| channel_id | TEXT | ID du salon |
| creator_id | TEXT | ID du créateur |
| created_at | INTEGER | Timestamp création |
| closed_at | INTEGER | Timestamp fermeture |
| closed_by | TEXT | ID qui a fermé |
| transcript_url | TEXT | Lien transcript |
| reason | TEXT | Raison initiale |

### Requêtes Courantes

```sql
-- Tickets actifs d'un serveur
SELECT * FROM tickets WHERE guild_id = ? AND closed_at IS NULL;

-- Tickets d'un utilisateur
SELECT * FROM tickets WHERE creator_id = ?;

-- Stats pour un serveur
SELECT COUNT(*) as total, 
       SUM(CASE WHEN closed_at IS NULL THEN 1 ELSE 0 END) as open
FROM tickets WHERE guild_id = ?;
```

---

## Workflow Typique

### Pour l'Utilisateur
1. Exécute `+ticket J'ai besoin d'aide`
2. Reçoit le lien vers son salon privé
3. Discute avec le staff
4. Exécute `+close` quand résolu
5. Reçoit le transcript en MP (si activé)

### Pour le Staff
1. Reçoit la notification dans le salon ticket
2. Répond à l'utilisateur
3. Ajoute d'autres staff si besoin avec `+add`
4. Ferme avec `+close Problème résolu`

---

## Dépannage

| Problème | Cause | Solution |
|----------|-------|----------|
| "Catégorie non configurée" | Ticketcategory manquant | Configurer avec `+configserver` |
| "Limite de tickets atteinte" | Max tickets par user | Augmenter avec `+ticketconfig limit` |
| Transcript non généré | Salon supprimé trop vite | Attendre la fin de génération |
| Bouton ne fonctionne pas | Permissions | Vérifier permissions du bot |

---

[← Retour aux modules](./README.md)
