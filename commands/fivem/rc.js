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
    name        : 'rc',
    description : 'Attribue les roles RC configures (refuse si membre blacklist FiveM).',
    usage       : 'rc <@membre|id>',
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
    if (!targetId) return replyError(message, 'Utilisation : `rc <@membre|id>`', module.exports.help.name);

    const target = await guild.members.fetch(targetId).catch(() => null);
    if (!target) return replyError(message, 'Membre introuvable.', module.exports.help.name);

    const cfg = getModuleConfig(guildId);
    if (!cfg.rcRoles.length) {
      return replyError(message, 'Aucun role RC configure. Utilisez `fconfig rc <@roles...>`.', module.exports.help.name);
    }

    const fblRoleIds = [...new Set([cfg.blacklistRoleId, ...(cfg.fblRoles || [])].filter(Boolean))];
    if (fblRoleIds.some(roleId => target.roles.cache.has(roleId))) {
      return replyError(message, 'Impossible de RC ce membre tant qu\'il est blacklist FiveM.', module.exports.help.name);
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return replyError(message, "Je n'ai pas la permission de gerer les roles.", module.exports.help.name);
    }

    let added = 0;
    let skipped = 0;

    for (const roleId of cfg.rcRoles) {
      const role = guild.roles.cache.get(roleId);
      if (!role || role.managed || role.position >= me.roles.highest.position) {
        skipped++;
        continue;
      }
      if (target.roles.cache.has(roleId)) {
        skipped++;
        continue;
      }
      await target.roles.add(roleId, `RC by ${message.author.tag}`).then(() => { added++; }).catch(() => { skipped++; });
    }

    return reply(
      message,
      `RC termine pour <@${target.id}>.\nRoles ajoutes: **${added}**\nIgnores: **${skipped}**`,
      { timestamp: false },
      module.exports.help.name
    );
  },
};
