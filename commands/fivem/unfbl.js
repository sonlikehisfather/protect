'use strict';

const { PermissionsBitField } = require('discord.js');

const db = require('../../core/database');
const {
  canUseFivem,
  authorCeiling,
  getDeletePolicy,
  getModuleConfig,
  extractUserId,
  logAction,
  reply,
  replyError,
} = require('./_shared');

module.exports = {
  help: {
    name        : 'unfbl',
    description : 'Annule un FBL : retire les roles blacklist et restaure les anciens roles.',
    usage       : 'unfbl <@membre|id>',
    aliases     : [],
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

    const targetId = extractUserId(message, args[0] || '');
    if (!targetId) return replyError(message, 'Utilisation : `unfbl <@membre|id>`', module.exports.help.name);

    const backup = db.getFivemRoleBackup(guildId, targetId, 'fbl');
    if (!backup) return replyError(message, `<@${targetId}> n'est pas dans la liste FBL.`, module.exports.help.name);

    const target = await guild.members.fetch(targetId).catch(() => null);
    if (!target) {
      return replyError(message, 'Membre introuvable sur le serveur (la sauvegarde est conservee).', module.exports.help.name);
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return replyError(message, "Je n'ai pas la permission de gerer les roles.", module.exports.help.name);
    }

    const cfg = getModuleConfig(guildId);
    const fblRoleIds = [...new Set([cfg.blacklistRoleId, ...cfg.fblRoles].filter(Boolean))];

    let removed = 0;
    let restored = 0;
    let skipped = 0;

    for (const roleId of fblRoleIds) {
      const role = guild.roles.cache.get(roleId);
      if (!role || !target.roles.cache.has(roleId) || role.position >= me.roles.highest.position) continue;
      await target.roles.remove(roleId, `UNFBL by ${message.author.tag}`).then(() => { removed++; }).catch(() => {});
    }

    const ceiling = authorCeiling(message);

    for (const roleId of backup.roles) {
      const role = guild.roles.cache.get(roleId);
      if (!role || role.managed || role.position >= me.roles.highest.position || role.position >= ceiling) { skipped++; continue; }
      if (target.roles.cache.has(roleId)) continue;
      await target.roles.add(roleId, `UNFBL by ${message.author.tag}`)
        .then(() => { restored++; })
        .catch(() => { skipped++; });
    }

    db.deleteFivemRoleBackup(guildId, targetId, 'fbl');

    await logAction(message, 'UNFBL', [
      { name: 'Membre', value: `<@${target.id}> (${target.id})`, inline: false },
      { name: 'Roles FBL retires', value: `${removed}`, inline: true },
      { name: 'Roles restaures', value: `${restored}`, inline: true },
      { name: 'Ignores', value: `${skipped}`, inline: true },
    ]);

    return reply(
      message,
      `UNFBL termine pour <@${target.id}>.\nRoles FBL retires: **${removed}**\nRoles restaures: **${restored}**\nIgnores: **${skipped}**`,
      { timestamp: false },
      module.exports.help.name
    );
  },
};
