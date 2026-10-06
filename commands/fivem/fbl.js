'use strict';

const { PermissionsBitField } = require('discord.js');

const {
  canUseFivem,
  getDeletePolicy,
  getModuleConfig,
  extractUserId,
  reply,
  replyError,
} = require('./_shared');

module.exports = {
  help: {
    name        : 'fbl',
    description : 'Retire les roles du membre puis applique les roles blacklist FiveM.',
    usage       : 'fbl <@membre|id>',
    aliases     : [],
    category    : 'fivem',
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
    if (!targetId) return replyError(message, 'Utilisation : `fbl <@membre|id>`', module.exports.help.name);

    const target = await guild.members.fetch(targetId).catch(() => null);
    if (!target) return replyError(message, 'Membre introuvable.', module.exports.help.name);

    const cfg = getModuleConfig(guildId);
    if (!cfg.blacklistRoleId) {
      return replyError(message, 'Role blacklist non configure. Definis-le dans fconfig page principale.', module.exports.help.name);
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return replyError(message, "Je n'ai pas la permission de gerer les roles.", module.exports.help.name);
    }

    let removed = 0;
    let added = 0;

    const removable = target.roles.cache.filter(role =>
      role.id !== guild.id &&
      !role.managed &&
      role.position < me.roles.highest.position
    );

    for (const role of removable.values()) {
      await target.roles.remove(role.id, `FBL by ${message.author.tag}`).then(() => { removed++; }).catch(() => {});
    }

    const applyRoles = [...new Set([cfg.blacklistRoleId, ...cfg.fblRoles])];

    for (const roleId of applyRoles) {
      const role = guild.roles.cache.get(roleId);
      if (!role || role.managed || role.position >= me.roles.highest.position) continue;
      if (target.roles.cache.has(roleId)) continue;
      await target.roles.add(roleId, `FBL by ${message.author.tag}`).then(() => { added++; }).catch(() => {});
    }

    return reply(
      message,
      `FBL applique sur <@${target.id}>.\nRoles retires: **${removed}**\nRoles ajoutes: **${added}**`,
      { timestamp: false },
      module.exports.help.name
    );
  },
};
