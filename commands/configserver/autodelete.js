'use strict';


const { parseDuration, formatDuration } = require('../../utils/parseDuration.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const TARGETS = {
  moderation: {
    aliases: ['moderation', 'mod', 'modo'],
    command: 'autoDeleteModCmds',
    reply  : 'autoDeleteModReplies',
  },

  snipe: {
    aliases: ['snipe'],
    command: 'autoDeleteSnipeCmds',
    reply  : 'autoDeleteSnipeReplies',
  },

  info: {
    aliases: ['info', 'infos'],
    command: 'autoDeleteInfoCmds',
    reply  : 'autoDeleteInfoReplies',
  },

  error: {
    aliases: ['error', 'erreur', 'errors', 'erreurs'],
    reply  : 'autoDeleteErrorReplies',
  },

  lock: {
    aliases: ['lock'],
    reply  : 'autoDeleteLockReplies',
  },

  role: {
    aliases: ['role', 'roles'],
    reply  : 'autoDeleteRoleReplies',
  },

  renew: {
    aliases: ['renew'],
    reply  : 'autoDeleteRenewReply',
    delay  : 'autoDeleteRenewDelay',
  },

  stats: {
    aliases: ['stats', 'stat', 'vc'],
    command: 'autoDeleteStatsCmds',
    reply  : 'autoDeleteStatsReplies',
  },
};

const ACTION_ALIASES = {
  command: ['command', 'commande', 'cmd', 'commands', 'commandes'],
  reply  : ['reply', 'reponse', 'réponse', 'rep', 'replies', 'responses'],
};

