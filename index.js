'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const REQUIRED_ENV = ['TOKEN', 'BUYER_ID', 'CLIENT_ID'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`\x1b[31m[ERREUR] Variables manquantes dans .env : ${missing.join(', ')}\x1b[0m`);
  process.exit(1);
}

const { createClient } = require('./core/client');
const { loadAll }      = require('./core/loader');
const errorHandler     = require('./utils/errorHandler');
const modmail          = require('./modules/modmail');

const LOCK_FILE = path.join(__dirname, '.bot-instance.lock');

function _isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function _acquireSingleInstanceLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const raw = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      const existingPid = Number(raw);

      if (Number.isInteger(existingPid) && existingPid > 0 && _isProcessAlive(existingPid)) {
        console.error(`\x1b[31m[ERREUR] Une autre instance du bot est deja active (PID ${existingPid}).\x1b[0m`);
        process.exit(1);
      }

      fs.unlinkSync(LOCK_FILE);
    }

    fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
  } catch (err) {
    console.error('\x1b[31m[ERREUR] Impossible de gerer le lock d\'instance :', err.message, '\x1b[0m');
    process.exit(1);
  }
}

function _releaseSingleInstanceLock() {
  try {
    if (!fs.existsSync(LOCK_FILE)) return;
    const raw = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    if (Number(raw) === process.pid) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {}
}

_acquireSingleInstanceLock();

const client = createClient();

client.on('raw', async (packet) => {
  if (packet.t !== 'MESSAGE_CREATE') return;
  if (packet.d?.guild_id) return;
  if (!packet.d?.author?.id) return;
  if (packet.d.author.bot) return;

  await modmail.handleRawDm(client, packet.d).catch(err => {
    errorHandler.handle(err, { source: 'modmail.rawDm' });
  });
});

errorHandler.init(client);

loadAll(client);

client.login(process.env.TOKEN)
  .catch(err => {
    console.error('\x1b[31m[ERREUR] Connexion impossible :', err.message, '\x1b[0m');
    process.exit(1);
  });

process.on('SIGINT', () => {
  console.log('\n\x1b[33m[INFO] Arrêt du bot...\x1b[0m');
  _releaseSingleInstanceLock();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\x1b[33m[INFO] Arrêt du bot (SIGTERM)...\x1b[0m');
  _releaseSingleInstanceLock();
  client.destroy();
  process.exit(0);
});

process.on('exit', () => {
  _releaseSingleInstanceLock();
});

module.exports = client;
