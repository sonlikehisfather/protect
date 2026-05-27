# Commandes Tickets

Système de tickets pour le support utilisateur.

## Table des matières
- [ticket](#ticket) - Créer un ticket
- [close](#close) - Fermer un ticket
- [add](#add) - Ajouter un membre
- [remove](#remove) - Retirer un membre
- [rename](#rename) - Renommer un ticket
- [transcript](#transcript) - Générer un transcript

---

## ticket

Crée un nouveau ticket de support.

**Usage:** `+ticket [raison]`

**Alias:** `new`, `create`, `support`

### Fonctionnement
1. Crée un salon privé dans la catégorie configurée
2. Mentionne le staff
3. Envoie un embed avec la raison
4. Le créateur du ticket est ajouté automatiquement

### Configuration Requise
Avant utilisation, configurez avec :
```
+configserver ticketcategory ID_CATÉGORIE
+configserver ticketrole @Staff
```

### Exemples
```
+ticket
+ticket Problème avec le rôle membre
+ticket Demande de partenariat
```

---

## close

Ferme le ticket actuel.

**Usage:** `+close [raison]`

**Alias:** `end`, `fermer`, `cloturer`

### Permissions
- Créateur du ticket : peut fermer son propre ticket
- Rôle staff : peut fermer tous les tickets

### Fonctionnement
1. Génère un transcript automatiquement
2. Envoie le transcript au créateur (optionnel)
3. Supprime le salon après délai

### Options
- `+close now` - Ferme immédiatement sans transcript
- `+close` - Ferme avec génération de transcript

### Exemples
```
+close Résolu
+close Problème réglé, merci !
+close now
```

---

## add

Ajoute un membre au ticket.

**Usage:** `+add <@user>`

**Permissions:** Créateur du ticket ou Staff

### Exemples
```
+add @Support
+add 123456789012345678
```

---

## remove

Retire un membre du ticket.

**Usage:** `+remove <@user>`

**Permissions:** Staff uniquement

### Exemples
```
+remove @Utilisateur
```

---

## rename

Renomme le salon du ticket.

**Usage:** `+rename <nouveau_nom>`

**Alias:** `renommer`

**Permissions:** Staff

### Exemples
```
+rename urgent-probleme-paiement
```

---

## transcript

Génère un transcript du ticket sans le fermer.

**Usage:** `+transcript`

**Alias:** `save`, `archive`

### Format
- Format HTML (haute fidélité)
- Inclut : messages, images, fichiers, réactions
- Sauvegarde : 7 jours par défaut

### Envoi
- Dans le salon de logs configuré
- En fichier attaché
- Lien web temporaire

---

## Commandes Administration Tickets

### ticketpanel
Crée un panneau de création de tickets avec bouton.

```
+ticketpanel
+ticketpanel "Cliquez ici pour ouvrir un ticket"
```

### ticketconfig
Configure les options avancées.

```
+ticketconfig limit 3              # Limite de tickets par user
+ticketconfig transcript on        # Activer transcripts auto
+ticketconfig dmtranscript on     # Envoyer transcript en DM
```

### ticketstats
Statistiques des tickets.

```
+ticketstats                       # Stats globales
+ticketstats @Staff                # Stats d'un staff
```

---

## Workflow Recommandé

### Pour les Utilisateurs
1. `+ticket Raison du contact`
2. Attendre une réponse du staff
3. Décrire le problème en détail
4. `+close` quand résolu

### Pour le Staff
1. Répondre rapidement aux nouveaux tickets
2. Utiliser `+add` pour impliquer d'autres staff si besoin
3. `+rename` pour organiser (optionnel)
4. `+close Raison` avec un message de conclusion

---

[← Retour à l'index des commandes](./README.md)
