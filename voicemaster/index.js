'use strict';

/**
 * VoiceMaster - point d'entrée.
 * Une commande exporte : { name, aliases?, minRank, usage, needsVoice?, needsBotPerms?, run }.
 */

const fs   = require('fs');
const path = require('path');
const { Collection } = require('discord.js');

const store   = require('./store');
const handler = require('./handler');

const COMMANDS_DIR = path.join(__dirname, 'commands');

function loadCommands(client) {
  client.vmCommands = new Collection();

  if (!fs.existsSync(COMMANDS_DIR)) return 0;

  let count = 0;

  for (const file of fs.readdirSync(COMMANDS_DIR)) {
    if (!file.endsWith('.js') || file.startsWith('_')) continue;

    const filePath = path.join(COMMANDS_DIR, file);

    try {
      delete require.cache[require.resolve(filePath)];
      const command = require(filePath);

      if (!command?.name || typeof command.run !== 'function' || typeof command.minRank !== 'number') {
        console.warn(`[VoiceMaster] Commande ignorée (format invalide) : ${file}`);
        continue;
      }

      for (const key of [command.name, ...(command.aliases ?? [])]) {
        client.vmCommands.set(key.toLowerCase(), command);
      }
      count++;
    } catch (err) {
      console.error(`[VoiceMaster] Erreur de chargement de ${file} :`, err.message);
    }
  }

  return count;
}

function init(client) {
  store.init();
  const count = loadCommands(client);
  client.__vmCmdCount = count;
  console.log(`[VoiceMaster] ${count} commande(s) chargée(s)`);
}

module.exports = { init, handle: handler.handle };
