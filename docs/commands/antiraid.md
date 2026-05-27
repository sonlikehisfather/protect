# Commandes Antiraid

Commandes de protection et sécurité du serveur contre les raids et abus.

## Table des matières
- [antiraid](#antiraid) - Configuration globale
- [antiban](#antiban) - Protection anti-ban
- [antirole](#antirole) - Protection anti-modification rôles
- [antiwebhook](#antiwebhook) - Protection anti-webhooks
- [antitoken](#antitoken) - Protection anti-token grab

---

## antiraid

Configure la protection anti-raid globale du serveur.

**Usage:** `+antiraid <on|off|status>`

**Permissions:** `Administrator`

### Sous-commandes

| Sous-commande | Description |
|---------------|-------------|
| `on` | Active toutes les protections |
| `off` | Désactive toutes les protections |
| `status` | Affiche l'état actuel |

### Exemples
```
+antiraid on
+antiraid status
```

---

## antiban

Configure la protection contre les bannissements massifs.

**Usage:** `+antiban <on|off|limit> [valeur]`

**Permissions:** `Administrator`

### Description
Bloque les utilisateurs qui bannissent plus de X membres en Y secondes.

### Paramètres
- `limit` : Nombre de bans avant déclenchement (défaut: 3)
- Le bot restaure automatiquement les membres bannis abusivement

### Exemples
```
+antiban on
+antiban limit 5
+antiban off
```

---

## antirole

Protection contre la suppression/modification massive de rôles.

**Usage:** `+antirole <on|off|limit> [valeur]`

**Permissions:** `Administrator`

### Description
Détecte et annule les actions sur les rôles au-delà d'un certain seuil.

### Paramètres
- `limit` : Nombre d'actions sur rôles avant déclenchement

### Exemples
```
+antirole on
+antirole limit 3
```

---

## antiwebhook

Protection contre la création de webhooks malveillants.

**Usage:** `+antiwebhook <on|off>`

**Permissions:** `Administrator`

### Description
- Bloque la création de webhooks par des rôles non autorisés
- Supprime automatiquement les webhooks suspects
- Bannit le créateur du webhook

### Exemples
```
+antiwebhook on
+antiwebhook off
```

---

## antitoken

Protection contre le vol de tokens (self-bots).

**Usage:** `+antitoken <on|off>`

**Permissions:** `Administrator`

### Description
Détecte les messages contenant des tokens Discord et supprime immédiatement.

### Exemples
```
+antitoken on
```

---

## Logique de Protection

### Détection d'Attaque
1. Surveillance des événements Discord
2. Comptage des actions par utilisateur
3. Comparaison avec les limites configurées

### Réactions Automatiques
1. **Annulation** : Les actions sont inversées quand possible
2. **Sanction** : L'attaquant est banni/kick
3. **Alerte** : Notification dans le salon de logs

### Événements Surveillés
- Ban/Unban de membres
- Création/Suppression de salons
- Création/Suppression de rôles
- Création de webhooks
- Attribution de rôles administrateur
- Modifications de serveur

---

## Recommandations

### Configuration Initiale
```
+antiraid on
+antiban limit 3
+antirole limit 5
+antiwebhook on
```

### Maintenance
- Vérifiez régulièrement `+antiraid status`
- Ajustez les limites selon l'activité du serveur
- Excluez les bots de confiance si nécessaire

---

[← Retour à l'index des commandes](./README.md)
