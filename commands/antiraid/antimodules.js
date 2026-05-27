'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { startAntidecoGuild, stopAntidecoGuild, } = require('../../events/voiceStateUpdate');
const { parseDuration } = require('../../utils/parseDuration.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');


function _getDeleteOptions(guildId) {
  const config = db.getGuildConfig(guildId);

  return {
    deleteCmd   : Boolean(config?.autoDeleteModCmds),
    deleteReply : Boolean(config?.autoDeleteModReplies),
    deleteDelay : config?.autoDeleteDelay ?? 5,
  };
}

async function _deleteCommand(message, options) {
  if (options.deleteCmd) {
    await message.delete().catch(() => {});
  }
}

async function _send(message, guildId, content, options = {}, deleteOptions = null) {
  const sent = await message.channel.send({
    embeds: [
      embed.build(guildId, content, {
        timestamp : false,
        ...options,
      })
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteOptions?.deleteReply) {
    embed.scheduleDelete(sent, deleteOptions.deleteDelay);
  }

  return sent;
}

async function _sendError(message, content, deleteOptions = null) {
  const sent = await embed.replyError(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteOptions?.deleteReply) {
    embed.scheduleDelete(sent, deleteOptions.deleteDelay);
  }

  return sent;
}

function _statusLabel(value) {
  return value ? 'Activé' : 'Désactivé';
}

function _parseWindow(raw) {
  const num = Number(raw);
  if (!isNaN(num) && num > 0) return Math.floor(num);
  const parsed = parseDuration(raw, { unit: 's' });
  if (parsed === null || parsed <= 0) return null;
  return parsed;
}

function _safeSetAntiraidConfig(guildId, key, value) {
  try {
    db.setAntiraidConfig(guildId, key, value);
    return true;
  } catch {
    return false;
  }
}

async function _toggle(message, guildId, key, value, label, deleteOptions) {
  const current = Number(db.getAntiraidConfig(guildId)?.[key] ?? 0);
  if (current === Number(value)) {
    return _sendError(
      message,
      `${label} est déjà ${value ? 'activé' : 'désactivé'}.`,
      deleteOptions
    );
  }

  if (value) db.setGuildConfig(guildId, 'antiraidEnabled', 1);
  db.setAntiraidConfig(guildId, key, value);
  return _send(
    message,
    guildId,
    `${label} ${value ? 'activé' : 'désactivé'}.`,
    {},
    deleteOptions
  );
}

async function _threshold(message, guildId, keyThreshold, keyWindow, threshold, window, label, deleteOptions) {
  const cfg = db.getAntiraidConfig(guildId) || {};
  if (Number(cfg[keyThreshold]) === Number(threshold) && Number(cfg[keyWindow]) === Number(window)) {
    return _sendError(
      message,
      'Cette valeur est déjà configurée.',
      deleteOptions
    );
  }

  db.setAntiraidConfig(guildId, keyThreshold, threshold);
  db.setAntiraidConfig(guildId, keyWindow, window);

  return _send(
    message,
    guildId,
    `${label} configuré : **${threshold}** en **${window}** secondes.`,
    {},
    deleteOptions
  );
}

function _isMaxed(guildId, expected) {
  const cfg = db.getAntiraidConfig(guildId) || {};
  return Object.entries(expected).every(([k, v]) => {
    if (typeof v === 'number') return Number(cfg[k] ?? 0) === v;
    return String(cfg[k] ?? '') === String(v);
  });
}


exports.antibanHelp = {
  name        : 'antiban',
  description : 'Configurer l’antiban.',
  usage       : 'antiban <on|off|max|<nombre>/<durée>>',
};

exports.antibanRun = async (client, message, args) => {
  const guildId       = message.guild.id;
  const arg           = args[0]?.toLowerCase();
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'antiban')) return;

  await _deleteCommand(message, deleteOptions);

  if (arg === 'on') {
    return _toggle(message, guildId, 'antibanEnabled', 1, 'Antiban', deleteOptions);
  }

  if (arg === 'off') {
    return _toggle(message, guildId, 'antibanEnabled', 0, 'Antiban', deleteOptions);
  }

  if (arg === 'max') {
    if (_isMaxed(guildId, { antibanEnabled: 1, antibanThreshold: 1, antibanWindow: 10, antibanPunish: 'derank' })) {
      return _sendError(message, 'Antiban est déjà en mode maximal.', deleteOptions);
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'antibanEnabled', 1);
    db.setAntiraidConfig(guildId, 'antibanThreshold', 1);
    db.setAntiraidConfig(guildId, 'antibanWindow', 10);
    db.setAntiraidConfig(guildId, 'antibanPunish', 'derank');

    return _send(
      message,
      guildId,
      'Antiban activé en mode maximal : **1** action en **10** secondes, punition **derank**.',
      {},
      deleteOptions
    );
  }

  const match = arg?.match(/^(\d+)\/(.+)$/);
  if (match) {
    const threshold = parseInt(match[1], 10);
    const window    = _parseWindow(match[2]);

    if (isNaN(threshold) || threshold < 1) {
      return _sendError(message, 'Le nombre d’actions doit être supérieur ou égal à **1**.', deleteOptions);
    }

    if (!window || window < 1) {
      return _sendError(message, 'La durée doit être supérieure ou égale à **1** seconde.', deleteOptions);
    }

    return _threshold(
      message,
      guildId,
      'antibanThreshold',
      'antibanWindow',
      threshold,
      window,
      'Antiban',
      deleteOptions
    );
  }

  const config = db.getAntiraidConfig(guildId);

  return _send(
    message,
    guildId,
    `Antiban : **${_statusLabel(config.antibanEnabled)}** - **${config.antibanThreshold}** action(s) en **${config.antibanWindow}** secondes - punition **${config.antibanPunish}**.`,
    {},
    deleteOptions
  );
};


