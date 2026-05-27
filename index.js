'use strict';

require('dotenv').config();

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
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\x1b[33m[INFO] Arrêt du bot (SIGTERM)...\x1b[0m');
  client.destroy();
  process.exit(0);
});

module.exports = client;
