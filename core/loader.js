'use strict';


const fs   = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const ROOT       = path.join(__dirname, '..');
const CMD_DIR    = path.join(ROOT, 'commands');
const SLASH_DIR  = path.join(ROOT, 'slashCommands');
const EVENTS_DIR = path.join(ROOT, 'events');

const DEBUG = process.env.DEBUG_LOADER === 'true';
const dbg   = (...args) => {
  if (DEBUG) console.log('[Loader:DEBUG]', ...args);
};


let _registeredHandlers = [];

function loadAll(client) {
  dbg('loadAll() appelé');

  loadEvents(client);
  loadCommands(client);
  loadSlashCommands(client);
}

async function deploySlash(client) {
  const commands = [...client.slashCommands.values()].map(c => c.data.toJSON());
  if (!commands.length) return;

  const token    = process.env.TOKEN;
  const clientId = process.env.CLIENT_ID;

  if (!token || !clientId) {
    console.warn('[Loader] TOKEN ou CLIENT_ID manquant - déploiement slash annulé.');
    return;
  }

  const rest  = new REST({ version: '10' }).setToken(token);
  const isDev = process.env.NODE_ENV !== 'production';

  try {
    if (isDev && process.env.DEV_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(clientId, process.env.DEV_GUILD_ID),
        { body: commands }
      );

      console.log(`[Loader] ${commands.length} slash command(s) déployée(s) sur le guild de dev`);
      return;
    }

    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );

    console.log(`[Loader] ${commands.length} slash command(s) déployée(s) globalement`);
  } catch (err) {
    console.error('[Loader] Erreur déploiement slash :', err.message);
  }
}

function loadCommands(client) {
  client.commands.clear();

  if (!client.commandAliases) {
    client.commandAliases = new Map();
  } else {
    client.commandAliases.clear();
  }

  if (!fs.existsSync(CMD_DIR)) return;

  let count = 0;

  for (const category of getFolders(CMD_DIR)) {
    const categoryPath = path.join(CMD_DIR, category);

    for (const file of getJsFiles(categoryPath)) {
      count += _loadCommand(client, path.join(categoryPath, file), category);
    }
  }

  for (const file of getJsFiles(CMD_DIR)) {
    count += _loadCommand(client, path.join(CMD_DIR, file), 'general');
  }

  client.__cmdCount = count;
  dbg(`${count} commande(s) prefix chargée(s)`);
}

function _loadCommand(client, filePath, category) {
  try {
    delete require.cache[require.resolve(filePath)];
    const mod = require(filePath);

    const multiKeys = Object.keys(mod).filter(k => k.endsWith('Help'));

    if (multiKeys.length > 0) {
      let count = 0;

      for (const key of multiKeys) {
        const help   = mod[key];
        const runKey = key.replace('Help', 'Run');
        const run    = mod[runKey];

        if (!help?.name || typeof run !== 'function') {
          console.warn(`[Loader] Sous-commande ignorée dans ${path.basename(filePath)} : ${key}`);
          continue;
        }

        const command = {
          help,
          run: (client, message, args) => run(client, message, args),
        };

        command.__filePath = filePath;

        if (_registerPrefixCommand(client, command, category, filePath)) {
          count++;
        }
      }

      return count;
    }

    if (!mod?.help?.name || typeof mod.run !== 'function') {
      console.warn(`[Loader] Ignoré (pas de help.name ou run manquant) : ${path.basename(filePath)}`);
      return 0;
    }

    mod.__filePath = filePath;

    return _registerPrefixCommand(client, mod, category, filePath) ? 1 : 0;
  } catch (err) {
    console.error(`[Loader] Erreur commande ${path.basename(filePath)} :`, err.message);
    return 0;
  }
}

