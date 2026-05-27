'use strict';


const {
  ChannelType,
  PermissionsBitField,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');
const logger = require('../../utils/logger');

module.exports = {
  help: {
    name        : 'voc',
    description : 'Gère votre vocal temporaire.',
    usage       : 'voc <action> [arguments]',
    aliases     : ['voice', 'vocal'],
    selfManaged : true,
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    const isPrivileged =
      perms.isBuyer(message.author.id) ||
      db.isGlobalOwner(message.author.id);

    if (deleteCmd && !isPrivileged) {
      await message.delete().catch(() => {});
    }

    const action = args[0]?.toLowerCase();

    const context = await _getTempvocContext(message);

    if (!context) {
      if (isPrivileged) {
        return _sendError(message, 'Vous n\'êtes pas dans un vocal temporaire.', deleteReply, deleteDelay);
      }
      await message.delete().catch(() => {});
      return;
    }

    const { channel, row } = context;


    if (message.channel.id !== channel.id) {
      if (isPrivileged) {
        return _sendError(message, 'Utilisez cette commande dans le chat de votre vocal temporaire.', deleteReply, deleteDelay);
      }
      await message.delete().catch(() => {});
      return;
    }

    if (!action || ['help', 'aide', 'cmd'].includes(action)) {
      return _showHelp(message, guildId, deleteReply, deleteDelay);
    }

    if (action === 'claim') {
      return _handleClaim(client, message, channel, row, guildId, deleteReply, deleteDelay);
    }

    const canControl = await _canControlTempvoc(message, row);

    if (!canControl) {
      return _sendError(
        message,
        'Vous n\'êtes pas le propriétaire de ce vocal temporaire.',
        deleteReply,
        deleteDelay
      );
    }

    await _ensureOwnerOverwrite(channel, row.ownerId).catch(() => {});

    if (action === 'status' || action === 'info') {
      return _handleStatus(message, channel, row, guildId, deleteReply, deleteDelay);
    }

    if (action === 'lock') {
      return _handleLock(client, message, channel, row, guildId, deleteReply, deleteDelay);
    }

    if (action === 'unlock') {
      return _handleUnlock(client, message, channel, row, guildId, deleteReply, deleteDelay);
    }

    if (action === 'hide') {
      return _handleHide(client, message, channel, row, guildId, deleteReply, deleteDelay);
    }

    if (action === 'unhide') {
      return _handleUnhide(client, message, channel, row, guildId, deleteReply, deleteDelay);
    }

    if (action === 'limit') {
      return _handleLimit(client, message, args, channel, row, guildId, deleteReply, deleteDelay);
    }

    if (['name', 'rename'].includes(action)) {
      return _handleName(client, message, args, channel, row, guildId, deleteReply, deleteDelay);
    }

    if (['permit', 'allow'].includes(action)) {
      return _handlePermit(client, message, args, channel, row, guildId, deleteReply, deleteDelay);
    }

    if (['reject', 'deny'].includes(action)) {
      return _handleReject(client, message, args, channel, row, guildId, deleteReply, deleteDelay);
    }

    if (['reset', 'unpermit', 'unreject'].includes(action)) {
      return _handleReset(client, message, args, channel, row, guildId, deleteReply, deleteDelay);
    }

    if (action === 'kick') {
      return _handleKick(client, message, args, channel, row, guildId, deleteReply, deleteDelay);
    }

    if (['owner', 'transfer'].includes(action)) {
      return _handleOwner(client, message, args, channel, row, guildId, deleteReply, deleteDelay);
    }

    return _showHelp(message, guildId, deleteReply, deleteDelay);
  },
};

async function _handleStatus(message, channel, row, guildId, deleteReply, deleteDelay) {
  const everyoneOverwrite = channel.permissionOverwrites.cache.get(message.guild.id);

  const locked = Boolean(
    everyoneOverwrite?.deny?.has(PermissionsBitField.Flags.Connect)
  );

  const hidden = Boolean(
    everyoneOverwrite?.deny?.has(PermissionsBitField.Flags.ViewChannel)
  );

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `Salon : ${channel}\n` +
        `Propriétaire : <@${row.ownerId}>\n` +
        `Verrouillé : ${locked ? '`Oui`' : '`Non`'}\n` +
        `Caché : ${hidden ? '`Oui`' : '`Non`'}\n` +
        `Limite : \`${channel.userLimit || 0}\`\n` +
        `Membres : \`${channel.members.size}\``,
        {
          title    : 'Vocal temporaire',
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

async function _handleLock(client, message, channel, row, guildId, deleteReply, deleteDelay) {
  const ok = await channel.permissionOverwrites.edit(
    message.guild.id,
    { Connect: false },
    { reason: `Tempvoc lock par ${message.author.username}` }
  ).then(() => true).catch(() => false);

  if (!ok) {
    return _sendError(message, 'Impossible de verrouiller ce vocal.', deleteReply, deleteDelay);
  }

  await _sendLog(client, guildId, 'Tempvoc verrouillé', channel, message.author, row);

  return _sendSuccess(message, 'Le vocal est maintenant verrouillé.', deleteReply, deleteDelay);
}

async function _handleUnlock(client, message, channel, row, guildId, deleteReply, deleteDelay) {
  const ok = await channel.permissionOverwrites.edit(
    message.guild.id,
    { Connect: null },
    { reason: `Tempvoc unlock par ${message.author.username}` }
  ).then(() => true).catch(() => false);

  if (!ok) {
    return _sendError(message, 'Impossible de déverrouiller ce vocal.', deleteReply, deleteDelay);
  }

  await _sendLog(client, guildId, 'Tempvoc déverrouillé', channel, message.author, row);

  return _sendSuccess(message, 'Le vocal est maintenant déverrouillé.', deleteReply, deleteDelay);
}

async function _handleHide(client, message, channel, row, guildId, deleteReply, deleteDelay) {
  await _ensureOwnerOverwrite(channel, row.ownerId).catch(() => {});

  const ok = await channel.permissionOverwrites.edit(
    message.guild.id,
    { ViewChannel: false },
    { reason: `Tempvoc hide par ${message.author.username}` }
  ).then(() => true).catch(() => false);

  if (!ok) {
    return _sendError(message, 'Impossible de cacher ce vocal.', deleteReply, deleteDelay);
  }

  await _sendLog(client, guildId, 'Tempvoc caché', channel, message.author, row);

  return _sendSuccess(message, 'Le vocal est maintenant caché.', deleteReply, deleteDelay);
}

async function _handleUnhide(client, message, channel, row, guildId, deleteReply, deleteDelay) {
  const ok = await channel.permissionOverwrites.edit(
    message.guild.id,
    { ViewChannel: null },
    { reason: `Tempvoc unhide par ${message.author.username}` }
  ).then(() => true).catch(() => false);

  if (!ok) {
    return _sendError(message, 'Impossible d\'afficher ce vocal.', deleteReply, deleteDelay);
  }

  await _sendLog(client, guildId, 'Tempvoc affiché', channel, message.author, row);

  return _sendSuccess(message, 'Le vocal est maintenant visible.', deleteReply, deleteDelay);
}

async function _handleLimit(client, message, args, channel, row, guildId, deleteReply, deleteDelay) {
  const rawLimit = args[1];

  if (rawLimit == null) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}voc limit <0-99>\``,
      deleteReply,
      deleteDelay
    );
  }

  const limit = Number(rawLimit);

  if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
    return _sendError(
      message,
      'La limite doit être un nombre entre 0 et 99.',
      deleteReply,
      deleteDelay
    );
  }

  const ok = await channel.setUserLimit(
    limit,
    `Tempvoc limit par ${message.author.username}`
  ).then(() => true).catch(() => false);

  if (!ok) {
    return _sendError(message, 'Impossible de modifier la limite du vocal.', deleteReply, deleteDelay);
  }

  await _sendLog(client, guildId, 'Tempvoc limite modifiée', channel, message.author, row, [
    { name: 'Limite', value: String(limit), inline: true },
  ]);

  return _sendSuccess(
    message,
    limit === 0
      ? 'La limite du vocal a été retirée.'
      : `La limite du vocal est maintenant de \`${limit}\` membre(s).`,
    deleteReply,
    deleteDelay
  );
}

