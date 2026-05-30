# 💾 Système de Backup Supabase

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

---

## Désactivation

Pour désactiver le backup, retirez simplement les variables d'environnement :

```env
# Supprimez ou commentez
# SUPABASE_URL=https://...
# SUPABASE_KEY=...
```

---

## Notes

- Le backup Supabase est **optionnel** (bot fonctionne sans)
- La base SQLite locale reste la source principale
- Pas d'impact sur les performances si désactivé
