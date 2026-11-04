'use strict';

/**
 * VoiceMaster - résolution d'une cible (mention ou ID) en membre du serveur.
 */

async function resolveMember(message, raw) {
  const cleaned = String(raw ?? '').replace(/[<@!>]/g, '').trim();
  if (!/^\d{17,20}$/.test(cleaned)) return null;

  const guild = message.guild;
  return guild.members.cache.get(cleaned)
    ?? await guild.members.fetch(cleaned).catch(() => null);
}

module.exports = { resolveMember };
