'use strict';


const {
  ChannelType,
  PermissionsBitField,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'sync',
    description : 'Synchronise les permissions d\'un salon avec sa catégorie.',
    usage       : 'sync <salon/catégorie/all>',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'sync')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas la permission de gérer les salons.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      const sent = await embed.replyError(
        message,
        'Vous devez avoir la permission de gérer les salons.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const query = args.join(' ').trim();

    if (!query) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}sync <salon/catégorie/all>\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (query.toLowerCase() === 'all') {
      return _syncAll(guild, message, guildId, deleteReply, deleteDelay);
    }

    const channel = await _resolveChannel(guild, query);

    if (!channel) {
      const sent = await embed.replyError(
        message,
        'Salon ou catégorie introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (channel.type === ChannelType.GuildCategory) {
      return _syncCategory(channel, message, guildId, deleteReply, deleteDelay);
    }

    return _syncChannel(channel, message, guildId, deleteReply, deleteDelay);
  },
};

async function _syncChannel(channel, message, guildId, deleteReply, deleteDelay) {
  if (!channel.parent) {
    const sent = await embed.replyError(
      message,
      'Ce salon n\'a pas de catégorie.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const ok = await channel.lockPermissions()
    .then(() => true)
    .catch(() => false);

  if (!ok) {
    const sent = await embed.replyError(
      message,
      'Impossible de synchroniser ce salon.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `**Salon synchronisé**\n${channel}\n\n**Catégorie**\n${channel.parent}`,
        {
          title     : 'Synchronisation terminée',
          timestamp : false,
        }
      ),
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _syncCategory(category, message, guildId, deleteReply, deleteDelay) {
  const children = category.children.cache.filter(channel =>
    _canSync(channel)
  );

  if (!children.size) {
    const sent = await embed.replyError(
      message,
      'Aucun salon synchronisable dans cette catégorie.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  let success = 0;
  let failed  = 0;

  for (const channel of children.values()) {
    const ok = await channel.lockPermissions()
      .then(() => true)
      .catch(() => false);

    if (ok) success++;
    else failed++;

    await _wait(300);
  }

  const text =
    `**Catégorie**\n` +
    `${category}\n\n` +
    `**Salons synchronisés**\n` +
    `\`${success}\`\n\n` +
    `**Échecs**\n` +
    `\`${failed}\``;

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        text,
        {
          title     : 'Synchronisation terminée',
          timestamp : false,
        }
      ),
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _syncAll(guild, message, guildId, deleteReply, deleteDelay) {
  const channels = guild.channels.cache.filter(channel =>
    _canSync(channel) &&
    channel.parent
  );

  if (!channels.size) {
    const sent = await embed.replyError(
      message,
      'Aucun salon synchronisable trouvé.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const pending = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `Synchronisation en cours sur \`${channels.size}\` salon(s).`,
        {
          title     : 'Synchronisation en cours',
          timestamp : false,
        }
      ),
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  let success = 0;
  let failed  = 0;

  for (const channel of channels.values()) {
    const ok = await channel.lockPermissions()
      .then(() => true)
      .catch(() => false);

    if (ok) success++;
    else failed++;

    await _wait(300);
  }

  const text =
    `**Salons ciblés**\n` +
    `\`${channels.size}\`\n\n` +
    `**Salons synchronisés**\n` +
    `\`${success}\`\n\n` +
    `**Échecs**\n` +
    `\`${failed}\``;

  if (pending) {
    await pending.edit({
      embeds: [
        embed.build(
          guildId,
          text,
          {
            title     : 'Synchronisation terminée',
            timestamp : false,
          }
        ),
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => {});

    if (deleteReply) {
      embed.scheduleDelete(pending, deleteDelay);
    }

    return;
  }

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        text,
        {
          title     : 'Synchronisation terminée',
          timestamp : false,
        }
      ),
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _resolveChannel(guild, query) {
  if (!query || typeof query !== 'string') return null;

  const clean = query.replace(/[<#>]/g, '');

  if (/^\d{17,20}$/.test(clean)) {
    return guild.channels.cache.get(clean) ??
      await guild.channels.fetch(clean).catch(() => null);
  }

  const lower = query.toLowerCase();

  return guild.channels.cache.find(channel =>
    channel.name.toLowerCase() === lower
  ) ?? null;
}

function _canSync(channel) {
  return Boolean(
    channel &&
    channel.type !== ChannelType.GuildCategory &&
    typeof channel.lockPermissions === 'function'
  );
}

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