module.exports = {
  help: {
    name        : 'autodelete',
    description : 'Configure la suppression automatique des commandes et réponses.',
    use         : 'autodelete <type/delay/reset> [commande/reply] [on/off/durée]',
    usage       : 'autodelete <type/delay/reset> [commande/reply] [on/off/durée]',
    aliases     : ['autodel', 'autodeletecmd'],
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

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

    const typeArg   = args[0]?.toLowerCase();
    const targetArg = args[1]?.toLowerCase();
    const valueArg  = args[2]?.toLowerCase();

if (!typeArg || ['show', 'list', 'settings', 'config'].includes(typeArg)) {
  return _show(message, guildId, deleteReply, deleteDelay);
}

if (['help', 'aide', 'types', 'cat', 'categories', 'catégories'].includes(typeArg)) {
  return _help(message, guildId, deleteReply, deleteDelay);
}

    if (['reset', 'default', 'defaults'].includes(typeArg)) {
  return _resetDefaults(message, guildId, deleteReply, deleteDelay);
}

    if (['delay', 'durée', 'duree', 'time'].includes(typeArg)) {
      return _setGlobalDelay(message, guildId, args[1], deleteReply, deleteDelay);
    }

    const targetGroup = _resolveTargetGroup(typeArg);

    if (!targetGroup) {
      return _sendError(
        message,
        `Type invalide. Types disponibles : \`${Object.keys(TARGETS).join('`, `')}\`.`,
        deleteReply,
        deleteDelay
      );
    }

    const targetKind = _resolveTargetKind(targetArg);

    if (!targetKind) {
      return _sendError(
        message,
        `Utilisation : \`${message.prefix || '+'}autodelete ${typeArg} <commande/reply> <on/off/durée>\``,
        deleteReply,
        deleteDelay
      );
    }

    const key = targetGroup[targetKind];

    if (!key) {
      return _sendError(
        message,
        `Le type \`${typeArg}\` ne supporte pas \`${targetArg}\`.`,
        deleteReply,
        deleteDelay
      );
    }

    if (!valueArg) {
      return _sendError(
        message,
        `Utilisation : \`${message.prefix || '+'}autodelete ${typeArg} ${targetArg} <on/off/durée>\``,
        deleteReply,
        deleteDelay
      );
    }

    const toggle = _parseToggle(valueArg);

    if (toggle !== null) {
      const currentValue = Number(db.getGuildConfig(guildId)?.[key] ?? 0);
      const desiredValue = toggle ? 1 : 0;

      if (currentValue === desiredValue) {
        return _sendError(
          message,
          desiredValue === 1
            ? `Autodelete \`${typeArg}\` \`${targetKind}\` est déjà activé.`
            : `Autodelete \`${typeArg}\` \`${targetKind}\` est déjà désactivé.`,
          deleteReply,
          deleteDelay
        );
      }

      db.setGuildConfig(guildId, key, desiredValue);

      const sent = await embed.reply(
        message,
        `Autodelete \`${typeArg}\` \`${targetKind}\` ${toggle ? 'activé' : 'désactivé'}.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const duration = parseDuration(valueArg, {
      minMs : 1_000,
      maxMs : 86_400_000,
      unit  : 's',
    });

    if (!duration) {
      return _sendError(
        message,
        'Valeur invalide. Utilisez `on`, `off` ou une durée comme `5s`, `10s`, `1m`.',
        deleteReply,
        deleteDelay
      );
    }

    const delayKey = targetGroup.delay || 'autoDeleteDelay';

    const currentCfg     = db.getGuildConfig(guildId) || {};
    const currentEnabled = Number(currentCfg[key] ?? 0);
    const currentDelay   = Number(currentCfg[delayKey] ?? 5);

    if (currentEnabled === 1 && currentDelay === duration) {
      return _sendError(
        message,
        'Cette valeur est déjà configurée.',
        deleteReply,
        deleteDelay
      );
    }

    db.setGuildConfig(guildId, key, 1);
    db.setGuildConfig(guildId, delayKey, duration);

    const sent = await embed.reply(
      message,
      `Autodelete \`${typeArg}\` \`${targetKind}\` activé avec un délai de \`${_formatDuration(duration)}\`.`,
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function _show(message, guildId, deleteReply, deleteDelay) {
  const config = db.getGuildConfig(guildId);

  const lines = [
    `Délai global : \`${_formatDuration(Number(config?.autoDeleteDelay ?? 5))}\``,
    '',
    `Modération commandes : ${_status(config?.autoDeleteModCmds)}`,
    `Modération réponses : ${_status(config?.autoDeleteModReplies)}`,
    `Snipe commandes : ${_status(config?.autoDeleteSnipeCmds)}`,
    `Snipe réponses : ${_status(config?.autoDeleteSnipeReplies)}`,
    `Info commandes : ${_status(config?.autoDeleteInfoCmds)}`,
    `Info réponses : ${_status(config?.autoDeleteInfoReplies)}`,
    `Erreurs réponses : ${_status(config?.autoDeleteErrorReplies)}`,
    `Lock réponses : ${_status(config?.autoDeleteLockReplies)}`,
    `Rôles réponses : ${_status(config?.autoDeleteRoleReplies)}`,
    `Renew réponses : ${_status(config?.autoDeleteRenewReply)}`,
    `Renew délai : \`${_formatDuration(Number(config?.autoDeleteRenewDelay ?? config?.autoDeleteDelay ?? 5))}\``,
    `Stats commandes : ${_status(config?.autoDeleteStatsCmds)}`,
    `Stats réponses : ${_status(config?.autoDeleteStatsReplies)}`,
    '',
    `Aide : \`${message.prefix || '+'}autodelete help\``,
  ];

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        lines.join('\n'),
        {
          title    : 'Autodelete',
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

async function _help(message, guildId, deleteReply, deleteDelay) {
  const lines = [
    `Catégories disponibles :`,
    `\`moderation\` - commandes et réponses de modération`,
    `\`snipe\` - commandes et réponses snipe`,
    `\`info\` - commandes et réponses utilitaires / informations`,
    `\`error\` - réponses d'erreur uniquement`,
    `\`lock\` - réponses lock / unlock uniquement`,
    `\`role\` - réponses liées aux rôles uniquement`,
    `\`renew\` - réponses renew uniquement`,
    `\`stats\` - commandes et réponses stats (vc, stats)`,
    '',
    `Actions disponibles :`,
    `\`commande\` - supprime le message envoyé par l'utilisateur`,
    `\`reply\` - supprime la réponse du bot`,
    `\`delay\` - change le délai global`,
    `\`reset\` - remet les valeurs par défaut`,
    '',
    `Exemples :`,
    `\`${message.prefix || '+'}autodelete moderation commande on\``,
    `\`${message.prefix || '+'}autodelete moderation reply 10s\``,
    `\`${message.prefix || '+'}autodelete snipe reply off\``,
    `\`${message.prefix || '+'}autodelete delay 5s\``,
    `\`${message.prefix || '+'}autodelete reset\``,
  ];

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        lines.join('\n'),
        {
          title    : 'Autodelete - aide',
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

async function _resetDefaults(message, guildId, deleteReply, deleteDelay) {
  db.setGuildConfig(guildId, 'autoDeleteDelay', 5);

  db.setGuildConfig(guildId, 'autoDeleteModCmds', 0);
  db.setGuildConfig(guildId, 'autoDeleteModReplies', 0);

  db.setGuildConfig(guildId, 'autoDeleteSnipeCmds', 0);
  db.setGuildConfig(guildId, 'autoDeleteSnipeReplies', 0);

  db.setGuildConfig(guildId, 'autoDeleteErrorReplies', 1);

  db.setGuildConfig(guildId, 'autoDeleteInfoCmds', 0);
  db.setGuildConfig(guildId, 'autoDeleteInfoReplies', 0);

  db.setGuildConfig(guildId, 'autoDeleteLockReplies', 0);
  db.setGuildConfig(guildId, 'autoDeleteRoleReplies', 0);

  db.setGuildConfig(guildId, 'autoDeleteRenewReply', 0);
  db.setGuildConfig(guildId, 'autoDeleteRenewDelay', null);

  db.setGuildConfig(guildId, 'autoDeleteStatsCmds', 0);
  db.setGuildConfig(guildId, 'autoDeleteStatsReplies', 0);

  const sent = await embed.reply(
    message,
    'Les paramètres autodelete ont été réinitialisés aux valeurs par défaut.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _setGlobalDelay(message, guildId, rawDuration, deleteReply, deleteDelay) {
  const duration = parseDuration(rawDuration, {
    minMs : 1_000,
    maxMs : 86_400_000,
    unit  : 's',
  });

  if (!duration) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}autodelete delay <durée>\``,
      deleteReply,
      deleteDelay
    );
  }

  const currentDelay = Number(db.getGuildConfig(guildId)?.autoDeleteDelay ?? 5);
  if (currentDelay === duration) {
    return _sendError(
      message,
      'Cette valeur est déjà configurée.',
      deleteReply,
      deleteDelay
    );
  }

  db.setGuildConfig(guildId, 'autoDeleteDelay', duration);

  const sent = await embed.reply(
    message,
    `Délai global d'autodelete configuré sur \`${_formatDuration(duration)}\`.`,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

function _resolveTargetGroup(value) {
  if (!value) return null;

  return Object.values(TARGETS).find(target =>
    target.aliases.includes(value)
  ) ?? null;
}

function _resolveTargetKind(value) {
  if (!value) return null;

  if (ACTION_ALIASES.command.includes(value)) return 'command';
  if (ACTION_ALIASES.reply.includes(value)) return 'reply';

  return null;
}

function _parseToggle(value) {
  const raw = String(value || '').toLowerCase();

  if (['on', 'enable', 'enabled', 'true', 'yes', 'oui', '1'].includes(raw)) return true;
  if (['off', 'disable', 'disabled', 'false', 'no', 'non', '0'].includes(raw)) return false;

  return null;
}

function _formatDuration(seconds) {
  const value = Number(seconds) || 0;
  if (value <= 0) return '0s';
  return formatDuration(value, { unit: 's', format: 'fr-long' }) || `${value}s`;
}

function _status(value) {
  return Number(value) === 1 ? '`Activé`' : '`Désactivé`';
}

async function _sendError(message, content, deleteReply, deleteDelay) {
  const sent = await embed.replyError(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