exports.antibotHelp = {
  name        : 'antibot',
  description : 'Empêcher l’ajout de bots.',
  usage       : 'antibot <on|off|max>',
};

exports.antibotRun = async (client, message, args) => {
  const guildId       = message.guild.id;
  const arg           = args[0]?.toLowerCase();
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'antibot')) return;

  await _deleteCommand(message, deleteOptions);

  if (arg === 'on') {
    return _toggle(message, guildId, 'antibotEnabled', 1, 'Antibot', deleteOptions);
  }

  if (arg === 'off') {
    return _toggle(message, guildId, 'antibotEnabled', 0, 'Antibot', deleteOptions);
  }

  if (arg === 'max') {
    if (_isMaxed(guildId, { antibotEnabled: 1, antibotPunish: 'ban' })) {
      return _sendError(message, 'Antibot est déjà en mode maximal.', deleteOptions);
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'antibotEnabled', 1);
    db.setAntiraidConfig(guildId, 'antibotPunish', 'ban');

    return _send(
      message,
      guildId,
      'Antibot activé en mode maximal - punition **ban**.',
      {},
      deleteOptions
    );
  }

  const config = db.getAntiraidConfig(guildId);

  return _send(
    message,
    guildId,
    `Antibot : **${_statusLabel(config.antibotEnabled)}** - punition **${config.antibotPunish}**.`,
    {},
    deleteOptions
  );
};


exports.antichannelHelp = {
  name        : 'antichannel',
  description : 'Empêcher la création ou suppression abusive de salons.',
  usage       : 'antichannel <on|off|max|<nombre>/<durée>>',
};

exports.antichannelRun = async (client, message, args) => {
  const guildId       = message.guild.id;
  const arg           = args[0]?.toLowerCase();
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'antichannel')) return;

  await _deleteCommand(message, deleteOptions);

  if (arg === 'on') {
    return _toggle(message, guildId, 'antichannelEnabled', 1, 'Antichannel', deleteOptions);
  }

  if (arg === 'off') {
    return _toggle(message, guildId, 'antichannelEnabled', 0, 'Antichannel', deleteOptions);
  }

  if (arg === 'max') {
    if (_isMaxed(guildId, { antichannelEnabled: 1, antichannelThreshold: 1, antichannelWindow: 5 })) {
      return _sendError(message, 'Antichannel est déjà en mode maximal.', deleteOptions);
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'antichannelEnabled', 1);
    db.setAntiraidConfig(guildId, 'antichannelThreshold', 1);
    db.setAntiraidConfig(guildId, 'antichannelWindow', 5);

    return _send(
      message,
      guildId,
      'Antichannel activé en mode maximal : **1** action en **5** secondes.',
      {},
      deleteOptions
    );
  }

  const match = arg?.match(/^(\d+)\/(.+)$/);
  if (match) {
    const threshold = parseInt(match[1], 10);
    const window    = _parseWindow(match[2]);

    if (isNaN(threshold) || threshold < 1) {
      return _sendError(message, 'Le nombre d’actions doit être supérieur ou égal à **1**.', deleteOptions);
    }

    if (!window || window < 1) {
      return _sendError(message, 'La durée doit être supérieure ou égale à **1** seconde.', deleteOptions);
    }

    return _threshold(
      message,
      guildId,
      'antichannelThreshold',
      'antichannelWindow',
      threshold,
      window,
      'Antichannel',
      deleteOptions
    );
  }

  const config = db.getAntiraidConfig(guildId);

  return _send(
    message,
    guildId,
    `Antichannel : **${_statusLabel(config.antichannelEnabled)}** - **${config.antichannelThreshold}** action(s) en **${config.antichannelWindow}** secondes.`,
    {},
    deleteOptions
  );
};


