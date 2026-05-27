# Commandes Générales

Commandes utiles pour tous les membres du serveur.

## Table des matières
- [help](#help) - Aide du bot
- [ping](#ping) - Latence
- [botinfo](#botinfo) - Informations bot
- [userinfo](#userinfo) - Informations utilisateur
- [serverinfo](#serverinfo) - Informations serveur
- [stats](#stats) - Statistiques
- [calc](#calc) - Calculateur
- [poll](#poll) - Sondage
- [avatar](#avatar) - Afficher avatar
- [banner](#banner) - Afficher bannière

---

## help

Affiche l'aide des commandes.

**Usage:** `+help [commande|catégorie]`

**Alias:** `h`, `aide`

### Exemples
```
+help              # Aide générale
+help ban          # Aide sur la commande ban
+help moderation   # Commandes de modération
```

---

## ping

Vérifie la latence du bot.

**Usage:** `+ping`

**Alias:** `latency`, `ms`

### Affichage
- **API** : Latence Discord API
- **Bot** : Temps de réponse du bot
- **Database** : Latence SQLite

---

## botinfo

Affiche les informations sur le bot.

**Usage:** `+botinfo`

**Alias:** `bi`, `bot`, `info`

### Informations Affichées
- Nom et version
- Uptime (temps depuis le démarrage)
- Nombre de serveurs et membres
- Utilisation mémoire
- Version Node.js et Discord.js
- Créateur (BUYER_ID)

---

## userinfo

Affiche les informations sur un membre.

**Usage:** `+userinfo [@user|id]`

**Alias:** `ui`, `user`, `whois`

### Sans Argument
Affiche vos propres informations.

### Informations Affichées
- Avatar et bannière
- Nom et surnom
- ID Discord
- Date de création du compte
- Date d'arrivée sur le serveur
- Rôles sur le serveur
- Permissions clés

### Exemples
```
+userinfo
+userinfo @mysoul
+userinfo 123456789012345678
```

---

## serverinfo

Affiche les informations sur le serveur.

**Usage:** `+serverinfo`

**Alias:** `si`, `server`, `guildinfo`

### Informations Affichées
- Nom et icône
- ID et propriétaire
- Date de création
- Nombre de membres (total/en ligne)
- Nombre de salons et rôles
- Niveau de boost
- Emojis personnalisés

---

## stats

Affiche les statistiques du serveur.

**Usage:** `+stats`

**Alias:** `statistics`

### Statistiques
- Messages envoyés (24h)
- Membres actifs
- Nouveaux membres (7j)
- Top salons actifs
- Répartition des membres (bots vs humains)

---

## calc

Calculateur avec expressions mathématiques.

**Usage:** `+calc <expression>`

**Alias:** `calculate`, `math`

### Fonctions Supportées
- Opérateurs : `+`, `-`, `*`, `/`, `^`, `%`
- Fonctions : `sin`, `cos`, `tan`, `sqrt`, `log`, `abs`
- Constantes : `pi`, `e`

### Exemples
```
+calc 2 + 2
+calc (10 * 5) / 2
+calc sqrt(144)
+calc sin(pi / 2)
```

---

## poll

Crée un sondage avec réactions.

**Usage:** `+poll "question" "option1" "option2" [...]`

**Permissions:** `ManageMessages`

### Limites
- Minimum 2 options
- Maximum 10 options
- Utilise les émojis 1️⃣ 2️⃣ 3️⃣ ...

### Exemples
```
+poll "Quelle est votre couleur préférée ?" "Rouge" "Bleu" "Vert"
+poll "Prêt pour l'événement ?" "Oui" "Non" "Peut-être"
```

---

## avatar

Affiche l'avatar d'un membre.

**Usage:** `+avatar [@user]`

**Alias:** `pp`, `pdp`, `av`

### Exemples
```
+avatar          # Votre avatar
+avatar @mysoul     # Avatar de mysoul
```

Affiche l'avatar en haute résolution avec lien direct.

---

## banner

Affiche la bannière d'un membre.

**Usage:** `+banner [@user]`

### Exemples
```
+banner
+banner @mysoul
```

> **Note** : La bannière doit être configurée sur le profil Discord (Nitro requis).

---

## allbots

Liste tous les bots du serveur.

**Usage:** `+allbots`

Affiche :
- Nombre total de bots
- Liste avec leur créateur
- Date d'ajout

---

## alladmins

Liste tous les administrateurs.

**Usage:** `+alladmins`

**Alias:** `admins`

Affiche les membres avec la permission `Administrator`.

---

## boosters

Liste les boosters du serveur.

**Usage:** `+boosters`

Affiche :
- Nombre de boosts total
- Liste des boosters
- Niveau de boost actuel

---

[← Retour à l'index des commandes](./README.md)
