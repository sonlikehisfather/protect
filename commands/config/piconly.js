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
    name        : 'piconly',
    description : 'Définit ou retire un salon comme salon à images uniquement.',
    usage       : 'piconly <add/del/list> [salon] | piconly exempt <add/del/list> [@role]',
    aliases     : ['imageonly', 'selfieonly'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'piconly')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
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

    const action = args[0]?.toLowerCase();

    if (!['add', 'del', 'delete', 'remove', 'list', 'on', 'off', 'exempt'].includes(action)) {
      return sendUsage(message, guildId, deleteReply, deleteDelay);
    }

    if (action === 'list') {
      return handleList(message, guildId, deleteReply, deleteDelay);
    }

    if (action === 'exempt') {
      return handleExempt(message, guild, guildId, args.slice(1), deleteReply, deleteDelay);
    }

    const channel = await resolveTextChannel(guild, message, args.slice(1));

    if (!channel) {
      const sent = await embed.replyError(
        message,
        'Salon introuvable ou invalide.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!isTextChannel(channel)) {
      const sent = await embed.replyError(
        message,
        'Le salon ciblé doit être un salon textuel.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const piconlyChannels = db.getPiconlyChannels(guildId);

    if (['add', 'on'].includes(action)) {
      if (piconlyChannels.includes(channel.id)) {
        const sent = await embed.replyError(
          message,
          `${channel} est déjà en mode image uniquement.`,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      db.addPiconlyChannel(guildId, channel.id);

      const sent = await embed.reply(
        message,
        `${channel} est maintenant en mode image uniquement.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (['del', 'delete', 'remove', 'off'].includes(action)) {
      if (!piconlyChannels.includes(channel.id)) {
        const sent = await embed.replyError(
          message,
          `${channel} n'est pas configuré en mode image uniquement.`,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      db.removePiconlyChannel(guildId, channel.id);

      const sent = await embed.reply(
        message,
        `${channel} n'est plus en mode image uniquement.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    return sendUsage(message, guildId, deleteReply, deleteDelay);
  },
};

async function handleList(message, guildId, deleteReply, deleteDelay) {
  const ids = db.getPiconlyChannels(guildId);

  if (!ids.length) {
    const sent = await embed.replyError(
      message,
      'Aucun salon n\'est défini en mode image uniquement.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }


  const channels = [];
  for (const id of ids) {
    const ch = message.guild.channels.cache.get(id);
    if (ch) {
      channels.push(ch);
    } else {
      try {
        db.removePiconlyChannel(guildId, id);
        db.clearPiconlyExemptRoles(guildId, id);
      } catch {}
    }
  }

  if (!channels.length) {
    const sent = await embed.replyError(
      message,
      'Aucun salon valide trouvé dans la configuration piconly.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const text =
    `**Salons image uniquement**\n` +
    channels.map((channel, index) => `\`${index + 1}.\` ${channel}`).join('\n');

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        text,
        {
          title     : 'Piconly',
          timestamp : false,
        }
      ),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function handleExempt(message, guild, guildId, args, deleteReply, deleteDelay) {
  const sub = args[0]?.toLowerCase();

  if (!['add', 'del', 'delete', 'remove', 'list'].includes(sub)) {
    const sent = await embed.replyError(
      message,
      'Utilisation : `piconly exempt <add/del/list> <#salon> [@role]`.',
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const channelArg = args[1];
  if (!channelArg) {
    const sent = await embed.replyError(
      message,
      'Indiquez un salon : `piconly exempt <add/del/list> <#salon> [@role]`.',
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const channel = await resolveTextChannel(guild, message, [channelArg]);
  if (!channel || !isTextChannel(channel)) {
    const sent = await embed.replyError(
      message,
      'Salon introuvable ou invalide.',
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (sub === 'list') {
    const rows = db.getPiconlyExemptRoles(guildId, channel.id);
    if (!rows.length) {
      const sent = await embed.replyError(
        message,
        `Aucun rôle exempté dans ${channel}.`,
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const lines = rows
      .map((row, i) => {
        const role = guild.roles.cache.get(row.roleId);
        return `\`${i + 1}.\` ${role ? role.toString() : `\`${row.roleId}\` (introuvable)`}`;
      })
      .join('\n');

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `**Rôles exemptés dans ${channel}**\n${lines}`,
          { title: 'Piconly exempt', timestamp: false }
        ),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const roleArg = args[2];
  const role = resolveRole(guild, message, roleArg);

  if (!role) {
    const sent = await embed.replyError(
      message,
      'Rôle introuvable. Utilisation : `piconly exempt add <#salon> @role`.',
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const existing = db.getPiconlyExemptRoles(guildId, channel.id);
  const alreadyExempt = existing.some(r => r.roleId === role.id);

  if (sub === 'add') {
    if (alreadyExempt) {
      const sent = await embed.replyError(
        message,
        `${role} est déjà exempté dans ${channel}.`,
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.addPiconlyExemptRole(guildId, channel.id, role.id);

    const sent = await embed.reply(
      message,
      `${role} est maintenant exempté du piconly dans ${channel}.`,
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (!alreadyExempt) {
    const sent = await embed.replyError(
      message,
      `${role} n'est pas exempté dans ${channel}.`,
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  db.removePiconlyExemptRole(guildId, channel.id, role.id);

  const sent = await embed.reply(
    message,
    `${role} n'est plus exempté du piconly dans ${channel}.`,
    { timestamp: false }
  ).catch(() => null);
  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

function resolveRole(guild, message, raw) {
  const mention = message.mentions.roles.first();
  if (mention) return mention;
  if (!raw) return null;

  const clean = String(raw).replace(/[<@&>]/g, '');
  if (/^\d{17,20}$/.test(clean)) {
    return guild.roles.cache.get(clean) ?? null;
  }

  const lower = String(raw).toLowerCase();
  return guild.roles.cache.find(r =>
    r.name.toLowerCase() === lower || r.name.toLowerCase().includes(lower)
  ) ?? null;
}

async function resolveTextChannel(guild, message, args) {
  if (!args.length) {
    return message.channel;
  }

  const mention = message.mentions.channels.first();

  if (mention) {
    return mention;
  }

  const raw = args.join(' ').trim();
  const clean = raw.replace(/[<#>]/g, '');

  if (/^\d{17,20}$/.test(clean)) {
    const channel =
      guild.channels.cache.get(clean) ??
      await guild.channels.fetch(clean).catch(() => null);

    return channel ?? null;
  }

  const lower = raw.toLowerCase();

  return guild.channels.cache.find(channel =>
    isTextChannel(channel) &&
    (
      channel.name.toLowerCase() === lower ||
      channel.name.toLowerCase().includes(lower)
    )
  ) ?? null;
}

function isTextChannel(channel) {
  return Boolean(
    channel &&
    (
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement
    )
  );
}

async function sendUsage(message, guildId, deleteReply, deleteDelay) {
  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        [
          `\`${message.prefix || '+'}piconly add [salon]\``,
          `\`${message.prefix || '+'}piconly del [salon]\``,
          `\`${message.prefix || '+'}piconly list\``,
          `\`${message.prefix || '+'}piconly exempt add <#salon> @role\``,
          `\`${message.prefix || '+'}piconly exempt del <#salon> @role\``,
          `\`${message.prefix || '+'}piconly exempt list <#salon>\``,
        ].join('\n'),
        {
          title     : 'Configuration piconly',
          timestamp : false,
        }
      ),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
