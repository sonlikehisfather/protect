'use strict';


const { PermissionsBitField } = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const MAX_AUTOROLES = 20;

module.exports = {
  help: {
    name        : 'autorole',
    description : 'Configure les rôles automatiques à l\'arrivée.',
    use         : 'autorole <add/remove/list/clear/clean> [@role|id|nom]',
    usage       : 'autorole <add/remove/list/clear/clean> [@role|id|nom]',
    aliases     : ['joinrole', 'ar'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const action = (args[0] || 'list').toLowerCase();

    if (['list', 'show', 'status'].includes(action)) {
      return _listAutoroles(message, guildId, deleteReply, deleteDelay);
    }

    if (['add', 'set'].includes(action)) {
      const query = args.slice(1).join(' ').trim();

      if (!query) {
        return _replyError(
          message,
          `Utilisation : \`${message.prefix || '+'}autorole add @role\``,
          deleteReply,
          deleteDelay
        );
      }

      const role = await _resolveRole(guild, query);

      if (!role) {
        return _replyError(message, 'Rôle introuvable.', deleteReply, deleteDelay);
      }

      const roleError = await _validateRole(guild, role);

      if (roleError) {
        return _replyError(message, roleError, deleteReply, deleteDelay);
      }

      const autoroles = db.getAutoroles(guildId);

      if (autoroles.includes(role.id)) {
        return _replyError(message, 'Ce rôle est déjà configuré en autorole.', deleteReply, deleteDelay);
      }

      if (autoroles.length >= MAX_AUTOROLES) {
        return _replyError(
          message,
          `Vous ne pouvez pas configurer plus de ${MAX_AUTOROLES} autoroles.`,
          deleteReply,
          deleteDelay
        );
      }

      db.addAutorole(guildId, role.id);

      return _reply(
        message,
        `Autorole ajouté : <@&${role.id}>.`,
        deleteReply,
        deleteDelay
      );
    }

    if (['remove', 'del', 'delete', 'rm'].includes(action)) {
      const query = args.slice(1).join(' ').trim();

      if (!query) {
        return _replyError(
          message,
          `Utilisation : \`${message.prefix || '+'}autorole remove @role\``,
          deleteReply,
          deleteDelay
        );
      }

      const role = await _resolveRole(guild, query);

      if (!role) {
        return _replyError(message, 'Rôle introuvable.', deleteReply, deleteDelay);
      }

      const autoroles = db.getAutoroles(guildId);

      if (!autoroles.includes(role.id)) {
        return _replyError(message, 'Ce rôle n\'est pas configuré en autorole.', deleteReply, deleteDelay);
      }

      db.removeAutorole(guildId, role.id);

      return _reply(
        message,
        `Autorole retiré : <@&${role.id}>.`,
        deleteReply,
        deleteDelay
      );
    }

    if (['clear', 'reset'].includes(action)) {
      const count = db.getAutoroles(guildId).length;

      if (!count) {
        return _replyError(message, 'Aucun autorole configuré.', deleteReply, deleteDelay);
      }

      db.clearAutoroles(guildId);

      return _reply(
        message,
        `Tous les autoroles ont été supprimés. Total retiré : \`${count}\`.`,
        deleteReply,
        deleteDelay
      );
    }

    if (['clean', 'cleanup'].includes(action)) {
      const roleIds = db.getAutoroles(guildId);
      let removed = 0;

      for (const roleId of roleIds) {
        const role = guild.roles.cache.get(roleId)
          ?? await guild.roles.fetch(roleId).catch(() => null);

        if (!role) {
          db.removeAutorole(guildId, roleId);
          removed++;
        }
      }

      return _reply(
        message,
        removed
          ? `Autoroles nettoyés. Rôles introuvables supprimés : \`${removed}\`.`
          : 'Aucun autorole à nettoyer.',
        deleteReply,
        deleteDelay
      );
    }

    return _replyError(
      message,
      `Action invalide. Utilisation : \`${message.prefix || '+'}autorole <add/remove/list/clear/clean>\``,
      deleteReply,
      deleteDelay
    );
  },
};

async function _listAutoroles(message, guildId, deleteReply, deleteDelay) {
  const roleIds = db.getAutoroles(guildId);

  if (!roleIds.length) {
    return _reply(
      message,
      'Aucun autorole configuré.',
      deleteReply,
      deleteDelay
    );
  }

  const lines = roleIds.map((roleId, index) => {
    const role = message.guild.roles.cache.get(roleId);

    if (!role) {
      return `\`${index + 1}.\` Rôle introuvable - \`${roleId}\``;
    }

    return `\`${index + 1}.\` <@&${role.id}>`;
  });

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        lines.join('\n'),
        {
          title    : 'Autoroles',
          timestamp: false,
        }
      ),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _resolveRole(guild, query) {
  if (!query) return null;

  const raw = String(query).trim();
  const mention = raw.match(/^<@&(\d{17,20})>$/);
  const id = mention?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);

  if (id) {
    return guild.roles.cache.get(id)
      ?? await guild.roles.fetch(id).catch(() => null);
  }

  const normalized = _normalizeName(raw);

  return guild.roles.cache.find(role =>
    _normalizeName(role.name) === normalized
  ) ?? null;
}

async function _validateRole(guild, role) {
  if (!role || role.id === guild.id) {
    return 'Rôle invalide.';
  }

  if (role.managed) {
    return 'Ce rôle est géré par une intégration et ne peut pas être utilisé.';
  }

  const me = guild.members.me
    ?? await guild.members.fetchMe().catch(() => null);

  if (!me) {
    return 'Impossible de vérifier mes permissions.';
  }

  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return 'Je n\'ai pas la permission de gérer les rôles.';
  }

  if (role.position >= me.roles.highest.position) {
    return 'Ce rôle est au-dessus ou au même niveau que mon rôle le plus haut.';
  }

  return null;
}

async function _reply(message, content, deleteReply, deleteDelay) {
  const sent = await embed.reply(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _replyError(message, content, deleteReply, deleteDelay) {
  const sent = await embed.replyError(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

function _normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}
