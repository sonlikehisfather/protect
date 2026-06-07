'use strict';


const {
  ChannelType,
  OverwriteType,
  PermissionsBitField,
} = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');
const perms        = require('../utils/permissions');
const { replaceVariables } = require('../utils/variables');

const createLocks = new Set();

const OWNER_ALLOW = [
  'ViewChannel',
  'Connect',
  'Speak',
  'Stream',
  'UseVAD',
];

const BOT_ALLOW = [
  'ViewChannel',
  'Connect',
  'Speak',
  'Stream',
  'UseVAD',
  'MoveMembers',
  'ManageChannels',
];

async function handleVoiceStateUpdate(client, oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const guildId = guild.id;

  try {
    await _cleanupOldChannel(client, oldState);
    await _createIfJoinChannel(client, newState);
  } catch (err) {
    errorHandler.handle(err, {
      source : 'tempvoc.voiceStateUpdate',
      guildId,
      userId : newState.member?.id || oldState.member?.id,
    });
  }
}

async function cleanupTempvocChannels(client, guild = null) {
  const guilds = guild
    ? [guild]
    : [...client.guilds.cache.values()];

  for (const currentGuild of guilds) {
    const guildId = currentGuild.id;

    try {
      const rows = db.getTempvocChannels(guildId);

      for (const row of rows) {
        const channel = currentGuild.channels.cache.get(row.channelId)
          ?? await currentGuild.channels.fetch(row.channelId).catch(() => null);

        if (!channel || channel.type !== ChannelType.GuildVoice) {
          db.removeTempvocChannel(row.channelId);
          continue;
        }

        const me = currentGuild.members.me
          ?? await currentGuild.members.fetchMe().catch(() => null);

        if (me) {
          const tvConfig = db.getTempvocConfig(guildId);
          await _ensureOwnerOverwrite(channel, row.ownerId, me.id, tvConfig).catch(() => {});
        }

        if (channel.members.size === 0) {
          const name = channel.name;

          const deleted = await channel.delete('Tempvoc vide au démarrage')
            .then(() => true)
            .catch(() => false);

          if (deleted) {
            db.removeTempvocChannel(row.channelId);

            const logEmbed = embed.log(guildId, 'Tempvoc supprimé', [
              {
                name   : 'Salon',
                value  : name,
                inline : true,
              },
              {
                name   : 'Raison',
                value  : 'Salon vide au démarrage',
                inline : true,
              },
            ]);

            await logger.send(client, guildId, 'voicelog', logEmbed);
          }
        }
      }
    } catch (err) {
      errorHandler.handle(err, {
        source : 'tempvoc.cleanup',
        guildId,
      });
    }
  }
}

