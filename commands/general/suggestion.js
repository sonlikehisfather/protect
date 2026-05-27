'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COLOR_APPROVED = '#57F287';
const COLOR_REJECTED = '#ED4245';

const SUGGESTION_COOLDOWN = 60_000;
const _cooldowns = new Map();

module.exports = {
  help: {
    name        : 'suggestion',
    description : 'Propose une suggestion au staff du serveur.',
    usage       : 'suggestion <message>',
    aliases     : ['suggest'],
  },

  async run(client, message, args) {
    const guildId = message.guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds ?? config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies ?? config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    if (!Number(config?.suggestionEnabled)) {
      return _err(message, deleteReply, deleteDelay,
        'Le système de suggestions est désactivé sur ce serveur.');
    }

    const pendingChId = config?.suggestionPendingChannel || config?.suggestionChannel;
    if (!pendingChId) {
      return _err(message, deleteReply, deleteDelay,
        'Aucun salon d\'attente n\'est configuré.');
    }

    const pendingCh = message.guild.channels.cache.get(pendingChId);
    if (!pendingCh?.isTextBased()) {
      return _err(message, deleteReply, deleteDelay,
        'Le salon d\'attente configuré est introuvable ou invalide.');
    }

    const content = args.join(' ').trim();

    if (!content) {
      return _err(message, deleteReply, deleteDelay,
        'Précisez une suggestion.\nExemple : `suggest Ajouter un salon musique`');
    }

    if (content.length > 1500) {
      return _err(message, deleteReply, deleteDelay,
        'La suggestion ne peut pas dépasser **1500** caractères.');
    }

    const userId  = message.author.id;
    const lastAt  = _cooldowns.get(userId) ?? 0;
    const elapsed = Date.now() - lastAt;
    if (elapsed < SUGGESTION_COOLDOWN) {
      const rem = Math.ceil((SUGGESTION_COOLDOWN - elapsed) / 1000);
      return _err(message, deleteReply, deleteDelay,
        `Attends ${rem}s avant de poster une nouvelle suggestion.`);
    }

    const suggestionId = db.createSuggestion(
      guildId,
      message.author.id,
      pendingCh.id,
      content
    );

    const pendingEmbed = _buildPendingEmbed(guildId, suggestionId, content, message.author);
    const staffRow     = _buildStaffRow(suggestionId);

    const sentSuggestion = await pendingCh.send({
      embeds          : [pendingEmbed],
      components      : [staffRow],
      allowedMentions : { parse: [] },
    }).catch(() => null);

    if (!sentSuggestion) {
      return _err(message, deleteReply, deleteDelay,
        'Impossible d\'envoyer la suggestion dans le salon d\'attente.');
    }

    db.setSuggestionMessageId(suggestionId, sentSuggestion.id);
    _cooldowns.set(userId, Date.now());

    _log(message.guild, config, guildId, 'Suggestion postée', [
      { name: 'Auteur',     value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
      { name: 'Salon',      value: `<#${pendingCh.id}>`,                              inline: true },
      { name: 'Suggestion', value: `#${suggestionId}`,                                inline: true },
      { name: 'Message',    value: `[Voir](${sentSuggestion.url})`,                   inline: false },
    ]);

    const sent = await embed.reply(
      message,
      `Suggestion envoyée dans <#${pendingCh.id}>.`,
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};


function _buildPendingEmbed(guildId, suggestionId, content, author) {
  return embed.build(guildId, content, {
    title      : `Suggestion #${suggestionId} - En attente`,
    authorName : author.displayName ?? author.username,
    authorIcon : author.displayAvatarURL({ size: 64 }),
    footer     : `ID : ${author.id}`,
    timestamp  : new Date(),
  });
}

function _buildApprovedEmbed(guildId, suggestionId, content, author, reason, fallbackUserId) {
  const fields = [];
  if (reason) {
    fields.push({ name: 'Note du staff', value: reason, inline: false });
  }
  return embed.build(guildId, content, {
    color      : COLOR_APPROVED,
    title      : `Suggestion #${suggestionId} - Validée`,
    authorName : author?.displayName ?? author?.username ?? 'Inconnu',
    authorIcon : author?.displayAvatarURL?.({ size: 64 }) ?? null,
    fields,
    footer     : `ID : ${author?.id ?? fallbackUserId ?? '?'}`,
    timestamp  : new Date(),
  });
}

function _buildRejectedEmbed(guildId, suggestionId, content, author, reason, fallbackUserId) {
  const fields = [];
  if (reason) {
    fields.push({ name: 'Raison du rejet', value: reason, inline: false });
  }
  return embed.build(guildId, content, {
    color      : COLOR_REJECTED,
    title      : `Suggestion #${suggestionId} - Rejetée`,
    authorName : author?.displayName ?? author?.username ?? 'Inconnu',
    authorIcon : author?.displayAvatarURL?.({ size: 64 }) ?? null,
    fields,
    footer     : `ID : ${author?.id ?? fallbackUserId ?? '?'}`,
    timestamp  : new Date(),
  });
}


function _buildStaffRow(suggestionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sug:approve:${suggestionId}`)
      .setLabel('Valider')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`sug:reject:${suggestionId}`)
      .setLabel('Rejeter')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`sug:delete:${suggestionId}`)
      .setLabel('Supprimer')
      .setStyle(ButtonStyle.Secondary),
  );
}


async function _err(message, deleteReply, deleteDelay, text) {
  const sent = await embed.replyError(message, text, { timestamp: false }).catch(() => null);
  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

function _log(guild, config, guildId, title, fields) {
  if (!config?.suggestionLogChannel) return;
  const logCh = guild.channels.cache.get(config.suggestionLogChannel);
  if (!logCh?.isTextBased()) return;
  logCh.send({
    embeds          : [embed.log(guildId, title, fields)],
    allowedMentions : { parse: [] },
  }).catch(() => {});
}


async function handleButton(client, interaction) {
  const id      = interaction.customId;
  const guildId = interaction.guild?.id;
  if (!guildId) return interaction.deferUpdate().catch(() => {});

  const match = id.match(/^sug:(approve|reject|delete):(\d+)$/);
  if (!match) return interaction.deferUpdate().catch(() => {});

  const action       = match[1];
  const suggestionId = Number(match[2]);


  const isStaff =
    perms.isBuyer(interaction.user.id) ||
    perms.isGlobalOwner(interaction.user.id) ||
    perms.check({
      member  : interaction.member,
      guild   : interaction.guild,
      channel : interaction.channel,
    }, 'suggestionconfig');

  if (!isStaff) {
    return interaction.reply({
      embeds : [embed.build(guildId, 'Vous n\'avez pas la permission de gérer les suggestions.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const suggestion = db.getSuggestion(suggestionId);
  if (!suggestion || suggestion.guildId !== guildId) {
    return interaction.reply({
      embeds : [embed.build(guildId, 'Cette suggestion n\'existe plus.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  if (suggestion.status !== 'pending') {
    return interaction.reply({
      embeds : [embed.build(guildId, 'Cette suggestion a déjà été traitée.', { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  const config = db.getGuildConfig(guildId);


  const author = interaction.guild.members.cache.get(suggestion.userId)?.user
    ?? await client.users.fetch(suggestion.userId).catch(() => null);

  if (action === 'approve') {
    const modalId = `sug:approve_modal:${interaction.id}`;
    const shown = await interaction.showModal(
      new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Valider la suggestion')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('Note (optionnelle)')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(1000)
              .setPlaceholder('Commentaire visible sur l\'embed...')
          )
        )
    ).then(() => true).catch(() => false);

    if (!shown) return;

    let submit;
    try {
      submit = await interaction.awaitModalSubmit({
        filter: i => i.customId === modalId && i.user.id === interaction.user.id,
        time: 120_000,
      });
    } catch { return; }

    const reason = submit.fields.getTextInputValue('reason').trim() || null;

    db.updateSuggestionStatus(suggestionId, 'approved', reason, interaction.user.id);


    const approvedPending = _buildApprovedEmbed(guildId, suggestionId, suggestion.content, author, reason, suggestion.userId);

    await submit.deferUpdate().catch(() => {});
    await interaction.message.edit({
      embeds          : [approvedPending],
      components      : [],
      allowedMentions : { parse: [] },
    }).catch(() => {});

    const validatedChId = config?.suggestionValidatedChannel;
    const validatedCh   = validatedChId
      ? interaction.guild.channels.cache.get(validatedChId)
      : null;

    if (validatedCh?.isTextBased()) {
      const validatedEmbed = _buildApprovedEmbed(guildId, suggestionId, suggestion.content, author, reason, suggestion.userId);

      const validatedMsg = await validatedCh.send({
        embeds          : [validatedEmbed],
        components      : [],
        allowedMentions : { parse: [] },
      }).catch(() => null);

      if (validatedMsg) {
        db.setSuggestionValidatedMessageId(suggestionId, validatedMsg.id);
        await validatedMsg.react('\u2705').catch(() => {});
        await validatedMsg.react('\u274c').catch(() => {});
      }
    }

    _log(interaction.guild, config, guildId, 'Suggestion validée', [
      { name: 'Suggestion', value: `#${suggestionId}`,                        inline: true },
      { name: 'Staff',      value: `<@${interaction.user.id}>`,               inline: true },
      { name: 'Note',       value: reason || 'Aucune',                        inline: false },
      { name: 'Message',    value: `[Voir](${interaction.message.url})`,      inline: false },
    ]);

    return;
  }

  if (action === 'reject') {
    const modalId = `sug:reject_modal:${interaction.id}`;
    const shown = await interaction.showModal(
      new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Rejeter la suggestion')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('Raison du rejet')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1000)
              .setPlaceholder('Expliquez pourquoi la suggestion est rejetée...')
          )
        )
    ).then(() => true).catch(() => false);

    if (!shown) return;

    let submit;
    try {
      submit = await interaction.awaitModalSubmit({
        filter: i => i.customId === modalId && i.user.id === interaction.user.id,
        time: 120_000,
      });
    } catch { return; }

    const reason = submit.fields.getTextInputValue('reason').trim() || 'Aucune raison fournie.';

    db.updateSuggestionStatus(suggestionId, 'refused', reason, interaction.user.id);

    const rejectedEmbed = _buildRejectedEmbed(guildId, suggestionId, suggestion.content, author, reason, suggestion.userId);

    await submit.deferUpdate().catch(() => {});
    await interaction.message.edit({
      embeds          : [rejectedEmbed],
      components      : [],
      allowedMentions : { parse: [] },
    }).catch(() => {});

    const thread = await interaction.message.startThread({
      name                : `Suggestion #${suggestionId} - Rejetée`.slice(0, 100),
      autoArchiveDuration : 1440,
      reason              : 'Discussion sur la suggestion rejetée',
    }).catch(() => null);

    if (thread) {
      db.setSuggestionThread(suggestionId, thread.id);
    }

    _log(interaction.guild, config, guildId, 'Suggestion rejetée', [
      { name: 'Suggestion', value: `#${suggestionId}`,                        inline: true },
      { name: 'Staff',      value: `<@${interaction.user.id}>`,               inline: true },
      { name: 'Raison',     value: reason,                                    inline: false },
      { name: 'Message',    value: `[Voir](${interaction.message.url})`,      inline: false },
    ]);

    return;
  }

  if (action === 'delete') {
    await interaction.reply({
      embeds     : [embed.build(guildId, `Supprimer la suggestion **#${suggestionId}** ?`, { color: '#ED4245', timestamp: false })],
      components : [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`sug:confirm_del:${suggestionId}`)
            .setLabel('Confirmer')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('sug:cancel_del')
            .setLabel('Annuler')
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
      flags: 64,
    }).catch(() => {});
    return;
  }
}