exports.antidecoHelp = {
  name        : 'antideco',
  description : 'Empêcher les déconnexions abusives en vocal.',
  usage       : 'antideco <on|off|max|<nombre>/<durée>>',
};

exports.antidecoRun = async (client, message, args) => {
  const guildId       = message.guild.id;
  const arg           = args[0]?.toLowerCase();
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'antideco')) return;

  await _deleteCommand(message, deleteOptions);

  if (arg === 'on') {
    const current = Number(db.getAntiraidConfig(guildId)?.antidecoEnabled ?? 0);
    if (current === 1) {
      return _sendError(message, 'Antideco est déjà activé.', deleteOptions);
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'antidecoEnabled', 1);
    startAntidecoGuild(client, message.guild);

    return _send(
      message,
      guildId,
      'Antideco activé.',
      {},
      deleteOptions
    );
  }

  if (arg === 'off') {
    const current = Number(db.getAntiraidConfig(guildId)?.antidecoEnabled ?? 0);
    if (current === 0) {
      return _sendError(message, 'Antideco est déjà désactivé.', deleteOptions);
    }

    db.setAntiraidConfig(guildId, 'antidecoEnabled', 0);
    stopAntidecoGuild(guildId);

    return _send(
      message,
      guildId,
      'Antideco désactivé.',
      {},
      deleteOptions
    );
  }

  if (arg === 'max') {
    if (_isMaxed(guildId, { antidecoEnabled: 1, antidecoThreshold: 3, antidecoWindow: 8, antidecoPunish: 'derank' })) {
      return _sendError(message, 'Antideco est déjà en mode maximal.', deleteOptions);
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'antidecoEnabled', 1);
    db.setAntiraidConfig(guildId, 'antidecoThreshold', 3);
    db.setAntiraidConfig(guildId, 'antidecoWindow', 8);
    db.setAntiraidConfig(guildId, 'antidecoPunish', 'derank');

    startAntidecoGuild(client, message.guild);

    return _send(
      message,
      guildId,
      'Antideco activé en mode maximal : **3** déconnexions en **8** secondes, punition **derank**.',
      {},
      deleteOptions
    );
  }

  const match = arg?.match(/^(\d+)\/(.+)$/);
  if (match) {
    const threshold = parseInt(match[1], 10);
    const window    = _parseWindow(match[2]);

    if (isNaN(threshold) || threshold < 1) {
      return _sendError(message, 'Le nombre d’actions doit être supérieur ou égal à **1**.', deleteOptions);
    }

    if (!window || window < 1) {
      return _sendError(message, 'La durée doit être supérieure ou égale à **1** seconde.', deleteOptions);
    }

    return _threshold(
      message,
      guildId,
      'antidecoThreshold',
      'antidecoWindow',
      threshold,
      window,
      'Antideco',
      deleteOptions
    );
  }

  const config = db.getAntiraidConfig(guildId);

  return _send(
    message,
    guildId,
    `Antideco : **${_statusLabel(config.antidecoEnabled)}** - **${config.antidecoThreshold ?? 0}** action(s) en **${config.antidecoWindow ?? 0}** secondes - punition **${config.antidecoPunish}**.`,
    {},
    deleteOptions
  );
};


exports.antiEveryoneHelp = {
  name        : 'antieveryone',
  description : 'Empêcher les mentions @everyone et @here abusives.',
  usage       : 'antieveryone <on|off|max|<nombre>/<durée>>',
};

