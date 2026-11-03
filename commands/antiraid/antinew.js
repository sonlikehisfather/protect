'use strict';

/**
 * Commandes de configuration des nouveaux modules antiraid :
 * antikick, antiroles, antiemoji, antiprune.
 * Format identique aux modules existants : <on|off|max|<nombre>/<durée>>.
 * La punition se règle avec la commande `punish`.
 */

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const { parseDuration } = require('../../utils/parseDuration.js');

function _deleteOptions(guildId) {
  const config = db.getGuildConfig(guildId);
  return {
    deleteCmd   : Boolean(config?.autoDeleteModCmds),
    deleteReply : Boolean(config?.autoDeleteModReplies),
    deleteDelay : config?.autoDeleteDelay ?? 5,
  };
}

async function _send(message, text, del, isError = false) {
  const sent = isError
    ? await embed.replyError(message, text, { timestamp: false }).catch(() => null)
    : await embed.sendEmbed(message.channel, message.guild.id, text, {
        timestamp: false,
        allowedMentions: { repliedUser: false },
      });
  if (sent && del.deleteReply) embed.scheduleDelete(sent, del.deleteDelay);
  return sent;
}

function _parseWindow(raw) {
  const num = Number(raw);
  if (!isNaN(num) && num > 0) return Math.floor(num);
  const parsed = parseDuration(raw, { unit: 's' });
  return parsed && parsed > 0 ? parsed : null;
}

/**
 * @param {object} def { name, label, prefix, description, hasThreshold, maxThreshold, maxWindow, restoreKey, restoreLabel }
 */
function makeModule(def) {
  const {
    name, label, prefix, description,
    hasThreshold = true, maxThreshold = 1, maxWindow = 10,
    restoreKey = null, restoreLabel = null,
  } = def;

  const usage = hasThreshold
    ? `${name} <on|off|max|<nombre>/<durée>>${restoreKey ? ' | restore <on|off>' : ''}`
    : `${name} <on|off|max>`;

  const help = { name, description, usage };

  const run = async (client, message, args) => {
    const guildId = message.guild.id;
    const del     = _deleteOptions(guildId);
    const arg     = args[0]?.toLowerCase();

    if (!perms.check(message, name)) return;
    if (del.deleteCmd) await message.delete().catch(() => {});

    const enabledKey   = `${prefix}Enabled`;
    const thresholdKey = `${prefix}Threshold`;
    const windowKey    = `${prefix}Window`;

    if (arg === 'on' || arg === 'off') {
      const value = arg === 'on' ? 1 : 0;
      if (value) db.setGuildConfig(guildId, 'antiraidEnabled', 1);
      db.setAntiraidConfig(guildId, enabledKey, value);
      return _send(message, `${label} ${value ? 'activé' : 'désactivé'}.`, del);
    }

    if (arg === 'max') {
      db.setGuildConfig(guildId, 'antiraidEnabled', 1);
      db.setAntiraidConfig(guildId, enabledKey, 1);
      if (hasThreshold) {
        db.setAntiraidConfig(guildId, thresholdKey, maxThreshold);
        db.setAntiraidConfig(guildId, windowKey, maxWindow);
      }
      return _send(message, `${label} activé en mode maximal.`, del);
    }

    if (restoreKey && arg === 'restore') {
      const v = args[1]?.toLowerCase();
      if (v !== 'on' && v !== 'off') {
        return _send(message, `Utilisation : \`${name} restore <on|off>\``, del, true);
      }
      db.setAntiraidConfig(guildId, restoreKey, v === 'on' ? 1 : 0);
      return _send(message, `${restoreLabel} : **${v === 'on' ? 'activé' : 'désactivé'}**.`, del);
    }

    const match = hasThreshold ? arg?.match(/^(\d+)\/(.+)$/) : null;
    if (match) {
      const threshold = parseInt(match[1], 10);
      const window    = _parseWindow(match[2]);

      if (isNaN(threshold) || threshold < 1) {
        return _send(message, 'Le nombre d’actions doit être supérieur ou égal à **1**.', del, true);
      }
      if (!window || window < 1) {
        return _send(message, 'La durée doit être supérieure ou égale à **1** seconde.', del, true);
      }

      db.setAntiraidConfig(guildId, thresholdKey, threshold);
      db.setAntiraidConfig(guildId, windowKey, window);
      return _send(message, `${label} configuré : **${threshold}** en **${window}** secondes.`, del);
    }

    const cfg = db.getAntiraidConfig(guildId);
    const status = cfg[enabledKey] ? 'Activé' : 'Désactivé';
    let line = `${label} : **${status}**`;
    if (hasThreshold) line += ` - **${cfg[thresholdKey]}** action(s) en **${cfg[windowKey]}** secondes`;
    line += ` - punition **${cfg[`${prefix}Punish`]}**`;
    if (restoreKey) line += `\n${restoreLabel} : **${cfg[restoreKey] ? 'activé' : 'désactivé'}**`;
    return _send(message, line, del);
  };

  return { help, run };
}

