'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');

const PERM_LABELS = {
  everyone : 'Tout le monde',
  public   : 'Public',
  '1'      : 'Perm 1',
  '2'      : 'Perm 2',
  '3'      : 'Perm 3',
  '4'      : 'Perm 4',
  '5'      : 'Perm 5',
  '6'      : 'Perm 6',
  '7'      : 'Perm 7',
  '8'      : 'Perm 8',
  '9'      : 'Perm 9',
  owner    : 'Owner',
  buyer    : 'Buyer',
  perm1    : 'Perm 1',
  perm2    : 'Perm 2',
  perm3    : 'Perm 3',
  perm4    : 'Perm 4',
  perm5    : 'Perm 5',
  perm6    : 'Perm 6',
  perm7    : 'Perm 7',
  perm8    : 'Perm 8',
  perm9    : 'Perm 9',
};

const BYPASS_LABELS = {
  globalOwner : 'Owners',
  buyer       : 'Buyer',
};

const DISCORD_PERM_LABELS = {
  Administrator      : 'Administrateur',
  BanMembers         : 'Bannir',
  KickMembers        : 'Expulser',
  ModerateMembers    : 'Timeout',
  ManageRoles        : 'Gérer les rôles',
  ManageChannels     : 'Gérer les salons',
  ManageMessages     : 'Gérer les messages',
  MoveMembers        : 'Déplacer',
  SendMessages       : 'Écrire',
  ViewChannel        : 'Voir',
  ManageGuild        : 'Gérer le serveur',
  ManageNicknames    : 'Gérer les pseudos',
  ManageWebhooks     : 'Gérer les webhooks',
  MentionEveryone    : 'Mentionner @everyone',
  AttachFiles        : 'Joindre des fichiers',
  EmbedLinks         : 'Intégrer des liens',
  ReadMessageHistory : 'Lire l\'historique',
  AddReactions       : 'Ajouter des réactions',
  Connect            : 'Vocal',
  Speak              : 'Parler en vocal',
  MuteMembers        : 'Rendre muet',
  DeafenMembers      : 'Rendre sourd',
};

const CATEGORY_LABELS = {
  general      : 'Général',
  owner        : 'Owner',
  antiraid     : 'Antiraid',
  server       : 'Serveur',
  configserver : 'Configuration du serveur',
  logs         : 'Logs',
  config       : 'Configuration',
  moderation   : 'Modération',
  tickets      : 'Tickets',
  levels       : 'Niveaux',
  giveaways    : 'Giveaways',
};

const SENSITIVE_ACTIONS = new Set([
  'role_add', 'role_remove', 'role_toggle', 'role_sync',
  'ban', 'kick', 'mute', 'delete_message',
]);

const NATIVE_NOTES = {
  mute : 'Utilise le système de mute configuré sur le serveur.',
};

const SENSITIVE_ACTION_LABELS = {
  role_add       : 'Gestion de rôles',
  role_remove    : 'Gestion de rôles',
  role_toggle    : 'Gestion de rôles',
  role_sync      : 'Synchronisation de rôles',
  delete_message : 'Suppression de message',
  ban            : 'Bannissement',
  kick           : 'Expulsion',
  mute           : 'Mute',
};

module.exports = {
  help: {
    name        : 'cmdperms',
    description : 'Affiche les permissions d\'une commande native ou custom.',
    usage       : 'cmdperms <commande> | cmdperms custom:<nom>',
    aliases     : ['cmdperm', 'commandperms'],
  },

  async run(client, message, args) {
    const guildId = message.guild.id;
    const prefix  = message.prefix || '+';

    if (!args[0]) {
      return embed.replyError(
        message,
        'Utilisation : `cmdperms <commande|custom:<nom>>`',
        { timestamp: false }
      );
    }

    const raw = args[0].toLowerCase().replace(/^\+/, '');

    if (raw.startsWith('custom:')) {
      const customName = raw.slice(7);
      if (!customName) {
        return embed.replyError(message, 'Precisez le nom apres custom:.', { timestamp: false });
      }
      const cc = db.getCustomCommand(guildId, customName);
      if (!cc) {
        return embed.replyError(message, 'Commande introuvable.', { timestamp: false });
      }
      return _replyCustom(message, cc);
    }

    const command = client.commands.get(raw);

    if (command) {
      const hasCustomDuplicate = !!db.getCustomCommand(guildId, raw);
      return _replyNative(message, guildId, command, raw, hasCustomDuplicate, prefix);
    }

    const cc = db.getCustomCommand(guildId, raw);
    if (cc) {
      return _replyCustom(message, cc);
    }

    return embed.replyError(message, 'Commande introuvable.', { timestamp: false });
  },
};

