'use strict';


const { parseDuration, formatDuration } = require('../../utils/parseDuration.js');

const db              = require('../../core/database');
const embed           = require('../../utils/embed');
const perms           = require('../../utils/permissions');
const commandCooldown = require('../../utils/commandCooldown');
const config          = require('../../config.json');

const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const ENABLED_KEY     = '__enabled';
const SELF_NAMES      = new Set(['cmdcooldown', 'commandcooldown', 'cooldown', 'cmdcd']);

module.exports = {
  help: {
    name        : 'cmdcooldown',
    description : 'Configure les cooldowns des commandes du bot.',
    use         : 'cmdcooldown <on|off|list|default|reset|commande> [durée|off|reset]',
    usage       : 'cmdcooldown <on|off|list|default|reset|commande> [durée|off|reset]',
    aliases     : ['commandcooldown', 'cooldown', 'cmdcd'],
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        'Vous n\'avez pas la permission d\'utiliser cette commande.',
        { timestamp: false }
      );
    }

    if (typeof db.getCommandCooldown !== 'function') {
      return embed.replyError(
        message,
        'Les helpers DB des cooldowns ne sont pas chargés.',
        { timestamp: false }
      );
    }

    const guildConfig = db.getGuildConfig(guildId) || {};

    const deleteCmd   = Boolean(guildConfig?.autoDeleteModCmds);
    const deleteReply = Boolean(guildConfig?.autoDeleteModReplies);
    const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);
    const prefix      = guildConfig?.prefix ?? config.prefix ?? '+';

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const sub = args[0]?.toLowerCase();

    if (!sub || ['show', 'status'].includes(sub)) {
      return _showHelp(message, prefix, deleteReply, deleteDelay);
    }

    if (sub === 'on') {
      return _setEnabled(message, true, deleteReply, deleteDelay);
    }

    if (sub === 'off') {
      return _setEnabled(message, false, deleteReply, deleteDelay);
    }

    if (['list', 'ls'].includes(sub)) {
      return _listCooldowns(message, deleteReply, deleteDelay);
    }

    if (['clear', 'resetall'].includes(sub)) {
      return _clearAll(message, deleteReply, deleteDelay);
    }

    if (sub === 'default') {
      return _handleDefault(message, args.slice(1), deleteReply, deleteDelay);
    }

    if (sub === 'reset') {
      return _clearAll(message, deleteReply, deleteDelay);
    }

    return _handleCommandCooldown(client, message, args, deleteReply, deleteDelay);
  },
};

async function _setEnabled(message, enabled, deleteReply, deleteDelay) {
  const guildId = message.guild.id;

  if (enabled) {
    db.deleteCommandCooldown(guildId, ENABLED_KEY);

    return _sendReply(
      message,
      'Système de cooldown **activé** sur ce serveur.',
      deleteReply,
      deleteDelay
    );
  }

  db.setCommandCooldown(guildId, ENABLED_KEY, 0);

  return _sendReply(
    message,
    'Système de cooldown **désactivé** sur ce serveur. Aucun cooldown ne sera appliqué.',
    deleteReply,
    deleteDelay
  );
}

async function _handleDefault(message, args, deleteReply, deleteDelay) {
  const guildId = message.guild.id;
  const raw = args[0]?.toLowerCase();

  if (!raw) {
    const current = db.getCommandCooldown(guildId, commandCooldown.DEFAULT_KEY);

    return _sendReply(
      message,
      current === null || current === undefined
        ? 'Aucun cooldown par défaut personnalisé. Le bot utilise le fallback interne.'
        : `Cooldown par défaut actuel : \`${_formatCooldown(current)}\`.`,
      deleteReply,
      deleteDelay
    );
  }

  const parsed = _parseCooldownInput(raw);

  if (parsed.type === 'reset') {
    db.deleteCommandCooldown(guildId, commandCooldown.DEFAULT_KEY);

    return _sendReply(
      message,
      'Cooldown par défaut réinitialisé. Le bot utilisera le fallback interne.',
      deleteReply,
      deleteDelay
    );
  }

  if (!parsed.ok) {
    return _sendError(message, parsed.error, deleteReply, deleteDelay);
  }

  db.setCommandCooldown(guildId, commandCooldown.DEFAULT_KEY, parsed.ms);

  return _sendReply(
    message,
    parsed.ms === 0
      ? 'Cooldown par défaut désactivé pour ce serveur.'
      : `Cooldown par défaut défini sur \`${_formatCooldown(parsed.ms)}\`.`,
    deleteReply,
    deleteDelay
  );
}

