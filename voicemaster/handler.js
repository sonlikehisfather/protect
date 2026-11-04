'use strict';

/**
 * VoiceMaster - reçoit un message commençant par le préfixe "=",
 * résout la commande, vérifie rang / vocal / permissions du bot, puis l'exécute.
 */

const { PREFIX, LEVELS } = require('./config');
const ranks    = require('./ranks');
const messages = require('./messages');
const errorHandler = require('../utils/errorHandler');
const embed        = require('../utils/embed');

/* Toutes les réponses du bot passent par embed.reply : container CV2 (repli embed selon le serveur). */
async function _reply(message, content) {
  return embed.reply(message, content, { timestamp: false });
}

/**
 * @returns {Promise<boolean>} true si le message a été pris en charge par le VoiceMaster.
 */
async function handle(client, message, content) {
  if (!content.startsWith(PREFIX)) return false;

  const body = content.slice(PREFIX.length);
  if (!body.trim() || /^\s/.test(body)) return false;

  const args = body.trim().split(/\s+/);
  const name = args.shift().toLowerCase();

  const command = client.vmCommands?.get(name);
  if (!command) return false;

  const guildId  = message.guild.id;
  const authorId = message.author.id;
  const level    = ranks.getLevel(guildId, authorId);

  /* Aucune commande publique : sans rang, le bot reste silencieux. */
  if (level === LEVELS.NONE) return true;

  if (level < command.minRank) {
    await _reply(message, messages.noRank());
    return true;
  }

  if (command.needsVoice && !message.member.voice?.channel) {
    await _reply(message, messages.needVoice());
    return true;
  }

  const required = command.needsBotPerms ?? [];
  if (required.length) {
    const me = message.guild.members.me;
    const missing = required.find(p => !me?.permissions.has(p));
    if (missing) {
      await _reply(message, messages.botMissing(String(missing)));
      return true;
    }
  }

  try {
    await command.run({
      client,
      message,
      args,
      level,
      reply: text => _reply(message, text),
    });
  } catch (err) {
    errorHandler.handle(err, {
      source  : `voicemaster.${command.name}`,
      guildId,
      userId  : authorId,
    });
    await _reply(message, messages.internal());
  }

  return true;
}

module.exports = { handle };