async function handleDeleteConfirm(client, interaction) {
  const id      = interaction.customId;
  const guildId = interaction.guild?.id;
  if (!guildId) return interaction.deferUpdate().catch(() => {});

  if (id === 'sug:cancel_del') {
    return interaction.update({
      embeds     : [embed.build(guildId, 'Suppression annulée.', { timestamp: false })],
      components : [],
    }).catch(() => {});
  }

  const match = id.match(/^sug:confirm_del:(\d+)$/);
  if (!match) return interaction.deferUpdate().catch(() => {});

  const suggestionId = Number(match[1]);
  const suggestion   = db.getSuggestion(suggestionId);
  if (!suggestion || suggestion.guildId !== guildId) {
    return interaction.update({
      embeds     : [embed.build(guildId, 'Suggestion introuvable.', { color: '#ED4245', timestamp: false })],
      components : [],
    }).catch(() => {});
  }

  const config = db.getGuildConfig(guildId);

  if (suggestion.messageId) {
    const ch = interaction.guild.channels.cache.get(suggestion.channelId);
    if (ch) {
      const msg = ch.messages.cache.get(suggestion.messageId)
        ?? await ch.messages.fetch(suggestion.messageId).catch(() => null);
      if (msg) await msg.delete().catch(() => {});
    }
  }

  if (suggestion.validatedMessageId) {
    const valChId = config?.suggestionValidatedChannel;
    const valCh   = valChId ? interaction.guild.channels.cache.get(valChId) : null;
    if (valCh) {
      const valMsg = valCh.messages.cache.get(suggestion.validatedMessageId)
        ?? await valCh.messages.fetch(suggestion.validatedMessageId).catch(() => null);
      if (valMsg) await valMsg.delete().catch(() => {});
    }
  }

  db.updateSuggestionStatus(suggestionId, 'refused', 'Supprimée par le staff', interaction.user.id);

  await interaction.update({
    embeds     : [embed.build(guildId, `Suggestion **#${suggestionId}** supprimée.`, { color: COLOR_APPROVED, timestamp: false })],
    components : [],
  }).catch(() => {});

  _log(interaction.guild, config, guildId, 'Suggestion supprimée', [
    { name: 'Suggestion', value: `#${suggestionId}`,          inline: true },
    { name: 'Staff',      value: `<@${interaction.user.id}>`, inline: true },
  ]);
}


module.exports.handleButton       = handleButton;
module.exports.handleDeleteConfirm = handleDeleteConfirm;