async function _handleCommandCooldown(client, message, args, deleteReply, deleteDelay) {
  const guildId  = message.guild.id;
  const input    = args[0]?.toLowerCase();
  const rawValue = args[1]?.toLowerCase();

  const commandName = _resolveCommandName(client, message, input);

  if (!commandName) {
    return _sendError(
      message,
      `Commande introuvable : \`${input || 'inconnue'}\`.`,
      deleteReply,
      deleteDelay
    );
  }

  if (SELF_NAMES.has(commandName)) {
    return _sendError(
      message,
      'Cette commande ne peut pas recevoir de cooldown.',
      deleteReply,
      deleteDelay
    );
  }

  if (!rawValue) {
    const configured = db.getCommandCooldown(guildId, commandName);
    const effective  = commandCooldown.getCooldownMs(message, commandName, client.commands.get(commandName));

    const lines = [
      `Commande : \`${commandName}\``,
      `Cooldown configuré : ${
        configured === null || configured === undefined
          ? '`Aucun`'
          : `\`${_formatCooldown(configured)}\``
      }`,
      `Cooldown appliqué : \`${_formatCooldown(effective)}\``,
    ];

    return _sendReply(message, lines.join('\n'), deleteReply, deleteDelay);
  }

  const parsed = _parseCooldownInput(rawValue);

  if (parsed.type === 'reset') {
    db.deleteCommandCooldown(guildId, commandName);

    return _sendReply(
      message,
      `Cooldown de \`${commandName}\` réinitialisé. Le bot utilisera le cooldown par défaut ou le fallback interne.`,
      deleteReply,
      deleteDelay
    );
  }

  if (!parsed.ok) {
    return _sendError(message, parsed.error, deleteReply, deleteDelay);
  }

  db.setCommandCooldown(guildId, commandName, parsed.ms);

  return _sendReply(
    message,
    parsed.ms === 0
      ? `Cooldown de \`${commandName}\` désactivé.`
      : `Cooldown de \`${commandName}\` défini sur \`${_formatCooldown(parsed.ms)}\`.`,
    deleteReply,
    deleteDelay
  );
}