async function _handleName(client, message, args, channel, row, guildId, deleteReply, deleteDelay) {
  const name = args.slice(1).join(' ').trim();

  if (!name) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}voc name <nom>\``,
      deleteReply,
      deleteDelay
    );
  }

  if (name.length > 100) {
    return _sendError(message, 'Le nom ne peut pas dépasser 100 caractères.', deleteReply, deleteDelay);
  }

  if (_hasDangerousMention(name)) {
    return _sendError(message, 'Le nom ne peut pas contenir de mention everyone ou here.', deleteReply, deleteDelay);
  }

  const oldName = channel.name;

  const ok = await channel.setName(
    name,
    `Tempvoc rename par ${message.author.username}`
  ).then(() => true).catch(() => false);

  if (!ok) {
    return _sendError(message, 'Impossible de renommer ce vocal.', deleteReply, deleteDelay);
  }

  await _sendLog(client, guildId, 'Tempvoc renommé', channel, message.author, row, [
    { name: 'Ancien nom', value: oldName, inline: true },
    { name: 'Nouveau nom', value: name,    inline: true },
  ]);

  return _sendSuccess(message, `Le vocal a été renommé en \`${name}\`.`, deleteReply, deleteDelay);
}

async function _handleClaim(client, message, channel, row, guildId, deleteReply, deleteDelay) {
  const currentOwnerInChannel = channel.members.has(row.ownerId);

  const canBypass =
    perms.isBuyer(message.author.id) ||
    db.isGlobalOwner(message.author.id);

  if (currentOwnerInChannel && row.ownerId !== message.author.id && !canBypass) {
    return _sendError(
      message,
      'Le propriétaire actuel est encore dans le vocal.',
      deleteReply,
      deleteDelay
    );
  }

  db.setTempvocOwner(channel.id, message.author.id);

  await _ensureOwnerOverwrite(channel, message.author.id).catch(() => {});

  await _sendLog(client, guildId, 'Tempvoc claim', channel, message.author, {
    ownerId: message.author.id,
  });

  return _sendSuccess(message, 'Vous êtes maintenant propriétaire de ce vocal.', deleteReply, deleteDelay);
}