async function _createIfJoinChannel(client, newState) {
  const member = newState.member;
  const guild  = newState.guild;

  if (!member || member.user.bot) return;
  if (!newState.channelId) return;

  const guildId = guild.id;
  const config  = db.getTempvocConfig(guildId);

  if (Number(config?.enabled) !== 1) return;
  if (!config?.joinChannelId) return;
  if (newState.channelId !== config.joinChannelId) return;

  const lockKey = `${guildId}:${member.id}`;

  if (createLocks.has(lockKey)) return;
  createLocks.add(lockKey);

  try {
    const joinChannel = newState.channel;
    if (!joinChannel || joinChannel.type !== ChannelType.GuildVoice) return;

    const me = guild.members.me
      ?? await guild.members.fetchMe().catch(() => null);

    if (!me) return;

    const joinPerms = joinChannel.permissionsFor(me);

    if (
      !joinPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
      !joinPerms?.has(PermissionsBitField.Flags.Connect) ||
      !joinPerms?.has(PermissionsBitField.Flags.MoveMembers) ||
      !joinPerms?.has(PermissionsBitField.Flags.ManageChannels)
    ) {
      return;
    }

    if (!perms.isBuyer(member.id) && !perms.isOwner(guildId,member.id)) {
      const requiredRoles = _parseJsonArray(config.requiredRoles);
      const blockedRoles  = _parseJsonArray(config.blockedRoles);

      if (requiredRoles.length && !requiredRoles.some(r => member.roles.cache.has(r))) return;
      if (blockedRoles.length  && blockedRoles.some(r => member.roles.cache.has(r)))  return;
    }

    const existing = await _getExistingOwnerChannel(guild, guildId, member.id);

    if (existing) {
      await _ensureOwnerOverwrite(existing, member.id, me.id, config).catch(() => {});

      await member.voice.setChannel(existing, 'Tempvoc existant')
        .catch(() => {});

      return;
    }

    const created = await _createTempChannel(guild, joinChannel, member, config, me);

    if (!created) return;

    db.addTempvocChannel(guildId, created.id, member.id);

    const moved = await member.voice.setChannel(created, 'Création tempvoc')
      .then(() => true)
      .catch(() => false);

    if (!moved) {
      db.removeTempvocChannel(created.id);
      await created.delete('Tempvoc non utilisé').catch(() => {});
      return;
    }

    const logEmbed = embed.log(guildId, 'Tempvoc créé', [
      {
        name   : 'Salon',
        value  : `<#${created.id}>`,
        inline : true,
      },
      {
        name   : 'Propriétaire',
        value  : `<@${member.id}> (${member.user.tag}) \`${member.id}\``,
        inline : true,
      },
      {
        name   : 'Limite',
        value  : String(created.userLimit || 0),
        inline : true,
      },
    ]);

    await logger.send(client, guildId, 'voicelog', logEmbed);
  } finally {
    setTimeout(() => createLocks.delete(lockKey), 2500);
  }
}

async function _createTempChannel(guild, joinChannel, member, config, me) {
  const categoryId = config.categoryId || joinChannel.parentId || null;

  const category = categoryId
    ? guild.channels.cache.get(categoryId)
      ?? await guild.channels.fetch(categoryId).catch(() => null)
    : null;

  const parent =
    category?.type === ChannelType.GuildCategory
      ? category
      : joinChannel.parent;

  const rawName = _formatName(
    config.nameTemplate || 'Vocal de {username}',
    member
  );

  const name = _sanitizeChannelName(rawName);

  const userLimit = Number(config.userLimit) || 0;

  const overwrites = _cloneCategoryOverwrites(parent);


  const ownerAllow = [...OWNER_ALLOW];
  if (Number(config.ownerManageChannel) === 1) ownerAllow.push('ManageChannels');
  if (Number(config.ownerManagePerms)   === 1) ownerAllow.push('ManageRoles');
  if (Number(config.ownerMoveMembers)   === 1) ownerAllow.push('MoveMembers');

  _upsertOverwrite(
    overwrites,
    member.id,
    OverwriteType.Member,
    ownerAllow,
    []
  );

  _upsertOverwrite(
    overwrites,
    me.id,
    OverwriteType.Member,
    BOT_ALLOW,
    []
  );


  if (Number(config.defaultInvisible) === 1) {
    _upsertOverwrite(
      overwrites,
      guild.id,
      OverwriteType.Role,
      [],
      ['ViewChannel', 'Connect']
    );
  }

  return guild.channels.create({
    name,
    type      : ChannelType.GuildVoice,
    parent    : parent?.id || null,
    userLimit : userLimit > 0 ? userLimit : 0,
    reason    : `Tempvoc créé pour ${member.user.tag}`,
    permissionOverwrites: overwrites.length ? overwrites : undefined,
  }).catch(() => null);
}

async function _cleanupOldChannel(client, oldState) {
  if (!oldState.channelId) return;

  const guild = oldState.guild;
  const row = db.getTempvocChannel(oldState.channelId);

  if (!row) return;

  setTimeout(async () => {
    try {
      await _deleteTempChannelIfEmpty(client, guild, oldState.channelId);
    } catch (err) {
      errorHandler.handle(err, {
        source : 'tempvoc.cleanupOldChannel',
        guildId: guild.id,
      });
    }
  }, 1500);
}