function _registerPrefixCommand(client, command, category, filePath) {
  const help = command.help;

  const name = _normalizeCommandKey(help.name);
  if (!name) {
    console.warn(`[Loader] Commande ignorée (help.name invalide) : ${path.basename(filePath)}`);
    return false;
  }

  const existing = client.commands.get(name);
  if (existing && existing !== command) {
    console.warn(
      `[Loader] Conflit de commande "${name}" : ${path.basename(filePath)} ignoré, déjà utilisé par ${existing.__filePath ? path.basename(existing.__filePath) : existing.help?.name ?? '?'}`
    );
    return false;
  }

  help.name = name;
  help.category = category;

  const aliases = Array.isArray(help.aliases)
    ? [...new Set(help.aliases.map(_normalizeCommandKey).filter(Boolean))]
    : [];

  help.aliases = aliases.filter(alias => alias !== name);

  client.commands.set(name, command);

  if (command.__filePath == null) {
    command.__filePath = filePath;
  }

  for (const alias of help.aliases) {
    const aliasExisting = client.commands.get(alias);

    if (aliasExisting && aliasExisting !== command) {
      console.warn(
        `[Loader] Conflit d'alias "${alias}" : ${name} ignoré, déjà utilisé par ${aliasExisting.help?.name ?? '?'}`
      );
      continue;
    }

    client.commands.set(alias, command);
    client.commandAliases.set(alias, name);
  }

  dbg(`Commande chargée : ${name} (${category}) depuis ${path.basename(filePath)}`);
  return true;
}

function _normalizeCommandKey(value) {
  if (typeof value !== 'string') return null;

  const key = value.trim().toLowerCase();
  return key.length > 0 ? key : null;
}

function loadSlashCommands(client) {
  client.slashCommands.clear();

  if (!fs.existsSync(SLASH_DIR)) return;

  let count = 0;

  for (const file of getJsFiles(SLASH_DIR)) {
    if (_loadSlash(client, path.join(SLASH_DIR, file))) count++;
  }

  for (const category of getFolders(SLASH_DIR)) {
    const categoryPath = path.join(SLASH_DIR, category);

    for (const file of getJsFiles(categoryPath)) {
      if (_loadSlash(client, path.join(categoryPath, file))) count++;
    }
  }

  dbg(`${count} slash command(s) chargée(s)`);
}

function _loadSlash(client, filePath) {
  try {
    delete require.cache[require.resolve(filePath)];
    const command = require(filePath);

    if (!command?.data?.name) {
      console.warn(`[Loader] Slash ignorée (pas de data.name) : ${path.basename(filePath)}`);
      return false;
    }

    const name = _normalizeCommandKey(command.data.name);

    if (!name) {
      console.warn(`[Loader] Slash ignorée (nom invalide) : ${path.basename(filePath)}`);
      return false;
    }

    const existing = client.slashCommands.get(name);
    if (existing) {
      console.warn(
        `[Loader] Conflit slash "${name}" : ${path.basename(filePath)} ignoré`
      );
      return false;
    }

    command.__filePath = filePath;
    client.slashCommands.set(name, command);

    return true;
  } catch (err) {
    console.error(`[Loader] Erreur slash ${path.basename(filePath)} :`, err.message);
    return false;
  }
}

