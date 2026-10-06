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
    name        : 'kp',
    description : 'Derank total: retire tous les roles du membre sauf le role conserve KP.',
    usage       : 'kp <@membre|id>',
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
    if (!targetId) return replyError(message, 'Utilisation : `kp <@membre|id>`', module.exports.help.name);

    const target = await guild.members.fetch(targetId).catch(() => null);
    if (!target) return replyError(message, 'Membre introuvable.', module.exports.help.name);

    const cfg = getModuleConfig(guildId);

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return replyError(message, "Je n'ai pas la permission de gerer les roles.", module.exports.help.name);
    }

    const keepRoleId = cfg.kpKeepRoleId;
    const removable = target.roles.cache.filter(role =>
      role.id !== guild.id &&
      role.id !== keepRoleId &&
      !role.managed &&
      role.position < me.roles.highest.position
    );

    let removed = 0;
    let skipped = 0;

    for (const role of removable.values()) {
      await target.roles.remove(role.id, `KP by ${message.author.tag}`).then(() => { removed++; }).catch(() => { skipped++; });
    }

    const keepText = keepRoleId
      ? (guild.roles.cache.has(keepRoleId) ? `<@&${keepRoleId}>` : '`Role conserve introuvable`')
      : '`Aucun role conserve`';

    return reply(
      message,
      `KP termine pour <@${target.id}>.\nRoles retires: **${removed}**\nEchecs: **${skipped}**\nRole conserve: ${keepText}`,
      { timestamp: false },
      module.exports.help.name
    );
  },
};
