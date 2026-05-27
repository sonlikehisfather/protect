'use strict';


const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');
const config = require('../../config.json');

const STATUSES = {
  online: {
    value: 'online',
    label: 'En ligne',
  },

  idle: {
    value: 'idle',
    label: 'Inactif',
  },

  dnd: {
    value: 'dnd',
    label: 'Ne pas déranger',
  },

  invisible: {
    value: 'invisible',
    label: 'Invisible',
  },
};

module.exports = {
  help: {
    name        : 'status',
    description : 'Change le statut du bot.',
    use         : 'status <online/idle/dnd/invisible>',
    usage       : 'status <online/idle/dnd/invisible>',
    aliases     : ['online', 'idle', 'dnd', 'invisible'],
    category    : 'owner',
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

    const guildConfig = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
    const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
    const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

    const prefix      = guildConfig?.prefix ?? config.prefix ?? '+';

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const invoked = _getInvokedName(message, prefix).toLowerCase();

    if (invoked === 'status') {
      const wanted = args[0]?.toLowerCase();

      if (!wanted) {
        return _showCurrentStatus(client, message, deleteReply, deleteDelay);
      }

      return _setStatus(client, message, wanted, deleteReply, deleteDelay);
    }

    return _setStatus(client, message, invoked, deleteReply, deleteDelay);
  },
};

async function _showCurrentStatus(client, message, deleteReply, deleteDelay) {
  const current = client.__presenceStatus
    || client.user?.presence?.status
    || 'online';

  const label = _statusLabel(current);

  return _sendReply(
    message,
    `Statut actuel du bot : \`${label}\`.\nUtilisation : \`${message.prefix || '+'}status <online/idle/dnd/invisible>\``,
    deleteReply,
    deleteDelay
  );
}

async function _setStatus(client, message, status, deleteReply, deleteDelay) {
  const data = STATUSES[status];

  if (!data) {
    return _sendError(
      message,
      `Statut invalide. Utilisation : \`${message.prefix || '+'}status <online/idle/dnd/invisible>\``,
      deleteReply,
      deleteDelay
    );
  }

  try {
    client.user.setStatus(data.value);
    client.__presenceStatus = data.value;

    const saved = db.getBotActivity();
    if (saved && !saved.removed) {
      db.setBotActivity(saved.type, saved.messages, saved.url, data.value);
    } else {
      db.setBotActivity(null, JSON.stringify([]), null, data.value);
    }
  } catch {
    return _sendError(
      message,
      'Impossible de modifier le statut du bot.',
      deleteReply,
      deleteDelay
    );
  }

  return _sendReply(
    message,
    `Statut du bot défini sur \`${data.label}\`.`,
    deleteReply,
    deleteDelay
  );
}

function _statusLabel(status) {
  return Object.values(STATUSES).find(data => data.value === status)?.label ?? status;
}


function _getInvokedName(message, prefix) {
  const content = String(message.content || '');

  if (content.startsWith(prefix)) {
    return content
      .slice(prefix.length)
      .trim()
      .split(/\s+/)[0] || module.exports.help.name;
  }

  return module.exports.help.name;
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
