'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name        : 'spam',
  description : 'Configurer l\'antispam par salon.',
  usage       : 'spam <allow|deny|reset|list> [#salon]',
};

exports.run = async (client, message, args) => {
  if (!perms.check(message, exports.help.name)) return;

  const guildId = message.guild.id;
  const sub     = String(args[0] || '').toLowerCase();
  const config  = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  if (sub === 'list') {
    return _list(message, guildId, deleteReply, deleteDelay);
  }

  if (!['allow', 'deny', 'reset'].includes(sub)) {
    return _replyError(
      message,
      'Utilisation : `spam <allow|deny|reset|list> [#salon]`.',
      deleteReply,
      deleteDelay
    );
  }

  const channel = _resolveTextChannel(message, args[1]);

  if (!channel) {
    return _replyError(
      message,
      'Salon introuvable ou non textuel.',
      deleteReply,
      deleteDelay
    );
  }

  const current = db.getAntispamOverride(guildId, channel.id);

  if (sub === 'allow') {
    if (current === 'allow') {
      return _replyError(
        message,
        'Ce salon autorise déjà le spam.',
        deleteReply,
        deleteDelay
      );
    }

    db.setAntispamOverride(guildId, channel.id, 'allow');

    return _replyOk(
      message,
      guildId,
      _withGlobalNote(
        `Le spam est maintenant autorisé dans <#${channel.id}>.`,
        guildId
      ),
      deleteReply,
      deleteDelay
    );
  }

  if (sub === 'deny') {
    if (current === 'deny') {
      return _replyError(
        message,
        'Ce salon interdit déjà le spam.',
        deleteReply,
        deleteDelay
      );
    }

    db.setAntispamOverride(guildId, channel.id, 'deny');

    return _replyOk(
      message,
      guildId,
      _withGlobalNote(
        `Le spam est maintenant interdit dans <#${channel.id}>.`,
        guildId
      ),
      deleteReply,
      deleteDelay
    );
  }

  if (!current) {
    return _replyError(
      message,
      'Aucune configuration spam n\'est définie pour ce salon.',
      deleteReply,
      deleteDelay
    );
  }

  db.deleteAntispamOverride(guildId, channel.id);

  return _replyOk(
    message,
    guildId,
    `Configuration spam réinitialisée pour <#${channel.id}>.`,
    deleteReply,
    deleteDelay
  );
};

async function _list(message, guildId, deleteReply, deleteDelay) {
  const rows = db.listAntispamOverrides(guildId);

  if (!rows.length) {
    return _replyOk(
      message,
      guildId,
      'Aucun salon configuré.',
      deleteReply,
      deleteDelay
    );
  }

  const allow = rows.filter(r => r.state === 'allow').map(r => `<#${r.channelId}>`);
  const deny  = rows.filter(r => r.state === 'deny').map(r => `<#${r.channelId}>`);

  const fields = [];

  if (allow.length) {
    fields.push({
      name   : `Autorisés (${allow.length})`,
      value  : allow.join('\n').slice(0, 1024),
      inline : false,
    });
  }

  if (deny.length) {
    fields.push({
      name   : `Interdits (${deny.length})`,
      value  : deny.join('\n').slice(0, 1024),
      inline : false,
    });
  }

  const sent = await message.channel.send({
    embeds: [
      embed.build(guildId, null, {
        title     : 'Antispam - configuration par salon',
        fields,
        timestamp : false,
      }),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

function _resolveTextChannel(message, raw) {
  const mentioned = message.mentions.channels.first();
  if (mentioned && mentioned.isTextBased?.()) return mentioned;

  if (!raw) return null;

  const clean = String(raw).replace(/[<#>]/g, '').trim();
  if (!clean) return null;

  const byId = message.guild.channels.cache.get(clean);
  if (byId?.isTextBased?.()) return byId;

  const byName = message.guild.channels.cache.find(
    c => c.isTextBased?.() && c.name?.toLowerCase() === clean.toLowerCase()
  );

  return byName || null;
}

function _withGlobalNote(text, guildId) {
  const antiraid = db.getAntiraidConfig(guildId) || {};

  if (Number(antiraid.antispamEnabled) === 1) return text;

  return (
    `${text}\n` +
    'Note : l\'antispam global est désactivé. ' +
    '`deny` force quand même ce salon, `allow` prendra effet quand l\'antispam global sera actif.'
  );
}

async function _replyOk(message, guildId, text, deleteReply, deleteDelay) {
  const sent = await message.channel.send({
    embeds: [
      embed.build(guildId, text, { timestamp: false }),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _replyError(message, text, deleteReply, deleteDelay) {
  const sent = await embed.replyError(message, text, { timestamp: false }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
