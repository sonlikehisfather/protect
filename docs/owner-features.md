# Fonctionnalités Owner

## Commandes Owner

### Gestion des serveurs

| Commande | Description |
|----------|-------------|
| `+serverlist` | Liste tous les serveurs du bot |
| `+serverlist [page]` | Navigation par page |

#### Panel Serveur
Dans la commande `+serverlist`, chaque serveur affiche :
- **Infos** : membres, salons, rôles, boosts
- **Boutons** :
  - **Créer une invitation** → Génère une invite 24h/1use
  - **Quitter le serveur** → Retire le bot du serveur

### Notifications automatiques

#### Serveur ajouté
Quand le bot rejoint un serveur, le **buyer** reçoit automatiquement un DM avec :
- Nom du serveur et icône
- Membres (humains/bots)
- Salons, rôles
- Niveau de vérification
- Boosts
- Locale

**Boutons disponibles :**
- Créer une invitation
- Quitter le serveur

### Sécurité

#### SecurInvite
- Vérifie automatiquement les serveurs entrants
- Si le serveur n'est pas autorisé → le bot quitte immédiatement
- Les serveurs autorisés sont définis par les owners globaux et le buyer

### Autres commandes Owner

| Commande | Description |
|----------|-------------|
| `+evaluate` | Évalue le bot et affiche les statistiques |
| `+broadcast` | Envoie un message sur tous les serveurs |
| `+setactivity` | Change l'activité du bot |
| `+globalowner` | Gère les owners globaux |

---

## Permissions

Seul le **buyer** (propriétaire du bot) peut utiliser ces commandes.

---

## Configuration

Les notifications automatiques ne nécessitent aucune configuration. Elles fonctionnent dès que le bot est en ligne et que l'`ownerId` est configuré dans `config.json`.

```json
{
  "ownerId": "VOTRE_ID_DISCORD"
}
```