async function _listCooldowns(message, deleteReply, deleteDelay) {
  const guildId = message.guild.id;
  const rows    = db.getCommandCooldowns(guildId);

  if (!rows.length) {
    return _sendReply(
      message,
      'Aucun cooldown personnalisé sur ce serveur.',
      deleteReply,
      deleteDelay
    );
  }

  const enabled = db.getCommandCooldown(guildId, ENABLED_KEY);
  const isOff   = enabled !== null && enabled !== undefined && Number(enabled) === 0;

  const lines = rows
    .filter(row => row.commandName !== ENABLED_KEY)
    .slice(0, 25)
    .map(row => {
      const name = row.commandName === commandCooldown.DEFAULT_KEY
        ? '__default'
        : row.commandName;

      return `\`${name}\` : \`${_formatCooldown(row.cooldownMs)}\``;
    });

  const extra = rows.length > 25
    ? `\nEt \`${rows.length - 25}\` autre(s).`
    : '';

  const statusLine = isOff
    ? 'Système de cooldown **désactivé** sur ce serveur.\n\n'
    : '';

  const content = lines.length
    ? `${statusLine}${lines.join('\n')}${extra}`
    : `${statusLine}Aucun cooldown personnalisé configuré.`;

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        content,
        {
          title    : 'Cooldowns des commandes',
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

async function _clearAll(message, deleteReply, deleteDelay) {
  const count = db.clearCommandCooldowns(message.guild.id);

  return _sendReply(
    message,
    count
      ? `Tous les cooldowns personnalisés ont été supprimés (\`${count}\`).`
      : 'Aucun cooldown personnalisé à supprimer.',
    deleteReply,
    deleteDelay
  );
}

function _resolveCommandName(client, message, input) {
  const name = String(input || '').trim().toLowerCase();

  if (!name) return null;
  if (name === 'default') return null;

  const command = client.commands.get(name);

  if (command?.help?.name) {
    return command.help.name.toLowerCase();
  }

  if (typeof db.getCustomCommand === 'function') {
    const custom = db.getCustomCommand(message.guild.id, name);
    if (custom) return name;
  }

  return null;
}

function _parseCooldownInput(input) {
  const raw = String(input || '').trim().toLowerCase();

  if (!raw) {
    return {
      ok   : false,
      error: 'Durée manquante. Exemple : `5s`, `10s`, `1m`, `off` ou `reset`.',
    };
  }

  if (['reset', 'default', 'remove', 'delete'].includes(raw)) {
    return { type: 'reset' };
  }

  if (['off', 'disable', 'disabled', '0', 'none'].includes(raw)) {
    return { ok: true, ms: 0 };
  }

  const parsed = parseDuration(raw);

  if (!parsed) {
    return {
      ok   : false,
      error: 'Durée invalide. Exemples : `5s`, `10s`, `1m`, `1h`, `off`.',
    };
  }

  if (parsed < 1000) {
    return {
      ok   : false,
      error: 'Le cooldown minimum est de `1s`.',
    };
  }

  if (parsed > MAX_COOLDOWN_MS) {
    return {
      ok   : false,
      error: 'Le cooldown maximum est de `24h`.',
    };
  }

  return {
    ok: true,
    ms: parsed,
  };
}

function _formatCooldown(value) {
  const cooldownMs = Number(value) || 0;
  if (cooldownMs <= 0) return 'off';
  return formatDuration(cooldownMs, { format: 'fr-long' }) || `${cooldownMs}ms`;
}

async function _showHelp(message, prefix, deleteReply, deleteDelay) {
  return _sendReply(
    message,
    `Utilisation :\n` +
    `\`${prefix}cmdcooldown on\` - Active le système de cooldown.\n` +
    `\`${prefix}cmdcooldown off\` - Désactive totalement les cooldowns.\n` +
    `\`${prefix}cmdcooldown list\` - Affiche les réglages personnalisés.\n` +
    `\`${prefix}cmdcooldown default <durée|off|reset>\` - Cooldown par défaut.\n` +
    `\`${prefix}cmdcooldown <commande> <durée|off|reset>\` - Configure une commande.\n` +
    `\`${prefix}cmdcooldown <commande>\` - Affiche le cooldown d\'une commande.\n` +
    `\`${prefix}cmdcooldown reset\` - Supprime toute la configuration.\n\n` +
    `Exemples :\n` +
    `\`${prefix}cmdcooldown pic 5s\`\n` +
    `\`${prefix}cmdcooldown embed 15s\`\n` +
    `\`${prefix}cmdcooldown massiverole 1m\`\n` +
    `\`${prefix}cmdcooldown default 2s\`\n` +
    `\`${prefix}cmdcooldown banner off\`\n` +
    `\`${prefix}cmdcooldown moncustom 10s\``,
    deleteReply,
    deleteDelay
  );
}

async function _sendReply(message, content, deleteReply, deleteDelay) {
  const sent = await embed.reply(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
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