function loadEvents(client) {
  if (DEBUG) {
    const eventNames = client.eventNames();

    dbg(`loadEvents() - ${_registeredHandlers.length} handler(s) enregistré(s) précédemment`);
    dbg(`Listeners actifs avant nettoyage :`, eventNames.map(e => `${e}(${client.listenerCount(e)})`).join(', '));
  }

  for (const { eventName, handler } of _registeredHandlers) {
    client.off(eventName, handler);
  }

  _registeredHandlers = [];

  if (!fs.existsSync(EVENTS_DIR)) {
    console.warn('[Loader] Dossier events introuvable :', EVENTS_DIR);
    return;
  }

  const eventMap = new Map();

  for (const file of getJsFiles(EVENTS_DIR)) {
    try {
      const filePath = path.join(EVENTS_DIR, file);

      delete require.cache[require.resolve(filePath)];
      const event = require(filePath);

      if (!event?.name || typeof event.execute !== 'function') {
        console.warn(`[Loader] Event ignoré (pas de name/execute) : ${file}`);
        continue;
      }

      if (!eventMap.has(event.name)) {
        eventMap.set(event.name, []);
      }

      eventMap.get(event.name).push({
        execute: event.execute,
        once   : Boolean(event.once),
        file,
      });

      dbg(`Module event collecté : ${event.name} depuis ${file}`);
    } catch (err) {
      console.error(`[Loader] Erreur event ${file} :`, err.message);
    }
  }

  let fileCount = 0;

  for (const [eventName, modules] of eventMap) {
    const isOnce = modules.every(m => m.once);

    if (modules.length > 1) {
      dbg(`Event "${eventName}" - ${modules.length} module(s) : ${modules.map(m => m.file).join(', ')}`);
    }

    const handler = async (...args) => {
      for (const mod of modules) {
        try {
          await mod.execute(client, ...args);
        } catch (err) {
          console.error(`[Loader] Erreur dans ${mod.file} (${eventName}) :`, err.message);
        }
      }
    };

    if (isOnce) {
      client.once(eventName, handler);
    } else {
      client.on(eventName, handler);
    }

    _registeredHandlers.push({ eventName, handler, once: isOnce });
    fileCount += modules.length;
  }

  client.__eventModuleCount = fileCount;
  client.__eventTypeCount   = eventMap.size;
  dbg(`${fileCount} fichier(s) event chargé(s) sur ${eventMap.size} event(s) Discord`);

  if (DEBUG) {
    const eventNames = client.eventNames();
    dbg(`Listeners actifs après chargement :`, eventNames.map(e => `${e}(${client.listenerCount(e)})`).join(', '));
  }
}

function getCommandFilePath(client, commandName) {
  const key = _normalizeCommandKey(commandName);
  if (!key) return null;

  const existing = client.commands.get(key);
  if (!existing) return null;

  const realName = existing.help?.name ?? key;
  return existing.__filePath || _findCommandFileInCache(realName) || null;
}

function reloadCommand(client, commandName) {
  const key = _normalizeCommandKey(commandName);

  if (!key) {
    return { success: false, message: 'Nom de commande invalide.' };
  }

  const existing = client.commands.get(key);

  if (!existing) {
    return { success: false, message: `Commande \`${commandName}\` introuvable.` };
  }

  const realName  = existing.help?.name ?? key;
  const filePath  = existing.__filePath || _findCommandFileInCache(realName);
  const category  = existing.help?.category ?? 'general';

  if (!filePath) {
    return { success: false, message: `Fichier source de \`${realName}\` introuvable dans le cache.` };
  }

  _removeCommandReferences(client, existing);

  const loaded = _loadCommand(client, filePath, category);

  return loaded > 0
    ? { success: true,  message: `\`${realName}\` rechargée.` }
    : { success: false, message: `Erreur lors du rechargement de \`${realName}\`.` };
}

function reloadEvents(client) {
  loadEvents(client);
  return { success: true, message: 'Events rechargés.' };
}

function _findCommandFileInCache(commandName) {
  return Object.keys(require.cache).find(k => {
    const exported = require.cache[k]?.exports;

    if (exported?.help?.name === commandName) {
      return true;
    }

    return Object.keys(exported || {}).some(key =>
      key.endsWith('Help') && exported[key]?.name === commandName
    );
  });
}

function _removeCommandReferences(client, command) {
  const commandName = command.help?.name;

  for (const [key, value] of client.commands.entries()) {
    if (value === command || value?.help?.name === commandName) {
      client.commands.delete(key);
    }
  }

  if (client.commandAliases) {
    for (const [alias, name] of client.commandAliases.entries()) {
      if (name === commandName) {
        client.commandAliases.delete(alias);
      }
    }
  }
}

function getCategories() {
  if (!fs.existsSync(CMD_DIR)) return [];
  return getFolders(CMD_DIR);
}

function getFolders(dir) {
  return fs.readdirSync(dir)
    .filter(f => fs.statSync(path.join(dir, f)).isDirectory())
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

function getJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js') && fs.statSync(path.join(dir, f)).isFile())
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

module.exports = {
  loadAll,
  loadCommands,
  loadSlashCommands,
  loadEvents,
  deploySlash,
  reloadCommand,
  reloadEvents,
  getCommandFilePath,
  getCategories,
};