function _replyNative(message, guildId, command, cmdName, hasCustomDuplicate, prefix) {
  const help     = command.help || {};
  const realName = help.name || cmdName;
  const perm     = help.permission || null;

  const dbPerm  = db.getCmdPerm(guildId, realName);
  const dbLabel = PERM_LABELS[dbPerm] || dbPerm;

  const aliases  = help.aliases?.length
    ? help.aliases.map(a => `\`${a}\``).join(', ')
    : 'Aucun';
  const category = CATEGORY_LABELS[help.category] || help.category || 'inconnue';

  const lines = [];

  lines.push(`> **Commande :** \`${realName}\``);
  lines.push(`> **Catégorie :** ${category}`);
  lines.push(`> **Alias :** ${aliases}`);

  lines.push('');
  lines.push(`> **Permission :** ${dbLabel}`);

  if (perm) {
    if (perm.discord?.length) {
      lines.push(`> **Bot :** ${perm.discord.map(p => _translateDiscordPerm(p)).join(', ')}`);
    }
    if (perm.targetProtection) {
      lines.push('> **Protection :** Oui');
    }
    if (perm.bypass?.length) {
      const bypassStr = perm.bypass.map(b => BYPASS_LABELS[b] || b).join(', ');
      lines.push('');
      lines.push(`> **Accès :** ${bypassStr}`);
    }
    const humanNote = NATIVE_NOTES[realName];
    if (humanNote) {
      lines.push(`> **Note :** ${humanNote}`);
    }
  }

  if (help.selfManaged) {
    lines.push('');
    lines.push('-# Permissions gerees en interne par cette commande.');
  }

  if (hasCustomDuplicate) {
    lines.push('');
    lines.push(`-# Une commande personnalisee du meme nom existe. Utilise \`${prefix}cmdperms custom:${realName}\` pour la voir.`);
  }

  return embed.reply(message, lines.join('\n'), {
    title           : 'Permissions de commande',
    timestamp       : false,
    allowedMentions : { parse: [] },
  });
}