async function _deleteTempChannelIfEmpty(client, guild, channelId) {
  const row = db.getTempvocChannel(channelId);

  if (!row) return;

  const channel = guild.channels.cache.get(channelId)
    ?? await guild.channels.fetch(channelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildVoice) {
    db.removeTempvocChannel(channelId);
    return;
  }

  if (channel.members.size > 0) return;

  const channelName = channel.name;

  const deleted = await channel.delete('Tempvoc vide')
    .then(() => true)
    .catch(() => false);

  if (!deleted) return;

  db.removeTempvocChannel(channelId);

  const logEmbed = embed.log(guild.id, 'Tempvoc supprimé', [
    {
      name   : 'Salon',
      value  : channelName,
      inline : true,
    },
    {
      name   : 'Raison',
      value  : 'Salon vide',
      inline : true,
    },
  ]);

  await logger.send(client, guild.id, 'voicelog', logEmbed);
}

async function _getExistingOwnerChannel(guild, guildId, ownerId) {
  const rows = db.getTempvocChannels(guildId);

  for (const row of rows) {
    if (row.ownerId !== ownerId) continue;

    const channel = guild.channels.cache.get(row.channelId)
      ?? await guild.channels.fetch(row.channelId).catch(() => null);

    if (!channel || channel.type !== ChannelType.GuildVoice) {
      db.removeTempvocChannel(row.channelId);
      continue;
    }

    return channel;
  }

  return null;
}

async function _ensureOwnerOverwrite(channel, ownerId, botId = null, config = null) {
  if (ownerId) {
    const ownerPerms = {
      ViewChannel: true,
      Connect    : true,
      Speak      : true,
      Stream     : true,
      UseVAD     : true,
    };
    if (Number(config?.ownerManageChannel) === 1) ownerPerms.ManageChannels = true;
    if (Number(config?.ownerManagePerms)   === 1) ownerPerms.ManageRoles    = true;
    if (Number(config?.ownerMoveMembers)   === 1) ownerPerms.MoveMembers    = true;
    await channel.permissionOverwrites.edit(
      ownerId,
      ownerPerms,
      { reason: 'Tempvoc owner permissions' }
    ).catch(() => {});
  }

  if (botId) {
    await channel.permissionOverwrites.edit(
      botId,
      {
        ViewChannel   : true,
        Connect       : true,
        Speak         : true,
        Stream        : true,
        UseVAD        : true,
        MoveMembers   : true,
        ManageChannels: true,
      },
      { reason: 'Tempvoc bot permissions' }
    ).catch(() => {});
  }
}

function _cloneCategoryOverwrites(category) {
  if (!category?.permissionOverwrites?.cache) return [];

  return category.permissionOverwrites.cache.map(overwrite => ({
    id    : overwrite.id,
    type  : overwrite.type,
    allow : overwrite.allow.toArray(),
    deny  : overwrite.deny.toArray(),
  }));
}

function _upsertOverwrite(overwrites, id, type, allow = [], deny = []) {
  const existing = overwrites.find(overwrite => overwrite.id === id);

  if (!existing) {
    overwrites.push({
      id,
      type,
      allow: _unique(allow),
      deny : _unique(deny),
    });
    return;
  }

  existing.allow = _unique([
    ...(existing.allow || []),
    ...allow,
  ]);

  existing.deny = _unique([
    ...(existing.deny || []),
    ...deny,
  ]).filter(permission => !existing.allow.includes(permission));
}

function _formatName(template, member) {

  return replaceVariables(String(template || 'Vocal de {username}'), {
    user   : member.user,
    member,
    guild  : member.guild,
    extras : { user: member.user.username },
  });
}

function _sanitizeChannelName(value) {
  const cleaned = String(value || 'Vocal temporaire')
    .replace(/@everyone/gi, 'everyone')
    .replace(/@here/gi, 'here')
    .replace(/<#\d{17,20}>/g, '')
    .replace(/<@!?\d{17,20}>/g, '')
    .replace(/<@&\d{17,20}>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return (cleaned || 'Vocal temporaire').slice(0, 100);
}

function _unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function _parseJsonArray(value) {
  if (!value) return [];
  try { const arr = JSON.parse(value); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}

module.exports = {
  handleVoiceStateUpdate,
  cleanupTempvocChannels,
};