exports.antiEveryoneRun = async (client, message, args) => {
  const guildId       = message.guild.id;
  const arg           = args[0]?.toLowerCase();
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'antieveryone')) return;

  await _deleteCommand(message, deleteOptions);

  if (arg === 'on') {
    return _toggle(message, guildId, 'antiEveryoneEnabled', 1, 'Antieveryone', deleteOptions);
  }

  if (arg === 'off') {
    return _toggle(message, guildId, 'antiEveryoneEnabled', 0, 'Antieveryone', deleteOptions);
  }

  if (arg === 'max') {
    if (_isMaxed(guildId, { antiEveryoneEnabled: 1, antiEveryoneThreshold: 1, antiEveryoneWindow: 10, antiEveryonePunish: 'mute' })) {
      return _sendError(message, 'Antieveryone est déjà en mode maximal.', deleteOptions);
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'antiEveryoneEnabled', 1);
    db.setAntiraidConfig(guildId, 'antiEveryoneThreshold', 1);
    db.setAntiraidConfig(guildId, 'antiEveryoneWindow', 10);
    db.setAntiraidConfig(guildId, 'antiEveryonePunish', 'mute');

    return _send(
      message,
      guildId,
      'Antieveryone activé en mode maximal : **1** mention en **10** secondes, punition **mute**.',
      {},
      deleteOptions
    );
  }

  const match = arg?.match(/^(\d+)\/(.+)$/);
  if (match) {
    const threshold = parseInt(match[1], 10);
    const window    = _parseWindow(match[2]);

    if (isNaN(threshold) || threshold < 1) {
      return _sendError(message, 'Le nombre d’actions doit être supérieur ou égal à **1**.', deleteOptions);
    }

    if (!window || window < 1) {
      return _sendError(message, 'La durée doit être supérieure ou égale à **1** seconde.', deleteOptions);
    }

    return _threshold(
      message,
      guildId,
      'antiEveryoneThreshold',
      'antiEveryoneWindow',
      threshold,
      window,
      'Antieveryone',
      deleteOptions
    );
  }

  const config = db.getAntiraidConfig(guildId);

  return _send(
    message,
    guildId,
    `Antieveryone : **${_statusLabel(config.antiEveryoneEnabled)}** - **${config.antiEveryoneThreshold ?? 0}** action(s) en **${config.antiEveryoneWindow ?? 0}** secondes - punition **${config.antiEveryonePunish}**.`,
    {},
    deleteOptions
  );
};


exports.antiroleHelp = {
  name        : 'antirole',
  description : 'Empêcher l’ajout abusif de rôles.',
  usage       : 'antirole <on|off|max|danger|all>',
};

exports.antiroleRun = async (client, message, args) => {
  const guildId       = message.guild.id;
  const arg           = args[0]?.toLowerCase();
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'antirole')) return;

  await _deleteCommand(message, deleteOptions);

  if (arg === 'on') {
    return _toggle(message, guildId, 'antiroleEnabled', 1, 'Antirole', deleteOptions);
  }

  if (arg === 'off') {
    return _toggle(message, guildId, 'antiroleEnabled', 0, 'Antirole', deleteOptions);
  }

  if (arg === 'max') {
    if (_isMaxed(guildId, { antiroleEnabled: 1, antirolePunish: 'derank', antiroleMode: 'all' })) {
      return _sendError(message, 'Antirole est déjà en mode maximal.', deleteOptions);
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'antiroleEnabled', 1);
    db.setAntiraidConfig(guildId, 'antirolePunish', 'derank');

    const ok = _safeSetAntiraidConfig(guildId, 'antiroleMode', 'all');

    if (!ok) {
      return _sendError(
        message,
        'Antirole activé en mode maximal côté protection, mais la colonne `antiroleMode` est absente de la base.',
        deleteOptions
      );
    }

    return _send(
      message,
      guildId,
      'Antirole activé en mode maximal - mode **all**, punition **derank**.',
      {},
      deleteOptions
    );
  }

  if (arg === 'danger' || arg === 'all') {
    const cfg = db.getAntiraidConfig(guildId) || {};
    if (Number(cfg.antiroleEnabled) === 1 && String(cfg.antiroleMode) === arg) {
      return _sendError(message, `Antirole est déjà en mode **${arg}**.`, deleteOptions);
    }

    const ok = _safeSetAntiraidConfig(guildId, 'antiroleMode', arg);

    if (!ok) {
      return _sendError(
        message,
        'Impossible d’enregistrer ce mode. La colonne `antiroleMode` semble absente de la base.',
        deleteOptions
      );
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'antiroleEnabled', 1);

    return _send(
      message,
      guildId,
      `Antirole activé en mode **${arg}**.`,
      {},
      deleteOptions
    );
  }

  const config = db.getAntiraidConfig(guildId);

  return _send(
    message,
    guildId,
    `Antirole : **${_statusLabel(config.antiroleEnabled)}** - mode **${config.antiroleMode ?? 'non défini'}** - punition **${config.antirolePunish}**.`,
    {},
    deleteOptions
  );
};


