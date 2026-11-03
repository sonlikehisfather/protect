'use strict';

const fs    = require('fs');
const path  = require('path');
const embed = require('../../utils/embed');

const VERSION_FILE = path.join(__dirname, '..', '..', 'VERSION');

function readVersion() {
  try {
    const v = fs.readFileSync(VERSION_FILE, 'utf8').trim();
    if (v) return v;
  } catch {}
  try {
    return require('../../package.json').version || 'inconnue';
  } catch {
    return 'inconnue';
  }
}

module.exports = {
  help: {
    name        : 'version',
    description : 'Affiche la version actuelle du bot.',
    usage       : 'version',
    aliases     : ['ver', 'v'],
    defaultPermission: 'everyone',
  },

  async run(client, message) {
    if (!message.guild) return;
    return embed.reply(message, `Version › **v${readVersion()}**`, {
      title     : 'Version du bot',
      timestamp : false,
    });
  },
};