async function _handlePermit(client, message, args, channel, row, guildId, deleteReply, deleteDelay) {
  const member = await _resolveMember(message, args.slice(1).join(' '));

  if (!member) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}voc permit <membre>\``,
      deleteReply,
      deleteDelay
    );
  }

  const ok = await channel.permissionOverwrites.edit(
    member.id,
    {
      ViewChannel: true,
      Connect    : true,
      Speak      : true,
      Stream     : true,
      UseVAD     : true,
    },
    { reason: `Tempvoc permit par ${message.author.username}` }
  ).then(() => true).catch(() => false);

  if (!ok) {
    return _sendError(message, 'Impossible d\'autoriser ce membre.', deleteReply, deleteDelay);
  }

  await _sendLog(client, guildId, 'Tempvoc membre autorisé', channel, message.author, row, [
    { name: 'Membre', value: `<@${member.id}> (${member.user.username})`, inline: true },
  ]);

  return _sendSuccess(message, `<@${member.id}> peut maintenant accéder au vocal.`, deleteReply, deleteDelay);
}

async function _handleReject(client, message, args, channel, row, guildId, deleteReply, deleteDelay) {
  const member = await _resolveMember(message, args.slice(1).join(' '));

  if (!member) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}voc reject <membre>\``,
      deleteReply,
      deleteDelay
    );
  }

  if (member.id === row.ownerId) {
    return _sendError(message, 'Vous ne pouvez pas rejeter le propriétaire du vocal.', deleteReply, deleteDelay);
  }

  const ok = await channel.permissionOverwrites.edit(
    member.id,
    { ViewChannel: false, Connect: false },
    { reason: `Tempvoc reject par ${message.author.username}` }
  ).then(() => true).catch(() => false);

  if (!ok) {
    return _sendError(message, 'Impossible de refuser ce membre.', deleteReply, deleteDelay);
  }

  if (member.voice?.channelId === channel.id) {
    await member.voice.disconnect('Tempvoc reject').catch(() => {});
  }

  await _sendLog(client, guildId, 'Tempvoc membre refusé', channel, message.author, row, [
    { name: 'Membre', value: `<@${member.id}> (${member.user.username})`, inline: true },
  ]);

  return _sendSuccess(message, `<@${member.id}> ne peut plus accéder au vocal.`, deleteReply, deleteDelay);
}

