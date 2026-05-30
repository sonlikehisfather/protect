# 💾 Système de Backup

## Overview

Sauvegarde automatique de toutes les données vers **Supabase** (PostgreSQL cloud) avec synchronisation régulière.

---

## Configuration

### Variables d'environnement

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
```

### Créer un projet Supabase

1. Créez un compte sur [supabase.com](https://supabase.com)
2. Créez un nouveau projet
3. Dans **Project Settings** → **API**, copiez :
   - `URL` → `SUPABASE_URL`
   - `anon public` → `SUPABASE_KEY`

### Tables requises

Le bot crée automatiquement les tables si elles n'existent pas :

- `backups` : Sauvegardes complètes
- `guild_data` : Données des serveurs
- `user_data` : Données des utilisateurs

---

## Fonctionnement

### Sauvegarde automatique
- **Fréquence** : Toutes les heures
- **Données sauvegardées** :
  - Configuration des serveurs
  - Niveaux et XP
  - Tickets
  - Giveaways
  - Logs
  - Paramètres anti-raid

### Récupération
- Les données peuvent être restaurées depuis Supabase
- Utile en cas de perte de la base SQLite locale

### Purge automatique
- Les données des serveurs supprimés sont marquées pour purge
- Suppression automatique après 30 jours
- Nettoie l'espace cloud

---

## Désactivation

Pour désactiver le backup, retirez simplement les variables d'environnement :

```env
# Supprimez ou commentez
# SUPABASE_URL=https://...
# SUPABASE_KEY=...
```

---

## Dépannage

| Erreur | Solution |
|--------|----------|
| `Invalid API key` | Vérifiez la clé Supabase |
| `Connection timeout` | Vérifiez l'URL et votre connexion |
| `Table not found` | Attendez la première sauvegarde auto |

---

## Notes

- Le backup est **optionnel** (bot fonctionne sans)
- La base SQLite locale reste la source principale
- Supabase sert uniquement de sauvegarde cloud
- Pas d'impact sur les performances si désactivé
