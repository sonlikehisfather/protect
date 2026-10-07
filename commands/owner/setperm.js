'use strict';

const permsCmd = require('./perms');
const db       = require('../../core/database');
const embed    = require('../../utils/embed');
const perms    = require('../../utils/permissions');
const { getCommandPermissionGroup } = require('../../utils/commandPermissionGroups');

exports.help = {
  name        : 'setperm',
  description : 'Assigne une perm à un rôle/membre, ou donne accès à une commande directement.',
  use         : 'setperm <1-9|commande> <@role|@membre>, ...',
  usage       : 'setperm <1-9|commande> <@role|@membre>, ...',
  aliases     : ['set perm'],
  category    : 'owner',
  multi       : true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const prefix  = message.prefix || '+';

  if (!args[0] || !args[1]) {
    return embed.replyError(
      message,
      `Utilisation : \`${prefix}setperm <1-9|commande> <@role|@membre>\``
    );
  }

  const first = args[0].toLowerCase();

  if (/^[1-9]$/.test(first) || /^perm[1-9]$/.test(first)) {
    return permsCmd.handleSet(
      message,
      guildId,
      first,
      args.slice(1).join(' '),
      `${prefix}setperm <1-9> <@role|@membre>, <@autre>, ...`,
    );
  }

  const cmdName = first.replace(/^\+/, '');
  const configuredCmdName = client.commands?.get?.(cmdName)?.help?.name?.toLowerCase() || cmdName;
  // Allow assigning targets to command-like names that may not be
  // registered as top-level commands (eg. ticket sub-actions like "close").
  // Previously we rejected unknown command names with client.commands.has,
  // preventing permissions for internal actions. We keep the name as-is.

  if (!perms.isBuyer(message.author.id) && !perms.isOwner(guildId, message.author.id)) {
    return embed.replyError(message, 'Permission refusée.');
  }

  const targetRaw = args.slice(1).join(' ').trim();
  const target    = await _resolveTarget(targetRaw, message);
  if (!target) {
    return embed.replyError(message, 'Cible introuvable. Mentionnez un rôle ou un membre.');
  }

  const grantedCommands = getCommandPermissionGroup(configuredCmdName);
  for (const commandName of grantedCommands) {
    db.addCmdTarget(guildId, commandName, target.id, target.type);
  }

  return embed.reply(
    message,
    `**${target.label}** peut maintenant utiliser ${grantedCommands.map(name => `\`${prefix}${name}\``).join(', ')}.`
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
