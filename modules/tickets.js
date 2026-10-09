'use strict';


const {
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  AttachmentBuilder,
  EmbedBuilder,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('discord.js');

const db           = require('../core/database');
const embed        = require('../utils/embed');
const errorHandler = require('../utils/errorHandler');
const permissions  = require('../utils/permissions');
const { safeSetTimeout } = require('../utils/safeTimers');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);


function _hasTicketBypass(member, guildId) {
  if (!member) return false;
  if (permissions.isProtected(member.id, guildId, member)) return true;
  if (member.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return true;
  return false;
}


async function handleOpen(client, interaction) {
  const guildId = interaction.guild.id;

  try {
    const [, , panelIdRaw, optionIdRaw] = String(interaction.customId || '').split('_');
    const panelId  = Number.parseInt(panelIdRaw, 10);
    const optionId = Number.parseInt(optionIdRaw, 10);

    if (!panelId || !optionId) {
      return _replyError(interaction, guildId, 'Impossible d\'identifier le panel ou l\'option. Réessayez.');
    }

    const panel = db.getTicketPanel(panelId);
    if (!panel || panel.guildId !== guildId) {
      return _replyError(interaction, guildId, 'Ce panel n\'existe plus. Contactez un administrateur.');
    }

    const option = db.getTicketOption(optionId);
    if (!option || String(option.panelId) !== String(panelId)) {
      return _replyError(interaction, guildId, 'Cette option n\'existe plus. Contactez un administrateur.');
    }

    return _openFromPanelOption(client, interaction, panel, option);
  } catch (err) {
    errorHandler.handle(err, { source: 'tickets.handleOpen', guildId });
    return _safeReply(interaction, {
      embeds : [embed.build(guildId, 'Une erreur est survenue lors de la création du ticket.', { color: '#ED4245' })],
      flags  : 64,
    });
  }
}

async function handleSelectOpen(client, interaction) {
  const guildId = interaction.guild.id;

  try {
    const [, , panelIdRaw] = String(interaction.customId || '').split('_');
    const panelId  = Number.parseInt(panelIdRaw, 10);
    const optionId = Number.parseInt(interaction.values?.[0], 10);

    if (!panelId || !optionId) {
      return _replyError(interaction, guildId, 'Impossible d\'identifier le panel ou l\'option. Réessayez.');
    }

    const panel = db.getTicketPanel(panelId);
    if (!panel || panel.guildId !== guildId) {
      return _replyError(interaction, guildId, 'Ce panel n\'existe plus. Contactez un administrateur.');
    }

    const option = db.getTicketOption(optionId);
    if (!option || String(option.panelId) !== String(panelId)) {
      return _replyError(interaction, guildId, 'Cette option n\'existe plus. Contactez un administrateur.');
    }

    await _openFromPanelOption(client, interaction, panel, option);

    _resetPanelSelect(interaction, panel).catch(() => {});
    return;
  } catch (err) {
    errorHandler.handle(err, { source: 'tickets.handleSelectOpen', guildId });
    return _safeReply(interaction, {
      embeds : [embed.build(guildId, 'Une erreur est survenue lors de la création du ticket.', { color: '#ED4245' })],
      flags  : 64,
    });
  }
}

async function _openFromPanelOption(client, interaction, panel, option) {
  const guild   = interaction.guild;
  const guildId = guild.id;
  const user    = interaction.user;
  const member  = interaction.member;

  const guildConfig = db.getGuildConfig(guildId);

  const maxOpen     = Number(panel.maxOpenPerUser ?? guildConfig.ticketMaxPerUser ?? 1);
  const openTickets = db.getOpenTickets(guildId, user.id);


  const hasGlobalBypass = _hasTicketBypass(member, guildId);


  const bypassRoles   = _parseJsonArray(panel.bypassRoles);
  const hasBypassRole = bypassRoles.length > 0 && member?.roles?.cache?.some(r => bypassRoles.includes(r.id));
  const hasMaxBypass  = hasGlobalBypass || hasBypassRole;

  if (!hasMaxBypass && maxOpen > 0 && openTickets.length >= maxOpen) {
    const existing = openTickets[0];
    return _replyError(
      interaction,
      guildId,
      `Vous avez déjà un ticket ouvert : <#${existing.channelId}>.\nMaximum autorisé : **${maxOpen}**.`
    );
  }

  const blockedRoles = _parseJsonArray(panel.blockedRoles);
  if (
    !hasGlobalBypass &&
    blockedRoles.length > 0 &&
    member?.roles?.cache?.some(role => blockedRoles.includes(role.id))
  ) {
    return _replyError(interaction, guildId, 'Vous ne pouvez pas ouvrir ce type de ticket.');
  }

  const requiredRoles = _parseJsonArray(panel.requiredRoles);
  if (
    !hasGlobalBypass &&
    requiredRoles.length > 0 &&
    !member?.roles?.cache?.some(role => requiredRoles.includes(role.id))
  ) {
    return _replyError(interaction, guildId, 'Vous n\'avez pas les rôles nécessaires pour ouvrir ce ticket.');
  }

  const categoryId = option.categoryId || guildConfig.ticketCategory || null;
  const category   = categoryId ? guild.channels.cache.get(categoryId) : null;

  if (categoryId && !category) {
    return _replyError(interaction, guildId, 'La catégorie configurée pour ce ticket est introuvable.');
  }

  if (categoryId && category.type !== ChannelType.GuildCategory) {
    return _replyError(interaction, guildId, 'La catégorie configurée pour ce ticket n\'est pas une vraie catégorie Discord.');
  }


  if (category) {
    const me = guild.members.me
      ?? await guild.members.fetchMe().catch(() => null);
    const botPermsInCategory = me ? category.permissionsFor(me) : null;

    if (
      !botPermsInCategory?.has(PermissionsBitField.Flags.ViewChannel) ||
      !botPermsInCategory?.has(PermissionsBitField.Flags.ManageChannels) ||
      !botPermsInCategory?.has(PermissionsBitField.Flags.SendMessages) ||
      !botPermsInCategory?.has(PermissionsBitField.Flags.EmbedLinks)
    ) {
      return _replyError(
        interaction,
        guildId,
        'Je n\'ai pas les permissions nécessaires dans la catégorie configurée : Voir le salon, Gérer les salons, Envoyer des messages, Intégrer des liens.'
      );
    }
  }

  const ticketCountRow = db.raw()
    .prepare('SELECT COUNT(*) AS count FROM tickets WHERE guildId = ?')
    .get(guildId);

  const ticketNumber = Number(ticketCountRow?.count || 0) + 1;

  const staffRoles   = _parseJsonArray(option.staffRoles);
  const mentionRoles = _parseJsonArray(option.mentionRoles);
  const owners       = typeof db.getGlobalOwners === 'function' ? db.getGlobalOwners() : [];

  const channelName = _resolveTicketName(option.nameTemplate, user, option, ticketNumber);

  const permissionOverwrites = [
    {
      id   : guild.id,
      deny : [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id    : user.id,
      allow : [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    },
    {
      id    : client.user.id,
      allow : [
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

    permissionOverwrites.push({
      id    : roleId,
      allow : [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    });
  }

  for (const ownerId of owners) {
    permissionOverwrites.push({
      id    : ownerId,
      allow : [
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
    topic                : `Ticket de ${user.tag}`,
    permissionOverwrites,
    reason               : `Ticket ouvert par ${user.tag}`,
  }).catch(() => null);

  if (!channel) {
    return _replyError(
      interaction,
      guildId,
      'Impossible de créer le salon ticket. Vérifiez mes permissions dans la catégorie configurée.'
    );
  }

  db.createTicket(
    guildId,
    channel.id,
    user.id,
    option.label ?? null,
    panel.id,
    option.id
  );

  if (typeof db.updateTicketActivity === 'function') {
    db.updateTicketActivity(channel.id, Math.floor(Date.now() / 1000));
  }

  const helperButtons = [];

  if (Number(panel.showClaimButton ?? 1) === 1) {
    helperButtons.push(
      new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel('Claim')
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (Number(panel.showCloseButton ?? 1) === 1) {
    helperButtons.push(
      new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('Close')
        .setStyle(ButtonStyle.Danger)
    );
  }

  const components = helperButtons.length
    ? [new ActionRowBuilder().addComponents(helperButtons)]
    : [];

  let welcomeEmbed;
  if (option.openEmbedJson) {
    try {
      const parsed = JSON.parse(option.openEmbedJson);
      // Convert hex color to int if needed
      if (parsed.color && typeof parsed.color === 'string') {
        parsed.color = parseInt(parsed.color.replace('#', ''), 16);
      }
      welcomeEmbed = new EmbedBuilder(parsed);
    } catch {
      welcomeEmbed = null;
    }
  }

  if (!welcomeEmbed) {
    const openMessage =
      option.openMessage ||
      `Bienvenue <@${user.id}>.\nExpliquez votre demande ci-dessous et un membre du staff vous répondra dès que possible.`;
    welcomeEmbed = embed.build(guildId, openMessage, {
      title     : option.label || 'Ticket',
      footer    : `Créé par ${user.tag}`,
      timestamp : new Date(),
    });
  }


  const welcome = await channel.send({
    content: [
      `<@${user.id}>`,
      ...mentionRoles
        .filter(roleId => guild.roles.cache.has(roleId))
        .map(roleId => `<@&${roleId}>`),
    ].join(' ').trim(),
    embeds: [welcomeEmbed],
    components,
    allowedMentions: {
      users : [user.id],
      roles : mentionRoles.filter(roleId => guild.roles.cache.has(roleId)),
    },
  });

  if (typeof db.setTicketLastMessageId === 'function') {
    db.setTicketLastMessageId(channel.id, welcome.id);
  }

  const logEmbed = embed.log(guildId, 'Ticket ouvert', [
    { name: 'Membre',  value: `<@${user.id}> (${user.tag})`, inline: true },
    { name: 'Salon',   value: `<#${channel.id}>`,            inline: true },
    { name: 'Panel',   value: `#${panel.id}`,                inline: true },
    { name: 'Option',  value: option.label ?? `#${option.id}`, inline: true },
  ]);

  await sendTicketLog(client, guild, { optionId: option.id, panelId: panel.id }, logEmbed);

  return _safeReply(interaction, {
    embeds : [embed.build(guildId, `Votre ticket a été créé : <#${channel.id}>`)],
    flags  : 64,
  });
}


async function handleClaim(client, ctx) {
  const isInteraction = !!ctx.user;
  const channel       = ctx.channel;
  const userId        = isInteraction ? ctx.user.id : ctx.author.id;
  const guildId       = ctx.guild.id;

  const ticket = db.getTicket(channel.id);

  if (!ticket) {
    return _replyCtxError(ctx, guildId, 'Ce salon ne correspond à aucun ticket.');
  }

  if (ticket.status === 'closed') {
    return _replyCtxError(ctx, guildId, 'Ce ticket est déjà fermé.');
  }

  if (ticket.claimedBy) {
    return _replyCtxError(ctx, guildId, `Ce ticket est déjà pris en charge par <@${ticket.claimedBy}>.`);
  }

  if (!_isStaffCtx(ctx, ticket, userId, 'claim')) {
    return _replyCtxError(ctx, guildId, 'Vous n\'avez pas la permission de claim ce ticket.');
  }

  db.claimTicket(channel.id, userId);

  const panel     = ticket.panelId ? db.getTicketPanel(ticket.panelId) : null;
  const claimMode = panel?.claimMode || 'off';

  if (claimMode === 'lock' || claimMode === 'cache') {
    const option     = ticket.optionId ? db.getTicketOption(ticket.optionId) : null;
    const staffRoles = option ? _parseJsonArray(option.staffRoles) : [];
    const owners     = typeof db.getGlobalOwners === 'function' ? db.getGlobalOwners() : [];

    const overwrites = [
      {
        id   : ctx.guild.id,
        deny : [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id    : ticket.userId,
        allow : [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      },
      {
        id    : userId,
        allow : [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      },
      {
        id    : client.user.id,
        allow : [
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


    if (claimMode === 'lock') {
      for (const roleId of staffRoles) {
        if (!ctx.guild.roles.cache.has(roleId)) continue;
        overwrites.push({
          id    : roleId,
          allow : [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
          deny  : [PermissionsBitField.Flags.SendMessages],
        });
      }
    }


    for (const ownerId of owners) {
      overwrites.push({
        id    : ownerId,
        allow : [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      });
    }

    await channel.permissionOverwrites.set(overwrites).catch(() => {});
  }

  const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
  if (messages) {
    const botMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0);
    if (botMsg) {
      const hasClaim = botMsg.components.some(row => row.components.some(c => c.customId === 'ticket_claim'));
      const hasClose = botMsg.components.some(row => row.components.some(c => c.customId === 'ticket_close'));

      if (hasClaim) {
        const updatedBtns = [];
        updatedBtns.push(
          new ButtonBuilder()
            .setCustomId('ticket_claim_disabled')
            .setLabel('Claimed')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true)
        );
        if (hasClose) {
          updatedBtns.push(
            new ButtonBuilder()
              .setCustomId('ticket_close')
              .setLabel('Close')
              .setStyle(ButtonStyle.Danger)
          );
        }
        await botMsg.edit({
          components: [new ActionRowBuilder().addComponents(updatedBtns)],
        }).catch(() => {});
      }
    }
  }

  const claimLog = embed.log(guildId, 'Ticket claim', [
    { name: 'Ticket',   value: `<#${channel.id}>`,   inline: true },
    { name: 'Staff',    value: `<@${userId}>`,        inline: true },
    { name: 'Créateur', value: `<@${ticket.userId}>`, inline: true },
  ]);

  await sendTicketLog(client, ctx.guild, ticket, claimLog);

  const msg = {
    embeds: [embed.build(guildId, `Le ticket est maintenant pris en charge par <@${userId}>.`)],
  };

  return isInteraction
    ? _safeReply(ctx, msg)
    : ctx.reply({ ...msg, allowedMentions: { repliedUser: false } }).catch(() => {});
}

async function handleAutoClaimMessage(client, message) {
  const guildId = message.guild?.id;
  if (!guildId) return false;

  const ticket = db.getTicket(message.channel.id);
  if (!ticket)                    return false;
  if (ticket.status === 'closed') return false;
  if (ticket.claimedBy)           return false;

  const panel = ticket.panelId ? db.getTicketPanel(ticket.panelId) : null;
  if (!panel || panel.claimMode !== 'autoclaim') return false;

  const option = ticket.optionId ? db.getTicketOption(ticket.optionId) : null;
  if (!option) return false;

  if (message.author.id === ticket.userId) return false;

  const staffRoles = _parseJsonArray(option.staffRoles);

  const isBuyerAutoclaim = permissions.isBuyer(message.author.id);
  const isGlobalOwner    = db.isOwner(guildId, message.author.id);

  const hasStaffRole =
    message.member?.roles?.cache?.some(role => staffRoles.includes(role.id)) || false;

  if (!isBuyerAutoclaim && !isGlobalOwner && !hasStaffRole) {
    return false;
  }

  db.claimTicket(message.channel.id, message.author.id);

  const claimLog = embed.log(guildId, 'Ticket auto-claim', [
    { name: 'Ticket',   value: `<#${message.channel.id}>`,   inline: true },
    { name: 'Staff',    value: `<@${message.author.id}>`,    inline: true },
    { name: 'Créateur', value: `<@${ticket.userId}>`,        inline: true },
  ]);

  await sendTicketLog(client, message.guild, ticket, claimLog);

  await message.channel.send({
    embeds: [embed.build(guildId, `Le ticket a été automatiquement pris en charge par <@${message.author.id}>.`)],
  }).catch(() => {});

  return true;
}


async function handleClose(client, ctx, reason = null) {
  const isInteraction = !!ctx.user;
  const channel       = ctx.channel;
  const userId        = isInteraction ? ctx.user.id : ctx.author.id;
  const guildId       = ctx.guild.id;

  const _prefix = (() => {
    try {
      return db.getGuildConfig(guildId)?.prefix || '+';
    } catch {
      return '+';
    }
  })();

  const ticket = db.getTicket(channel.id);

  if (!ticket) {
    return _replyCtxError(ctx, guildId, 'Ce salon ne correspond à aucun ticket.');
  }

  if (ticket.status === 'closed') {
    return _replyCtxError(ctx, guildId, 'Ce ticket est déjà fermé.');
  }

  if (!_canCloseTicket(ctx, ticket, userId)) {
    return _replyCtxError(ctx, guildId, 'Vous ne pouvez pas fermer ce ticket.');
  }

  try {
    const transcript = await _generateTranscript(channel);
    const panel      = ticket.panelId ? db.getTicketPanel(ticket.panelId) : null;

    const rawAutoDelete   = panel?.autoDeleteSeconds;
    const configuredDelay = rawAutoDelete == null ? null : Number(rawAutoDelete);


    let deleteDelaySeconds;
    let deleteAt;
    const nowEpoch = Math.floor(Date.now() / 1000);

    if (configuredDelay === 0) {
      deleteDelaySeconds = null;
      deleteAt           = null;
    } else if (Number.isFinite(configuredDelay) && configuredDelay > 0) {
      deleteDelaySeconds = configuredDelay;
      deleteAt           = nowEpoch + configuredDelay;
    } else {
      deleteDelaySeconds = 30;
      deleteAt           = nowEpoch + 30;
    }

    if (typeof db.closeTicket === 'function') {
      db.closeTicket(channel.id, userId, reason ?? null, deleteAt);
    }

    const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
    if (messages) {
      const botMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0);

      if (botMsg) {
        const disabled = [];

        if (botMsg.components.some(row => row.components.some(c => c.customId === 'ticket_claim'))) {
          disabled.push(
            new ButtonBuilder()
              .setCustomId('ticket_claim_disabled')
              .setLabel('Claim')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(true)
          );
        }

        if (botMsg.components.some(row => row.components.some(c => c.customId === 'ticket_close'))) {
          disabled.push(
            new ButtonBuilder()
              .setCustomId('ticket_close_disabled')
              .setLabel('Closed')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true)
          );
        }

        if (disabled.length) {
          await botMsg.edit({
            components: [new ActionRowBuilder().addComponents(disabled)],
          }).catch(() => {});
        }
      }
    }

    const closingEmbed = embed.build(
      guildId,
      deleteDelaySeconds
        ? `Le ticket sera supprimé <t:${nowEpoch + deleteDelaySeconds}:R>.\nFermé par <@${userId}>${reason ? `\nRaison : ${reason}` : ''}`
        : `Le ticket est fermé. Il peut être rouvert par le staff.\nFermé par <@${userId}>${reason ? `\nRaison : ${reason}` : ''}`,
      { timestamp: new Date() }
    );

    if (isInteraction) {
      await _safeReply(ctx, { embeds: [closingEmbed], allowedMentions: { parse: [] } });
    } else {
      await channel.send({ embeds: [closingEmbed], allowedMentions: { parse: [] } }).catch(() => {});
    }

    const logEmbed = embed.log(guildId, 'Ticket fermé', [
      { name: 'Créateur',  value: `<@${ticket.userId}>`, inline: true },
      { name: 'Fermé par', value: `<@${userId}>`,        inline: true },
      { name: 'Raison',    value: reason ?? 'Aucune',    inline: false },
      { name: 'Messages',  value: String(transcript.count), inline: true },
    ]);

    const logChannel = await sendTicketLog(client, ctx.guild, ticket, logEmbed);

    if (transcript.content) {
      const attachment = new AttachmentBuilder(
        Buffer.from(transcript.content, 'utf-8'),
        { name: `transcript-${channel.name}.txt` }
      );

      const transcriptPayload = _buildTicketLogPayload(
        { title: `Transcript du ticket ${channel.name}` },
        { files: [attachment] }
      );

      if (logChannel && typeof logChannel.send === 'function') {
        await logChannel.send(transcriptPayload).catch(() => {});
      } else {
        const config = db.getGuildConfig(guildId);
        const modLogChannelId = config?.modLogChannel;
        const modLogChannel = modLogChannelId
          ? ctx.guild.channels.cache.get(modLogChannelId)
          : null;

        if (modLogChannel?.isTextBased()) {
          await modLogChannel.send(transcriptPayload).catch(() => {});
        }
      }
    }

    if (panel?.transcriptDm && transcript.content) {
      const user = await client.users.fetch(ticket.userId).catch(() => null);
      if (user) {
        const dmAttachment = new AttachmentBuilder(
          Buffer.from(transcript.content, 'utf-8'),
          { name: `transcript-${channel.name}.txt` }
        );

        await user.send({
          content : `Voici le transcript de votre ticket ${channel.name}.`,
          files   : [dmAttachment],
        }).catch(() => {});
      }
    }

    if (deleteDelaySeconds && deleteDelaySeconds > 0) {
      _schedulePendingDelete(client, ticket, deleteDelaySeconds * 1000);
    } else {
      await _executeTicketDelete(client, ticket);
    }

  } catch (err) {
    errorHandler.handle(err, { source: 'tickets.handleClose', guildId });
  }
}

function _buildRatingCard(title, description, details) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${title}\n${description}`)
    );

  if (details) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(1))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(details));
  }

  return container;
}

async function _sendRatingDm(client, ticket, guildId) {
  const ratingRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ticket_rating:${ticket.id}`)
      .setPlaceholder('Choisis ta note de 1 à 5')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('⭐ Très mauvais').setValue('1').setDescription('1/5'),
        new StringSelectMenuOptionBuilder().setLabel('⭐⭐ Mauvais').setValue('2').setDescription('2/5'),
        new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐ Correct').setValue('3').setDescription('3/5'),
        new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐⭐ Bien').setValue('4').setDescription('4/5'),
        new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐⭐⭐ Excellent').setValue('5').setDescription('5/5'),
      )
  );

  const guildConfig   = db.getGuildConfig(guildId);
  const ratingChannelId = guildConfig?.ticketRatingChannel;
  const guild         = client.guilds.cache.get(guildId);
  const guildName     = guild?.name ?? 'Serveur';

  const claimedBy = ticket.claimedBy
    ? `<@${ticket.claimedBy}>`
    : 'Non assigné';

  const openedAt = ticket.createdAt
    ? `<t:${ticket.createdAt}:F>`
    : 'Inconnu';
  const details = [
    `**Serveur**\n${guildName}`,
    `**Ticket**\n#${ticket.id}`,
    `**Pris en charge**\n${claimedBy}`,
    `**Ouvert le**\n${openedAt}`,
  ].join('\n\n');
  const ratingCard = _buildRatingCard(
    '⭐ Ton avis compte !',
    'Ton ticket est fermé. Comment évalues-tu le support reçu ?',
    details
  );

  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (!user) return;

  await user.send({
    components      : [ratingCard, ratingRow],
    flags           : COMPONENTS_V2_FLAG,
    allowedMentions : { parse: [] },
  }).catch(() => null);
}

async function handleRating(interaction) {
  const match = /^ticket_rating:(\d+)$/.exec(interaction.customId);
  if (!match) return;

  const ticketId = Number(match[1]);
  const ticket = db.getTicketById(ticketId);
  if (!ticket) {
    return interaction.update({
      components: [_buildRatingCard(
        'Évaluation annulée',
        'Ce ticket n’existe plus ; aucune note n’a été enregistrée.',
        null
      )],
      flags: COMPONENTS_V2_FLAG,
    });
  }

  if (interaction.user.id !== ticket.userId) {
    return interaction.reply({ content: 'Cette évaluation ne vous est pas destinée.', flags: 64 });
  }

  if (ticket.status !== 'closed') {
    return interaction.update({
      components: [_buildRatingCard(
        'Évaluation annulée',
        'Ce ticket a été rouvert ; tu pourras l’évaluer lorsqu’il sera de nouveau fermé.',
        null
      )],
      flags: COMPONENTS_V2_FLAG,
    });
  }

  const rating = Number(interaction.values[0]);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return interaction.reply({ content: 'Note invalide. Choisis une note entre 1 et 5.', flags: 64 });
  }

  const saved = db.setTicketRating(ticket.id, rating, null);
  const stars  = '⭐'.repeat(rating);
  const labels = ['', 'Très mauvais', 'Mauvais', 'Correct', 'Bien', 'Excellent'];

  if (!saved) {
    const latest = db.getTicketById(ticket.id);
    const reopened = latest?.status !== 'closed';
    return interaction.update({
      components: [_buildRatingCard(
        reopened ? 'Évaluation annulée' : 'Merci, tu as déjà répondu !',
        reopened
          ? 'Ce ticket a été rouvert ; aucune note n’a été enregistrée.'
          : 'Une seule évaluation est autorisée par ticket. Ta première note a bien été conservée.',
        null
      )],
      flags: COMPONENTS_V2_FLAG,
    });
  }

  const guildConfig = db.getGuildConfig(ticket.guildId);
  const ratingChannelId = guildConfig?.ticketRatingChannel;
  const guild = interaction.client.guilds.cache.get(ticket.guildId);
  const claimedBy = ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Non assigné';
  const openedAt = ticket.createdAt ? `<t:${ticket.createdAt}:F>` : 'Inconnu';
  const details = [
    `**Ticket**\n#${ticket.id}`,
    `**Ta note**\n${stars} ・ **${labels[rating]}** (${rating}/5)`,
    `**Pris en charge**\n${claimedBy}`,
  ].join('\n\n');

  try {
    await interaction.update({
      components: [_buildRatingCard(
        'Merci pour ton retour !',
        'Ton évaluation a bien été enregistrée.',
        details
      )],
      flags: COMPONENTS_V2_FLAG,
    });
  } catch (err) {
    await errorHandler.handle(err, {
      source: 'tickets.handleRating.confirmation',
      guildId: ticket.guildId,
      userId: ticket.userId,
      ticketId: ticket.id,
    });
  }

  if (!ratingChannelId) return;

  let ratingGuild;
  let ratingChannel;
  try {
    ratingGuild = guild ?? await interaction.client.guilds.fetch(ticket.guildId);
    ratingChannel = await ratingGuild.channels.fetch(ratingChannelId);
  } catch (err) {
    errorHandler.handle(err, {
      source: 'tickets.sendRatingLog.fetchChannel',
      guildId: ticket.guildId,
      channelId: ratingChannelId,
    });
    return;
  }

  if (!ratingChannel?.isTextBased() || ratingChannel.guildId !== ticket.guildId) {
    errorHandler.handle(new Error('Le salon configuré pour les évaluations est introuvable ou n’est pas textuel.'), {
      source: 'tickets.sendRatingLog.invalidChannel',
      guildId: ticket.guildId,
      channelId: ratingChannelId,
    });
    return;
  }

  const me = ratingGuild.members.me ?? await ratingGuild.members.fetchMe().catch(() => null);
  const channelPerms = me ? ratingChannel.permissionsFor(me) : null;
  if (!channelPerms?.has('ViewChannel') || !channelPerms?.has('SendMessages') || !channelPerms?.has('EmbedLinks')) {
    errorHandler.handle(new Error('Le bot n’a pas les permissions nécessaires dans le salon des évaluations.'), {
      source: 'tickets.sendRatingLog.missingPermissions',
      guildId: ticket.guildId,
      channelId: ratingChannelId,
    });
    return;
  }

  try {
    await ratingChannel.send(_buildTicketLogPayload({
      title: `Évaluation reçue ・ Ticket #${ticket.id}`,
      fields: [
        { name: 'Membre', value: `<@${ticket.userId}>` },
        { name: 'Note', value: `${stars} ・ ${labels[rating]}` },
        { name: 'Pris en charge', value: claimedBy },
        { name: 'Serveur', value: ratingGuild.name },
        { name: 'Ouvert le', value: openedAt },
      ],
    }));
  } catch (err) {
    errorHandler.handle(err, {
      source: 'tickets.sendRatingLog.send',
      guildId: ticket.guildId,
      channelId: ratingChannelId,
      ticketId: ticket.id,
    });
  }
}

async function handleCloseModal(client, interaction) {
  const guildId = interaction.guild.id;

  try {
    const reason = interaction.fields.getTextInputValue('reason')?.trim() || null;
    return handleClose(client, interaction, reason);
  } catch (err) {
    errorHandler.handle(err, { source: 'tickets.handleCloseModal', guildId });

    return interaction.reply({
      embeds : [embed.build(guildId, 'Une erreur est survenue lors de la fermeture du ticket.', { color: '#ED4245' })],
      flags  : 64,
    }).catch(() => {});
  }
}


async function _fetchTranscriptMessages(channel, max = 1000) {
  const collected = [];
  let before = null;

  while (collected.length < max) {
    const limit   = Math.min(100, max - collected.length);
    const options = before ? { limit, before } : { limit };
    const batch   = await channel.messages.fetch(options).catch(() => null);

    if (!batch?.size) break;

    const values = Array.from(batch.values());
    collected.push(...values);
    before = values[values.length - 1]?.id;

    if (batch.size < 100) break;
  }

  return collected;
}

async function _generateTranscript(channel) {
  try {
    const messages = await _fetchTranscriptMessages(channel, 1000);

    if (!messages.length) {
      return { content: null, count: 0 };
    }


    const sorted = messages.reverse();
    const lines  = sorted.map(m => {
      const time    = new Date(m.createdTimestamp).toLocaleString('fr-FR');
      const content = m.content || (m.embeds.length ? '[Embed]' : '[Média]');
      const authorTag = m.author?.tag ?? m.author?.username ?? `Utilisateur (${m.author?.id ?? 'inconnu'})`;
      return `[${time}] ${authorTag}: ${content}`;
    });

    if (messages.length >= 1000) {
      lines.unshift('[Transcript tronqué aux 1000 derniers messages.]');
    }

    return {
      content : lines.join('\n'),
      count   : sorted.length,
    };
  } catch {
    return { content: null, count: 0 };
  }
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

function isTicketStaff(ctx, ticket) {
  const userId = ctx.user?.id ?? ctx.author?.id ?? ctx.member?.id;
  if (!userId) return false;
  return _isStaffCtx(ctx, ticket, userId);
}

function _hasTicketPermission(ctx, commandName) {
  if (!commandName) return false;
  return permissions.check(ctx, commandName);
}

function _isStaffCtx(ctx, ticket, userId, commandName = null) {
  const member  = ctx.member;
  const guildId = ctx.guild?.id ?? ctx.guildId;

  if (permissions.isBuyer(userId)) return true;

  if (member?.permissions?.has(PermissionsBitField.Flags.Administrator)) return true;

  const isOwner = guildId ? db.isOwner(guildId, userId) : false;
  if (isOwner) return true;

  if (_hasTicketPermission(ctx, commandName)) return true;

  if (!ticket?.optionId) return false;
  const option     = db.getTicketOption(ticket.optionId);
  const staffRoles = _parseJsonArray(option?.staffRoles);
  if (!staffRoles.length) return false;

  return staffRoles.some(roleId => member?.roles?.cache?.has(roleId));
}

function _canCloseTicket(ctx, ticket, userId) {
  if (_isStaffCtx(ctx, ticket, userId, 'close')) return true;
  if (userId === ticket.userId) return true;
  return false;
}

function canCloseTicket(interaction) {
  const ticket = db.getTicket(interaction.channel?.id);
  if (!ticket) return false;
  const userId = interaction.user?.id ?? interaction.member?.id;
  if (!userId) return false;
  return _canCloseTicket(interaction, ticket, userId);
}

function _resolveTicketName(template, user, option, ticketNumber) {
  const safeUsername = String(user.username || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 20);

  const safeOption = String(option.label || 'ticket')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 20);

  const value = String(template || 'ticket-{number}')
    .replaceAll('{username}', safeUsername || 'user')
    .replaceAll('{user}',     safeUsername || 'user')
    .replaceAll('{userid}',   user.id)
    .replaceAll('{option}',   safeOption || 'ticket')
    .replaceAll('{number}',   String(ticketNumber).padStart(4, '0'));

  return value.slice(0, 90) || `ticket-${String(ticketNumber).padStart(4, '0')}`;
}

function _replyError(interaction, guildId, content) {
  return _safeReply(interaction, {
    embeds : [embed.build(guildId, content, { color: '#ED4245' })],
    flags  : 64,
  });
}

function _replyCtxError(ctx, guildId, content) {
  const isInteraction = !!ctx.user;

  if (isInteraction) {
    return _safeReply(ctx, {
      embeds : [embed.build(guildId, content, { color: '#ED4245' })],
      flags  : 64,
    });
  }

  return ctx.reply({
    embeds          : [embed.build(guildId, content, { color: '#ED4245' })],
    allowedMentions : { repliedUser: false },
  }).catch(() => {});
}

async function _resetPanelSelect(interaction, panel) {
  const msg = interaction.message;
  if (!msg) return;

  const options = db.getTicketOptions(panel.id);
  if (!options.length) return;

  const select = new StringSelectMenuBuilder()
    .setCustomId(`ticket_select_${panel.id}`)
    .setPlaceholder((panel.placeholder || 'Fais un choix').slice(0, 150))
    .addOptions(options.slice(0, 25).map(opt => ({
      label       : String(opt.label || 'Option').slice(0, 100),
      description : String(opt.description || 'Ouvrir un ticket').slice(0, 100),
      value       : String(opt.id),
      ...(opt.emoji ? { emoji: opt.emoji } : {}),
    })));

  await msg.edit({
    components: [new ActionRowBuilder().addComponents(select)],
  });
}

function _safeReply(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload).catch(() => {});
  }

  return interaction.reply(payload).catch(() => {});
}


async function sendTicketLog(client, guild, ticket, logEmbed) {
  try {
    const payload = _buildTicketLogPayload(logEmbed);
    if (ticket.optionId) {
      const option = db.getTicketOption(ticket.optionId);
      if (option?.logChannelId) {
        const ch = await _resolveLogChannel(guild, option.logChannelId);
        if (ch) {
          await ch.send(payload);
          return ch;
        }
      }
    }

    if (ticket.panelId) {
      const panel = db.getTicketPanel(ticket.panelId);
      if (panel?.logChannelId) {
        const ch = await _resolveLogChannel(guild, panel.logChannelId);
        if (ch) {
          await ch.send(payload);
          return ch;
        }
      }
    }

    const config = db.getGuildConfig(guild.id);
    if (config?.ticketLogChannel) {
      const ch = await _resolveLogChannel(guild, config.ticketLogChannel);
      if (ch) {
        await ch.send(payload);
        return ch;
      }
    }

    if (config?.modLogChannel) {
      const ch = await _resolveLogChannel(guild, config.modLogChannel);
      if (ch) {
        await ch.send(payload);
        return ch;
      }
    }

    return null;
  } catch (err) {
    errorHandler.handle(err, {
      source: 'tickets.sendTicketLog',
      guildId: guild.id,
      ticketId: ticket.id ?? null,
    });
    return null;
  }
}

function _buildTicketLogPayload(logEmbed, extra = {}) {
  const data = logEmbed?.data ?? logEmbed ?? {};
  const parts = [];

  if (data.title) parts.push(`## ${data.title}`);
  if (data.description) parts.push(String(data.description));

  if (Array.isArray(data.fields)) {
    for (const field of data.fields) {
      parts.push(`**${String(field.name || 'Détail')}**\n${String(field.value || '—')}`);
    }
  }

  if (data.footer?.text) parts.push(`-# ${data.footer.text}`);
  if (data.timestamp) {
    const timestamp = Math.floor(new Date(data.timestamp).getTime() / 1000);
    if (Number.isFinite(timestamp)) parts.push(`-# <t:${timestamp}:F>`);
  }

  const content = parts.join('\n\n').slice(0, 4000) || '## Journal du ticket';
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  return {
    ...extra,
    components: [container],
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { parse: [] },
  };
}

async function _resolveLogChannel(guild, channelId) {
  try {
    const ch = guild.channels.cache.get(channelId)
      ?? await guild.channels.fetch(channelId).catch(() => null);
    if (!ch) return null;
    if (!ch.isTextBased()) return null;
    if (typeof ch.isThread === 'function' && ch.isThread()) return null;
    return ch;
  } catch {
    return null;
  }
}


async function closeOnMemberLeave(client, guild, ticket) {
  const guildId = guild.id;

  try {
    const panel = ticket.panelId ? db.getTicketPanel(ticket.panelId) : null;

    const rawAutoDelete      = panel?.autoDeleteSeconds;
    const deleteDelaySeconds = rawAutoDelete == null ? null : Number(rawAutoDelete);

    const deleteAt =
      deleteDelaySeconds && deleteDelaySeconds > 0
        ? Math.floor(Date.now() / 1000) + deleteDelaySeconds
        : null;

    const channel = guild.channels.cache.get(ticket.channelId);
    const transcript = channel ? await _generateTranscript(channel) : { content: null, count: 0 };

    if (typeof db.closeTicket === 'function') {
      db.closeTicket(ticket.channelId, client.user.id, 'Membre parti du serveur', deleteAt);
    }

    if (channel) {
      await channel.send({
        embeds: [
          embed.build(
            guildId,
            `Ticket fermé automatiquement.\nRaison : membre <@${ticket.userId}> parti du serveur.`,
            { timestamp: new Date() }
          ),
        ],
        allowedMentions: { parse: [] },
      }).catch(() => {});

      if (deleteDelaySeconds && deleteDelaySeconds > 0) {
        _schedulePendingDelete(client, ticket, deleteDelaySeconds * 1000);
      }
    }

    const logEmbed = embed.log(guildId, 'Ticket fermé (closeOnLeave)', [
      { name: 'Créateur', value: `<@${ticket.userId}>`,    inline: true },
      { name: 'Ticket',   value: `<#${ticket.channelId}>`, inline: true },
      { name: 'Raison',   value: 'Membre parti du serveur', inline: false },
      { name: 'Messages', value: String(transcript.count), inline: true },
    ]);

    const logChannel = await sendTicketLog(client, guild, ticket, logEmbed);

    if (transcript.content) {
      const attachment = new AttachmentBuilder(
        Buffer.from(transcript.content, 'utf-8'),
        { name: `transcript-${channel?.name || ticket.channelId}.txt` }
      );

      const transcriptPayload = _buildTicketLogPayload(
        { title: `Transcript du ticket ${channel?.name || ticket.channelId}` },
        { files: [attachment] }
      );

      if (logChannel && typeof logChannel.send === 'function') {
        await logChannel.send(transcriptPayload).catch(() => {});
      } else {
        const config = db.getGuildConfig(guildId);
        const modLogChannelId = config?.modLogChannel;
        const modLogChannel = modLogChannelId
          ? guild.channels.cache.get(modLogChannelId)
          : null;

        if (modLogChannel?.isTextBased()) {
          await modLogChannel.send(transcriptPayload).catch(() => {});
        }
      }
    }

    if (panel?.transcriptDm && transcript.content) {
      const user = await client.users.fetch(ticket.userId).catch(() => null);
      if (user) {
        const dmAttachment = new AttachmentBuilder(
          Buffer.from(transcript.content, 'utf-8'),
          { name: `transcript-${channel?.name || ticket.channelId}.txt` }
        );

        await user.send({
          content : `Voici le transcript de votre ticket ${channel?.name || ticket.channelId}.`,
          files   : [dmAttachment],
        }).catch(() => {});
      }
    }
  } catch (err) {
    errorHandler.handle(err, { source: 'tickets.closeOnMemberLeave', guildId });
  }
}


const _pendingDeleteTimers = new Map();

function _schedulePendingDelete(client, ticket, delayMs) {
  const id = ticket.channelId;

  const existing = _pendingDeleteTimers.get(id);
  if (existing) {
    if (typeof existing.clear === 'function') existing.clear();
    else clearTimeout(existing);
  }

  if (delayMs <= 0) {
    _pendingDeleteTimers.delete(id);
    _executeTicketDelete(client, ticket);
    return;
  }


  const timer = safeSetTimeout(() => {
    _pendingDeleteTimers.delete(id);
    _executeTicketDelete(client, ticket);
  }, delayMs);

  _pendingDeleteTimers.set(id, timer);
}

async function restorePendingDeletes(client) {
  const tickets = typeof db.getTicketsPendingDelete === 'function'
    ? db.getTicketsPendingDelete()
    : [];

  if (!tickets.length) return;

  const now = Math.floor(Date.now() / 1000);

  for (const ticket of tickets) {
    if (_pendingDeleteTimers.has(ticket.channelId)) continue;

    if (ticket.status !== 'closed') continue;

    const delay = (ticket.deleteAt - now) * 1000;
    _schedulePendingDelete(client, ticket, delay);
  }
}

function cancelPendingDelete(channelId) {
  const timer = _pendingDeleteTimers.get(channelId);
  if (timer) {
    if (typeof timer.clear === 'function') timer.clear();
    else clearTimeout(timer);
    _pendingDeleteTimers.delete(channelId);
  }
}

async function _executeTicketDelete(client, ticket) {
  try {
    const fresh = db.getTicket(ticket.channelId);
    if (!fresh || fresh.status !== 'closed') return;

    const guild = client.guilds.cache.get(ticket.guildId);
    if (!guild) return;

    const guildConfig = db.getGuildConfig(ticket.guildId);
    if (Number(guildConfig?.ticketRatingEnabled ?? 1) !== 0) {
      await _sendRatingDm(client, fresh, ticket.guildId).catch(() => {});
    }

    const channel = guild.channels.cache.get(ticket.channelId)
      ?? await guild.channels.fetch(ticket.channelId).catch(() => null);

    if (channel) {
      await channel.delete('Auto-delete ticket').catch(() => {});
    }

    db.raw()
      .prepare("UPDATE tickets SET channelId = 'deleted_' || id, deleteAt = NULL, updatedAt = unixepoch() WHERE guildId = ? AND channelId = ?")
      .run(ticket.guildId, ticket.channelId);
  } catch (err) {
    errorHandler.handle(err, { source: 'tickets.executeTicketDelete', channelId: ticket.channelId });
  }
}


async function processInactiveTickets(client) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const tickets = typeof db.getInactiveTickets === 'function'
      ? db.getInactiveTickets(now)
      : [];

    if (!tickets.length) return;

    for (const ticket of tickets) {
      try {
        const fresh = db.getTicket(ticket.channelId);
        if (!fresh || fresh.status !== 'open') continue;

        const guild = client.guilds.cache.get(ticket.guildId);
        if (!guild) continue;

        const channel = guild.channels.cache.get(ticket.channelId)
          ?? await guild.channels.fetch(ticket.channelId).catch(() => null);

        if (!channel) {
          if (typeof db.closeTicket === 'function') {
            db.closeTicket(ticket.channelId, client.user.id, 'Fermeture inactive (salon introuvable)', null);
          }
          continue;
        }

        const deleteDelaySeconds = ticket.autoDeleteSeconds
          ? Number(ticket.autoDeleteSeconds)
          : null;

        const deleteAt =
          deleteDelaySeconds && deleteDelaySeconds > 0
            ? now + deleteDelaySeconds
            : null;

        const transcript = await _generateTranscript(channel);

        if (typeof db.closeTicket === 'function') {
          db.closeTicket(ticket.channelId, client.user.id, 'Ticket fermé automatiquement pour inactivité.', deleteAt);
        }

        await channel.send({
          embeds: [
            embed.build(
              ticket.guildId,
              `Ticket fermé automatiquement pour inactivité.`,
              { timestamp: new Date() }
            ),
          ],
          allowedMentions: { parse: [] },
        }).catch(() => {});

        if (deleteDelaySeconds && deleteDelaySeconds > 0) {
          _schedulePendingDelete(client, ticket, deleteDelaySeconds * 1000);
        }

        const logEmbed = embed.log(ticket.guildId, 'Ticket fermé (inactivité)', [
          { name: 'Créateur', value: `<@${ticket.userId}>`,    inline: true },
          { name: 'Ticket',   value: `<#${ticket.channelId}>`, inline: true },
          { name: 'Raison',   value: 'Inactivité',            inline: false },
          { name: 'Messages', value: String(transcript.count), inline: true },
        ]);

        const logChannel = await sendTicketLog(client, guild, ticket, logEmbed);

        if (transcript.content) {
          const attachment = new AttachmentBuilder(
            Buffer.from(transcript.content, 'utf-8'),
            { name: `transcript-${channel.name}.txt` }
          );

          const transcriptPayload = _buildTicketLogPayload(
            { title: `Transcript du ticket ${channel.name}` },
            { files: [attachment] }
          );

          if (logChannel && typeof logChannel.send === 'function') {
            await logChannel.send(transcriptPayload).catch(() => {});
          } else {
            const config = db.getGuildConfig(ticket.guildId);
            const modLogChannelId = config?.modLogChannel;
            const modLogChannel = modLogChannelId
              ? guild.channels.cache.get(modLogChannelId)
              : null;

            if (modLogChannel?.isTextBased()) {
              await modLogChannel.send(transcriptPayload).catch(() => {});
            }
          }
        }

        const panel = ticket.panelId ? db.getTicketPanel(ticket.panelId) : null;
        if (panel?.transcriptDm && transcript.content) {
          const user = await client.users.fetch(ticket.userId).catch(() => null);
          if (user) {
            const dmAttachment = new AttachmentBuilder(
              Buffer.from(transcript.content, 'utf-8'),
              { name: `transcript-${channel.name}.txt` }
            );

            await user.send({
              content : `Voici le transcript de votre ticket ${channel.name}.`,
              files   : [dmAttachment],
            }).catch(() => {});
          }
        }
      } catch (err) {
        errorHandler.handle(err, { source: 'tickets.processInactive', channelId: ticket.channelId });
      }
    }
  } catch (err) {
    errorHandler.handle(err, { source: 'tickets.processInactiveTickets' });
  }
}

module.exports = {
  handleOpen,
  handleSelectOpen,
  handleClaim,
  handleClose,
  handleCloseModal,
  handleRating,
  handleAutoClaimMessage,
  closeOnMemberLeave,
  sendTicketLog,
  restorePendingDeletes,
  cancelPendingDelete,
  isTicketStaff,
  canCloseTicket,
  processInactiveTickets,
};
