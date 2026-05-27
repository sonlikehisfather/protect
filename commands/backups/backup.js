'use strict';


const fs = require('fs');
const path = require('path');
const https = require('https');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  OverwriteType,
} = require('discord.js');

const db = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups');
const CONFIRM_MS = 120_000;

exports.help = {
  name        : 'backup',
  description : 'Créer, gérer et restaurer une sauvegarde serveur.',
  usage       : 'backup <create|list|info|delete|load> [id]',
  aliases     : ['backups', 'sauvegarde'],
  subcommands : [
    {
      name        : 'backup create',
      description : 'Créer une sauvegarde des rôles, salons et permissions.',
      usage       : 'backup create [nom]',
      category    : 'backups',
    },
    {
      name        : 'backup list',
      description : 'Lister les sauvegardes du serveur.',
      usage       : 'backup list',
      category    : 'backups',
    },
    {
      name        : 'backup info',
      description : 'Afficher les détails d’une sauvegarde.',
      usage       : 'backup info <id>',
      category    : 'backups',
    },
    {
      name        : 'backup delete',
      description : 'Supprimer une sauvegarde.',
      usage       : 'backup delete <id>',
      category    : 'backups',
    },
    {
      name        : 'backup clear',
      description : 'Supprimer toutes les sauvegardes.',
      usage       : 'backup clear',
      category    : 'backups',
    },
    {
      name        : 'backup load',
      description : 'Restaurer une sauvegarde sur le serveur.',
      usage       : 'backup load <id>',
      category    : 'backups',
    },
  ],
};