function _replyCustom(message, cc) {
  const perm      = (cc.customPerm || 'everyone').toLowerCase();
  const permLabel = PERM_LABELS[perm] || perm;

  const MODE_LABELS = {
    local  : 'Dans le salon',
    dm     : 'En message privé',
    fixed  : 'Dans un salon défini',
    remote : 'Dans le salon configuré',
  };
  const mode    = (cc.responseMode || 'local').toLowerCase();
  const modeStr = (mode === 'fixed' && cc.responseChannelId)
    ? `Dans un salon défini (<#${cc.responseChannelId}>)`
    : (MODE_LABELS[mode] || mode);

  const lines = [];

  lines.push(`> **Commande :** \`${cc.name}\``);
  lines.push(`> **État :** ${cc.enabled ? 'Activée' : 'Désactivée'}`);
  lines.push(`> **Permission :** ${permLabel}`);

  lines.push('');
  lines.push(`> **Réponse :** ${modeStr}`);
  lines.push(`> **Message supprimé :** ${cc.deleteMsg ? 'Oui' : 'Non'}`);

  const allowed = _parseJsonArray(cc.allowedChannelIds);
  const blocked = _parseJsonArray(cc.blockedChannelIds);
  const cd = Number(cc.cooldown ?? 0);
  if (allowed.length || blocked.length || cc.requiredRoleId || cc.deniedRoleId || cd > 0) {
    lines.push('');
    if (allowed.length)    lines.push(`> **Salons autorisés :** ${allowed.map(id => `<#${id}>`).join(', ')}`);
    if (blocked.length)    lines.push(`> **Salons bloqués :** ${blocked.map(id => `<#${id}>`).join(', ')}`);
    if (cc.requiredRoleId) lines.push(`> **Rôle requis :** <@&${cc.requiredRoleId}>`);
    if (cc.deniedRoleId)   lines.push(`> **Rôle interdit :** <@&${cc.deniedRoleId}>`);
    if (cd > 0)            lines.push(`> **Cooldown :** ${cd}s`);
  }

  const btnCount  = _countJson(cc.buttonsJson);
  const selCount  = _countJson(cc.selectsJson);
  const v2Count   = _countJson(cc.componentsJson);
  const compParts = [];
  if (btnCount > 0) compParts.push(`boutons ${btnCount}`);
  if (selCount > 0) compParts.push(`menus ${selCount}`);
  if (v2Count > 0)  compParts.push(`composants V2 ${v2Count}`);

  const actions = _detectSensitiveActions(cc);
  const translatedActions = [...new Set(actions.map(a => SENSITIVE_ACTION_LABELS[a] || a))];
  const isPublicPerm = perm === 'everyone' || perm === 'public' || !cc.customPerm;
  const hasExtras = compParts.length || translatedActions.length || cc.description || (isPublicPerm && translatedActions.length > 0);

  if (hasExtras) {
    lines.push('');
    if (compParts.length)         lines.push(`> **Composants :** ${compParts.join(', ')}`);
    if (translatedActions.length) lines.push(`> **Actions sensibles :** ${translatedActions.join(', ')}`);
    if (cc.description)           lines.push(`> ${cc.description}`);
    if (isPublicPerm && translatedActions.length > 0) {
      lines.push('> Attention : custom publique avec action sensible.');
    }
  }

  return embed.reply(message, lines.join('\n'), {
    title           : 'Permissions de commande personnalisée',
    timestamp       : false,
    allowedMentions : { parse: [] },
  });
}

function _parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function _countJson(raw) {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function _translateDiscordPerm(perm) {
  if (DISCORD_PERM_LABELS[perm]) return DISCORD_PERM_LABELS[perm];
  return perm.replace(/([A-Z])/g, ' $1').trim();
}

function _detectSensitiveActions(cc) {
  const found = new Set();

  const roles = _parseJsonArray(cc.rolesJson);
  for (const entry of roles) {
    if (!entry?.action) continue;
    const mapped = `role_${entry.action}`;
    if (SENSITIVE_ACTIONS.has(mapped)) found.add(mapped);
  }

  _scanLegacyButtons(cc.buttonsJson, found);

  _scanLegacySelects(cc.selectsJson, found);

  _scanV2Components(cc.componentsJson, found);

  _scanV2Components(cc.componentsPagesJson, found);

  if (cc.deleteMsg) found.add('delete_message');

  return [...found].sort();
}

function _scanLegacyButtons(raw, found) {
  const arr = _parseJsonArray(raw);
  for (const btn of arr) {
    if (btn?.type === 'custom' && btn?.mode) {
      if (SENSITIVE_ACTIONS.has(btn.mode)) found.add(btn.mode);
    }
  }
}

function _scanLegacySelects(raw, found) {
  const arr = _parseJsonArray(raw);
  for (const sel of arr) {
    const options = Array.isArray(sel?.options) ? sel.options : [];
    for (const opt of options) {
      if (opt?.mode && SENSITIVE_ACTIONS.has(opt.mode)) found.add(opt.mode);
    }
  }
}

function _scanV2Components(raw, found) {
  const arr = _parseJsonArray(raw);
  for (const item of arr) {
    if (item?.action?.type && SENSITIVE_ACTIONS.has(item.action.type)) {
      found.add(item.action.type);
    }
    if (Array.isArray(item?.actions)) {
      for (const a of item.actions) {
        if (a?.type && SENSITIVE_ACTIONS.has(a.type)) found.add(a.type);
      }
    }
    if (Array.isArray(item?.options)) {
      for (const opt of item.options) {
        if (opt?.action?.type && SENSITIVE_ACTIONS.has(opt.action.type)) {
          found.add(opt.action.type);
        }
        if (Array.isArray(opt?.actions)) {
          for (const a of opt.actions) {
            if (a?.type && SENSITIVE_ACTIONS.has(a.type)) found.add(a.type);
          }
        }
      }
    }
  }
}