exports.antiwebhookHelp = {
  name        : 'antiwebhook',
  description : 'Empêcher la création de webhooks.',
  usage       : 'antiwebhook <on|off|max>',
};

exports.antiwebhookRun = async (client, message, args) => {
  const guildId       = message.guild.id;
  const arg           = args[0]?.toLowerCase();
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'antiwebhook')) return;

  await _deleteCommand(message, deleteOptions);

  if (arg === 'on') {
    return _toggle(message, guildId, 'antiwebhookEnabled', 1, 'Antiwebhook', deleteOptions);
  }

  if (arg === 'off') {
    return _toggle(message, guildId, 'antiwebhookEnabled', 0, 'Antiwebhook', deleteOptions);
  }

  if (arg === 'max') {
    if (_isMaxed(guildId, { antiwebhookEnabled: 1 })) {
      return _sendError(message, 'Antiwebhook est déjà en mode maximal.', deleteOptions);
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'antiwebhookEnabled', 1);
    return _send(
      message,
      guildId,
      'Antiwebhook activé en mode maximal.',
      {},
      deleteOptions
    );
  }

  const config = db.getAntiraidConfig(guildId);

  return _send(
    message,
    guildId,
    `Antiwebhook : **${_statusLabel(config.antiwebhookEnabled)}**.`,
    {},
    deleteOptions
  );
};


exports.antiupdateHelp = {
  name        : 'antiupdate',
  description : 'Empêcher la modification abusive du serveur.',
  usage       : 'antiupdate <on|off|max>',
};

exports.antiupdateRun = async (client, message, args) => {
  const guildId       = message.guild.id;
  const arg           = args[0]?.toLowerCase();
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'antiupdate')) return;

  await _deleteCommand(message, deleteOptions);

  if (arg === 'on') {
    return _toggle(message, guildId, 'antiupdateEnabled', 1, 'Antiupdate', deleteOptions);
  }

  if (arg === 'off') {
    return _toggle(message, guildId, 'antiupdateEnabled', 0, 'Antiupdate', deleteOptions);
  }

  if (arg === 'max') {
    if (_isMaxed(guildId, { antiupdateEnabled: 1, antiupdatePunish: 'derank' })) {
      return _sendError(message, 'Antiupdate est déjà en mode maximal.', deleteOptions);
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'antiupdateEnabled', 1);
    db.setAntiraidConfig(guildId, 'antiupdatePunish', 'derank');

    return _send(
      message,
      guildId,
      'Antiupdate activé en mode maximal - punition **derank**.',
      {},
      deleteOptions
    );
  }

  const config = db.getAntiraidConfig(guildId);

  return _send(
    message,
    guildId,
    `Antiupdate : **${_statusLabel(config.antiupdateEnabled)}** - punition **${config.antiupdatePunish}**.`,
    {},
    deleteOptions
  );
};


exports.antivanityHelp = {
  name        : 'antivanity',
  description : 'Protéger l\'URL personnalisée (vanity) du serveur.',
  usage       : 'antivanity <on|off|max>',
};

exports.antivanityRun = async (client, message, args) => {
  const guildId       = message.guild.id;
  const arg           = args[0]?.toLowerCase();
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'antivanity')) return;

  await _deleteCommand(message, deleteOptions);

  if (arg === 'on') {
    return _toggle(message, guildId, 'antivanityEnabled', 1, 'Antivanity', deleteOptions);
  }

  if (arg === 'off') {
    return _toggle(message, guildId, 'antivanityEnabled', 0, 'Antivanity', deleteOptions);
  }

  if (arg === 'max') {
    if (_isMaxed(guildId, { antivanityEnabled: 1, antivanityPunish: 'derank' })) {
      return _sendError(message, 'Antivanity est déjà en mode maximal.', deleteOptions);
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'antivanityEnabled', 1);
    db.setAntiraidConfig(guildId, 'antivanityPunish', 'derank');

    return _send(
      message,
      guildId,
      'Antivanity activé en mode maximal - punition **derank**.',
      {},
      deleteOptions
    );
  }

  const config = db.getAntiraidConfig(guildId);

  return _send(
    message,
    guildId,
    `Antivanity : **${_statusLabel(config.antivanityEnabled)}** - punition **${config.antivanityPunish ?? 'derank'}**.`,
    {},
    deleteOptions
  );
};