exports.run = async (client, message, args) => {
  if (!perms.check(message, exports.help.name)) return;

  const guild = message.guild;
  const guildId = guild.id;
  const config = db.getGuildConfig(guildId);

  const deleteCmd = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const sub = args[0]?.toLowerCase();

  if (!sub || ['help', 'aide'].includes(sub)) {
    const sent = await _sendHelp(message).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (sub === 'create' || sub === 'créer' || sub === 'creer') {
    const sent = await _createBackup(message, args.slice(1)).catch(err => _handleError(message, err));
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (sub === 'list' || sub === 'liste') {
    const sent = await _listBackups(message).catch(err => _handleError(message, err));
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (sub === 'info' || sub === 'show') {
    const sent = await _showInfo(message, args[1]).catch(err => _handleError(message, err));
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (sub === 'delete' || sub === 'del' || sub === 'remove' || sub === 'supprimer') {
    const sent = await _deleteBackup(message, args[1]).catch(err => _handleError(message, err));
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (sub === 'clear' || sub === 'clean' || sub === 'vider') {
    return _confirmClearBackups(message, deleteReply, deleteDelay).catch(err => _handleError(message, err));
  }

  if (sub === 'load' || sub === 'restore' || sub === 'restaurer') {
    return _confirmRestore(message, args[1], deleteReply, deleteDelay).catch(err => _handleError(message, err));
  }

  const sent = await embed.replyError(
    message,
    'Sous-commande inconnue. Utilisez `backup create`, `backup list`, `backup info <id>`, `backup delete <id>`, `backup clear` ou `backup load <id>`.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
};

async function _sendHelp(message) {
  return message.channel.send({
    embeds: [
      embed.build(message.guild.id, null, {
        title: 'Système de backup serveur',
        fields: [
          {
            name: 'Commandes',
            value:
              '`backup create [nom]` - créer une sauvegarde\n' +
              '`backup list` - lister les sauvegardes\n' +
              '`backup info <id>` - détails d’une sauvegarde\n' +
              '`backup delete <id>` - supprimer une sauvegarde\n' +
              '`backup clear` - supprimer toutes les sauvegardes\n' +
              '`backup load <id>` - restaurer une sauvegarde',
          },
          {
            name: 'Contenu sauvegardé',
            value: 'Rôles, catégories, salons textes/vocaux/forums/annonces/stages et permissions. Une backup peut être restaurée sur n’importe quel serveur où le bot est présent.',
          },
        ],
        timestamp: false,
      }),
    ],
    allowedMentions: { repliedUser: false },
  });
}

async function _createBackup(message, nameArgs) {
  const guild = message.guild;
  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);
  await guild.emojis.fetch().catch(() => null);
  await guild.stickers.fetch().catch(() => null);

  const backup = await _serializeGuild(guild, message.author.id, nameArgs.join(' ').trim());
  await _writeBackupWithAssets(backup.id, backup, guild);

  return message.channel.send({
    embeds: [
      embed.build(guild.id, `Sauvegarde créée avec l'id \`${backup.id}\`.`, {
        title: 'Backup créé',
        fields: [
          { name: 'Nom', value: backup.name || 'Aucun', inline: true },
          { name: 'Rôles', value: String(backup.roles.length), inline: true },
          { name: 'Salons', value: String(backup.channels.length), inline: true },
          { name: 'Emojis', value: String(backup.emojis?.length ?? 0), inline: true },
          { name: 'Stickers', value: String(backup.stickers?.length ?? 0), inline: true },
          { name: 'Icône/Bannière', value: `${backup.hasIcon ? 'Oui' : 'Non'} / ${backup.hasBanner ? 'Oui' : 'Non'}`, inline: true },
        ],
        timestamp: false,
      }),
    ],
    allowedMentions: { repliedUser: false },
  });
}

async function _listBackups(message) {
  const backups = _readAllBackups();

  if (!backups.length) {
    return embed.replyError(message, 'Aucune sauvegarde trouvée.', { timestamp: false });
  }

  const lines = backups
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 15)
    .map(b => `\`${b.id}\` - **${_escape(b.name || 'Sans nom')}** - ${_escape(b.guildName || 'Serveur inconnu')} - ${_formatDate(b.createdAt)} - ${b.roles.length} rôles / ${b.channels.length} salons`);

  return message.channel.send({
    embeds: [
      embed.build(message.guild.id, lines.join('\n'), {
        title: 'Backups disponibles',
        footer: backups.length > 15 ? `${backups.length - 15} sauvegarde(s) non affichée(s)` : null,
        timestamp: false,
      }),
    ],
    allowedMentions: { repliedUser: false },
  });
}

async function _showInfo(message, backupId) {
  const backup = _getBackupOrNull(backupId);
  if (!backup) {
    return embed.replyError(message, 'Sauvegarde introuvable.', { timestamp: false });
  }

  return message.channel.send({
    embeds: [
      embed.build(message.guild.id, null, {
        title: `Backup ${backup.id}`,
        fields: [
          { name: 'Nom', value: backup.name || 'Aucun', inline: true },
          { name: 'Créé le', value: _formatDate(backup.createdAt), inline: true },
          { name: 'Créé par', value: backup.createdBy ? `<@${backup.createdBy}>` : 'Inconnu', inline: true },
          { name: 'Serveur source', value: `${backup.guildName} (${backup.guildId})`, inline: false },
          { name: 'Contenu', value: `${backup.roles.length} rôle(s)\n${backup.channels.length} salon(s)`, inline: true },
        ],
        timestamp: false,
      }),
    ],
    allowedMentions: { repliedUser: false },
  });
}

async function _deleteBackup(message, backupId) {
  const backup = _getBackupOrNull(backupId);
  if (!backup) {
    return embed.replyError(message, 'Sauvegarde introuvable.', { timestamp: false });
  }

  const deleted = _deleteBackupFile(backup.id);
  if (!deleted) {
    return embed.replyError(message, 'Impossible de supprimer le fichier de sauvegarde.', { timestamp: false });
  }

  return embed.reply(message, `Sauvegarde \`${backup.id}\` supprimée.`, { timestamp: false });
}

async function _confirmClearBackups(message, deleteReply, deleteDelay) {
  const backups = _readAllBackups();

  if (!backups.length) {
    const sent = await embed.replyError(message, 'Aucune sauvegarde à supprimer.', { timestamp: false }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const confirmMessage = await message.channel.send({
    embeds: [
      embed.build(message.guild.id, null, {
        title: 'Confirmer la suppression des backups',
        fields: [
          { name: 'Backups détectées', value: String(backups.length), inline: true },
          { name: 'Action', value: 'Toutes les sauvegardes globales et anciennes sauvegardes par serveur seront supprimées.', inline: false },
          { name: 'Attention', value: 'Cette action est irréversible.', inline: false },
        ],
        timestamp: false,
      }),
    ],
    components: [_clearRow(false)],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (!confirmMessage) return;

  embed.registerPrivateInteraction(confirmMessage, message.author.id, CONFIRM_MS);

  const collector = confirmMessage.createMessageComponentCollector({
    filter: interaction => interaction.user.id === message.author.id && interaction.message.id === confirmMessage.id,
    idle: 60_000,
    time: CONFIRM_MS,
  });

  collector.on('collect', async interaction => {
    if (interaction.customId === 'local:backup:clear:cancel') {
      collector.stop('cancelled');
      await interaction.update({
        embeds: [embed.build(message.guild.id, 'Suppression annulée.', { timestamp: false })],
        components: [_clearRow(true)],
      }).catch(() => {});
      return;
    }

    if (interaction.customId !== 'local:backup:clear:confirm') {
      return interaction.deferUpdate().catch(() => {});
    }

    collector.stop('confirmed');
    const result = _clearAllBackups();

    await interaction.update({
      embeds: [
        embed.build(message.guild.id, null, {
          title: 'Backups supprimées',
          fields: [
            { name: 'Fichiers supprimés', value: String(result.deleted), inline: true },
            { name: 'Erreurs', value: String(result.errors.length), inline: true },
            { name: 'Détails', value: result.errors.length ? result.errors.slice(0, 8).join('\n').slice(0, 1024) : 'Aucune erreur détectée.', inline: false },
          ],
          timestamp: false,
        }),
      ],
      components: [_clearRow(true)],
    }).catch(() => {});

    if (deleteReply) embed.scheduleDelete(confirmMessage, deleteDelay);
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(confirmMessage);
    if (reason === 'confirmed' || reason === 'cancelled') return;
    confirmMessage.edit({ components: [_clearRow(true)] }).catch(() => {});
  });
}

async function _confirmRestore(message, backupId, deleteReply, deleteDelay) {
  const backup = _getBackupOrNull(backupId);
  if (!backup) {
    const sent = await embed.replyError(message, 'Sauvegarde introuvable.', { timestamp: false }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const me = message.guild.members.me;
  if (
    !me.permissions.has(PermissionsBitField.Flags.ManageRoles) ||
    !me.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
    !me.permissions.has(PermissionsBitField.Flags.ManageGuild)
  ) {
    const sent = await embed.replyError(
      message,
      'Il me faut les permissions **Gérer les rôles**, **Gérer les salons** et **Gérer le serveur** pour restaurer une sauvegarde complète.',
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const validation = _validateBackup(backup);
  if (!validation.ok) {
    const sent = await embed.replyError(
      message,
      `Backup invalide : ${validation.reason}`,
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const row = _confirmRow(false);
  const confirmMessage = await message.channel.send({
    embeds: [
      embed.build(
        message.guild.id,
        `Cette action va **supprimer les salons et rôles supprimables** de **${_escape(message.guild.name)}**, renommer le serveur, puis restaurer le backup \`${backup.id}\`.\nSource : **${_escape(backup.guildName || 'Serveur inconnu')}**.\nCette action est destructive et irréversible.`,
        {
          title: 'Confirmer la restauration du backup',
          fields: [
            { name: 'Backup', value: backup.name || backup.id, inline: true },
            { name: 'Serveur source', value: backup.guildName || backup.guildId || 'Inconnu', inline: true },
            { name: 'Rôles', value: String(backup.roles.length), inline: true },
            { name: 'Salons', value: String(backup.channels.length), inline: true },
            { name: 'Emojis', value: String(backup.emojis?.length ?? 0), inline: true },
            { name: 'Stickers', value: String(backup.stickers?.length ?? 0), inline: true },
            { name: 'Icône/Bannière', value: `${backup.hasIcon ? 'Oui' : 'Non'} / ${backup.hasBanner ? 'Oui' : 'Non'}`, inline: true },
            { name: 'Attention', value: 'Le bot va d’abord tenter de nettoyer le serveur cible avant de recréer la structure.', inline: false },
          ],
          timestamp: false,
        }
      ),
    ],
    components: [row],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (!confirmMessage) return;

  embed.registerPrivateInteraction(confirmMessage, message.author.id, CONFIRM_MS);

  const collector = confirmMessage.createMessageComponentCollector({
    filter: interaction => interaction.user.id === message.author.id && interaction.message.id === confirmMessage.id,
    idle: 60_000,
    time: CONFIRM_MS,
  });

  collector.on('collect', async interaction => {
    if (interaction.customId === 'local:backup:cancel') {
      collector.stop('cancelled');
      await interaction.update({
        embeds: [embed.build(message.guild.id, 'Restauration annulée.', { timestamp: false })],
        components: [_confirmRow(true)],
      }).catch(() => {});
      return;
    }

    if (interaction.customId !== 'local:backup:confirm') {
      return interaction.deferUpdate().catch(() => {});
    }

    collector.stop('confirmed');
    await interaction.update({
      embeds: [embed.build(message.guild.id, 'Restauration en cours...', { timestamp: false })],
      components: [_confirmRow(true)],
    }).catch(() => {});

    const result = await _restoreBackup(message.guild, backup);

    await confirmMessage.edit({
      embeds: [
        embed.build(message.guild.id, null, {
          title: 'Restauration terminée',
          fields: [
            { name: 'Serveur renommé', value: result.guildRenamed ? 'Oui' : 'Non', inline: true },
            { name: 'Icône/Bannière', value: `${result.iconRestored ? 'Oui' : 'Non'} / ${result.bannerRestored ? 'Oui' : 'Non'}`, inline: true },
            { name: 'Salons supprimés', value: String(result.channelsDeleted), inline: true },
            { name: 'Rôles supprimés', value: String(result.rolesDeleted), inline: true },
            { name: 'Rôles créés', value: String(result.rolesCreated), inline: true },
            { name: 'Salons créés', value: String(result.channelsCreated), inline: true },
            { name: 'Emojis créés', value: String(result.emojisCreated), inline: true },
            { name: 'Stickers créés', value: String(result.stickersCreated), inline: true },
            { name: 'Erreurs', value: String(result.errors.length), inline: true },
            { name: 'Détails', value: result.errors.length ? result.errors.slice(0, 8).join('\n').slice(0, 1024) : 'Aucune erreur détectée.' },
          ],
          timestamp: false,
        }),
      ],
      components: [_confirmRow(true)],
    }).catch(() => {});

    if (deleteReply) embed.scheduleDelete(confirmMessage, deleteDelay);
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(confirmMessage);
    if (reason === 'confirmed' || reason === 'cancelled') return;
    confirmMessage.edit({ components: [_confirmRow(true)] }).catch(() => {});
  });
}

async function _serializeGuild(guild, createdBy, name) {
  const roles = guild.roles.cache
    .filter(role => role.id !== guild.id && !role.managed)
    .sort((a, b) => a.position - b.position)
    .map(role => ({
      oldId: role.id,
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions.bitfield.toString(),
      position: role.position,
      rawPosition: role.rawPosition ?? role.position,
    }));

  const channels = guild.channels.cache
    .filter(channel => channel.type !== ChannelType.DM && channel.type !== ChannelType.GroupDM)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map(channel => ({
      oldId: channel.id,
      parentId: channel.parentId,
      type: channel.type,
      name: channel.name,
      topic: channel.topic ?? null,
      nsfw: Boolean(channel.nsfw),
      bitrate: channel.bitrate ?? null,
      userLimit: channel.userLimit ?? null,
      rateLimitPerUser: channel.rateLimitPerUser ?? null,
      position: channel.rawPosition,
      defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration ?? null,
      defaultReactionEmoji: channel.defaultReactionEmoji ?? null,
      defaultThreadRateLimitPerUser: channel.defaultThreadRateLimitPerUser ?? null,
      defaultSortOrder: channel.defaultSortOrder ?? null,
      defaultForumLayout: channel.defaultForumLayout ?? null,
      availableTags: Array.isArray(channel.availableTags) ? channel.availableTags.map(tag => ({
        name: tag.name,
        moderated: Boolean(tag.moderated),
        emojiId: tag.emoji?.id ?? null,
        emojiName: tag.emoji?.name ?? null,
      })) : [],
      permissionOverwrites: channel.permissionOverwrites.cache.map(overwrite => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow.bitfield.toString(),
        deny: overwrite.deny.bitfield.toString(),
      })),
    }));

  const emojis = guild.emojis.cache.map(emoji => ({
    id: emoji.id,
    name: emoji.name,
    animated: emoji.animated,
    url: emoji.imageURL({ extension: emoji.animated ? 'gif' : 'png', size: 128 }),
  }));

  const stickers = guild.stickers.cache.map(sticker => ({
    id: sticker.id,
    name: sticker.name,
    description: sticker.description ?? null,
    tags: sticker.tags ?? [],
    format: sticker.format,
    url: sticker.url,
  }));

  const iconUrl = guild.iconURL({ extension: 'png', size: 4096 }) ?? null;
  const bannerUrl = guild.bannerURL({ extension: 'png', size: 4096 }) ?? null;

  return {
    version: 2,
    id: _makeBackupId(),
    name: name || null,
    guildId: guild.id,
    guildName: guild.name,
    createdAt: Math.floor(Date.now() / 1000),
    createdBy,
    roles,
    channels,
    emojis,
    stickers,
    hasIcon: !!iconUrl,
    hasBanner: !!bannerUrl,
  };
}

async function _restoreBackup(guild, backup) {
  const result = {
    guildRenamed: false,
    iconRestored: false,
    bannerRestored: false,
    rolesDeleted: 0,
    channelsDeleted: 0,
    rolesCreated: 0,
    channelsCreated: 0,
    emojisCreated: 0,
    stickersCreated: 0,
    errors: [],
  };
  const roleMap = new Map([[backup.guildId, guild.id], [guild.id, guild.id]]);
  const userMap = new Map();
  const channelMap = new Map();
  const me = guild.members.me;

  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);

  if (backup.guildName && guild.name !== backup.guildName) {
    await guild.setName(backup.guildName, `Restauration backup ${backup.id}`)
      .then(() => { result.guildRenamed = true; })
      .catch(err => result.errors.push(`Nom serveur: ${err.message}`));
  }

  await _clearGuild(guild, result);
  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);

  const rolesToCreate = [...backup.roles].sort((a, b) => _rolePosition(b) - _rolePosition(a));

  for (const role of rolesToCreate) {
    try {
      if (BigInt(role.permissions) & PermissionsBitField.Flags.Administrator) {
        result.errors.push(`Rôle ${role.name}: permission Administrateur ignorée.`);
      }

      const safePerms = BigInt(role.permissions) & ~PermissionsBitField.Flags.Administrator;
      const created = await guild.roles.create({
        name: role.name,
        colors: { primaryColor: role.color || 0 },
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: safePerms,
        reason: `Restauration backup ${backup.id}`,
      });

      roleMap.set(role.oldId, created.id);
      result.rolesCreated++;
    } catch (err) {
      result.errors.push(`Rôle ${role.name}: ${err.message}`);
    }
  }

  const categories = backup.channels.filter(c => c.type === ChannelType.GuildCategory);
  const others = backup.channels.filter(c => c.type !== ChannelType.GuildCategory);

  for (const channel of [...categories, ...others]) {
    try {
      const options = {
        name: channel.name,
        type: channel.type,
        reason: `Restauration backup ${backup.id}`,
        permissionOverwrites: _mapOverwrites(channel.permissionOverwrites, roleMap, userMap, guild),
      };

      if (channel.parentId && channelMap.has(channel.parentId)) {
        options.parent = channelMap.get(channel.parentId);
      }

      if (channel.topic) options.topic = channel.topic;
      if (channel.nsfw != null) options.nsfw = channel.nsfw;
      if (channel.bitrate) options.bitrate = channel.bitrate;
      if (channel.userLimit != null) options.userLimit = channel.userLimit;
      if (channel.rateLimitPerUser != null) options.rateLimitPerUser = channel.rateLimitPerUser;
      if (channel.defaultAutoArchiveDuration != null) options.defaultAutoArchiveDuration = channel.defaultAutoArchiveDuration;
      if (channel.defaultReactionEmoji != null) options.defaultReactionEmoji = channel.defaultReactionEmoji;
      if (channel.defaultThreadRateLimitPerUser != null) options.defaultThreadRateLimitPerUser = channel.defaultThreadRateLimitPerUser;
      if (channel.defaultSortOrder != null) options.defaultSortOrder = channel.defaultSortOrder;
      if (channel.defaultForumLayout != null) options.defaultForumLayout = channel.defaultForumLayout;
      if (Array.isArray(channel.availableTags) && channel.availableTags.length) options.availableTags = channel.availableTags;

      const created = await guild.channels.create(options);
      channelMap.set(channel.oldId, created.id);
      result.channelsCreated++;
    } catch (err) {
      result.errors.push(`Salon ${channel.name}: ${err.message}`);
    }
  }

  await _applyPositions(guild, backup, roleMap, channelMap, result, me);

  await _restoreAssets(guild, backup, result);

  return result;
}

async function _clearGuild(guild, result) {
  const channels = [...guild.channels.cache.values()]
    .filter(channel => channel.deletable)
    .sort((a, b) => b.rawPosition - a.rawPosition);

  for (const channel of channels) {
    await channel.delete('Nettoyage avant restauration backup')
      .then(() => { result.channelsDeleted++; })
      .catch(err => result.errors.push(`Suppression salon ${channel.name}: ${err.message}`));
  }

  await guild.channels.fetch().catch(() => null);

  const roles = [...guild.roles.cache.values()]
    .filter(role => role.id !== guild.id && !role.managed && role.editable)
    .sort((a, b) => b.position - a.position);

  for (const role of roles) {
    await role.delete('Nettoyage avant restauration backup')
      .then(() => { result.rolesDeleted++; })
      .catch(err => result.errors.push(`Suppression rôle ${role.name}: ${err.message}`));
  }
}

async function _applyPositions(guild, backup, roleMap, channelMap, result, me) {
  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);

  const maxRolePosition = Math.max(me.roles.highest.position - 1, 1);
  const rolePositions = backup.roles
    .filter(role => roleMap.has(role.oldId))
    .sort((a, b) => _rolePosition(b) - _rolePosition(a))
    .map(role => ({
      role: roleMap.get(role.oldId),
      position: Math.min(Math.max(_rolePosition(role), 1), maxRolePosition),
    }));

  if (rolePositions.length) {
    await guild.roles.setPositions(rolePositions).catch(err => result.errors.push(`Positions rôles: ${err.message}`));
  }

  await guild.channels.fetch().catch(() => null);

  const categories = backup.channels
    .filter(channel => channel.type === ChannelType.GuildCategory)
    .filter(channel => channelMap.has(channel.oldId))
    .sort((a, b) => a.position - b.position);

  for (const [index, channel] of categories.entries()) {
    const id = channelMap.get(channel.oldId);
    const created = guild.channels.cache.get(id);
    if (!created) continue;
    await created.setPosition(index).catch(err => result.errors.push(`Position catégorie ${channel.name}: ${err.message}`));
  }

  await guild.channels.fetch().catch(() => null);

  const groups = new Map();
  for (const channel of backup.channels) {
    if (channel.type === ChannelType.GuildCategory || !channelMap.has(channel.oldId)) continue;
    const parentKey = channel.parentId && channelMap.has(channel.parentId)
      ? channel.parentId
      : 'root';
    if (!groups.has(parentKey)) groups.set(parentKey, []);
    groups.get(parentKey).push(channel);
  }

  for (const channels of groups.values()) {
    channels.sort((a, b) => a.position - b.position);

    for (const [index, channel] of channels.entries()) {
      const id = channelMap.get(channel.oldId);
      const created = guild.channels.cache.get(id);
      if (!created) continue;
      await created.setPosition(index).catch(err => result.errors.push(`Position ${channel.name}: ${err.message}`));
    }
  }
}

async function _restoreAssets(guild, backup, result) {
  const backupDir = path.join(BACKUP_DIR, backup.id);

  const iconPath = path.join(backupDir, 'icon.png');
  if (backup.hasIcon && fs.existsSync(iconPath)) {
    try {
      await guild.setIcon(iconPath, `Restauration backup ${backup.id}`);
      result.iconRestored = true;
    } catch (err) {
      result.errors.push(`Icône serveur: ${err.message}`);
    }
  }

  const bannerPath = path.join(backupDir, 'banner.png');
  if (backup.hasBanner && fs.existsSync(bannerPath)) {
    try {
      await guild.setBanner(bannerPath, `Restauration backup ${backup.id}`);
      result.bannerRestored = true;
    } catch (err) {
      result.errors.push(`Bannière serveur: ${err.message}`);
    }
  }

  if (backup.emojis?.length) {
    const emojiDir = path.join(backupDir, 'emojis');
    for (const emoji of backup.emojis) {
      const ext = emoji.animated ? 'gif' : 'png';
      const emojiPath = path.join(emojiDir, `${emoji.id}.${ext}`);
      if (!fs.existsSync(emojiPath)) continue;

      try {
        await guild.emojis.create({
          attachment: emojiPath,
          name: emoji.name,
          reason: `Restauration backup ${backup.id}`,
        });
        result.emojisCreated++;
      } catch (err) {
        if (err.code === 30008) {
          result.errors.push(`Emoji ${emoji.name}: limite d'emojis atteinte`);
          break;
        }
        result.errors.push(`Emoji ${emoji.name}: ${err.message}`);
      }
    }
  }

  if (backup.stickers?.length) {
    const stickerDir = path.join(backupDir, 'stickers');
    for (const sticker of backup.stickers) {
      const stickerPath = path.join(stickerDir, `${sticker.id}.png`);
      if (!fs.existsSync(stickerPath)) continue;

      try {
        await guild.stickers.create({
          file: stickerPath,
          name: sticker.name,
          description: sticker.description || sticker.name,
          tags: sticker.tags?.[0] || sticker.name,
          reason: `Restauration backup ${backup.id}`,
        });
        result.stickersCreated++;
      } catch (err) {
        if (err.code === 30039) {
          result.errors.push(`Sticker ${sticker.name}: limite de stickers atteinte`);
          break;
        }
        result.errors.push(`Sticker ${sticker.name}: ${err.message}`);
      }
    }
  }
}

function _mapOverwrites(overwrites, roleMap, userMap, guild) {
  const mapped = [];

  for (const overwrite of overwrites || []) {
    let id = overwrite.id;
    if (overwrite.id === guild.id) {
      id = guild.id;
    } else if (overwrite.type === OverwriteType.Role || overwrite.type === 0) {
      if (!roleMap.has(overwrite.id)) continue;
      id = roleMap.get(overwrite.id);
    } else if (overwrite.type === OverwriteType.Member || overwrite.type === 1) {
      if (!guild.members.cache.has(overwrite.id) && !userMap.has(overwrite.id)) continue;
      userMap.set(overwrite.id, overwrite.id);
      id = overwrite.id;
    } else {
      continue;
    }

    mapped.push({
      id,
      type: overwrite.type,
      allow: BigInt(overwrite.allow),
      deny: BigInt(overwrite.deny),
    });
  }

  return mapped;
}

function _rolePosition(role) {
  const position = Number(role?.rawPosition ?? role?.position ?? 1);
  return Number.isFinite(position) ? position : 1;
}

function _confirmRow(disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:backup:confirm')
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:backup:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function _clearRow(disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:backup:clear:confirm')
      .setLabel('Tout supprimer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:backup:clear:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function _ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function _backupPath(backupId) {
  return path.join(BACKUP_DIR, `${backupId}.json`);
}

function _writeBackup(backupId, payload) {
  _ensureBackupDir();
  fs.writeFileSync(_backupPath(backupId), JSON.stringify(payload, null, 2), 'utf8');
}

async function _writeBackupWithAssets(backupId, payload, guild) {
  _ensureBackupDir();

  const backupDir = path.join(BACKUP_DIR, backupId);
  fs.mkdirSync(backupDir, { recursive: true });

  fs.writeFileSync(path.join(backupDir, 'backup.json'), JSON.stringify(payload, null, 2), 'utf8');

  const downloads = [];

  if (payload.hasIcon) {
    const iconUrl = guild.iconURL({ extension: 'png', size: 4096 });
    if (iconUrl) {
      downloads.push(_downloadFile(iconUrl, path.join(backupDir, 'icon.png')));
    }
  }

  if (payload.hasBanner) {
    const bannerUrl = guild.bannerURL({ extension: 'png', size: 4096 });
    if (bannerUrl) {
      downloads.push(_downloadFile(bannerUrl, path.join(backupDir, 'banner.png')));
    }
  }

  if (payload.emojis?.length) {
    const emojiDir = path.join(backupDir, 'emojis');
    fs.mkdirSync(emojiDir, { recursive: true });
    for (const emoji of payload.emojis) {
      if (emoji.url) {
        const ext = emoji.animated ? 'gif' : 'png';
        downloads.push(_downloadFile(emoji.url, path.join(emojiDir, `${emoji.id}.${ext}`)));
      }
    }
  }

  if (payload.stickers?.length) {
    const stickerDir = path.join(backupDir, 'stickers');
    fs.mkdirSync(stickerDir, { recursive: true });
    for (const sticker of payload.stickers) {
      if (sticker.url) {
        downloads.push(_downloadFile(sticker.url, path.join(stickerDir, `${sticker.id}.png`)));
      }
    }
  }

  await Promise.allSettled(downloads);
}

function _downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { timeout: 30000 }, response => {
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Status ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', err => {
      file.close();
      fs.unlinkSync(dest).catch(() => {});
      reject(err);
    });
  });
}

function _readAllBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];

  const backups = [];

  for (const file of fs.readdirSync(BACKUP_DIR)) {
    const fullPath = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(fullPath);

    if (stat.isFile() && file.endsWith('.json')) {
      const parsed = _readBackupFile(fullPath);
      if (parsed) backups.push(parsed);
      continue;
    }

    if (stat.isDirectory()) {
      for (const legacyFile of fs.readdirSync(fullPath)) {
        if (!legacyFile.endsWith('.json')) continue;
        const parsed = _readBackupFile(path.join(fullPath, legacyFile));
        if (parsed) backups.push(parsed);
      }
    }
  }

  const unique = new Map();
  for (const backup of backups) {
    if (backup?.id && !unique.has(backup.id)) {
      unique.set(backup.id, backup);
    }
  }

  return [...unique.values()];
}

function _getBackupOrNull(backupId) {
  const id = _safeId(backupId);
  if (!id) return null;

  const backupDir = path.join(BACKUP_DIR, id);
  const dirFile = path.join(backupDir, 'backup.json');
  if (fs.existsSync(dirFile)) {
    return _readBackupFile(dirFile);
  }

  const file = _backupPath(id);
  if (fs.existsSync(file)) {
    return _readBackupFile(file);
  }

  if (!fs.existsSync(BACKUP_DIR)) return null;

  for (const entry of fs.readdirSync(BACKUP_DIR)) {
    const legacyPath = path.join(BACKUP_DIR, entry, `${id}.json`);
    if (!fs.existsSync(legacyPath)) continue;
    const stat = fs.statSync(legacyPath);
    if (!stat.isFile()) continue;
    return _readBackupFile(legacyPath);
  }

  return null;
}

function _deleteBackupFile(backupId) {
  const id = _safeId(backupId);
  if (!id) return false;

  const backupDir = path.join(BACKUP_DIR, id);
  if (fs.existsSync(backupDir) && fs.statSync(backupDir).isDirectory()) {
    fs.rmSync(backupDir, { recursive: true, force: true });
    return true;
  }

  const file = _backupPath(id);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }

  if (!fs.existsSync(BACKUP_DIR)) return false;

  for (const entry of fs.readdirSync(BACKUP_DIR)) {
    const legacyPath = path.join(BACKUP_DIR, entry, `${id}.json`);
    if (!fs.existsSync(legacyPath)) continue;
    const stat = fs.statSync(legacyPath);
    if (!stat.isFile()) continue;
    fs.unlinkSync(legacyPath);
    return true;
  }

  return false;
}

function _clearAllBackups() {
  const result = { deleted: 0, errors: [] };
  if (!fs.existsSync(BACKUP_DIR)) return result;

  for (const entry of fs.readdirSync(BACKUP_DIR)) {
    const fullPath = path.join(BACKUP_DIR, entry);

    try {
      const stat = fs.statSync(fullPath);

      if (stat.isFile() && entry.endsWith('.json')) {
        fs.unlinkSync(fullPath);
        result.deleted++;
        continue;
      }

      if (stat.isDirectory()) {
        result.deleted += _clearBackupDirectory(fullPath, result.errors);
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    } catch (err) {
      result.errors.push(`${entry}: ${err.message}`);
    }
  }

  return result;
}

function _clearBackupDirectory(directory, errors) {
  let deleted = 0;

  for (const entry of fs.readdirSync(directory)) {
    const fullPath = path.join(directory, entry);

    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        deleted += _clearBackupDirectory(fullPath, errors);
        continue;
      }

      if (stat.isFile() && entry.endsWith('.json')) {
        fs.unlinkSync(fullPath);
        deleted++;
      }
    } catch (err) {
      errors.push(`${entry}: ${err.message}`);
    }
  }

  return deleted;
}

function _readBackupFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function _validateBackup(backup) {
  if (!backup || typeof backup !== 'object') {
    return { ok: false, reason: 'format invalide' };
  }

  if (backup.version !== 1 && backup.version !== 2) {
    return { ok: false, reason: 'version non supportée' };
  }

  if (!backup.id || !_safeId(backup.id)) {
    return { ok: false, reason: 'identifiant invalide' };
  }

  if (!Array.isArray(backup.roles)) {
    return { ok: false, reason: 'liste des rôles invalide' };
  }

  if (!Array.isArray(backup.channels)) {
    return { ok: false, reason: 'liste des salons invalide' };
  }

  if (backup.roles.length > 250) {
    return { ok: false, reason: 'trop de rôles dans la sauvegarde' };
  }

  if (backup.channels.length > 500) {
    return { ok: false, reason: 'trop de salons dans la sauvegarde' };
  }

  return { ok: true };
}

function _safeId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{6,32}$/.test(id)) return null;
  return id;
}

function _makeBackupId() {
  const now = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${now}-${random}`;
}

function _formatDate(ts) {
  const date = new Date(Number(ts) * 1000);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}

function _escape(value) {
  return String(value).replace(/[*_`~|]/g, '\\$&').slice(0, 80);
}

async function _handleError(message, err) {
  console.error('[backup] error:', err);
  return embed.replyError(
    message,
    'Une erreur est survenue pendant le traitement du backup.',
    { timestamp: false }
  ).catch(() => null);
}
