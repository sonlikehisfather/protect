# Guide de Déploiement

Mise en production du bot mysoul.

## Sommaire
1. [Préparation](#préparation)
2. [Environnement de Production](#environnement-de-production)
3. [Hébergement](#hébergement)
4. [Monitoring](#monitoring)
5. [Backup](#backup)

---

## Préparation

### Checklist Pré-Déploiement

- [ ] Tests passent localement
- [ ] Configuration `.env` production prête
- [ ] Token de production différent du dev
- [ ] Base de données initialisée
- [ ] Permissions Discord vérifiées
- [ ] Logs configurés

### Variables d'Environnement Production

```env
# === PRODUCTION ===
NODE_ENV=production
TOKEN=production_token_here
CLIENT_ID=1234567890123456789
BUYER_ID=9876543210987654321

# === OPTIONNEL ===
DEV_GUILD_ID=  # Vide en production pour déploiement global
DEBUG_LOADER=false
DEBUG_SQL=false
```

### Optimisations

```javascript
// Désactiver le hot-reload en production
// package.json
{
  "scripts": {
    "start": "node index.js",  // Production
    "dev": "nodemon index.js"  // Développement
  }
}
```

---

## Environnement de Production

### Utilisation de PM2

PM2 est recommandé pour la production :

```bash
# Installation globale
npm install -g pm2

# Démarrer avec PM2
pm2 start index.js --name "mysoul-bot"

# Configuration avancée
pm2 start index.js --name "mysoul-bot" \
  --log-date-format "YYYY-MM-DD HH:mm:ss" \
  --max-memory-restart 512M \
  --restart-delay 3000 \
  --max-restarts 5

# Sauvegarder la config
pm2 save
pm2 startup
```

### Configuration PM2 (ecosystem.config.js)

```javascript
module.exports = {
  apps: [{
    name: 'mysoul-bot',
    script: './index.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '512M',
    restart_delay: 3000,
    max_restarts: 5,
    min_uptime: '10s',
    
    env: {
      NODE_ENV: 'production'
    },
    
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
```

### Démarrage avec ecosystem

```bash
pm2 start ecosystem.config.js
pm2 save
```

---

## Hébergement

### VPS (Recommandé)

#### VPS Cloud (DigitalOcean, AWS, etc.)

```bash
# Connecter au serveur
ssh user@votre-vps.com

# Mettre à jour
sudo apt update && sudo apt upgrade -y

# Installer Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Installer Git et PM2
sudo apt install -y git
sudo npm install -g pm2

# Cloner le projet
git clone https://github.com/sonlikehisfather/protect.git
cd protect
npm install --production

# Configurer
nano .env

# Démarrer
pm2 start index.js --name protect
```

### Docker (Optionnel)

#### Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

USER node

CMD ["node", "index.js"]
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  bot:
    build: .
    container_name: protect
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./database.sqlite:/app/database.sqlite
      - ./logs:/app/logs
```

#### Commandes Docker

```bash
# Build et démarrer
docker-compose up -d

# Logs
docker-compose logs -f bot

# Redémarrer
docker-compose restart
```

---

## Monitoring

### Logs avec PM2

```bash
# Voir les logs
pm2 logs protect

# Logs en temps réel
pm2 logs protect --lines 100

# Vider les logs
pm2 flush
```

### Monitoring PM2

```bash
# Dashboard
pm2 monit

# Liste des processus
pm2 list

# Informations détaillées
pm2 describe protect

# Métriques
pm2 show protect
```

### Alertes

```bash
# Configurer les alertes email (optionnel)
pm2 install pm2-server-monit
```

---

## Backup

### Script de Backup

```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/protect"
DB_FILE="database.sqlite"

# Créer le dossier
mkdir -p $BACKUP_DIR

# Backup de la base de données
cp $DB_FILE $BACKUP_DIR/database_$DATE.sqlite

# Backup des logs
tar -czf $BACKUP_DIR/logs_$DATE.tar.gz logs/

# Backup de la configuration
cp .env $BACKUP_DIR/env_$DATE.txt

# Supprimer les backups de plus de 7 jours
find $BACKUP_DIR -name "*.sqlite" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
```

### Cron Job

```bash
# Éditer crontab
crontab -e

# Backup quotidien à 3h du matin
0 3 * * * /path/to/protect/backup.sh >> /path/to/protect/logs/backup.log 2>&1
```

### Backup Cloud (Optionnel)

```javascript
// Upload vers S3, Google Drive, etc.
const { backupToS3 } = require('./utils/backup');

// Tâche quotidienne
setInterval(() => {
  backupToS3();
}, 24 * 60 * 60 * 1000);
```

---

## Mises à Jour

### Déploiement Continu (Git)

```bash
# Script de déploiement
deploy.sh

#!/bin/bash
cd /path/to/protect

# Pull des changements
git pull origin main

# Installer les nouvelles dépendances
npm install --production

# Redémarrer PM2
pm2 restart protect

echo "Déploiement terminé"
```

### Sans Coupure (Zero-Downtime)

```bash
# PM2 reload sans coupure
pm2 reload protect
```

---

## Sécurité

### Firewall

```bash
# UFW (Ubuntu)
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw enable
```

### Protection du Token

```bash
# Permissions du .env
chmod 600 .env

# Ne jamais commit le .env
git update-index --assume-unchanged .env
```

---

## Troubleshooting Production

| Problème | Solution |
|----------|----------|
| Bot hors ligne | `pm2 restart protect` |
| Memory leak | Vérifier `pm2 monit`, redémarrer |
| Base de données corrompue | Restaurer depuis backup |
| Rate limiting Discord | Attendre, vérifier les logs |

---

[← Retour à la documentation](../README.md)
