'use strict';


const {
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const { replaceVariables } = require('../../utils/variables');

const MAX_AUTOROLES   = 20;
const PANEL_IDLE_MS   = 3_600_000;
const PANEL_TIMEOUT_MS = 3_600_000;


const _panelBusy = new Map();

function _isBusy(pnl) {
  return Boolean(pnl) && _panelBusy.get(pnl.id) === true;
}

function _setBusy(pnl, value) {
  if (!pnl) return;
  if (value) _panelBusy.set(pnl.id, true);
  else _panelBusy.delete(pnl.id);
}

module.exports = {
  help: {
    name        : 'joinsettings',
    description : 'Configure les actions effectuées quand un membre rejoint le serveur.',
    use         : 'joinsettings <channel/message/dm/dmmessage/role/autodelete/afterverify/off/test/show> [valeur]',
    usage       : 'joinsettings <channel/message/dm/dmmessage/role/autodelete/afterverify/off/test/show> [valeur]',
    aliases     : ['joinconfig', 'welcomesettings'],
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

    const action = args[0]?.toLowerCase();

    if (!action || ['settings', 'config', 'panel'].includes(action)) {
      return _openPanel(client, message, guildId, deleteReply, deleteDelay);
    }

    if (action === 'show') {
      return _show(message, guildId, config, deleteReply, deleteDelay);
    }

    if (['channel', 'salon'].includes(action)) {
      return _setChannel(message, guildId, args[1], deleteReply, deleteDelay);
    }

    if (['message', 'msg'].includes(action)) {
      return _setMessage(message, guildId, args.slice(1).join(' ').trim(), deleteReply, deleteDelay);
    }

    if (['dm', 'mp'].includes(action)) {
      return _setDm(message, guildId, args[1], deleteReply, deleteDelay);
    }

    if (['dmmessage', 'mpmessage', 'dmmsg', 'mpmsg'].includes(action)) {
      return _setDmMessage(message, guildId, args.slice(1).join(' ').trim(), deleteReply, deleteDelay);
    }

    if (['role', 'roles', 'autorole', 'autoroles'].includes(action)) {
      return _handleAutoroles(message, guildId, args.slice(1), deleteReply, deleteDelay);
    }

    if (['autodelete', 'autodel', 'delete', 'suppression'].includes(action)) {
      return _setAutoDelete(message, guildId, args.slice(1).join(' ').trim(), deleteReply, deleteDelay);
    }

    if (['afterverify', 'afterverif', 'verifywelcome'].includes(action)) {
      return _setAfterVerify(message, guildId, args[1]?.toLowerCase(), deleteReply, deleteDelay);
    }

    if (['off', 'disable', 'reset'].includes(action)) {
      return _disable(message, guildId, deleteReply, deleteDelay);
    }

    if (['test', 'preview'].includes(action)) {
      return _test(message, guildId, deleteReply, deleteDelay);
    }

    return _usage(message, deleteReply, deleteDelay);
  },
};

async function _show(message, guildId, config, deleteReply, deleteDelay) {
  const autoroles = _getAutoroles(guildId);

  const autorolesText = autoroles.length
    ? autoroles
      .map((roleId, index) => {
        const role = message.guild.roles.cache.get(roleId);
        return role
          ? `\`${index + 1}.\` <@&${role.id}>`
          : `\`${index + 1}.\` Rôle introuvable - \`${roleId}\``;
      })
      .join('\n')
    : '`Aucun`';

  const autoDeleteDelay = Math.max(0, Number(config?.welcomeAutoDeleteDelay ?? 0));

  const showSendMode      = _normalizeWelcomeMode(config?.welcomeSendMode);
  const showSendModeLabel = _WELCOME_MODE_LABELS[showSendMode];
  const showHasEmbedConf  = _hasConfiguredEmbed(config);

  const text =
    `Salon : ${config?.welcomeChannel ? `<#${config.welcomeChannel}>` : '`Non configuré`'}\n` +
    `Message : ${config?.welcomeMessage ? `\`${_truncate(config.welcomeMessage, 120)}\`` : '`Défaut`'}\n` +
    `Mode welcome : \`${showSendModeLabel}\`\n` +
    `Embed bienvenue : ${showHasEmbedConf ? '`Configuré`' : '`Non configuré`'}\n` +
    `DM : ${Number(config?.welcomeDmEnabled) === 1 ? '`Activé`' : '`Désactivé`'}\n` +
    `Message DM : ${config?.welcomeDmMessage ? `\`${_truncate(config.welcomeDmMessage, 120)}\`` : '`Défaut`'}\n` +
    `Suppression auto : ${autoDeleteDelay > 0 ? `\`${_formatDelay(autoDeleteDelay)}\`` : '`Désactivée`'}\n` +
    `Après vérification : ${Number(config?.welcomeAfterVerify) === 1 ? '`Activé`' : '`Désactivé`'}\n\n` +
    `Rôles auto :\n${autorolesText}\n\n` +
    `Variables : \`{user}\`, \`{username}\`, \`{tag}\`, \`{server}\`, \`{membercount}\``;

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        text,
        {
          title    : 'Join settings',
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

async function _setChannel(message, guildId, rawChannel, deleteReply, deleteDelay) {
  const channel = await _resolveTextChannel(message.guild, rawChannel);

  if (!channel) {
    return _sendError(message, 'Salon introuvable ou invalide.', deleteReply, deleteDelay);
  }

  const me = message.guild.members.me
    ?? await message.guild.members.fetchMe().catch(() => null);

  const botPerms = me ? channel.permissionsFor(me) : null;

  if (
    !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
    !botPerms?.has(PermissionsBitField.Flags.SendMessages)
  ) {
    return _sendError(
      message,
      'Je n\'ai pas les permissions nécessaires dans ce salon.',
      deleteReply,
      deleteDelay
    );
  }

  db.setGuildConfig(guildId, 'welcomeChannel', channel.id);

  const sent = await embed.reply(
    message,
    `Salon d'arrivée configuré sur ${channel}.`,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _setMessage(message, guildId, content, deleteReply, deleteDelay) {
  if (!content) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}joinsettings message Bienvenue {user} sur {server}\``,
      deleteReply,
      deleteDelay
    );
  }

  if (content.length > 1500) {
    return _sendError(message, 'Le message ne peut pas dépasser 1500 caractères.', deleteReply, deleteDelay);
  }

  db.setGuildConfig(guildId, 'welcomeMessage', content);

  const sent = await embed.reply(
    message,
    'Message d\'arrivée configuré.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _setDm(message, guildId, rawState, deleteReply, deleteDelay) {
  const state = _parseToggle(rawState);

  if (state === null) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}joinsettings dm <on/off>\``,
      deleteReply,
      deleteDelay
    );
  }

  db.setGuildConfig(guildId, 'welcomeDmEnabled', state ? 1 : 0);

  const sent = await embed.reply(
    message,
    `DM d'arrivée ${state ? 'activé' : 'désactivé'}.`,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _setDmMessage(message, guildId, content, deleteReply, deleteDelay) {
  if (!content) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}joinsettings dmmessage Bienvenue sur {server}\``,
      deleteReply,
      deleteDelay
    );
  }

  if (content.length > 1500) {
    return _sendError(message, 'Le message DM ne peut pas dépasser 1500 caractères.', deleteReply, deleteDelay);
  }

  db.setGuildConfig(guildId, 'welcomeDmMessage', content);

  const sent = await embed.reply(
    message,
    'Message DM d\'arrivée configuré.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _handleAutoroles(message, guildId, args, deleteReply, deleteDelay) {
  const action = args[0]?.toLowerCase();

  if (!action || ['list', 'show'].includes(action)) {
    return _listAutoroles(message, guildId, deleteReply, deleteDelay);
  }

  if (['add', 'set'].includes(action)) {
    const query = args.slice(1).join(' ').trim();

    if (!query) {
      return _sendError(
        message,
        `Utilisation : \`${message.prefix || '+'}joinsettings role add @role\``,
        deleteReply,
        deleteDelay
      );
    }

    const role = await _resolveRole(message.guild, query);

    if (!role) {
      return _sendError(message, 'Rôle introuvable.', deleteReply, deleteDelay);
    }

    const error = await _validateRole(message.guild, role);

    if (error) {
      return _sendError(message, error, deleteReply, deleteDelay);
    }

    const autoroles = _getAutoroles(guildId);

    if (autoroles.includes(role.id)) {
      return _sendError(message, 'Ce rôle est déjà configuré en rôle automatique.', deleteReply, deleteDelay);
    }

    if (autoroles.length >= MAX_AUTOROLES) {
      return _sendError(
        message,
        `Vous ne pouvez pas configurer plus de ${MAX_AUTOROLES} rôles automatiques.`,
        deleteReply,
        deleteDelay
      );
    }

    db.addAutorole(guildId, role.id);

    const sent = await embed.reply(
      message,
      `Rôle automatique ajouté : <@&${role.id}>.`,
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (['remove', 'del', 'delete', 'rm'].includes(action)) {
    const query = args.slice(1).join(' ').trim();

    if (!query) {
      return _sendError(
        message,
        `Utilisation : \`${message.prefix || '+'}joinsettings role remove @role\``,
        deleteReply,
        deleteDelay
      );
    }

    const role = await _resolveRole(message.guild, query);

    if (!role) {
      return _sendError(message, 'Rôle introuvable.', deleteReply, deleteDelay);
    }

    const autoroles = _getAutoroles(guildId);

    if (!autoroles.includes(role.id)) {
      return _sendError(message, 'Ce rôle n\'est pas configuré en rôle automatique.', deleteReply, deleteDelay);
    }

    db.removeAutorole(guildId, role.id);

    const sent = await embed.reply(
      message,
      `Rôle automatique retiré : <@&${role.id}>.`,
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (['clear', 'reset'].includes(action)) {
    const count = _getAutoroles(guildId).length;

    if (!count) {
      return _sendError(message, 'Aucun rôle automatique configuré.', deleteReply, deleteDelay);
    }

    db.clearAutoroles(guildId);

    const sent = await embed.reply(
      message,
      `Tous les rôles automatiques ont été supprimés. Total : \`${count}\`.`,
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  return _sendError(
    message,
    `Utilisation : \`${message.prefix || '+'}joinsettings role <add/remove/list/clear> [@role]\``,
    deleteReply,
    deleteDelay
  );
}

async function _listAutoroles(message, guildId, deleteReply, deleteDelay) {
  const autoroles = _getAutoroles(guildId);

  if (!autoroles.length) {
    const sent = await embed.reply(
      message,
      'Aucun rôle automatique configuré.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const lines = autoroles.map((roleId, index) => {
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
          title    : 'Rôles automatiques',
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

async function _setAfterVerify(message, guildId, value, deleteReply, deleteDelay) {
  if (!value || !['on', 'off', 'enable', 'disable', 'true', 'false', '1', '0'].includes(value)) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}joinsettings afterverify <on/off>\``,
      deleteReply,
      deleteDelay
    );
  }

  const enable = ['on', 'enable', 'true', '1'].includes(value);

  if (enable) {
    const config = db.getGuildConfig(guildId);

    if (Number(config?.verifyEnabled) !== 1) {
      return _sendError(
        message,
        `Activez d'abord la vérification avec \`${message.prefix || '+'}verify setup #salon @role\`.`,
        deleteReply,
        deleteDelay
      );
    }
  }

  db.setGuildConfig(guildId, 'welcomeAfterVerify', enable ? 1 : 0);

  const sent = await embed.reply(
    message,
    enable
      ? 'Welcome envoyé après vérification : `Activé`. Le welcome au join est suspendu tant que la vérification est active.'
      : 'Welcome envoyé après vérification : `Désactivé`. Le welcome est envoyé au join.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _disable(message, guildId, deleteReply, deleteDelay) {
  db.setGuildConfig(guildId, 'welcomeChannel', null);
  db.setGuildConfig(guildId, 'welcomeMessage', null);
  db.setGuildConfig(guildId, 'welcomeDmMessage', null);
  db.setGuildConfig(guildId, 'welcomeDmEnabled', 0);
  db.setGuildConfig(guildId, 'welcomeAutoDeleteDelay', 0);
  db.setGuildConfig(guildId, 'welcomeAfterVerify', 0);

  const sent = await embed.reply(
    message,
    'Messages d\'arrivée désactivés et réinitialisés. Les rôles automatiques ne sont pas modifiés.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _test(message, guildId, deleteReply, deleteDelay) {
  const config = db.getGuildConfig(guildId);

  const channel = config?.welcomeChannel
    ? message.guild.channels.cache.get(config.welcomeChannel)
    : message.channel;

  if (!channel?.isTextBased()) {
    return _sendError(message, 'Salon d\'arrivée introuvable.', deleteReply, deleteDelay);
  }

  const content = _formatWelcomeMessage(
    config?.welcomeMessage || 'Bienvenue {user} sur **{server}**.',
    message.member
  );

  const sentTest = await channel.send({
    content,
    allowedMentions: { users: [message.author.id] },
  }).catch(() => null);

  if (!sentTest) {
    return _sendError(message, 'Impossible d\'envoyer le test.', deleteReply, deleteDelay);
  }

  const autoDeleteDelay = Math.max(0, Number(config?.welcomeAutoDeleteDelay ?? 0));

  if (autoDeleteDelay > 0) {
    embed.scheduleDelete(sentTest, autoDeleteDelay);
  }

  if (Number(config?.welcomeDmEnabled) === 1) {
    const dmContent = _formatWelcomeMessage(
      config?.welcomeDmMessage || 'Bienvenue sur **{server}**.',
      message.member
    );

    await message.author.send({
      content: dmContent,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  const sent = await embed.reply(
    message,
    'Test d\'arrivée envoyé.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _usage(message, deleteReply, deleteDelay) {
  const sent = await embed.replyError(
    message,
    `Utilisation :\n` +
    `\`${message.prefix || '+'}joinsettings\`\n` +
    `\`${message.prefix || '+'}joinsettings channel #salon\`\n` +
    `\`${message.prefix || '+'}joinsettings message Bienvenue {user} sur {server}\`\n` +
    `\`${message.prefix || '+'}joinsettings dm on/off\`\n` +
    `\`${message.prefix || '+'}joinsettings dmmessage Bienvenue sur {server}\`\n` +
    `\`${message.prefix || '+'}joinsettings role add @role\`\n` +
    `\`${message.prefix || '+'}joinsettings role remove @role\`\n` +
    `\`${message.prefix || '+'}joinsettings role list\`\n` +
    `\`${message.prefix || '+'}joinsettings role clear\`\n` +
    `\`${message.prefix || '+'}joinsettings autodelete <délai>\`\n` +
    `\`${message.prefix || '+'}joinsettings afterverify <on/off>\`\n` +
    `\`${message.prefix || '+'}joinsettings test\`\n` +
    `\`${message.prefix || '+'}joinsettings off\``,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _resolveTextChannel(guild, query) {
  if (!query) return null;

  const raw = String(query).trim();
  const mention = raw.match(/^<#(\d{17,20})>$/);
  const id = mention?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);

  if (id) {
    const channel = guild.channels.cache.get(id)
      ?? await guild.channels.fetch(id).catch(() => null);

    return _isTextChannel(channel) ? channel : null;
  }

  const normalized = _normalizeName(raw);

  return guild.channels.cache.find(channel =>
    _isTextChannel(channel) &&
    _normalizeName(channel.name) === normalized
  ) ?? null;
}

function _isTextChannel(channel) {
  return Boolean(
    channel &&
    (
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement
    )
  );
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

function _getAutoroles(guildId) {
  if (typeof db.getAutoroles !== 'function') return [];
  return db.getAutoroles(guildId);
}

function _formatWelcomeMessage(template, member) {
  return replaceVariables(String(template || ''), {
    user   : member.user,
    member,
    guild  : member.guild,
    client : member.client,
  });
}

async function _setAutoDelete(message, guildId, raw, deleteReply, deleteDelay) {
  if (!raw) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}joinsettings autodelete <délai>\`. Exemples : 0, 10s, 1m, 1h, 1d. Maximum 86400s.`,
      deleteReply,
      deleteDelay
    );
  }

  const parsed = _parseDelayInput(raw);

  if (parsed === null) {
    return _sendError(
      message,
      'Délai invalide. Exemples : 0, 10s, 1m, 1h, 1d. Maximum 86400s.',
      deleteReply,
      deleteDelay
    );
  }

  db.setGuildConfig(guildId, 'welcomeAutoDeleteDelay', parsed);

  const sent = await embed.reply(
    message,
    parsed > 0
      ? `Suppression automatique du message d'arrivée configurée sur \`${_formatDelay(parsed)}\`.`
      : 'Suppression automatique du message d\'arrivée désactivée.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

const _DELAY_MAX = 86400;

function _parseDelayInput(raw) {
  const v = String(raw || '').toLowerCase().trim();

  if (!v) return null;
  if (['0', 'none', 'aucun', 'off', 'disable', 'disabled'].includes(v)) return 0;

  const m = v.match(/^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days|j|jour|jours)?$/);
  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;

  const unit = m[2] || 's';
  let seconds;

  if (['s', 'sec', 'secs'].includes(unit))      seconds = n;
  else if (['m', 'min', 'mins'].includes(unit)) seconds = n * 60;
  else if (['h', 'hr', 'hrs'].includes(unit))   seconds = n * 3600;
  else                                          seconds = n * 86400;

  if (seconds === 0) return 0;
  if (seconds < 1)   return null;
  if (seconds > _DELAY_MAX) return null;

  return seconds;
}

function _formatDelay(seconds) {
  const s = Number(seconds) || 0;
  if (s <= 0)     return '0s';
  if (s < 60)     return `${s}s`;
  if (s < 3600)   return `${Math.floor(s / 60)}m`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}j`;
}

function _parseToggle(value) {
  const raw = String(value || '').toLowerCase();

  if (['on', 'enable', 'enabled', 'true', 'yes', 'oui', '1'].includes(raw)) return true;
  if (['off', 'disable', 'disabled', 'false', 'no', 'non', '0'].includes(raw)) return false;

  return null;
}

function _normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^#/, '')
    .trim();
}

function _truncate(value, max) {
  const text = String(value || '');
  const cut  = text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
  return embed.breakLongTokens(cut);
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


const PANEL_OPTIONS = [
  { value: 'sec_captcha',  label: 'Sécurité captcha',                                  description: 'Active la vérification par captcha.',          emoji: '🔐' },
  { value: 'sec_verify',   label: 'Sécurité vérification',                             description: 'Active la vérification par bouton.',           emoji: '' },
  { value: 'sec_off',      label: 'Pas de sécurité',                                   description: 'Désactive la vérification.',                    emoji: '' },
  { value: 'duration',     label: 'Modifier la durée maximum',                         description: 'Délai avant kick si non vérifié (0 = désactivé).',   emoji: '⏱️' },
  { value: 'role',         label: 'Modifier le rôle membre',                           description: 'Rôle attribué après vérification.',                emoji: '🎭' },
  { value: 'msg_set',      label: 'Modifier le message de bienvenue',                  description: 'Message envoyé dans le salon de bienvenue.',  emoji: '💬' },
  { value: 'msg_clear',    label: 'Supprimer le message de bienvenue',                 description: 'Retirer le message custom (revient au défaut).', emoji: '🗑️' },
  { value: 'channel',      label: 'Modifier le salon du message de bienvenue',         description: 'Salon où est envoyé le message.',                   emoji: '📢' },
  { value: 'autodel',      label: 'Supprimer le message de bienvenue automatiquement', description: 'Délai avant suppression (ghost ping).',       emoji: '⏳' },
  { value: 'dm_set',       label: 'Modifier le message en mp',                         description: 'Message DM envoyé au nouveau membre.',        emoji: '📩' },
  { value: 'dm_clear',     label: 'Supprimer le message en mp',                        description: 'Retirer le message DM et désactiver le DM.', emoji: '🗑️' },
  { value: 'afterverify',  label: 'Envoyer les messages de bienvenue après sécurité',  description: 'Welcome envoyé seulement après vérification.', emoji: '🔄' },
  { value: 'logs',         label: 'Modifier le salon des logs de vérification',        description: 'Salon dédié aux logs verify.',                  emoji: '📋' },
];

const WELCOME_MODE_OPTIONS = [
  { value: 'welcome_mode_message',       label: 'Mode welcome : message simple',  description: 'Envoie le message en texte normal.',                  emoji: '💬' },
  { value: 'welcome_mode_message_embed', label: 'Mode welcome : message en embed', description: 'Affiche le message de bienvenue dans un embed.',     emoji: '📦' },
  { value: 'welcome_mode_embed',         label: 'Mode welcome : embed seul',      description: 'Envoie uniquement l\'embed configuré.',               emoji: '📄' },
  { value: 'welcome_mode_both',          label: 'Mode welcome : message + embed', description: 'Envoie le message et l\'embed configuré.',             emoji: '📑' },
  { value: 'welcome_embed_import',       label: 'Configurer l\'embed de bienvenue', description: 'Copie l\'embed depuis un message existant.',          emoji: '✏️' },
  { value: 'welcome_embed_from_message', label: 'Créer un embed depuis le message', description: 'Crée un embed simple avec le message de bienvenue.', emoji: '📋' },
  { value: 'welcome_embed_clear',        label: 'Supprimer l\'embed de bienvenue', description: 'Désactive et supprime l\'embed configuré.',           emoji: '🗑️' },
  { value: 'welcome_dynamic_images',     label: 'Images dynamiques welcome',       description: 'Aide MemberPic, ServerIcon, ClientPic.',              emoji: '🖼️' },
  { value: 'welcome_preview',            label: 'Prévisualiser le welcome',      description: 'Envoie une prévisualisation dans ce salon.',          emoji: '👁️' },
];

const _WELCOME_MODE_LABELS = {
  message       : 'Message simple',
  message_embed : 'Message en embed',
  embed         : 'Embed seul',
  both          : 'Message + embed',
};

function _normalizeWelcomeMode(mode) {
  if (['message', 'message_embed', 'embed', 'both'].includes(String(mode))) {
    return String(mode);
  }
  return 'message';
}

async function _openPanel(client, message, guildId, deleteReply, deleteDelay) {
  const pnl = await message.channel.send({
    embeds          : [_buildPanelEmbed(guildId)],
    components      : _buildPanelRows(false),
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!pnl) return;

  embed.registerPrivateInteraction(pnl, message.author.id, PANEL_TIMEOUT_MS);

  const collector = pnl.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : PANEL_IDLE_MS,
    time   : PANEL_TIMEOUT_MS,
  });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'local:joinsettings:close') {
        await i.deferUpdate().catch(() => {});
        collector.stop('closed');
        embed.clearPrivateInteraction(pnl);
        return pnl.delete().catch(() => {});
      }

      if (
        i.customId !== 'local:joinsettings:menu' &&
        i.customId !== 'local:joinsettings:menu:welcome'
      ) return;

      const choice = i.values?.[0];
      await _handleSelect(client, message, guildId, pnl, i, choice);
    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) {
        console.error('[joinsettings panel] collect error :', err.message);
      }
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(pnl);
    _setBusy(pnl, false);
    if (reason === 'closed') return;
    pnl.edit({
      components      : [],
      content         : '-# Session expirée, relance la commande pour reprendre.',
      allowedMentions : { parse: [] },
    }).catch(() => {});
  });
}

function _buildPanelEmbed(guildId) {
  const config = db.getGuildConfig(guildId) || {};

  const verifyEnabled = Number(config.verifyEnabled) === 1;
  const verifyType    = String(config.verifyType || 'button').toLowerCase();

  let secLabel = '`Aucune`';
  if (verifyEnabled && verifyType === 'captcha') secLabel = '`Captcha`';
  else if (verifyEnabled)                        secLabel = '`Vérification`';

  const roleId       = config.verifyRoleId || null;
  const channelId    = config.welcomeChannel || null;
  const dmEnabled    = Number(config.welcomeDmEnabled) === 1;
  const autoDelay    = Math.max(0, Number(config.welcomeAutoDeleteDelay ?? 0));
  const afterVerify  = Number(config.welcomeAfterVerify) === 1;
  const duration     = Math.max(0, Math.floor(Number(config.verifyDuration) || 0));
  const verifyLogId  = config.verifyLogChannel || null;

  const sendMode      = _normalizeWelcomeMode(config.welcomeSendMode);
  const sendModeLabel = _WELCOME_MODE_LABELS[sendMode];
  const hasEmbedConf  = _hasConfiguredEmbed(config);

  const welcomeMsgPreview = _truncatePanelValue(config.welcomeMessage);
  const dmMsgPreview      = _truncatePanelValue(config.welcomeDmMessage);

  const fields = [
    {
      name : 'Sécurité',
      value:
        `Type : ${secLabel}\n` +
        `Durée maximum : ${duration > 0 ? `\`${_formatDelay(duration)}\`` : '`Désactivée`'}`,
    },
    {
      name : 'Membre',
      value: `Rôle membre : ${roleId ? `<@&${roleId}>` : '`Aucun`'}`,
    },
    {
      name : 'Bienvenue',
      value:
        `Salon : ${channelId ? `<#${channelId}>` : '`Non configuré`'}\n` +
        `Mode : \`${sendModeLabel}\`\n` +
        `Embed : ${hasEmbedConf ? '`Configuré`' : '`Non configuré`'}\n` +
        `Message : ${welcomeMsgPreview ? `\`${welcomeMsgPreview}\`` : '`Défaut`'}\n` +
        `Suppression auto : ${autoDelay > 0 ? `\`${_formatDelay(autoDelay)}\`` : '`Désactivée`'}`,
    },
    {
      name : 'MP de bienvenue',
      value:
        `État : ${dmEnabled ? '`Activé`' : '`Désactivé`'}\n` +
        `Message : ${dmMsgPreview ? `\`${dmMsgPreview}\`` : '`Défaut`'}`,
    },
    {
      name : 'Vérification',
      value:
        `Après vérification : ${afterVerify ? '`Activé`' : '`Désactivé`'}\n` +
        `Logs : ${verifyLogId ? `<#${verifyLogId}>` : '`Non configuré`'}`,
    },
    {
      name : 'Variables',
      value: 'Liste complète : `+variables`',
    },
  ];

  return embed.build(guildId, null, {
    title     : 'Paramètres d\'arrivée',
    fields,
    footer    : 'Utilise les menus ci-dessous pour modifier la configuration.',
    timestamp : false,
  });
}

function _truncatePanelValue(value, max = 120) {
  const text = String(value || '')
    .replace(/`/g, '\'')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const cut = text.length > max ? `${text.slice(0, max - 3)}...` : text;
  return embed.breakLongTokens(cut);
}

function _buildPanelRows(disabled) {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('local:joinsettings:menu')
        .setPlaceholder('Paramètres d\'arrivée')
        .setDisabled(disabled)
        .addOptions(PANEL_OPTIONS.map(o => ({
          label       : o.label.slice(0, 100),
          description : o.description.slice(0, 100),
          value       : o.value,
          ...(o.emoji ? { emoji: o.emoji } : {}),
        })))
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('local:joinsettings:menu:welcome')
        .setPlaceholder('Mode et embed welcome')
        .setDisabled(disabled)
        .addOptions(WELCOME_MODE_OPTIONS.map(o => ({
          label       : o.label.slice(0, 100),
          description : o.description.slice(0, 100),
          value       : o.value,
          ...(o.emoji ? { emoji: o.emoji } : {}),
        })))
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:joinsettings:close')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    ),
  ];
}

async function _refreshPanel(pnl, guildId) {
  await pnl.edit({
    embeds     : [_buildPanelEmbed(guildId)],
    components : _buildPanelRows(false),
  }).catch(() => {});
}

async function _optWelcomeDynamicImages(i) {
  const help = [
    'Variables image disponibles :',
    '`{MemberPic}` : avatar du membre qui rejoint',
    '`{ServerIcon}` : icône du serveur',
    '`{ClientPic}` : avatar du bot',
    '',
    'Utilisation :',
    'Ces variables fonctionnent dans les champs image de l\'embed welcome :',
    'thumbnail, image, icône auteur, icône footer.',
    '',
    'Exemples :',
    'Thumbnail = `{MemberPic}`',
    'Icône footer = `{ServerIcon}`',
    '',
    'Note :',
    'Dans `+embed`, utilisez plutôt les raccourcis `me`, `serveur`, `bot`, `@user` car l\'embed est envoyé immédiatement.',
  ].join('\n');

  await _ackInfo(i, help);
}

async function _ackInfo(i, content) {
  await i.reply({
    content,
    flags           : 64,
    allowedMentions : { parse: [] },
  }).catch(() => {});
}

async function _handleSelect(client, message, guildId, pnl, i, choice) {
  if (_isBusy(pnl)) {
    return i.reply({
      content         : 'Une modification est déjà en cours.',
      flags           : 64,
      allowedMentions : { parse: [] },
    }).catch(() => {});
  }

  if (typeof choice === 'string' && choice.startsWith('welcome_')) {
    return _handleWelcomeSelect(message, guildId, pnl, i, choice);
  }

  switch (choice) {
    case 'sec_captcha':
      return _optSecCaptcha(message, guildId, pnl, i);

    case 'sec_verify':
      return _optSecVerify(message, guildId, pnl, i);

    case 'sec_off':
      return _optSecOff(guildId, pnl, i);

    case 'duration':
      return _optDuration(guildId, pnl, i);

    case 'role':
      return _optRole(message, guildId, pnl, i);

    case 'msg_set':
      return _optMessageSet(guildId, pnl, i);

    case 'msg_clear':
      return _optMessageClear(guildId, pnl, i);

    case 'channel':
      return _optChannel(message, guildId, pnl, i);

    case 'autodel':
      return _optAutoDelete(guildId, pnl, i);

    case 'dm_set':
      return _optDmSet(guildId, pnl, i);

    case 'dm_clear':
      return _optDmClear(guildId, pnl, i);

    case 'afterverify':
      return _optAfterVerify(guildId, pnl, i);

    case 'logs':
      return _optVerifyLog(message, guildId, pnl, i);

    default:
      await i.deferUpdate().catch(() => {});
      return;
  }
}

async function _handleWelcomeSelect(message, guildId, pnl, i, choice) {
  switch (choice) {
    case 'welcome_mode_message':
      return _optSetMode(guildId, pnl, i, 'message');
    case 'welcome_mode_message_embed':
      return _optSetMode(guildId, pnl, i, 'message_embed');
    case 'welcome_mode_embed':
      return _optSetMode(guildId, pnl, i, 'embed');
    case 'welcome_mode_both':
      return _optSetMode(guildId, pnl, i, 'both');
    case 'welcome_embed_import':
      return _optWelcomeEmbedImport(message, guildId, pnl, i);
    case 'welcome_embed_from_message':
      return _optWelcomeEmbedFromMessage(guildId, pnl, i);
    case 'welcome_embed_clear':
      return _optWelcomeEmbedClear(guildId, pnl, i);
    case 'welcome_dynamic_images':
      return _optWelcomeDynamicImages(i);
    case 'welcome_preview':
      return _optWelcomePreview(message, guildId, pnl, i);
    default:
      await i.deferUpdate().catch(() => {});
      return;
  }
}

async function _optSetMode(guildId, pnl, i, mode) {
  const config      = db.getGuildConfig(guildId) || {};
  const currentMode = _normalizeWelcomeMode(config.welcomeSendMode);

  if (mode === currentMode) {
    await _ackInfo(i, 'Ce mode welcome est déjà actif.');
    return;
  }

  if (mode === 'embed' || mode === 'both') {
    if (!_hasConfiguredEmbed(config)) {
      await _ackInfo(
        i,
        'Aucun embed de bienvenue configuré. Utilisez d\'abord `Configurer l\'embed de bienvenue` ou `Créer un embed depuis le message`.'
      );
      return;
    }
  }

  await i.deferUpdate().catch(() => {});
  db.setGuildConfig(guildId, 'welcomeSendMode', mode);
  await _refreshPanel(pnl, guildId);

  const labels = {
    message       : 'Mode welcome : message simple.',
    message_embed : 'Mode welcome : message en embed.',
    embed         : 'Mode welcome : embed seul.',
    both          : 'Mode welcome : message + embed.',
  };

  await i.followUp({
    content         : labels[mode],
    flags           : 64,
    allowedMentions : { parse: [] },
  }).catch(() => {});
}


function _hasConfiguredEmbed(config) {
  if (Number(config?.welcomeEmbedEnabled) !== 1) return false;
  if (typeof config?.welcomeEmbedJson !== 'string') return false;

  const raw = config.welcomeEmbedJson.trim();
  if (!raw) return false;

  try {
    const data = JSON.parse(raw);
    return !!data && typeof data === 'object';
  } catch {
    return false;
  }
}

function _parseMessageRef(raw, message) {
  if (!raw) return null;
  const trimmed = String(raw).trim();

  const link = trimmed.match(
    /^https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})$/i
  );
  if (link) {
    if (link[1] !== message.guild.id) return null;
    return { channelId: link[2], messageId: link[3] };
  }

  if (/^\d{17,20}$/.test(trimmed)) {
    return { channelId: message.channel.id, messageId: trimmed };
  }

  return null;
}

function _embedColorToHex(color) {
  if (typeof color !== 'number' || !Number.isFinite(color) || color < 0) return null;
  return `#${color.toString(16).padStart(6, '0')}`;
}

function _safeHexColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!/^#?[0-9a-f]{6}$/i.test(v)) return null;
  return v.startsWith('#') ? v : `#${v}`;
}

async function _optWelcomeEmbedImport(message, guildId, pnl, i) {
  const wasConfigured = _hasConfiguredEmbed(db.getGuildConfig(guildId) || {});
  const modalId = `local:joinsettings:modal:embedimport:${i.id}`;

  _setBusy(pnl, true);
  const shown = await i.showModal(
    new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('Embed de bienvenue')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('value')
            .setLabel('ID ou lien du message')
            .setPlaceholder('123456789012345678 ou lien Discord')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(200)
        )
      )
  ).then(() => true).catch(() => false);
  _setBusy(pnl, false);

  if (!shown) return;

  const submit = await _awaitJsModal(i, modalId);
  if (!submit) return;

  _setBusy(pnl, true);
  try {
    const raw = submit.fields.getTextInputValue('value').trim();
    const ref = _parseMessageRef(raw, message);

    if (!ref) {
      await submit.reply({ content: 'Lien ou ID invalide.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    const ch = message.guild.channels.cache.get(ref.channelId)
      ?? await message.guild.channels.fetch(ref.channelId).catch(() => null);

    if (!ch || !ch.isTextBased?.()) {
      await submit.reply({ content: 'Salon introuvable.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    const me = message.guild.members.me
      ?? await message.guild.members.fetchMe().catch(() => null);
    const botPerms = me ? ch.permissionsFor(me) : null;

    if (
      !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
      !botPerms?.has(PermissionsBitField.Flags.ReadMessageHistory)
    ) {
      await submit.reply({ content: 'Je ne peux pas lire ce message.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    const sourceMsg = await ch.messages.fetch(ref.messageId).catch(() => null);

    if (!sourceMsg) {
      await submit.reply({ content: 'Message introuvable.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    const firstEmbed = sourceMsg.embeds?.[0];

    if (!firstEmbed) {
      await submit.reply({ content: 'Ce message ne contient aucun embed.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    const data = firstEmbed.toJSON?.() || firstEmbed;
    const stored = {
      title       : data.title || null,
      description : data.description || null,
      url         : data.url || null,
      color       : _embedColorToHex(data.color),
      image       : data.image?.url || null,
      thumbnail   : data.thumbnail?.url || null,
      footer      : data.footer?.text || null,
      footerIcon  : data.footer?.icon_url || null,
      author      : data.author?.name || null,
      authorIcon  : data.author?.icon_url || null,
      authorUrl   : data.author?.url || null,
      fields      : Array.isArray(data.fields)
        ? data.fields.slice(0, 25).map(f => ({
            name   : String(f?.name || '').slice(0, 256),
            value  : String(f?.value || '').slice(0, 1024),
            inline : Boolean(f?.inline),
          })).filter(f => f.name && f.value)
        : [],
      timestamp   : Boolean(data.timestamp),
    };

    await submit.deferUpdate().catch(() => {});
    db.setGuildConfig(guildId, 'welcomeEmbedJson', JSON.stringify(stored));
    db.setGuildConfig(guildId, 'welcomeEmbedEnabled', 1);
    await _refreshPanel(pnl, guildId);
    await submit.followUp({
      content         : wasConfigured ? 'Embed de bienvenue remplacé.' : 'Embed de bienvenue configuré.',
      flags           : 64,
      allowedMentions : { parse: [] },
    }).catch(() => {});
  } finally {
    _setBusy(pnl, false);
  }
}

async function _optWelcomeEmbedFromMessage(guildId, pnl, i) {
  const config = db.getGuildConfig(guildId) || {};

  if (_hasConfiguredEmbed(config)) {
    await _ackInfo(i, 'Un embed de bienvenue est déjà configuré. Supprimez-le avant d\'en créer un nouveau.');
    return;
  }

  const description = config.welcomeMessage || 'Bienvenue {user} sur **{server}** !';

  const stored = {
    title       : null,
    description,
    color       : _safeHexColor(config.color),
    image       : null,
    thumbnail   : null,
    footer      : null,
  };

  await i.deferUpdate().catch(() => {});
  db.setGuildConfig(guildId, 'welcomeEmbedJson', JSON.stringify(stored));
  db.setGuildConfig(guildId, 'welcomeEmbedEnabled', 1);
  await _refreshPanel(pnl, guildId);
  await i.followUp({ content: 'Embed créé depuis le message de bienvenue.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
}

async function _optWelcomeEmbedClear(guildId, pnl, i) {
  const config = db.getGuildConfig(guildId) || {};

  if (!_hasConfiguredEmbed(config)) {
    await _ackInfo(i, 'Aucun embed de bienvenue n\'est configuré.');
    return;
  }

  const currentMode = _normalizeWelcomeMode(config.welcomeSendMode);

  await i.deferUpdate().catch(() => {});
  db.setGuildConfig(guildId, 'welcomeEmbedJson', null);
  db.setGuildConfig(guildId, 'welcomeEmbedEnabled', 0);

  if (currentMode === 'embed' || currentMode === 'both') {
    db.setGuildConfig(guildId, 'welcomeSendMode', 'message');
  }

  await _refreshPanel(pnl, guildId);
  await i.followUp({ content: 'Embed de bienvenue supprimé.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
}

async function _optWelcomePreview(message, guildId, pnl, i) {
  const config       = db.getGuildConfig(guildId) || {};
  const mode         = _normalizeWelcomeMode(config.welcomeSendMode);
  const modeLabel    = _WELCOME_MODE_LABELS[mode];
  const hasEmbedConf = _hasConfiguredEmbed(config);

  const rendered = _formatWelcomeMessage(
    config.welcomeMessage || 'Bienvenue {user} sur **{server}**.',
    message.member
  );

  const text =
    `Mode welcome : \`${modeLabel}\`\n` +
    `Embed bienvenue : ${hasEmbedConf ? '`Configuré`' : '`Non configuré`'}\n\n` +
    `Aperçu du message rendu :\n${_truncate(rendered, 1500)}\n\n` +
    `Note : la vraie notification n'est envoyée que lors d'une arrivée réelle.`;

  await i.reply({
    embeds: [
      embed.build(guildId, text, {
        title     : 'Prévisualisation welcome',
        timestamp : false,
      }),
    ],
    flags           : 64,
    allowedMentions : { parse: [] },
  }).catch(() => {});
}


async function _optSecVerify(message, guildId, pnl, i) {
  const config = db.getGuildConfig(guildId) || {};

  if (
    Number(config.verifyEnabled) === 1 &&
    String(config.verifyType || 'button').toLowerCase() === 'button'
  ) {
    await _ackInfo(i, 'La sécurité vérification est déjà active.');
    return;
  }

  if (!config.verifyChannel || !config.verifyMessageId || !config.verifyRoleId) {
    await _ackInfo(
      i,
      `Configurez d'abord la vérification avec \`${message.prefix || '+'}verify setup #salon @role\`.`
    );
    return;
  }

  const channel = message.guild.channels.cache.get(config.verifyChannel)
    ?? await message.guild.channels.fetch(config.verifyChannel).catch(() => null);

  const targetMessage = channel?.isTextBased?.()
    ? await channel.messages.fetch(config.verifyMessageId).catch(() => null)
    : null;

  const hasButton = !!targetMessage && (targetMessage.components ?? []).some(row =>
    (row.components ?? []).some(c =>
      String(c.customId || c.custom_id || '').startsWith('verify:button:')
    )
  );

  if (!hasButton) {
    await _ackInfo(
      i,
      `Le bouton de vérification est absent. Relancez \`${message.prefix || '+'}verify setup #salon @role\`.`
    );
    return;
  }

  await i.deferUpdate().catch(() => {});
  db.setGuildConfig(guildId, 'verifyEnabled', 1);
  db.setGuildConfig(guildId, 'verifyType', 'button');
  await _refreshPanel(pnl, guildId);
  await i.followUp({ content: 'Sécurité vérification activée.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
}

async function _optSecOff(guildId, pnl, i) {
  const config = db.getGuildConfig(guildId) || {};

  if (
    Number(config.verifyEnabled) !== 1 &&
    Number(config.welcomeAfterVerify) !== 1
  ) {
    await _ackInfo(i, 'La sécurité est déjà désactivée.');
    return;
  }

  await i.deferUpdate().catch(() => {});
  db.setGuildConfig(guildId, 'verifyEnabled', 0);
  db.setGuildConfig(guildId, 'welcomeAfterVerify', 0);

  try {
    const verifyTimeouts = require('../../utils/verifyTimeouts');
    verifyTimeouts.cancelGuildAll(guildId);
  } catch {
  }

  await _refreshPanel(pnl, guildId);
  await i.followUp({ content: 'Sécurité désactivée.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
}


async function _optSecCaptcha(message, guildId, pnl, i) {
  const config = db.getGuildConfig(guildId) || {};

  if (
    Number(config.verifyEnabled) === 1 &&
    String(config.verifyType || 'button').toLowerCase() === 'captcha'
  ) {
    await _ackInfo(i, 'La sécurité captcha est déjà active.');
    return;
  }

  if (!config.verifyChannel || !config.verifyMessageId || !config.verifyRoleId) {
    await _ackInfo(
      i,
      `Configurez d'abord la vérification avec \`${message.prefix || '+'}verify setup #salon @role\`.`
    );
    return;
  }

  const channel = message.guild.channels.cache.get(config.verifyChannel)
    ?? await message.guild.channels.fetch(config.verifyChannel).catch(() => null);

  const targetMessage = channel?.isTextBased?.()
    ? await channel.messages.fetch(config.verifyMessageId).catch(() => null)
    : null;

  const hasButton = !!targetMessage && (targetMessage.components ?? []).some(row =>
    (row.components ?? []).some(c =>
      String(c.customId || c.custom_id || '').startsWith('verify:button:')
    )
  );

  if (!hasButton) {
    await _ackInfo(
      i,
      `Le bouton de vérification est absent. Relancez \`${message.prefix || '+'}verify setup #salon @role\`.`
    );
    return;
  }

  await i.deferUpdate().catch(() => {});
  db.setGuildConfig(guildId, 'verifyEnabled', 1);
  db.setGuildConfig(guildId, 'verifyType', 'captcha');
  await _refreshPanel(pnl, guildId);
  await i.followUp({ content: 'Sécurité captcha activée.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
}


async function _optDuration(guildId, pnl, i) {
  const config  = db.getGuildConfig(guildId) || {};
  const modalId = `local:joinsettings:modal:duration:${i.id}`;

  _setBusy(pnl, true);
  const shown = await i.showModal(
    new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('Durée maximum vérification')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('value')
            .setLabel('Délai (0, 30s, 5m, 1h, 1d, max 86400)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(20)
            .setValue(String(config.verifyDuration ?? 0))
        )
      )
  ).then(() => true).catch(() => false);
  _setBusy(pnl, false);

  if (!shown) return;

  const submit = await _awaitJsModal(i, modalId);
  if (!submit) return;

  _setBusy(pnl, true);
  try {
    const raw = submit.fields.getTextInputValue('value').trim();
    const parsed = _parseDelayInput(raw);

    if (parsed === null) {
      await submit.reply({ content: 'Délai invalide. Exemples : 0, 30s, 5m, 1h, 1d.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    const currentDuration = Math.max(0, Math.floor(Number(config.verifyDuration) || 0));
    if (parsed === currentDuration) {
      await submit.reply({
        content         : parsed === 0
          ? 'La durée maximum est déjà désactivée.'
          : `La durée maximum est déjà sur \`${_formatDelay(parsed)}\`.`,
        flags           : 64,
        allowedMentions : { parse: [] },
      }).catch(() => {});
      return;
    }

    await submit.deferUpdate().catch(() => {});
    db.setGuildConfig(guildId, 'verifyDuration', parsed);

    if (parsed <= 0) {
      try {
        const verifyTimeouts = require('../../utils/verifyTimeouts');
        verifyTimeouts.cancelGuildAll(guildId);
      } catch {
      }
    }

    await _refreshPanel(pnl, guildId);
    await submit.followUp({
      content: parsed > 0
        ? `Durée maximum configurée sur \`${_formatDelay(parsed)}\`.`
        : 'Durée maximum désactivée.',
      flags: 64,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  } finally {
    _setBusy(pnl, false);
  }
}


async function _optVerifyLog(message, guildId, pnl, i) {
  const config  = db.getGuildConfig(guildId) || {};
  const modalId = `local:joinsettings:modal:verifylog:${i.id}`;

  _setBusy(pnl, true);
  const shown = await i.showModal(
    new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('Salon des logs vérification')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('value')
            .setLabel('Mention, ID, nom (vide = retirer)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(120)
            .setValue(config.verifyLogChannel || '')
        )
      )
  ).then(() => true).catch(() => false);
  _setBusy(pnl, false);

  if (!shown) return;

  const submit = await _awaitJsModal(i, modalId);
  if (!submit) return;

  _setBusy(pnl, true);
  try {
    const raw = submit.fields.getTextInputValue('value').trim();

    if (!raw) {
      if (!config.verifyLogChannel) {
        await submit.reply({ content: 'Aucun salon de logs de vérification n\'est configuré.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
        return;
      }

      await submit.deferUpdate().catch(() => {});
      db.setGuildConfig(guildId, 'verifyLogChannel', null);
      await _refreshPanel(pnl, guildId);
      await submit.followUp({ content: 'Salon des logs vérification retiré.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    const channel = await _resolveTextChannel(message.guild, raw);

    if (!channel) {
      await submit.reply({ content: 'Salon introuvable ou invalide.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    const me = message.guild.members.me
      ?? await message.guild.members.fetchMe().catch(() => null);
    const botPerms = me ? channel.permissionsFor(me) : null;

    if (
      !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
      !botPerms?.has(PermissionsBitField.Flags.SendMessages)
    ) {
      await submit.reply({ content: 'Je n\'ai pas les permissions nécessaires dans ce salon.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    await submit.deferUpdate().catch(() => {});
    db.setGuildConfig(guildId, 'verifyLogChannel', channel.id);
    await _refreshPanel(pnl, guildId);
    await submit.followUp({ content: `Salon des logs vérification défini sur <#${channel.id}>.`, flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
  } finally {
    _setBusy(pnl, false);
  }
}


async function _optRole(message, guildId, pnl, i) {
  const config = db.getGuildConfig(guildId) || {};

  if (!config.verifyChannel || !config.verifyMessageId) {
    await _ackInfo(
      i,
      `Aucun système de vérification configuré. Lancez \`${message.prefix || '+'}verify setup #salon @role\`.`
    );
    return;
  }

  const modalId = `local:joinsettings:modal:role:${i.id}`;
  _setBusy(pnl, true);
  const shown = await i.showModal(
    new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('Rôle membre')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('value')
            .setLabel('Mention, ID ou nom du rôle')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(120)
            .setValue(config.verifyRoleId || '')
        )
      )
  ).then(() => true).catch(() => false);
  _setBusy(pnl, false);

  if (!shown) return;

  const submit = await _awaitJsModal(i, modalId);
  if (!submit) return;

  _setBusy(pnl, true);
  try {
    const raw = submit.fields.getTextInputValue('value').trim();
    const role = await _resolveRole(message.guild, raw);

    if (!role) {
      await submit.reply({ content: 'Rôle introuvable.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    const error = await _validateRole(message.guild, role);
    if (error) {
      await submit.reply({ content: error, flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    await submit.deferUpdate().catch(() => {});
    db.setGuildConfig(guildId, 'verifyRoleId', role.id);
    await _refreshPanel(pnl, guildId);
    await submit.followUp({ content: `Rôle membre défini sur <@&${role.id}>.`, flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
  } finally {
    _setBusy(pnl, false);
  }
}


async function _optMessageSet(guildId, pnl, i) {
  const config  = db.getGuildConfig(guildId) || {};
  const modalId = `local:joinsettings:modal:msg:${i.id}`;

  _setBusy(pnl, true);
  const shown = await i.showModal(
    new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('Message de bienvenue')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('value')
            .setLabel('Message (max 1500)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1500)
            .setValue(config.welcomeMessage || '')
        )
      )
  ).then(() => true).catch(() => false);
  _setBusy(pnl, false);

  if (!shown) return;

  const submit = await _awaitJsModal(i, modalId);
  if (!submit) return;

  _setBusy(pnl, true);
  try {
    const raw = submit.fields.getTextInputValue('value').trim();

    if (!raw) {
      await submit.reply({ content: 'Message vide ignoré.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    if (raw.length > 1500) {
      await submit.reply({ content: 'Le message ne peut pas dépasser 1500 caractères.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    await submit.deferUpdate().catch(() => {});
    db.setGuildConfig(guildId, 'welcomeMessage', raw);
    await _refreshPanel(pnl, guildId);
    await submit.followUp({ content: 'Message de bienvenue défini. Variables disponibles avec +variables.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
  } finally {
    _setBusy(pnl, false);
  }
}

async function _optMessageClear(guildId, pnl, i) {
  const config = db.getGuildConfig(guildId) || {};

  if (!config.welcomeMessage || !String(config.welcomeMessage).trim()) {
    await _ackInfo(i, 'Aucun message de bienvenue personnalisé n\'est configuré.');
    return;
  }

  await i.deferUpdate().catch(() => {});
  db.setGuildConfig(guildId, 'welcomeMessage', null);
  await _refreshPanel(pnl, guildId);
  await i.followUp({ content: 'Message de bienvenue supprimé.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
}


async function _optChannel(message, guildId, pnl, i) {
  const config  = db.getGuildConfig(guildId) || {};
  const modalId = `local:joinsettings:modal:channel:${i.id}`;

  _setBusy(pnl, true);
  const shown = await i.showModal(
    new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('Salon de bienvenue')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('value')
            .setLabel('Mention, ID ou nom du salon')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(120)
            .setValue(config.welcomeChannel || '')
        )
      )
  ).then(() => true).catch(() => false);
  _setBusy(pnl, false);

  if (!shown) return;

  const submit = await _awaitJsModal(i, modalId);
  if (!submit) return;

  _setBusy(pnl, true);
  try {
    const raw = submit.fields.getTextInputValue('value').trim();
    const channel = await _resolveTextChannel(message.guild, raw);

    if (!channel) {
      await submit.reply({ content: 'Salon introuvable ou invalide.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    const me = message.guild.members.me
      ?? await message.guild.members.fetchMe().catch(() => null);
    const botPerms = me ? channel.permissionsFor(me) : null;

    if (
      !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
      !botPerms?.has(PermissionsBitField.Flags.SendMessages)
    ) {
      await submit.reply({ content: 'Je n\'ai pas les permissions nécessaires dans ce salon.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    await submit.deferUpdate().catch(() => {});
    db.setGuildConfig(guildId, 'welcomeChannel', channel.id);
    await _refreshPanel(pnl, guildId);
    await submit.followUp({ content: `Salon de bienvenue défini sur <#${channel.id}>.`, flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
  } finally {
    _setBusy(pnl, false);
  }
}


async function _optAutoDelete(guildId, pnl, i) {
  const config  = db.getGuildConfig(guildId) || {};
  const modalId = `local:joinsettings:modal:autodel:${i.id}`;

  _setBusy(pnl, true);
  const shown = await i.showModal(
    new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('Suppression automatique')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('value')
            .setLabel('Délai (0, 1s, 1m, 1h, 1d, max 86400)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(20)
            .setValue(String(config.welcomeAutoDeleteDelay ?? 0))
        )
      )
  ).then(() => true).catch(() => false);
  _setBusy(pnl, false);

  if (!shown) return;

  const submit = await _awaitJsModal(i, modalId);
  if (!submit) return;

  _setBusy(pnl, true);
  try {
    const raw = submit.fields.getTextInputValue('value').trim();
    const parsed = _parseDelayInput(raw);

    if (parsed === null) {
      await submit.reply({ content: 'Délai invalide. Exemples : 0, 10s, 1m, 1h, 1d.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    await submit.deferUpdate().catch(() => {});
    db.setGuildConfig(guildId, 'welcomeAutoDeleteDelay', parsed);
    await _refreshPanel(pnl, guildId);
    await submit.followUp({
      content: parsed > 0
        ? `Suppression automatique configurée sur \`${_formatDelay(parsed)}\`.`
        : 'Suppression automatique désactivée.',
      flags: 64,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  } finally {
    _setBusy(pnl, false);
  }
}


async function _optDmSet(guildId, pnl, i) {
  const config  = db.getGuildConfig(guildId) || {};
  const modalId = `local:joinsettings:modal:dm:${i.id}`;

  _setBusy(pnl, true);
  const shown = await i.showModal(
    new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('Message en MP')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('value')
            .setLabel('Message DM (max 1500)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1500)
            .setValue(config.welcomeDmMessage || '')
        )
      )
  ).then(() => true).catch(() => false);
  _setBusy(pnl, false);

  if (!shown) return;

  const submit = await _awaitJsModal(i, modalId);
  if (!submit) return;

  _setBusy(pnl, true);
  try {
    const raw = submit.fields.getTextInputValue('value').trim();

    if (!raw) {
      await submit.reply({ content: 'Message DM vide ignoré.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    if (raw.length > 1500) {
      await submit.reply({ content: 'Le message DM ne peut pas dépasser 1500 caractères.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    await submit.deferUpdate().catch(() => {});
    db.setGuildConfig(guildId, 'welcomeDmMessage', raw);
    db.setGuildConfig(guildId, 'welcomeDmEnabled', 1);
    await _refreshPanel(pnl, guildId);
    await submit.followUp({ content: 'Message MP défini et DM activé. Variables disponibles avec +variables.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
  } finally {
    _setBusy(pnl, false);
  }
}

async function _optDmClear(guildId, pnl, i) {
  const config = db.getGuildConfig(guildId) || {};
  const hasDmMessage = config.welcomeDmMessage && String(config.welcomeDmMessage).trim();

  if (Number(config.welcomeDmEnabled) !== 1 && !hasDmMessage) {
    await _ackInfo(i, 'Aucun message MP de bienvenue n\'est configuré.');
    return;
  }

  await i.deferUpdate().catch(() => {});
  db.setGuildConfig(guildId, 'welcomeDmMessage', null);
  db.setGuildConfig(guildId, 'welcomeDmEnabled', 0);
  await _refreshPanel(pnl, guildId);
  await i.followUp({ content: 'Message MP supprimé et DM désactivé.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
}


async function _optAfterVerify(guildId, pnl, i) {
  const config = db.getGuildConfig(guildId) || {};

  if (Number(config.verifyEnabled) !== 1) {
    await _ackInfo(i, 'Configurez d\'abord la vérification avec +verify setup.');
    return;
  }

  const next = Number(config.welcomeAfterVerify) === 1 ? 0 : 1;

  await i.deferUpdate().catch(() => {});
  db.setGuildConfig(guildId, 'welcomeAfterVerify', next);
  await _refreshPanel(pnl, guildId);
  await i.followUp({
    content: next === 1
      ? 'Welcome envoyé après vérification : activé.'
      : 'Welcome envoyé après vérification : désactivé.',
    flags: 64,
    allowedMentions: { parse: [] },
  }).catch(() => {});
}


async function _awaitJsModal(interaction, customId) {
  try {
    return await interaction.awaitModalSubmit({
      filter : s => s.customId === customId && s.user.id === interaction.user.id,
      time   : 5 * 60_000,
    });
  } catch {
    return null;
  }
}
