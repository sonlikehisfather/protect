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
    name        : 'unkp',
    description : 'Restaure les roles retires par un KP.',
    usage       : 'unkp <@membre|id>',
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
    if (!targetId) return replyError(message, 'Utilisation : `unkp <@membre|id>`', module.exports.help.name);

    const backup = db.getFivemRoleBackup(guildId, targetId, 'kp');
    if (!backup) return replyError(message, `Aucune sauvegarde KP pour <@${targetId}>.`, module.exports.help.name);

    const target = await guild.members.fetch(targetId).catch(() => null);
    if (!target) {
      return replyError(message, 'Membre introuvable sur le serveur (la sauvegarde est conservee).', module.exports.help.name);
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return replyError(message, "Je n'ai pas la permission de gerer les roles.", module.exports.help.name);
    }

    // Ne pas restaurer des rôles blacklist si le membre est en FBL.
    const cfg = getModuleConfig(guildId);
    const fblRoleIds = new Set([cfg.blacklistRoleId, ...cfg.fblRoles].filter(Boolean));
    if ([...fblRoleIds].some(id => target.roles.cache.has(id))) {
      return replyError(message, 'Ce membre est blacklist FiveM : utilise `unfbl` d\'abord.', module.exports.help.name);
    }

    let restored = 0;
    let skipped = 0;

    const ceiling = authorCeiling(message);

    for (const roleId of backup.roles) {
      const role = guild.roles.cache.get(roleId);
      if (!role || role.managed || role.position >= me.roles.highest.position || role.position >= ceiling) { skipped++; continue; }
      if (target.roles.cache.has(roleId)) continue;
      await target.roles.add(roleId, `UNKP by ${message.author.tag}`)
        .then(() => { restored++; })
        .catch(() => { skipped++; });
    }

    db.deleteFivemRoleBackup(guildId, targetId, 'kp');

    await logAction(message, 'UNKP', [
      { name: 'Membre', value: `<@${target.id}> (${target.id})`, inline: false },
      { name: 'Roles restaures', value: `${restored}`, inline: true },
      { name: 'Ignores', value: `${skipped}`, inline: true },
    ]);

    return reply(
      message,
      `UNKP termine pour <@${target.id}>.\nRoles restaures: **${restored}**\nIgnores: **${skipped}**`,
      { timestamp: false },
      module.exports.help.name
    );
  },
};
