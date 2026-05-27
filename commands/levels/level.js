'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'level',
  description: 'Configurer le système de niveaux.',
  use        : 'level <on|off|status|reset|resetall|channel|message|role|removerole>',
  aliases    : ['levels', 'lvlconfig'],
  category   : 'levels',
};

exports.run = async (client, message, args) => {

  const guildId = message.guild.id;
  const sub     = args[0]?.toLowerCase();

  if (!sub) return _sendHelp(message);

  if (!perms.check(message, 'owner')) {
    return embed.replyError(
      message,
      'Permission refusée.'
    );
  }

  const config = db.getGuildConfig(guildId);

  switch (sub) {


    case 'on': {

      if (config.levelEnabled) {
        return embed.reply(
          message,
          'Le système de niveaux est déjà activé.'
        );
      }

      db.setGuildConfig(
        guildId,
        'levelEnabled',
        1
      );

      return embed.reply(
        message,
        'Le système de niveaux est maintenant activé.'
      );
    }


    case 'off': {

      if (!config.levelEnabled) {
        return embed.reply(
          message,
          'Le système de niveaux est déjà désactivé.'
        );
      }

      db.setGuildConfig(
        guildId,
        'levelEnabled',
        0
      );

      return embed.reply(
        message,
        'Le système de niveaux est maintenant désactivé.'
      );
    }


    case 'status': {

      const state =
        config.levelEnabled
          ? 'activé'
          : 'désactivé';

      return embed.reply(
        message,
        `Le système de niveaux est actuellement ${state}.`
      );
    }


    case 'reset': {

      const member =
        message.mentions.members.first();

      if (!member) {
        return embed.replyError(
          message,
          'Mentionnez un membre.'
        );
      }

      db.resetLevelUser(
        guildId,
        member.id
      );

      return embed.reply(
        message,
        `Les niveaux de <@${member.id}> ont été réinitialisés.`
      );
    }


    case 'resetall': {

      if (args[1]?.toLowerCase() !== 'confirm') {
        return embed.replyError(
          message,
          'Confirmez avec `level resetall confirm`.'
        );
      }

      db.resetLevelsGuild(guildId);

      return embed.reply(
        message,
        'Tous les niveaux ont été réinitialisés.'
      );
    }


    case 'channel': {

      const channel =
        message.mentions.channels.first();

      if (!channel) {
        return embed.replyError(
          message,
          'Mentionnez un salon.'
        );
      }

      db.setGuildConfig(
        guildId,
        'levelUpChannel',
        channel.id
      );

      return embed.reply(
        message,
        `Salon des niveaux défini sur <#${channel.id}>.`
      );
    }


    case 'message': {

      const text = args.slice(1).join(' ');

      if (!text) {
        return embed.replyError(
          message,
          'Spécifiez un message.'
        );
      }

      db.setGuildConfig(
        guildId,
        'levelUpMessage',
        text
      );

      return embed.reply(
        message,
        'Message de niveau mis à jour.'
      );
    }


    case 'removerole': {

      const lvl = parseInt(args[1], 10);

      if (isNaN(lvl) || lvl < 1) {
        return embed.replyError(
          message,
          'Utilisation : `level removerole <niveau> [@rôle ou ID]`'
        );
      }

      const configured = db.getLevelRoles(guildId)
        .filter(r => r.level === lvl);

      if (!configured.length) {
        return embed.replyError(
          message,
          `Aucun rôle configuré pour le niveau ${lvl}.`
        );
      }


      if (configured.length === 1 && !args[2]) {
        db.removeLevelRole(guildId, lvl, configured[0].roleId);
        return embed.reply(
          message,
          `Rôle <@&${configured[0].roleId}> retiré du niveau ${lvl}.`
        );
      }


      if (!args[2]) {
        const list = configured
          .map(r => `• <@&${r.roleId}> (\`${r.roleId}\`)`)
          .join('\n');
        return embed.replyError(
          message,
          `Plusieurs rôles configurés pour le niveau ${lvl}. Précisez lequel :\n${list}\n\nUtilisation : \`level removerole ${lvl} <@rôle ou ID>\``
        );
      }


      const raw = args.slice(2).join(' ');
      const mentionId = raw.match(/^<@&(\d{17,20})>$/)?.[1];
      const plainId   = /^\d{17,20}$/.test(raw) ? raw : null;
      const resolvedId = mentionId ?? plainId;

      let targetRoleId = null;

      if (resolvedId) {
        targetRoleId = configured.find(r => r.roleId === resolvedId)?.roleId ?? null;
      } else {
        const byName = configured.filter(r => {
          const role = message.guild.roles.cache.get(r.roleId);
          return role && role.name === raw;
        });

        if (byName.length === 1) {
          targetRoleId = byName[0].roleId;
        } else if (byName.length > 1) {
          return embed.replyError(
            message,
            'Plusieurs rôles correspondent à ce nom. Utilisez une mention ou un ID.'
          );
        }
      }

      if (!targetRoleId) {
        return embed.replyError(
          message,
          `Ce rôle n'est pas configuré pour le niveau ${lvl}.`
        );
      }

      db.removeLevelRole(guildId, lvl, targetRoleId);

      return embed.reply(
        message,
        `Rôle <@&${targetRoleId}> retiré du niveau ${lvl}.`
      );
    }

    case 'role': {

      const level =
        parseInt(args[1], 10);

      const role =
        message.mentions.roles.first();

      if (
        isNaN(level)
        || level < 1
        || !role
      ) {
        return embed.replyError(
          message,
          'Utilisation : `level role <niveau> <@role>`'
        );
      }


      const DANGEROUS_PERMS = [
        'Administrator',
        'ManageGuild',
        'BanMembers',
        'KickMembers',
        'ManageRoles',
        'ManageWebhooks',
        'ManageChannels',
      ];
      const dangerous = DANGEROUS_PERMS.filter(p => role.permissions.has(p));
      if (dangerous.length) {
        return embed.replyError(
          message,
          'Ce r\u00f4le a des permissions trop \u00e9lev\u00e9es pour \u00eatre attribu\u00e9 automatiquement par le syst\u00e8me de niveaux.'
        );
      }

      db.addLevelRole(
        guildId,
        level,
        role.id
      );

      return embed.reply(
        message,
        `Rôle <@&${role.id}> ajouté pour le niveau ${level}.`
      );
    }

    default:
      return _sendHelp(message);

  }

};


function _sendHelp(message) {

  return embed.reply(message, null, {
    title : 'Levels',
    fields: [

      { name: 'level on', value: 'Activer les niveaux.', inline: false },
      { name: 'level off', value: 'Désactiver les niveaux.', inline: false },
      { name: 'level status', value: 'Voir l\'état.', inline: false },
      { name: 'level reset', value: 'Reset un membre.', inline: false },
      { name: 'level resetall confirm', value: 'Reset serveur.', inline: false },
      { name: 'level channel', value: 'Définir salon.', inline: false },
      { name: 'level message', value: 'Changer message.', inline: false },
      { name: 'level role', value: 'Ajouter rôle niveau.', inline: false },
      { name: 'level removerole', value: 'Retirer rôle niveau.', inline: false },

    ],
    timestamp: false,
  });

}
