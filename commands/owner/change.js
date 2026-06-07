'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const CONFIG_TOGGLES = {
  autodeleteerrorreplies : 'autoDeleteErrorReplies',
  autodeleteinfocmds     : 'autoDeleteInfoCmds',
  autodeleteinforeplies  : 'autoDeleteInfoReplies',
  autodeletelockreplies  : 'autoDeleteLockReplies',
  autodeleterolereplies  : 'autoDeleteRoleReplies',
  autodeletemodcmds      : 'autoDeleteModCmds',
  autodeletemodreplies   : 'autoDeleteModReplies',
  autodeletesnipecmds    : 'autoDeleteSnipeCmds',
  autodeletesnipereplies : 'autoDeleteSnipeReplies',
};

exports.help = {
  name       : 'change',
  description: 'Changer permissions ou réglages du bot.',
  use        : 'change <commande|réglage|reset> [valeur]',
  usage      : 'change <commande|réglage|reset> [valeur]',

};

exports.run = async (client, message, args) => {
  const guildId  = message.guild.id;
  const authorId = message.author.id;

  if (!perms.isBuyer(authorId) && !perms.isOwner(guildId, authorId)) {
    return embed.replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.");
  }

  const target = args[0]?.toLowerCase();
  const value  = args[1]?.toLowerCase();

  if (!target) {
    return _sendHelp(message);
  }

  if (target === 'reset') {
    if (!perms.isBuyer(authorId) && !perms.isOwner(guildId, authorId)) {
      return embed.replyError(
        message,
        'Seul le buyer ou un owner peut réinitialiser toutes les permissions.'
      );
    }

    await embed.reply(
      message,
      'Cela va remettre toutes les permissions à leur valeur par défaut.\nRépondez `confirmer` dans 15s.'
    );

    const filter = m =>
      m.author.id === authorId &&
      m.content.toLowerCase() === 'confirmer';

    const collected = await message.channel.awaitMessages({
      filter,
      max  : 1,
      time : 15000,
    }).catch(() => null);

    if (!collected?.size) {
      return embed.reply(
        message,
        'Réinitialisation annulée.'
      );
    }

    db.resetCmdPerms(guildId);

    return embed.reply(
      message,
      'Toutes les permissions ont été réinitialisées.'
    );
  }

  if (Object.prototype.hasOwnProperty.call(CONFIG_TOGGLES, target)) {
    if (!perms.isBuyer(authorId) && !perms.isOwner(guildId, authorId)) {
      return embed.replyError(
        message,
        'Permission refusée.'
      );
    }

    if (value !== 'on' && value !== 'off') {
      return embed.replyError(
        message,
        `Valeur invalide. Utilisez \`on\` ou \`off\` pour \`${target}\`.`
      );
    }

    const dbKey    = CONFIG_TOGGLES[target];
    const boolValue = value === 'on' ? 1 : 0;

    const currentConfig = db.getGuildConfig(guildId);
    const currentValue  = Number(currentConfig?.[dbKey] ?? 0);

    if (currentValue === boolValue) {
      return embed.replyError(
        message,
        boolValue === 1
          ? `\`${target}\` est déjà activé.`
          : `\`${target}\` est déjà désactivé.`
      );
    }

    db.setGuildConfig(guildId, dbKey, boolValue);

    return embed.reply(
      message,
      `Réglage \`${target}\` -> **${value === 'on' ? 'activé' : 'désactivé'}**`
    );
  }

  if (target === 'autodeletedelay') {
    if (!perms.isBuyer(authorId) && !perms.isOwner(guildId, authorId)) {
      return embed.replyError(
        message,
        'Permission refusée.'
      );
    }

    const delay = parseInt(value, 10);

    if (isNaN(delay) || delay < 1 || delay > 60) {
      return embed.replyError(
        message,
        'Valeur invalide. Utilisez : `+change autodeletedelay <1-60>`'
      );
    }

    const currentDelay = Number(db.getGuildConfig(guildId)?.autoDeleteDelay ?? 5);
    if (currentDelay === delay) {
      return embed.replyError(
        message,
        'Cette valeur est déjà configurée.'
      );
    }

    db.setGuildConfig(guildId, 'autoDeleteDelay', delay);

    return embed.reply(
      message,
      `Réglage \`autoDeleteDelay\` -> **${delay}s**`
    );
  }

  if (!value) {
    return embed.replyError(
      message,
      'Précisez la permission. Ex: `+change ban perm2` ou `+change ban owner`'
    );
  }

  const perm = perms.parsePerm(value);

  if (!perm) {
    return embed.replyError(
      message,
      'Permission ou réglage invalide.'
    );
  }

  const command = client.commands.get(target);

  if (!command) {
    return embed.replyError(
      message,
      `Commande \`${target}\` introuvable.`
    );
  }

  const currentPerm = db.getCmdPerm(guildId, command.help.name) ?? 'everyone';

  if (!perms.canEditPerm(message, currentPerm) || !perms.canEditPerm(message, perm)) {
    return embed.replyError(
      message,
      'Vous ne pouvez pas modifier ces permissions.'
    );
  }

  db.setCmdPerm(
    guildId,
    command.help.name,
    perm
  );

  return embed.reply(
    message,
    `Commande \`${command.help.name}\` -> **${perms.permLabel(perm)}**`
  );
};

function _sendHelp(message) {
  return embed.reply(
    message,
    null,
    {
      title : 'Change command',
      fields: [
        {
          name  : 'change <commande> <perm>',
          value : 'Change la permission requise pour une commande'
        },
        {
          name  : 'change reset',
          value : 'Réinitialise toutes les permissions de commandes'
        },
        {
          name  : 'change autodeleteerrorreplies <on|off>',
          value : 'Active ou désactive l\'auto-delete des erreurs'
        },
        {
          name  : 'change autodeleteinfocmds <on|off>',
          value : 'Active ou désactive l\'auto-delete des commandes info'
        },
        {
          name  : 'change autodeleteinforeplies <on|off>',
          value : 'Active ou désactive l\'auto-delete des réponses info'
        },
        {
          name  : 'change autodeletelockreplies <on|off>',
          value : 'Active ou désactive l\'auto-delete des réponses lock/unlock/hide/unhide'
        },
        {
          name  : 'change autodeleterolereplies <on|off>',
          value : 'Active ou désactive l\'auto-delete des réponses role'
        },
        {
          name  : 'change autodeletemodcmds <on|off>',
          value : 'Active ou désactive l\'auto-delete des commandes de modération'
        },
        {
          name  : 'change autodeletemodreplies <on|off>',
          value : 'Active ou désactive l\'auto-delete des réponses de modération'
        },
        {
          name  : 'change autodeletesnipecmds <on|off>',
          value : 'Active ou désactive l\'auto-delete des commandes snipe'
        },
        {
          name  : 'change autodeletesnipereplies <on|off>',
          value : 'Active ou désactive l\'auto-delete des réponses snipe'
        },
        {
          name  : 'change autodeletedelay <1-60>',
          value : 'Change le délai global d\'auto-delete'
        },
      ],
      timestamp: false,
    }
  );
}
