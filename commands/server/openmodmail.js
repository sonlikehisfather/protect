'use strict';


const {
  ChannelType,
  PermissionsBitField,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const logger = require('../../utils/logger');
const perms  = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'openmodmail',
    description : 'Ouvre manuellement un ticket avec un membre du serveur.',
    usage       : 'openmodmail <membre>',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'openmodmail')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me) {
      const sent = await embed.replyError(
        message,
        'Impossible de vérifier mes permissions.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (!me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas la permission de gérer les salons.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const member = await _resolveMember(guild, message, args[0]);

    if (!member) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}openmodmail <membre>\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (member.user.bot) {
      const sent = await embed.replyError(
        message,
        'Vous ne pouvez pas ouvrir un modmail avec un bot.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const existing = db.getOpenTickets(guildId, member.id);

    if (existing?.length) {
      const sent = await embed.replyError(
        message,
        `Ce membre a déjà un ticket ouvert : <#${existing[0].channelId}>.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const ticketPreset = _getTicketPreset(guildId);
    const panel        = ticketPreset.panel;
    const option       = ticketPreset.option;

    const categoryId =
      option?.categoryId ||
      config?.ticketCategory ||
      null;

    const category = categoryId
      ? guild.channels.cache.get(categoryId)
      : null;

    if (categoryId && (!category || category.type !== ChannelType.GuildCategory)) {
      const sent = await embed.replyError(
        message,
        'La catégorie configurée pour les tickets est introuvable ou invalide.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const channelName = _buildTicketChannelName(member);

    const staffRoles = _parseJsonArray(option?.staffRoles);
    const owners =
      typeof db.getGlobalOwners === 'function'
        ? db.getGlobalOwners()
        : [];

    const overwrites = [
      {
        id: guild.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: member.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      },
      {
        id: client.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      },
    ];

    for (const roleId of staffRoles) {
      if (!guild.roles.cache.has(roleId)) continue;

      overwrites.push({
        id: roleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      });
    }

    for (const ownerId of owners) {
      overwrites.push({
        id: ownerId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      });
    }

    const channel = await guild.channels.create({
      name                 : channelName,
      type                 : ChannelType.GuildText,
      parent               : category?.id ?? null,
      topic                : `Modmail manuel de ${member.user.username}`,
      permissionOverwrites : overwrites,
      reason               : `Modmail ouvert par ${message.author.username}`,
    }).catch(() => null);

    if (!channel) {
      const sent = await embed.replyError(
        message,
        'Impossible de créer le salon du modmail.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.createTicket(
      guildId,
      channel.id,
      member.id,
      option?.label ?? 'Modmail',
      panel?.id ?? null,
      option?.id ?? null
    );

    const welcome = await channel.send({
      embeds: [
        embed.build(
          guildId,
          `Ticket ouvert manuellement par <@${message.author.id}> pour <@${member.id}>.\n\nCe membre n'a pas reçu de notification automatique.`,
          {
            title     : 'Modmail ouvert',
            timestamp: new Date(),
          }
        ),
      ],
      allowedMentions: { users: [message.author.id, member.id] },
    }).catch(() => null);

    if (welcome && typeof db.setTicketLastMessageId === 'function') {
      db.setTicketLastMessageId(channel.id, welcome.id);
    }

    const logEmbed = embed.log(guildId, 'Modmail ouvert manuellement', [
      { name: 'Membre', value: `<@${member.id}> (${member.user.username})`, inline: true },
      { name: 'Staff', value: `<@${message.author.id}>`, inline: true },
      { name: 'Salon', value: `<#${channel.id}>`, inline: true },
    ]);

    let logSent = false;

    if (option?.logChannelId && guild.channels.cache.has(option.logChannelId)) {
      await guild.channels.cache.get(option.logChannelId).send({
        embeds: [logEmbed],
      }).catch(() => {});
      logSent = true;
    }

    if (!logSent) {
      await logger.send(client, guildId, 'modlog', logEmbed).catch(() => {});
    }

    const sent = await embed.reply(
      message,
      `Modmail ouvert : <#${channel.id}>`,
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function _resolveMember(guild, message, raw) {
  const mention = message.mentions.members.first();
  if (mention) return mention;

  if (!raw) return null;

  const clean = raw.replace(/[<@!>]/g, '');

  if (!/^\d{17,20}$/.test(clean)) return null;

  return guild.members.cache.get(clean) ??
    await guild.members.fetch(clean).catch(() => null);
}

function _getTicketPreset(guildId) {
  const panels =
    typeof db.getTicketPanels === 'function'
      ? db.getTicketPanels(guildId)
      : [];

  const panel = panels[0] || null;

  if (!panel || typeof db.getTicketOptions !== 'function') {
    return { panel: null, option: null };
  }

  const options = db.getTicketOptions(panel.id);
  const option  = options[0] || null;

  return { panel, option };
}

function _buildTicketChannelName(member) {
  const username = member.user.username
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 20);

  return `modmail-${username || member.id}`;
}

function _parseJsonArray(raw) {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
