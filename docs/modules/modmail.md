# Module ModMail

Communication directe entre les DM des membres et votre serveur staff.

## Vue d'ensemble

```
┌────────────────────────────────────────────────────────────┐
│                      MODULE MODMAIL                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│   Membre (DM)                    Serveur (Staff)          │
│       │                               │                   │
│       │  ┌─────────────────────┐    │                   │
│       ├──▶  DM au Bot          │──────▶│                   │
│       │  └─────────────────────┘    │                   │
│       │                               ▼                   │
│       │                        ┌──────────────┐          │
│       │                        │ Salon Thread │          │
│       │                        │  (Privé)     │          │
│       │                        └──────┬───────┘          │
│       │                               │                   │
│       │  ◄───────────────────────────┤  Réponse Staff   │
│       │      Transmis au membre       │                   │
│       │                               │                   │
└────────────────────────────────────────────────────────────┘
```

## Fonctionnalités

-  Communication bidirectionnelle DM ↔ Serveur
-  Création automatique de salons/thread
-  Support des pièces jointes (images, fichiers)
-  Support des embeds
-  Fermeture et archivage
-  Logs complets

---

## Configuration

### Activation
```
+modmail enable
```

### Catégorie des Threads
```
+modmail category 📬 ModMail
```

### Rôle Staff
```
+modmail role @Staff
```

### Message de Confirmation
```
+modmail message Votre message a été transmis au staff de {server.name}.
```

---

## Fonctionnement

### 1. Membre envoie un DM
```
(Membre → Bot en DM)
"Bonjour, j'ai un problème avec ma commande"
```

### 2. Création du Thread
- Bot crée un salon privé dans la catégorie configurée
- Nom : `modmail-username-1234`
- Mentionne le rôle staff

### 3. Message transmis au Staff
```
📬 Nouveau ModMail
De: @Username (ID: 123456789)
Message: Bonjour, j'ai un problème avec ma commande
```

### 4. Le Staff répond
Dans le salon modmail, tapez simplement :
```
Bonjour, pouvez-vous préciser votre problème ?
```

Le message est automatiquement transmis au membre en DM.

### 5. Fermeture
```
+modclose Raison de fermeture
```

---

## Commandes ModMail

### Pour les Membres (en DM)
Aucune commande nécessaire. Envoyez simplement un message au bot.

### Pour le Staff (dans le salon)

| Commande | Description |
|----------|-------------|
| `+modclose` | Fermer le thread |
| `+modreply` | Répondre avec un embed |
| `+modanon` | Répondre anonymement |
| `+modblock` | Bloquer l'utilisateur |
| `+modunblock` | Débloquer l'utilisateur |

---

## API du Module

```javascript
const modmail = require('../modules/modmail');

// Gérer un message DM entrant
await modmail.handleRawDm(client, messageData);

// Créer un thread
const thread = await modmail.createThread(guild, user, message);

// Envoyer une réponse au membre
await modmail.sendToUser(userId, content, attachments);

// Fermer un thread
await modmail.closeThread(threadId, closer, reason);

// Bloquer un utilisateur
await modmail.blockUser(userId, reason);
```

---

## Schéma de Base de Données

### Table `modmail_threads`

| Colonne | Type | Description |
|---------|------|-------------|
| id | INTEGER PRIMARY KEY | ID unique |
| guild_id | TEXT | ID du serveur |
| channel_id | TEXT | ID du salon thread |
| user_id | TEXT | ID du membre |
| opened_at | INTEGER | Timestamp ouverture |
| closed_at | INTEGER | Timestamp fermeture |
| closed_by | TEXT | ID qui a fermé |
| messages_count | INTEGER | Nombre de messages |

### Table `modmail_blocks`

| Colonne | Type | Description |
|---------|------|-------------|
| user_id | TEXT PRIMARY KEY | ID bloqué |
| reason | TEXT | Raison du blocage |
| blocked_at | INTEGER | Timestamp |
| blocked_by | TEXT | ID du staff |

---

## Gestion des Fichiers

### Types Supportés
- Images (PNG, JPG, GIF, WEBP)
- Documents (PDF, TXT)
- Archives (ZIP, limité)

### Limites
- Taille max : 8 Mo (limite Discord)
- Nombre max : 10 fichiers par message

---

## Workflow Typique

### Scénario : Support Client

1. **Client envoie un problème en DM au bot**
2. **Staff voit le message** dans #modmail
3. **Staff investigate** et demande des détails
4. **Client répond** avec plus d'informations
5. **Staff résout** le problème
6. **Staff ferme** avec `+modclose Résolu`
7. **Transcript** sauvegardé (optionnel)

---

## Sécurité

### Protections
- 🔒 Un seul thread actif par utilisateur/serveur
- 🔒 Messages limités en taille
- 🔒 Fichiers scannés (taille/type)
- 🔒 Liste noire d'utilisateurs abusifs

### Anonymat
Le staff peut répondre anonymement :
```
+modanon Votre demande a été traitée.
```

L'utilisateur verra :
```
Staff: Votre demande a été traitée.
```

Au lieu de :
```
@Modérateur: Votre demande a été traitée.
```

---

## Intégration avec Tickets

Le ModMail peut être lié au système de tickets :
- Conversion d'un modmail en ticket formel
- Transfert vers un salon ticket dédié
- Référence croisée des archives

---

[← Retour aux modules](./README.md)