async function _handleReset(client, message, args, channel, row, guildId, deleteReply, deleteDelay) {
  const member = await _resolveMember(message, args.slice(1).join(' '));

  if (!member) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}voc reset <membre>\``,
      deleteReply,
      deleteDelay
    );
  }

  const ok = await channel.permissionOverwrites.delete(
    member.id,
    `Tempvoc reset par ${message.author.username}`
  ).then(() => true).catch(() => false);

  if (!ok) {
    return _sendError(message, 'Impossible de réinitialiser les permissions de ce membre.', deleteReply, deleteDelay);
  }

  await _sendLog(client, guildId, 'Tempvoc permissions réinitialisées', channel, message.author, row, [
    { name: 'Membre', value: `<@${member.id}> (${member.user.username})`, inline: true },
  ]);

  return _sendSuccess(message, `Les permissions de <@${member.id}> ont été réinitialisées.`, deleteReply, deleteDelay);
}

async function _handleKick(client, message, args, channel, row, guildId, deleteReply, deleteDelay) {
  const member = await _resolveMember(message, args.slice(1).join(' '));

  if (!member) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}voc kick <membre>\``,
      deleteReply,
      deleteDelay
    );
  }

  if (member.id === row.ownerId) {
    return _sendError(message, 'Vous ne pouvez pas expulser le propriétaire du vocal.', deleteReply, deleteDelay);
  }

  if (member.voice?.channelId !== channel.id) {
    return _sendError(message, 'Ce membre n\'est pas dans votre vocal.', deleteReply, deleteDelay);
  }

  const ok = await member.voice.disconnect(
    `Tempvoc kick par ${message.author.username}`
  ).then(() => true).catch(() => false);

  if (!ok) {
    return _sendError(message, 'Impossible de déconnecter ce membre.', deleteReply, deleteDelay);
  }

  await _sendLog(client, guildId, 'Tempvoc membre expulsé', channel, message.author, row, [
    { name: 'Membre', value: `<@${member.id}> (${member.user.username})`, inline: true },
  ]);

  return _sendSuccess(message, `<@${member.id}> a été déconnecté du vocal.`, deleteReply, deleteDelay);
}

async function _handleOwner(client, message, args, channel, row, guildId, deleteReply, deleteDelay) {
  const member = await _resolveMember(message, args.slice(1).join(' '));

  if (!member) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}voc owner <membre>\``,
      deleteReply,
      deleteDelay
    );
  }

  if (member.user.bot) {
    return _sendError(message, 'Vous ne pouvez pas transférer le vocal à un bot.', deleteReply, deleteDelay);
  }

  if (member.voice?.channelId !== channel.id) {
    return _sendError(message, 'Le nouveau propriétaire doit être dans le vocal.', deleteReply, deleteDelay);
  }

  db.setTempvocOwner(channel.id, member.id);

  await _ensureOwnerOverwrite(channel, member.id).catch(() => {});

  await _sendLog(client, guildId, 'Tempvoc propriétaire modifié', channel, message.author, {
    ownerId: member.id,
  }, [
    { name: 'Nouveau propriétaire', value: `<@${member.id}> (${member.user.username})`, inline: true },
  ]);

  return _sendSuccess(message, `<@${member.id}> est maintenant propriétaire du vocal.`, deleteReply, deleteDelay);
}

