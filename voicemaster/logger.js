'use strict';

/**
 * VoiceMaster - envoi des logs en container CV2.
 *
 * Mise en page commune à tous les types :
 *   ### TYPE · Action
 *   **Libellé** › valeur
 *   ...
 *   ────────────
 *   -# date complète
 *
 * Un log ne doit jamais faire échouer la commande qui l'émet : toute erreur est absorbée.
 */

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');

const store = require('./store');

const MAX_VALUE_LENGTH = 500;

/** Mention d'un membre suivie de son ID. */
function user(id) {
  return id ? `<@${id}> · \`${id}\`` : 'Inconnu';
}

/** Mention d'un salon suivie de son ID. */
function channel(id) {
  return id ? `<#${id}> · \`${id}\`` : 'Aucun';
}

/** Texte libre tronqué (messages privés, etc.). */
function text(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Vide';
  return raw.length > MAX_VALUE_LENGTH ? `${raw.slice(0, MAX_VALUE_LENGTH - 1)}…` : raw;
}

/** Durée en secondes avec une décimale, par exemple "2.7 s". */
function duration(ms) {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} type      identifiant de log (sys, pv, acces, ...)
 * @param {{ title: string, fields: Array<[string, string]> }} entry
 */
async function send(guild, type, { title, fields }) {
  try {
    const entry = store.getLogEntry(guild.id, type);
    if (!entry?.enabled || !entry.channelId) return null;

    const target = guild.channels.cache.get(entry.channelId)
      ?? await guild.channels.fetch(entry.channelId).catch(() => null);
    if (!target?.isTextBased?.()) return null;

    const lines = fields.map(([label, value]) => `**${label}** › ${value}`);
    const stamp = Math.floor(Date.now() / 1000);

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${title}\n${lines.join('\n')}`.slice(0, 3900))
    );
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# <t:${stamp}:F>`));

    return await target.send({
      components      : [container],
      flags           : MessageFlags.IsComponentsV2,
      allowedMentions : { parse: [] },
    }).catch(() => null);
  } catch {
    return null;
  }
}

module.exports = { send, user, channel, text, duration };
