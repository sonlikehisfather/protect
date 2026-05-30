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

    case 'xpignore': {
      const channel = message.mentions.channels.first();
      if (!channel) {
        return embed.replyError(message, 'Utilisation : `level xpignore #salon`');
      }
      db.addXpIgnoredChannel(guildId, channel.id);
      return embed.reply(message, `<#${channel.id}> ignoré pour l'XP.`);
    }

    case 'xpunignore': {
      const channel = message.mentions.channels.first();
      if (!channel) {
        return embed.replyError(message, 'Utilisation : `level xpunignore #salon`');
      }
      db.removeXpIgnoredChannel(guildId, channel.id);
      return embed.reply(message, `<#${channel.id}> retiré des salons ignorés pour l'XP.`);
    }

    case 'xpignored': {
      const ignored = db.getXpIgnoredChannels(guildId);
      if (!ignored.length) return embed.reply(message, 'Aucun salon ignoré pour l\'XP.');
      return embed.reply(message, `Salons ignorés pour l'XP :\n${ignored.map(id => `<#${id}>`).join('\n')}`);
    }

    case 'xpmulti': {
      const role = message.mentions.roles.first();
      const multi = parseFloat(args[2]);
      if (!role || isNaN(multi) || multi <= 0) {
        return embed.replyError(message, 'Utilisation : `level xpmulti @role <multiplicateur>` (ex: `level xpmulti @Booster 2`)');
      }
      db.setXpRoleMultiplier(guildId, role.id, multi);
      return embed.reply(message, `Multiplicateur XP de **${multi}x** défini pour <@&${role.id}>.`);
    }

    case 'xpmultiremove': {
      const role = message.mentions.roles.first();
      if (!role) return embed.replyError(message, 'Utilisation : `level xpmultiremove @role`');
      db.removeXpRoleMultiplier(guildId, role.id);
      return embed.reply(message, `Multiplicateur XP retiré pour <@&${role.id}>.`);
    }

    case 'xpmultis': {
      const multis = db.getXpRoleMultipliers(guildId);
      if (!multis.length) return embed.reply(message, 'Aucun multiplicateur XP configuré.');
      const lines = multis.map(r => `<@&${r.roleId}> → **${r.multiplier}x**`).join('\n');
      return embed.reply(message, `Multiplicateurs XP :\n${lines}`);
    }

    case 'xpcooldown': {
      const channel = message.mentions.channels.first();
      const secs = parseInt(args[2], 10);
      if (!channel || isNaN(secs) || secs < 1) {
        return embed.replyError(message, 'Utilisation : `level xpcooldown #salon <secondes>` (ex: `level xpcooldown #général 30`)');
      }
      db.setXpChannelCooldown(guildId, channel.id, secs);
      return embed.reply(message, `Cooldown XP de **${secs}s** défini pour <#${channel.id}>.`);
    }

    case 'xpcooldownremove': {
      const channel = message.mentions.channels.first();
      if (!channel) return embed.replyError(message, 'Utilisation : `level xpcooldownremove #salon`');
      db.removeXpChannelCooldown(guildId, channel.id);
      return embed.reply(message, `Cooldown XP retiré pour <#${channel.id}> (retour au cooldown global).`);
    }

    case 'xpcooldowns': {
      const cooldowns = db.getAllXpChannelCooldowns(guildId);
      if (!cooldowns.length) return embed.reply(message, 'Aucun cooldown XP personnalisé configuré.');
      const lines = cooldowns.map(r => `<#${r.channelId}> → **${r.cooldown}s**`).join('\n');
      return embed.reply(message, `Cooldowns XP par salon :\n${lines}`);
    }

    default:
      return _sendHelp(message);

  }

};


function _sendHelp(message) {

  return embed.reply(message, null, {
    title : 'Levels',
    fields: [
      { name: 'level on/off', value: 'Activer/désactiver les niveaux.', inline: false },
      { name: 'level status', value: 'Voir l\'état.', inline: false },
      { name: 'level reset @membre', value: 'Reset un membre.', inline: false },
      { name: 'level resetall confirm', value: 'Reset serveur.', inline: false },
      { name: 'level channel #salon', value: 'Définir salon de level-up.', inline: false },
      { name: 'level message <texte>', value: 'Changer message de level-up.', inline: false },
      { name: 'level role <niveau> @role', value: 'Ajouter rôle niveau.', inline: false },
      { name: 'level removerole <niveau>', value: 'Retirer rôle niveau.', inline: false },
      { name: 'level xpignore #salon', value: 'Ignorer un salon pour l\'XP.', inline: false },
      { name: 'level xpunignore #salon', value: 'Retirer un salon ignoré.', inline: false },
      { name: 'level xpignored', value: 'Voir les salons ignorés.', inline: false },
      { name: 'level xpmulti @role <multi>', value: 'Multiplicateur XP pour un rôle.', inline: false },
      { name: 'level xpmultiremove @role', value: 'Retirer le multiplicateur.', inline: false },
      { name: 'level xpmultis', value: 'Voir tous les multiplicateurs.', inline: false },
      { name: 'level xpcooldown #salon <secs>', value: 'Cooldown XP par salon.', inline: false },
      { name: 'level xpcooldownremove #salon', value: 'Retirer le cooldown.', inline: false },
      { name: 'level xpcooldowns', value: 'Voir tous les cooldowns.', inline: false },
    ],
    timestamp: false,
  });

}