async function _getTempvocContext(message) {
  const channel = message.member?.voice?.channel;

  if (!channel || channel.type !== ChannelType.GuildVoice) {
    return null;
  }

  const row = db.getTempvocChannel(channel.id);

  if (!row) {
    return null;
  }

  return { channel, row };
}

async function _canControlTempvoc(message, row) {
  if (row.ownerId === message.author.id) return true;
  if (perms.isBuyer(message.author.id)) return true;
  if (db.isGlobalOwner(message.author.id)) return true;

  return false;
}

async function _ensureOwnerOverwrite(channel, ownerId) {
  if (!ownerId) return;

  return channel.permissionOverwrites.edit(
    ownerId,
    {
      ViewChannel: true,
      Connect    : true,
      Speak      : true,
      Stream     : true,
      UseVAD     : true,
    },
    { reason: 'Tempvoc owner permissions' }
  );
}

async function _resolveMember(message, query) {
  const guild = message.guild;

  const mentioned = message.mentions.members.first();
  if (mentioned) return mentioned;

  const raw = String(query || '').trim();
  if (!raw) return null;

  const mentionMatch = raw.match(/^<@!?(\d{17,20})>$/);
  const id = mentionMatch?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);

  if (id) {
    return guild.members.fetch(id).catch(() => null);
  }

  const normalized = _normalizeName(raw);

  return guild.members.cache.find(member =>
    _normalizeName(member.user.username) === normalized ||
    _normalizeName(member.displayName) === normalized ||
    _normalizeName(member.user.username) === normalized
  ) ?? null;
}

async function _showHelp(message, guildId, deleteReply, deleteDelay) {
  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `Commandes disponibles :\n` +
        `\`${message.prefix || '+'}voc status\` - affiche les informations du vocal\n` +
        `\`${message.prefix || '+'}voc lock\` - ferme l\'accès au vocal\n` +
        `\`${message.prefix || '+'}voc unlock\` - réouvre l\'accès au vocal\n` +
        `\`${message.prefix || '+'}voc hide\` - cache le vocal\n` +
        `\`${message.prefix || '+'}voc unhide\` - affiche le vocal\n` +
        `\`${message.prefix || '+'}voc limit <0-99>\` - change la limite\n` +
        `\`${message.prefix || '+'}voc name <nom>\` - renomme le vocal\n` +
        `\`${message.prefix || '+'}voc claim\` - récupère le vocal si le propriétaire est absent\n` +
        `\`${message.prefix || '+'}voc permit <membre>\` - autorise un membre\n` +
        `\`${message.prefix || '+'}voc reject <membre>\` - refuse un membre\n` +
        `\`${message.prefix || '+'}voc reset <membre>\` - reset les permissions d\'un membre\n` +
        `\`${message.prefix || '+'}voc kick <membre>\` - expulse un membre du vocal\n` +
        `\`${message.prefix || '+'}voc owner <membre>\` - transfère le vocal`,
        {
          title    : 'Tempvoc',
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

async function _sendSuccess(message, content, deleteReply, deleteDelay) {
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

async function _sendLog(client, guildId, title, channel, moderator, row, extraFields = []) {
  const logEmbed = embed.log(guildId, title, [
    { name: 'Salon',      value: `<#${channel.id}>`,                       inline: true },
    { name: 'Propriétaire', value: `<@${row.ownerId}>`,                    inline: true },
    { name: 'Action par', value: `<@${moderator.id}> (${moderator.username})`,  inline: true },
    ...extraFields,
  ]);

  await logger.send(client, guildId, 'voicelog', logEmbed);
}

function _hasDangerousMention(value) {
  return /@everyone|@here/i.test(String(value || ''));
}

function _normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}