exports.antiunbanHelp = {
  name        : 'antiunban',
  description : 'Empêcher les débans abusifs.',
  usage       : 'antiunban <on|off|max>',
};

exports.antiunbanRun = async (client, message, args) => {
  const guildId       = message.guild.id;
  const arg           = args[0]?.toLowerCase();
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'antiunban')) return;

  await _deleteCommand(message, deleteOptions);

  if (arg === 'on') {
    return _toggle(message, guildId, 'antiunbanEnabled', 1, 'Antiunban', deleteOptions);
  }

  if (arg === 'off') {
    return _toggle(message, guildId, 'antiunbanEnabled', 0, 'Antiunban', deleteOptions);
  }

  if (arg === 'max') {
    if (_isMaxed(guildId, { antiunbanEnabled: 1, antiunbanPunish: 'derank' })) {
      return _sendError(message, 'Antiunban est déjà en mode maximal.', deleteOptions);
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'antiunbanEnabled', 1);
    db.setAntiraidConfig(guildId, 'antiunbanPunish', 'derank');

    return _send(
      message,
      guildId,
      'Antiunban activé en mode maximal - punition **derank**.',
      {},
      deleteOptions
    );
  }

  const config = db.getAntiraidConfig(guildId);

  return _send(
    message,
    guildId,
    `Antiunban : **${_statusLabel(config.antiunbanEnabled)}** - punition **${config.antiunbanPunish ?? 'non définie'}**.`,
    {},
    deleteOptions
  );
};


exports.antitokenHelp = {
  name        : 'antitoken',
  description : 'Empêcher le flood de nouveaux membres.',
  usage       : 'antitoken <on|off|lock|<nombre>/<durée>>',
};

exports.antitokenRun = async (client, message, args) => {
  const guildId       = message.guild.id;
  const arg           = args[0]?.toLowerCase();
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'antitoken')) return;

  await _deleteCommand(message, deleteOptions);

  if (arg === 'on') {
    return _toggle(message, guildId, 'antitokenEnabled', 1, 'Antitoken', deleteOptions);
  }

  if (arg === 'off') {
    return _toggle(message, guildId, 'antitokenEnabled', 0, 'Antitoken', deleteOptions);
  }

  if (arg === 'lock') {
    if (Number(message.guild.verificationLevel) === 4) {
      return _sendError(message, 'Le serveur est déjà verrouillé au niveau maximal.', deleteOptions);
    }

    try {
      await message.guild.setVerificationLevel(4, 'Antitoken lock');

      return _send(
        message,
        guildId,
        'Serveur verrouillé - niveau de vérification maximal activé.',
        {},
        deleteOptions
      );
    } catch {
      return _sendError(
        message,
        'Impossible de verrouiller le serveur (permissions manquantes).',
        deleteOptions
      );
    }
  }

  const match = arg?.match(/^(\d+)\/(.+)$/);
  if (match) {
    const threshold = parseInt(match[1], 10);
    const window    = _parseWindow(match[2]);

    if (isNaN(threshold) || threshold < 1) {
      return _sendError(message, 'Le nombre de joins doit être supérieur ou égal à **1**.', deleteOptions);
    }

    if (!window || window < 1) {
      return _sendError(message, 'La durée doit être supérieure ou égale à **1** seconde.', deleteOptions);
    }

    return _threshold(
      message,
      guildId,
      'antitokenThreshold',
      'antitokenWindow',
      threshold,
      window,
      'Antitoken',
      deleteOptions
    );
  }

  const config = db.getAntiraidConfig(guildId);

  return _send(
    message,
    guildId,
    `Antitoken : **${_statusLabel(config.antitokenEnabled)}** - **${config.antitokenThreshold}** join(s) en **${config.antitokenWindow}** secondes.`,
    {},
    deleteOptions
  );
};


exports.clearwebhooksHelp = {
  name        : 'clearwebhooks',
  description : 'Supprimer tous les webhooks du serveur.',
  usage       : 'clearwebhooks',
};

