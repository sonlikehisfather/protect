'use strict';


const { ActivityType } = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');
const config = require('../../config.json');

const ROTATE_MS = 30_000;
const MAX_ACTIVITIES = 10;
const MAX_ACTIVITY_LENGTH = 128;

const ACTIVITY_TYPES = {
  playto: {
    type : ActivityType.Playing,
    name : 'playto',
    label: 'Joue à',
  },

  listen: {
    type : ActivityType.Listening,
    name : 'listen',
    label: 'Écoute',
  },

  watch: {
    type : ActivityType.Watching,
    name : 'watch',
    label: 'Regarde',
  },

  compet: {
    type : ActivityType.Competing,
    name : 'compet',
    label: 'Participe à',
  },

  stream: {
    type : ActivityType.Streaming,
    name : 'stream',
    label: 'Stream',
  },
};

module.exports = {
  help: {
    name        : 'activity',
    description : "Gère l'activité du bot.",
    use         : 'activity <playto/listen/watch/compet/stream/reset/remove> [message]',
    usage       : 'activity <playto/listen/watch/compet/stream/reset/remove> [message]',
    aliases     : ['playto', 'listen', 'watch', 'compet', 'stream', 'remove'],
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

    if (invoked === 'remove') {
      return _handleRemoveActivity(client, message, args, deleteReply, deleteDelay);
    }

    if (invoked === 'activity') {
      return _handleActivityCommand(client, message, args, deleteReply, deleteDelay);
    }

    const activityConfig = ACTIVITY_TYPES[invoked];

    if (!activityConfig) {
      return _sendUsage(message, deleteReply, deleteDelay);
    }

    return _setActivityFromInput(
      client,
      message,
      activityConfig,
      invoked,
      args.join(' ').trim(),
      deleteReply,
      deleteDelay
    );
  },
};

async function _handleActivityCommand(client, message, args, deleteReply, deleteDelay) {
  const action = args[0]?.toLowerCase();

  if (!action) {
    const current = client.user?.presence?.activities?.[0];

    if (!current) {
      return _sendReply(
        message,
        `Aucune activité configurée.\nUtilisation : \`${message.prefix || '+'}activity <playto/listen/watch/compet/stream/reset/remove>\``,
        deleteReply,
        deleteDelay
      );
    }

    return _sendReply(
      message,
      `Activité actuelle : \`${current.name}\`.\nUtilisation : \`${message.prefix || '+'}activity <playto/listen/watch/compet/stream/reset/remove>\``,
      deleteReply,
      deleteDelay
    );
  }

  if (['reset', 'default', 'base'].includes(action)) {
    return _resetDefaultActivity(client, message, deleteReply, deleteDelay);
  }

  if (['remove', 'clear', 'off'].includes(action)) {
    return _clearBotActivity(client, message, deleteReply, deleteDelay);
  }

  const activityConfig = ACTIVITY_TYPES[action];

  if (!activityConfig) {
    return _sendUsage(message, deleteReply, deleteDelay);
  }

  return _setActivityFromInput(
    client,
    message,
    activityConfig,
    action,
    args.slice(1).join(' ').trim(),
    deleteReply,
    deleteDelay
  );
}

async function _handleRemoveActivity(client, message, args, deleteReply, deleteDelay) {
  const sub = args[0]?.toLowerCase();

  if (!['activity', 'activité', 'activite'].includes(sub)) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}remove activity\``,
      deleteReply,
      deleteDelay
    );
  }

  return _clearBotActivity(client, message, deleteReply, deleteDelay);
}

async function _setActivityFromInput(client, message, activityConfig, invoked, raw, deleteReply, deleteDelay) {
  if (!raw) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}${activityConfig.name} <message>\``,
      deleteReply,
      deleteDelay
    );
  }

  const streamData = invoked === 'stream'
    ? _parseStreamInput(raw, client)
    : { text: raw, url: null };

  const activities = _parseActivities(streamData.text);

  if (!activities.length) {
    return _sendError(
      message,
      'Vous devez indiquer au moins un message valide.',
      deleteReply,
      deleteDelay
    );
  }

  const tooLong = activities.find(activity => activity.length > MAX_ACTIVITY_LENGTH);

  if (tooLong) {
    return _sendError(
      message,
      `Une activité ne peut pas dépasser ${MAX_ACTIVITY_LENGTH} caractères.`,
      deleteReply,
      deleteDelay
    );
  }

  if (activities.length > MAX_ACTIVITIES) {
    return _sendError(
      message,
      `Vous ne pouvez pas définir plus de ${MAX_ACTIVITIES} activités en rotation.`,
      deleteReply,
      deleteDelay
    );
  }

  if (invoked === 'stream' && !_isValidStreamUrl(streamData.url)) {
    return _sendError(
      message,
      `URL de stream invalide. Utilisation : \`${message.prefix || '+'}activity stream Live du serveur | https://twitch.tv/mysoulislost\``,
      deleteReply,
      deleteDelay
    );
  }

  const applied = await _setActivity(client, {
    type     : activityConfig.type,
    label    : activityConfig.label,
    messages : activities,
    url      : streamData.url,
  });

  if (applied) {
    db.setBotActivity(
      String(activityConfig.type),
      JSON.stringify(activities),
      streamData.url || null,
      client.__presenceStatus || 'online'
    );
  }

  if (!applied) {
    return _sendError(
      message,
      "Impossible de modifier l'activité du bot.",
      deleteReply,
      deleteDelay
    );
  }

  const rotationText = activities.length > 1
    ? `\nRotation : \`${activities.length}\` messages toutes les \`${ROTATE_MS / 1000}s\`.`
    : '';

  const streamText = invoked === 'stream'
    ? `\nURL : \`${streamData.url}\``
    : '';

  return _sendReply(
    message,
    `Activité du bot modifiée : \`${activityConfig.label} ${activities[0]}\`.${rotationText}${streamText}`,
    deleteReply,
    deleteDelay
  );
}