const antikick  = makeModule({
  name: 'antikick', label: 'Antikick', prefix: 'antikick',
  description: 'Sanctionner les kicks en masse.',
});

const antiroles = makeModule({
  name: 'antiroles', label: 'Antiroles', prefix: 'antiroles',
  description: 'Sanctionner la création, suppression et modification (permissions) abusives de rôles.',
  restoreKey: 'antirolesRestore',
  restoreLabel: 'Restauration des rôles (recréer / supprimer / remettre les permissions)',
});

const antiemoji = makeModule({
  name: 'antiemoji', label: 'Antiemoji', prefix: 'antiemoji',
  description: 'Sanctionner la création et suppression abusives d’emojis.',
});

const antiprune = makeModule({
  name: 'antiprune', label: 'Antiprune', prefix: 'antiprune',
  description: 'Sanctionner un prune de membres.',
  hasThreshold: false,
});

const antichanneledit = makeModule({
  name: 'antichanneledit', label: 'Antichanneledit', prefix: 'antichanneledit',
  description: 'Sanctionner les modifications abusives de salons (permissions, nom).',
  restoreKey: 'antichanneleditRestore',
  restoreLabel: 'Restauration des salons modifiés (permissions et nom)',
});

const antieveryoneperm = makeModule({
  name: 'antieveryoneperm', label: 'Antieveryoneperm', prefix: 'antieveryperm',
  description: 'Sanctionner l’ajout de permissions dangereuses au rôle @everyone (immédiat).',
  hasThreshold: false,
  restoreKey: 'antieverypermRestore',
  restoreLabel: 'Restauration des permissions @everyone',
});

const antimassdelete = makeModule({
  name: 'antimassdelete', label: 'Antimassdelete', prefix: 'antimassdelete',
  description: 'Sanctionner la suppression de messages en masse par un membre.',
  maxThreshold: 10, maxWindow: 10,
});

const antithread = makeModule({
  name: 'antithread', label: 'Antithread', prefix: 'antithread',
  description: 'Sanctionner la création de fils en rafale.',
  restoreKey: 'antithreadRestore',
  restoreLabel: 'Suppression des fils créés pendant la rafale',
});

const antiinvite = makeModule({
  name: 'antiinvite', label: 'Antiinvite', prefix: 'antiinvite',
  description: 'Sanctionner la création d’invitations en rafale.',
  restoreKey: 'antiinviteRestore',
  restoreLabel: 'Suppression des invitations créées pendant la rafale',
});

exports.antikickHelp  = antikick.help;   exports.antikickRun  = antikick.run;
exports.antirolesHelp = antiroles.help;  exports.antirolesRun = antiroles.run;
exports.antiemojiHelp = antiemoji.help;  exports.antiemojiRun = antiemoji.run;
exports.antipruneHelp = antiprune.help;  exports.antipruneRun = antiprune.run;
exports.antichanneleditHelp  = antichanneledit.help;  exports.antichanneleditRun  = antichanneledit.run;
exports.antieverypermHelp    = antieveryoneperm.help; exports.antieverypermRun    = antieveryoneperm.run;
exports.antithreadHelp = antithread.help; exports.antithreadRun = antithread.run;
exports.antiinviteHelp = antiinvite.help; exports.antiinviteRun = antiinvite.run;
exports.antimassdeleteHelp   = antimassdelete.help;   exports.antimassdeleteRun   = antimassdelete.run;