exports.clearwebhooksRun = async (client, message) => {
  const guildId       = message.guild.id;
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'clearwebhooks')) return;

  await _deleteCommand(message, deleteOptions);

  let webhooks;
  try {
    webhooks = await message.guild.fetchWebhooks();
  } catch {
    return _sendError(
      message,
      'Impossible de récupérer les webhooks (permissions manquantes).',
      deleteOptions
    );
  }

  if (webhooks.size === 0) {
    return _send(
      message,
      guildId,
      'Aucun webhook à supprimer.',
      {},
      deleteOptions
    );
  }

  const confirmMessage = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `**${webhooks.size}** webhook(s) seront supprimés.\nCette action est irréversible.`,
        {
          title    : 'Confirmer clearwebhooks',
          timestamp: false,
        }
      ),
    ],
    components      : [_buildClearwebhooksRow(false)],
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!confirmMessage) return;

  embed.registerPrivateInteraction(confirmMessage, message.author.id, 120_000);

  const collector = confirmMessage.createMessageComponentCollector({
    filter: interaction =>
      interaction.user.id === message.author.id &&
      interaction.message.id === confirmMessage.id,
    idle: 60_000,
    time: 120_000,
  });

  collector.on('collect', async interaction => {
    if (interaction.customId === 'local:clearwebhooks:cancel') {
      collector.stop('cancelled');
      await interaction.update({
        embeds: [
          embed.build(guildId, 'Action annulée.', {
            title    : 'Clearwebhooks annulé',
            timestamp: false,
          }),
        ],
        components: [_buildClearwebhooksRow(true)],
      }).catch(() => {});
      return;
    }

    if (interaction.customId !== 'local:clearwebhooks:confirm') {
      return interaction.deferUpdate().catch(() => {});
    }

    collector.stop('confirmed');
    await interaction.deferUpdate().catch(() => {});
    await confirmMessage.edit({
      components: [_buildClearwebhooksRow(true)],
    }).catch(() => {});

    let deleted = 0;
    for (const webhook of webhooks.values()) {
      await webhook.delete('Suppression manuelle via +clearwebhooks')
        .then(() => deleted++)
        .catch(() => {});
    }

    await _send(
      message,
      guildId,
      `**${deleted}** webhook(s) supprimé(s).`,
      {},
      deleteOptions
    );
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(confirmMessage);
    if (reason === 'confirmed' || reason === 'cancelled') return;
    confirmMessage.edit({
      components: [_buildClearwebhooksRow(true)],
    }).catch(() => {});
  });
};

function _buildClearwebhooksRow(disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:clearwebhooks:confirm')
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:clearwebhooks:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}


async function _resolveMember(message, args) {

  const mentioned = message.mentions.members.first();
  if (mentioned) return mentioned;

  const query = args[1];
  if (!query) return null;

  if (/^\d{17,20}$/.test(query)) {
    return message.guild.members.fetch(query).catch(() => null);
  }


  const lower = query.toLowerCase();
  const all   = await message.guild.members.fetch().catch(() => null);
  if (!all) return null;

  return all.find(m =>
    m.displayName.toLowerCase() === lower ||
    m.user.username.toLowerCase() === lower
  ) ?? null;
}


exports.blrankHelp = {
  name        : 'blrank',
  description : 'Blacklist rank - empêcher certains rôles d’être donnés.',
  usage       : 'blrank <on|off|max|danger|all|add|del> [@membre]',
};

