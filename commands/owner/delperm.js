'use strict';

const permsCmd = require('./perms');
const db       = require('../../core/database');
const embed    = require('../../utils/embed');
const perms    = require('../../utils/permissions');

exports.help = {
  name        : 'delperm',
  description : 'Retire une perm d\'un rôle/membre, ou révoque l\'accès à une commande.',
  use         : 'delperm <1-9|commande> <@role|@membre>, ...',
  usage       : 'delperm <1-9|commande> <@role|@membre>, ...',
  aliases     : ['del perm'],
  category    : 'owner',
  multi       : true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const prefix  = message.prefix || '+';

  if (!args[0] || !args[1]) {
    return embed.replyError(
      message,
      `Utilisation : \`${prefix}delperm <1-9|commande> <@role|@membre>\``
    );
  }

  const first = args[0].toLowerCase();

  if (/^[1-9]$/.test(first) || /^perm[1-9]$/.test(first)) {
    return permsCmd.handleDel(
      message,
      guildId,
      first,
      args.slice(1).join(' '),
      `${prefix}delperm <1-9> <@role|@membre>, <@autre>, ...`,
    );
  }

  const cmdName = first.replace(/^\+/, '');
  if (!client.commands.has(cmdName)) {
    return embed.replyError(message, `Commande \`${cmdName}\` introuvable.`);
  }

  if (!perms.isBuyer(message.author.id) && !perms.isOwner(guildId, message.author.id)) {
    return embed.replyError(message, 'Permission refusée.');
  }

  const targetRaw = args.slice(1).join(' ').trim();
  const target    = await _resolveTarget(targetRaw, message);
  if (!target) {
    return embed.replyError(message, 'Cible introuvable. Mentionnez un rôle ou un membre.');
  }

  db.removeCmdTarget(guildId, cmdName, target.id);

  return embed.reply(
    message,
    `**${target.label}** n'a plus accès à \`${prefix}${cmdName}\`.`
  );
};

async function _resolveTarget(raw, message) {
  const guild = message.guild;

  const memberMatch = raw.match(/^<@!?(\d+)>$/);
  if (memberMatch) {
    const m = guild.members.cache.get(memberMatch[1]) ?? await guild.members.fetch(memberMatch[1]).catch(() => null);
    return m ? { id: m.id, type: 'user', label: m.user.username } : null;
  }

  const roleMatch = raw.match(/^<@&(\d+)>$/);
  if (roleMatch) {
    const r = guild.roles.cache.get(roleMatch[1]) ?? await guild.roles.fetch(roleMatch[1]).catch(() => null);
    return r ? { id: r.id, type: 'role', label: `@${r.name}` } : null;
  }

  if (/^\d{17,20}$/.test(raw)) {
    const r = guild.roles.cache.get(raw);
    if (r) return { id: r.id, type: 'role', label: `@${r.name}` };
    const m = guild.members.cache.get(raw) ?? await guild.members.fetch(raw).catch(() => null);
    if (m) return { id: m.id, type: 'user', label: m.user.username };
  }

  return null;
}
