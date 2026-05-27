# FAQ - Questions Fréquentes

## Général

### Le bot ne répond pas, que faire ?

1. Vérifiez que le bot est en ligne (point vert)
2. Vérifiez vos permissions (vérifiez que vous n'êtes pas mute/ban)
3. Vérifiez le préfixe (`+` par défaut)
4. Vérifiez les permissions du bot dans le salon

### Comment changer le préfixe ?

```
+config prefix !
```

Ou modifiez `config.json` :
```json
{
  "prefix": "!"
}
```

Puis redémarrez le bot.

---

## Configuration

### Comment configurer les messages de bienvenue ?

```
+joinsettings enable
+joinsettings channel #bienvenue
+joinsettings message Bienvenue {user.mention} sur {server.name} !
```

### Comment activer le système de tickets ?

```
+configserver ticketcategory ID_CATÉGORIE
+configserver ticketrole @Staff
```

Pour obtenir l'ID de la catégorie : clic droit → Copier l'ID (mode développeur activé).

### Comment activer le ModMail ?

```
+modmail enable
+modmail category ID_CATÉGORIE
+modmail role @Staff
```

---

## Modération

### Comment configurer le rôle muet ?

```
+muteconfig @RoleMute
```

Le bot créera automatiquement le rôle s'il n'existe pas et configurera les permissions sur tous les salons.

### Comment configurer les punitions automatiques ?

```
+punish add 3 mute 1h
+punish add 5 kick
+punish add 7 ban
```

Ceci :
- Mute 1h au 3ème warn
- Kick au 5ème warn
- Ban au 7ème warn

### Comment voir l'historique d'un membre ?

```
+warnlist @Utilisateur
+userinfo @Utilisateur
```

---

## Problèmes Techniques

### "Missing Access" / "Missing Permissions"

Le bot n'a pas les permissions nécessaires :
1. Allez dans Paramètres du serveur → Rôles
2. Vérifiez que le rôle du bot est en haut de la liste
3. Activez ces permissions :
   - Voir les salons
   - Gérer les salons
   - Gérer les messages
   - Gérer les rôles
   - Gérer les membres
   - Gérer les webhooks
   - Lire l'historique des messages
   - Envoyer des messages
   - Intégrer des liens
   - Joindre des fichiers
   - Utiliser des emojis externes
   - Ajouter des réactions
   - Se connecter
   - Parler
   - Déplacer des membres
   - Muter des membres
   - Sourdiniser des membres

### "Variables manquantes dans .env"

Votre fichier `.env` doit contenir au minimum :
```env
TOKEN=votre_token
CLIENT_ID=votre_client_id
BUYER_ID=votre_id
```

### Les commandes ne fonctionnent pas

Vérifiez :
1. Le préfixe est correct (`+` par défaut)
2. Le bot a les permissions `SendMessages` et `ReadMessageHistory`
3. Le bot peut voir le salon

Pour recharger les commandes :
```
+reload commands
```

### La base de données ne fonctionne pas

1. Vérifiez que `database.sqlite` existe
2. Vérifiez les permissions du fichier
3. Redémarrez le bot (le fichier sera recréé si manquant)

---

## Fonctionnalités

### Comment fonctionne le système de niveaux ?

- 1 message = XP aléatoire (10-25 par défaut)
- Cooldown de 60 secondes entre chaque gain
- Niveau 1 = 100 XP, Niveau 2 = 200 XP supplémentaires, etc.
- Formule : `XP_Nécessaire = Niveau × 100`

### Comment créer un giveaway ?

```
+giveaway 1d 1 Nitro Classic
```

- `1d` = durée (1 jour)
- `1` = nombre de gagnants
- `Nitro Classic` = prix

### Comment ajouter des rôles automatiques ?

```
+autorole add @Membre
+autorole add @Nouveau
```

### Comment créer un menu de rôles ?

```
+rolemenu create
# Notez l'ID retourné
+rolemenu add ID :emoji: @Role
```

---

## Développement

### Comment ajouter une commande ?

1. Créer un fichier dans `commands/[catégorie]/`
2. Suivre le template existant
3. Redémarrer le bot ou `+reload commands`

### Comment modifier le code ?

- Mode dev : `npm run dev` (auto-reload)
- En production : redémarrer avec `pm2 restart bot`

### Comment déboguer ?

```bash
# Mode debug
DEBUG_LOADER=true npm run dev
DEBUG_SQL=true npm run dev
```

---

## Erreurs Courantes

| Erreur | Cause | Solution |
|--------|-------|----------|
| `Cannot find module` | Dépendance manquante | `npm install` |
| `DiscordAPIError: Unknown Member` | Membre pas en cache | Attendre ou recharger |
| `SQLITE_BUSY` | Base de données verrouillée | Redémarrer le bot |
| `ETIMEDOUT` | Connexion internet | Vérifier la connexion |
| `Invalid token` | Token incorrect | Vérifier le .env |

---

## Support

Si votre question n'est pas ici :

1. Vérifiez la documentation complète dans `docs/`
2. Consultez les logs d'erreur
3. Ouvrez une issue sur GitHub

---

[← Retour à la documentation](../README.md)