exports.blrankRun = async (client, message, args) => {
  const guildId       = message.guild.id;
  const arg           = args[0]?.toLowerCase();
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'blrank')) return;

  await _deleteCommand(message, deleteOptions);

  if (arg === 'on') {
    return _toggle(message, guildId, 'blrankEnabled', 1, 'Blrank', deleteOptions);
  }

  if (arg === 'off') {
    return _toggle(message, guildId, 'blrankEnabled', 0, 'Blrank', deleteOptions);
  }

  if (arg === 'max') {
    if (_isMaxed(guildId, { blrankEnabled: 1, blrankMode: 'all' })) {
      return _sendError(message, 'Blrank est déjà en mode maximal.', deleteOptions);
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'blrankEnabled', 1);

    const ok = _safeSetAntiraidConfig(guildId, 'blrankMode', 'all');

    if (!ok) {
      return _sendError(
        message,
        'Blrank activé côté protection, mais la colonne `blrankMode` est absente de la base.',
        deleteOptions
      );
    }

    return _send(
      message,
      guildId,
      'Blrank activé en mode maximal - mode **all**.',
      {},
      deleteOptions
    );
  }

  if (arg === 'danger' || arg === 'all') {
    const cfg = db.getAntiraidConfig(guildId) || {};
    if (Number(cfg.blrankEnabled) === 1 && String(cfg.blrankMode) === arg) {
      return _sendError(message, `Blrank est déjà en mode **${arg}**.`, deleteOptions);
    }

    const ok = _safeSetAntiraidConfig(guildId, 'blrankMode', arg);

    if (!ok) {
      return _sendError(
        message,
        'Impossible d’enregistrer ce mode. La colonne `blrankMode` semble absente de la base.',
        deleteOptions
      );
    }

    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    db.setAntiraidConfig(guildId, 'blrankEnabled', 1);

    return _send(
      message,
      guildId,
      `Blrank activé en mode **${arg}**.`,
      {},
      deleteOptions
    );
  }

  if (arg === 'add') {
    const target = await _resolveMember(message, args);
    if (!target) {
      return _sendError(message, 'Membre introuvable. Utilisez une mention, un ID ou un nom exact.', deleteOptions);
    }

    for (const role of target.roles.cache.values()) {
      if (role.id === message.guild.id) continue;
      db.addBlacklistRank(guildId, role.id);
    }

    return _send(
      message,
      guildId,
      `Les rôles de <@${target.id}> ont été ajoutés à la blacklist rank.`,
      {},
      deleteOptions
    );
  }

  if (arg === 'del') {
    const target = await _resolveMember(message, args);
    if (!target) {
      return _sendError(message, 'Membre introuvable. Utilisez une mention, un ID ou un nom exact.', deleteOptions);
    }

    for (const role of target.roles.cache.values()) {
      if (role.id === message.guild.id) continue;
      db.removeBlacklistRank(guildId, role.id);
    }

    return _send(
      message,
      guildId,
      `Les rôles de <@${target.id}> ont été retirés de la blacklist rank.`,
      {},
      deleteOptions
    );
  }

  const config = db.getAntiraidConfig(guildId);
  const list   = db.raw()
    .prepare('SELECT roleId FROM blacklist_rank WHERE guildId = ?')
    .all(guildId);

  return _send(
    message,
    guildId,
    null,
    {
      title  : 'Blacklist rank',
      fields : [
        {
          name   : 'Statut',
          value  : `**${_statusLabel(config.blrankEnabled)}** - mode **${config.blrankMode ?? 'non défini'}**`,
          inline : false,
        },
        {
          name   : `${list.length} rôle(s)`,
          value  : list.length
            ? list.map(row => `<@&${row.roleId}>`).join(', ').slice(0, 1024)
            : 'Blacklist rank vide.',
          inline : false,
        },
      ],
    },
    deleteOptions
  );
};


exports.antimassmentionHelp = {
  name        : 'antimassmention',
  description : 'Empêcher les mentions abusives.',
  usage       : 'antimassmention <on|off|<nombre>>',
};

exports.antimassmentionRun = async (client, message, args) => {
  const guildId       = message.guild.id;
  const arg           = args[0]?.toLowerCase();
  const deleteOptions = _getDeleteOptions(guildId);

  if (!perms.check(message, 'antimassmention')) return;

  await _deleteCommand(message, deleteOptions);

  if (arg === 'on') {
    return _toggle(message, guildId, 'antimassmentionEnabled', 1, 'Antimassmention', deleteOptions);
  }

  if (arg === 'off') {
    return _toggle(message, guildId, 'antimassmentionEnabled', 0, 'Antimassmention', deleteOptions);
  }

  const number = parseInt(arg, 10);
  if (!isNaN(number)) {
    if (number < 1) {
      return _sendError(message, 'Le seuil doit être supérieur ou égal à **1**.', deleteOptions);
    }

    const current = Number(db.getAntiraidConfig(guildId)?.antimassmentionThreshold ?? 0);
    if (current === number) {
      return _sendError(message, 'Cette valeur est déjà configurée.', deleteOptions);
    }

    db.setAntiraidConfig(guildId, 'antimassmentionThreshold', number);

    return _send(
      message,
      guildId,
      `Antimassmention configuré : maximum **${number}** mention(s) par message.`,
      {},
      deleteOptions
    );
  }

  const config = db.getAntiraidConfig(guildId);

  return _send(
    message,
    guildId,
    `Antimassmention : **${_statusLabel(config.antimassmentionEnabled)}** - seuil **${config.antimassmentionThreshold}** mention(s).`,
    {},
    deleteOptions
  );
};
