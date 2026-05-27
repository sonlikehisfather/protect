'use strict';


const { ChannelType } = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name        : 'showpics',
  description : 'Configurer l’envoi automatique de photos de profil.',
  usage       : 'showpics <channel|interval|off|settings>',
};

exports.run = async (client, message, args) => {
  if (!perms.check(message, exports.help.name)) return;

  const guildId = message.guild.id;
  const config  = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const sub = args[0]?.toLowerCase();

  if (!sub) {
    return _error(
      message,
      deleteReply,
      deleteDelay,
      'Utilisez `showpics channel`, `showpics interval`, `showpics off` ou `showpics settings`.'
    );
  }

  if (sub === 'settings') {
    const sent = await embed.reply(
      message,
      null,
      {
        title  : 'Configuration show pics',
        fields : [
          {
            name   : 'Salon',
            value  : config?.showPicsChannel ? `<#${config.showPicsChannel}>` : 'Aucun',
            inline : true,
          },
          {
            name   : 'Intervalle',
            value  : `${Number(config?.showPicsInterval ?? 60)} minute(s)`,
            inline : true,
          },
        ],
        timestamp: false,
      }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

    return;
  }

  if (sub === 'off' || sub === 'disable') {
    if (!config?.showPicsChannel) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Show pics est déjà désactivé.'
      );
    }

    db.setGuildConfig(guildId, 'showPicsChannel', null);

    db.setGuildConfig(guildId, 'showPicsInterval', 60);

    return _success(
      message,
      deleteReply,
      deleteDelay,
      'Show pics désactivé.'
    );
  }

  if (sub === 'channel') {
    const channel = _resolveTextChannel(message, args[1]);

    if (!channel) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Salon invalide. Utilisez `showpics channel #salon`.'
      );
    }

    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Le salon doit être un salon textuel.'
      );
    }

    if (config?.showPicsChannel === channel.id) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        `Le salon <#${channel.id}> est déjà utilisé pour show pics.`
      );
    }

    db.setGuildConfig(guildId, 'showPicsChannel', channel.id);

    return _success(
      message,
      deleteReply,
      deleteDelay,
      `Salon show pics défini sur <#${channel.id}>.`
    );
  }

  if (sub === 'interval') {
    const minutes = Number.parseInt(args[1], 10);

    if (Number.isNaN(minutes)) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Précisez un intervalle valide en minutes.\nExemple : `showpics interval 60`'
      );
    }

    if (minutes < 5 || minutes > 1440) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'L’intervalle doit être compris entre **5** et **1440** minutes.'
      );
    }

    if (Number(config?.showPicsInterval ?? 60) === minutes) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        `L’intervalle est déjà défini sur **${minutes}** minute(s).`
      );
    }

    db.setGuildConfig(guildId, 'showPicsInterval', minutes);

    return _success(
      message,
      deleteReply,
      deleteDelay,
      `Intervalle show pics défini sur **${minutes}** minute(s).`
    );
  }

  return _error(
    message,
    deleteReply,
    deleteDelay,
    'Action invalide. Utilisez `channel`, `interval`, `off` ou `settings`.'
  );
};

function _resolveTextChannel(message, raw) {
  return message.mentions.channels.first()
    ?? (raw ? message.guild.channels.cache.get(String(raw).replace(/[<#>]/g, '')) : null);
}

async function _error(message, deleteReply, deleteDelay, text) {
  const sent = await embed.replyError(
    message,
    text,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _success(message, deleteReply, deleteDelay, text) {
  const sent = await embed.reply(
    message,
    text,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