function _clearBotActivity(client, message, deleteReply, deleteDelay) {
  _clearActivityRotation(client);

  client.__customActivityLocked = true;
  db.clearBotActivity();

  const status = client.__presenceStatus
    || client.user?.presence?.status
    || 'online';

  try {
    client.user.setPresence({
      status,
      activities: [],
    });
  } catch {
    return _sendError(
      message,
      "Impossible de supprimer l'activité du bot.",
      deleteReply,
      deleteDelay
    );
  }

  return _sendReply(
    message,
    'Activité du bot supprimée.',
    deleteReply,
    deleteDelay
  );
}

function _resetDefaultActivity(client, message, deleteReply, deleteDelay) {
  _clearActivityRotation(client);

  client.__customActivityLocked = false;
  db.clearBotActivity();

  try {
    if (typeof client.__setDefaultPresence === 'function') {
      client.__setDefaultPresence();
    } else {
      const status = client.__presenceStatus
        || client.user?.presence?.status
        || 'online';

      client.user.setPresence({
        status,
        activities: [],
      });
    }
  } catch {
    return _sendError(
      message,
      "Impossible de remettre l'activité de base.",
      deleteReply,
      deleteDelay
    );
  }

  return _sendReply(
    message,
    'Activité de base remise.',
    deleteReply,
    deleteDelay
  );
}

async function _setActivity(client, data) {
  _clearActivityRotation(client);

  client.__customActivityLocked = true;

  const messages = data.messages;
  let index = 0;

  const apply = () => {
    const name = messages[index];

    const activity = {
      name,
      type: data.type,
    };

    if (data.type === ActivityType.Streaming && data.url) {
      activity.url = data.url;
    }

    const status = client.__presenceStatus
      || client.user?.presence?.status
      || 'online';

    client.user.setPresence({
      status,
      activities: [activity],
    });
  };

  try {
    apply();
  } catch {
    return false;
  }

  if (messages.length > 1) {
    const interval = setInterval(() => {
      index = (index + 1) % messages.length;

      try {
        apply();
      } catch (err) {

        console.error('[activity] Erreur lors de la rotation d\'activité :', err?.message ?? err);
      }
    }, ROTATE_MS);

    if (typeof interval.unref === 'function') {
      interval.unref();
    }

    client.__activityRotation = interval;
  }

  return true;
}

function _clearActivityRotation(client) {
  if (client.__activityRotation) {
    clearInterval(client.__activityRotation);
    client.__activityRotation = null;
  }
}

function _parseActivities(raw) {
  return String(raw || '')
    .split(/,,|,/)
    .map(part => part.trim())
    .filter(Boolean);
}

function _parseStreamInput(raw, client) {
  const text = String(raw || '').trim();

  if (text.includes('|')) {
    const [messagePart, urlPart] = text.split('|').map(part => part.trim());

    return {
      text: messagePart,
      url : urlPart || _defaultStreamUrl(client),
    };
  }

  const parts = text.split(/\s+/);
  const last  = parts[parts.length - 1];

  if (_isValidStreamUrl(last)) {
    return {
      text: parts.slice(0, -1).join(' ').trim(),
      url : last,
    };
  }

  return {
    text,
    url: _defaultStreamUrl(client),
  };
}

function _defaultStreamUrl(client) {
  const rawName = client.user?.username || 'stream';
  const name = rawName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24) || 'stream';


  return `https://www.twitch.tv/mysoulislost`;
}

function _isValidStreamUrl(value) {
  if (!value) return false;

  try {
    const url = new URL(value);

    if (!['http:', 'https:'].includes(url.protocol)) return false;

    const validHost =
      url.hostname.includes('twitch.tv') ||
      url.hostname.includes('youtube.com') ||
      url.hostname.includes('youtu.be');

    if (!validHost) return false;

    const path = url.pathname.replace(/^\/+/, '').trim();
    return path.length >= 2;
  } catch {
    return false;
  }
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

async function _sendUsage(message, deleteReply, deleteDelay) {
  return _sendError(
    message,
    `Utilisation :\n` +
    `\`${message.prefix || '+'}activity\`\n` +
    `\`${message.prefix || '+'}activity playto <message>\`\n` +
    `\`${message.prefix || '+'}activity listen <message>\`\n` +
    `\`${message.prefix || '+'}activity watch <message>\`\n` +
    `\`${message.prefix || '+'}activity compet <message>\`\n` +
    `\`${message.prefix || '+'}activity stream <message> [| url]\`\n` +
    `\`${message.prefix || '+'}activity reset\`\n` +
    `\`${message.prefix || '+'}activity remove\`\n` +
    `\`${message.prefix || '+'}remove activity\`\n\n` +
    `Si les aliases sont chargés par le loader :\n` +
    `\`${message.prefix || '+'}playto <message>\`, \`${message.prefix || '+'}listen <message>\`, \`${message.prefix || '+'}watch <message>\`, \`${message.prefix || '+'}compet <message>\`, \`${message.prefix || '+'}stream <message>\`.\n\n` +
    `Plusieurs messages peuvent être séparés par des virgules.`,
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
