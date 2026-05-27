'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'noderank',
    description : 'Gérer les rôles protégés lors d\'un derank.',
    usage       : 'noderank [list|add|del] [@role]',
    aliases     : [],
    multi       : true,
  },

  async run(client, message, args) {
    const guildId  = message.guild.id;
    const authorId = message.author.id;

    if (!perms.isBuyer(authorId) && !perms.isGlobalOwner(authorId)) {
      return embed.replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.");
    }

    const sub = args[0]?.toLowerCase();

    if (!sub || sub === 'list') {
      return _list(message, guildId);
    }

    if (sub === 'add') {
      const raw     = args.slice(1).join(' ');
      const targets = _parseRoles(raw);

      if (!targets.length) {
        return embed.replyError(message, 'Mentionnez au moins un role. Ex: `+noderank add @role1, @role2`');
      }

      let ok = 0;
      let ko = 0;

      for (const t of targets) {
        const role = await _resolveRole(t, message.guild);
        if (!role) { ko++; continue; }

        const existing = db.getNoderankRoles(guildId);
        if (existing.includes(role.id)) { ko++; continue; }

        db.addNoderankRole(guildId, role.id);
        ok++;
      }

      return embed.reply(
        message,
        `**${ok}** rôle(s) ajouté(s) au noderank${ko ? `, **${ko}** invalide(s) ou déjà présent(s)` : ''}.`
      );
    }

    if (sub === 'del') {
      const raw     = args.slice(1).join(' ');
      const targets = _parseRoles(raw);

      if (!targets.length) {
        return embed.replyError(message, 'Mentionnez au moins un role. Ex: `+noderank del @role1, @role2`');
      }

      let ok = 0;
      let ko = 0;

      for (const t of targets) {
        const role = await _resolveRole(t, message.guild);
        if (!role) { ko++; continue; }

        const existing = db.getNoderankRoles(guildId);
        if (!existing.includes(role.id)) { ko++; continue; }

        db.removeNoderankRole(guildId, role.id);
        ok++;
      }

      return embed.reply(
        message,
        `**${ok}** role(s) retire(s) du noderank${ko ? `, **${ko}** invalide(s) ou absent(s)` : ''}.`
      );
    }

    return _list(message, guildId);
  },
};

async function _list(message, guildId) {
  const roleIds = db.getNoderankRoles(guildId);

  const value = roleIds.length
    ? roleIds.map(id => `<@&${id}>`).join(', ')
    : 'Aucun role protege';

  return message.channel.send({
    embeds: [
      embed.build(guildId, null, {
        title  : 'Roles proteges (noderank)',
        fields : [
          { name: 'Roles', value: value.slice(0, 1024), inline: false },
        ],
        timestamp: false,
      }),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

function _parseRoles(raw) {
  if (!raw) return [];
  return raw.split(/,,|,/).map(s => s.trim()).filter(Boolean);
}

async function _resolveRole(raw, guild) {
  const roleMatch = raw.match(/^<@&(\d+)>$/);
  if (roleMatch) {
    const id = roleMatch[1];
    return guild.roles.cache.get(id) ?? await guild.roles.fetch(id).catch(() => null);
  }

  if (/^\d{17,20}$/.test(raw)) {
    return guild.roles.cache.get(raw) ?? await guild.roles.fetch(raw).catch(() => null);
  }

  return null;
}
