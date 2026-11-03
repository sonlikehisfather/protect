'use strict';

const { PermissionsBitField } = require('discord.js');

const db = require('../../core/database');
const {
  canUseFivem,
  checkTargetAllowed,
  getDeletePolicy,
  getModuleConfig,
  extractUserId,
  logAction,
  reply,
  replyError,
} = require('./_shared');

module.exports = {
  help: {
    name        : 'fbl',
    description : 'Sans argument : liste des FBL. Avec un membre : retire ses roles puis applique les roles blacklist FiveM (sauvegarde pour unfbl).',
    usage       : 'fbl [@membre|id]',
    aliases     : ['fbls', 'fbllist'],
    category    : 'fivem',
    selfManaged : true,
  },

  async run(client, message, args) {
    const guild = message.guild;
    const guildId = guild.id;

    if (!canUseFivem(message, module.exports.help.name)) {
      return replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.", module.exports.help.name);
    }

    const del = getDeletePolicy(guildId);
    if (del.deleteCmd) await message.delete().catch(() => {});

    if (!args[0]) return _showList(message);

    const targetId = extractUserId(message, args[0]);
    if (!targetId) return replyError(message, 'Utilisation : `fbl [@membre|id]`', module.exports.help.name);

    const target = await guild.members.fetch(targetId).catch(() => null);
    if (!target) return replyError(message, 'Membre introuvable.', module.exports.help.name);

    const denied = checkTargetAllowed(message, target);
    if (denied) return replyError(message, denied, module.exports.help.name);

    const cfg = getModuleConfig(guildId);
    if (!cfg.blacklistRoleId) {
      return replyError(message, 'Role blacklist non configure. Definis-le dans fconfig page principale.', module.exports.help.name);
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return replyError(message, "Je n'ai pas la permission de gerer les roles.", module.exports.help.name);
    }

    const applyRoles = [...new Set([cfg.blacklistRoleId, ...cfg.fblRoles])];

    let removed = 0;
    let added = 0;
    const removedIds = [];

    const removable = target.roles.cache.filter(role =>
      role.id !== guild.id &&
      !role.managed &&
      !applyRoles.includes(role.id) &&
      role.position < me.roles.highest.position
    );

    for (const role of removable.values()) {
      await target.roles.remove(role.id, `FBL by ${message.author.tag}`)
        .then(() => { removed++; removedIds.push(role.id); })
        .catch(() => {});
    }

    if (removedIds.length) {
      try { db.saveFivemRoleBackup(guildId, target.id, 'fbl', removedIds, message.author.id); } catch {}
    } else if (!db.getFivemRoleBackup(guildId, target.id, 'fbl')) {
      // Même sans rôle retiré, on enregistre le membre dans la liste FBL.
      try { db.saveFivemRoleBackup(guildId, target.id, 'fbl', [], message.author.id); } catch {}
    }

    for (const roleId of applyRoles) {
      const role = guild.roles.cache.get(roleId);
      if (!role || role.managed || role.position >= me.roles.highest.position) continue;
      if (target.roles.cache.has(roleId)) continue;
      await target.roles.add(roleId, `FBL by ${message.author.tag}`).then(() => { added++; }).catch(() => {});
    }

    await logAction(message, 'FBL', [
      { name: 'Membre', value: `<@${target.id}> (${target.id})`, inline: false },
      { name: 'Roles retires', value: `${removed}`, inline: true },
      { name: 'Roles ajoutes', value: `${added}`, inline: true },
    ]);

    return reply(
      message,
      `FBL applique sur <@${target.id}>.\nRoles retires: **${removed}**\nRoles ajoutes: **${added}**\nUtilise \`unfbl\` pour annuler.`,
      { timestamp: false },
      module.exports.help.name
    );
  },
};

async function _showList(message) {
  const rows = db.listFivemRoleBackups(message.guild.id, 'fbl');
  if (!rows.length) {
    return reply(message, 'Aucun membre en FBL.', { timestamp: false }, module.exports.help.name);
  }

  const lines = rows.slice(0, 40).map((row, i) =>
    `**${i + 1}.** <@${row.userId}> \`${row.userId}\` ・ par <@${row.createdBy}> ・ <t:${row.createdAt}:d>`
  );
  if (rows.length > 40) lines.push(`... et ${rows.length - 40} autre(s)`);

  return reply(message, lines.join('\n'), {
    title     : `FBL (${rows.length})`,
    timestamp : false,
    allowedMentions: { parse: [] },
  }, module.exports.help.name);
}
