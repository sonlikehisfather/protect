'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionsBitField,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const { replaceVariables } = require('../../utils/variables');

module.exports = {
  help: {
    name        : 'leavesettings',
    description : 'Configure les messages de départ.',
    use         : 'leavesettings',
    usage       : 'leavesettings',
    aliases     : ['leaveconfig'],
  },

  async run(client, message) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const state = _stateFromConfig(config);

    const panel = await message.channel.send({
      embeds          : _buildPanelEmbeds(guildId, state, message.member),
      components      : _buildRows(false),
      allowedMentions : { parse: [] },
    }).catch(() => null);

    if (!panel) {
      return embed.replyError(
        message,
        'Impossible d\'ouvrir le panel de configuration.',
        { timestamp: false }
      ).catch(() => {});
    }

    embed.registerPrivateInteraction(panel, message.author.id, 3_600_000);

    let busy = false;

    const collector = panel.createMessageComponentCollector({
      filter       : interaction =>
        interaction.user.id === message.author.id &&
        interaction.message.id === panel.id,
      idle         : 3_600_000,
      time         : 3_600_000,
    });

    collector.on('collect', async interaction => {
      let id = interaction.customId;

      if (busy) {
        return _ephemeral(interaction, guildId, 'Une modification est déjà en cours.');
      }

      if (interaction.isStringSelectMenu?.() && id === 'local:leavesettings:menu:mode') {
        const choice = interaction.values?.[0];
        return _handleLeaveSelect(message, guildId, panel, interaction, choice, state);
      }

      if (interaction.isStringSelectMenu?.() && id === 'local:leavesettings:menu:settings') {
        const choice = interaction.values?.[0];
        const mapped = _LEAVE_SETTINGS_MAP[choice];

        if (!mapped) {
          return interaction.deferUpdate().catch(() => {});
        }

        id = mapped;
      }

      if (id === 'local:leavesettings:close') {
        collector.stop('closed');
        embed.clearPrivateInteraction(panel);
        await interaction.deferUpdate().catch(() => {});
        await panel.delete().catch(() => {});
        return;
      }

      if (id === 'local:leavesettings:channel') {
        busy = true;

        const modalId = `local:ls:channel:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(
            modalId,
            'Salon de départ',
            [
              _input(
                'channel',
                'Salon',
                TextInputStyle.Short,
                {
                  value       : state.channelId ? `<#${state.channelId}>` : '',
                  required    : true,
                  maxLength   : 100,
                  placeholder : '#salon, ID ou nom',
                }
              ),
            ]
          )
        ).then(() => true).catch(() => false);

        busy = false;

        if (!shown) {
          return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');
        }

        const submit = await _awaitOwnModal(interaction, modalId);
        if (!submit) return _refresh(panel, guildId, state, message.member);

        busy = true;

        const value = submit.fields.getTextInputValue('channel').trim();
        const channel = await _resolveTextChannel(guild, value);

        if (!channel) {
          await _modalError(submit, guildId, 'Salon introuvable ou invalide.');
          busy = false;
          return _refresh(panel, guildId, state, message.member);
        }

        const me = guild.members.me
          ?? await guild.members.fetchMe().catch(() => null);

        const botPerms = me ? channel.permissionsFor(me) : null;

        if (
          !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
          !botPerms?.has(PermissionsBitField.Flags.SendMessages)
        ) {
          await _modalError(submit, guildId, 'Je n\'ai pas les permissions nécessaires dans ce salon.');
          busy = false;
          return _refresh(panel, guildId, state, message.member);
        }

        db.setGuildConfig(guildId, 'leaveChannel', channel.id);
        state.channelId = channel.id;

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state, message.member);
      }

      if (id === 'local:leavesettings:message') {
        busy = true;

        const modalId = `local:ls:message:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(
            modalId,
            'Message de départ',
            [
              _input(
                'message',
                'Message texte',
                TextInputStyle.Paragraph,
                {
                  value       : state.message || '',
                  required    : false,
                  maxLength   : 1500,
                  placeholder : '{username} a quitté {server}',
                }
              ),
            ]
          )
        ).then(() => true).catch(() => false);

        busy = false;

        if (!shown) {
          return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');
        }

        const submit = await _awaitOwnModal(interaction, modalId);
        if (!submit) return _refresh(panel, guildId, state, message.member);

        busy = true;

        const value = submit.fields.getTextInputValue('message').trim();

        db.setGuildConfig(guildId, 'leaveMessage', value || null);
        state.message = value || null;

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state, message.member);
      }

      if (id === 'local:leavesettings:embedtoggle') {
        return _ephemeral(
          interaction,
          guildId,
          'Utilisez le menu `Mode et embed départ` pour gérer le mode et l\'embed.'
        );
      }

      if (id === 'local:leavesettings:embededit') {
        busy = true;

        const current = state.embedJson || _defaultLeaveEmbed(state.baseColor);

        const modalId = `local:ls:embed:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(
            modalId,
            'Embed de départ',
            [
              _input(
                'title',
                'Titre',
                TextInputStyle.Short,
                {
                  value       : current.title || '',
                  required    : false,
                  maxLength   : 256,
                  placeholder : 'Départ de {username}',
                }
              ),
              _input(
                'description',
                'Description',
                TextInputStyle.Paragraph,
                {
                  value       : current.description || '',
                  required    : true,
                  maxLength   : 4000,
                  placeholder : '{username} a quitté {server}.',
                }
              ),
              _input(
                'color',
                'Couleur',
                TextInputStyle.Short,
                {
                  value       : current.color || state.baseColor,
                  required    : false,
                  maxLength   : 7,
                  placeholder : state.baseColor,
                }
              ),
              _input(
                'image',
                'Image',
                TextInputStyle.Short,
                {
                  value       : current.image || '',
                  required    : false,
                  maxLength   : 512,
                  placeholder : 'URL image ou vide',
                }
              ),
              _input(
                'footer',
                'Footer',
                TextInputStyle.Short,
                {
                  value       : current.footer || '',
                  required    : false,
                  maxLength   : 2048,
                  placeholder : 'Départ',
                }
              ),
            ]
          )
        ).then(() => true).catch(() => false);

        busy = false;

        if (!shown) {
          return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');
        }

        const submit = await _awaitOwnModal(interaction, modalId);
        if (!submit) return _refresh(panel, guildId, state, message.member);

        busy = true;

        const title       = submit.fields.getTextInputValue('title').trim();
        const description = submit.fields.getTextInputValue('description').trim();
        const color       = submit.fields.getTextInputValue('color').trim();
        const image       = submit.fields.getTextInputValue('image').trim();
        const footer      = submit.fields.getTextInputValue('footer').trim();

        if (!description) {
          await _modalError(submit, guildId, 'La description de l\'embed est obligatoire.');
          busy = false;
          return _refresh(panel, guildId, state, message.member);
        }

        if (color && !/^#?[0-9a-f]{6}$/i.test(color)) {
          await _modalError(submit, guildId, 'Couleur invalide. Exemple : #2f3136.');
          busy = false;
          return _refresh(panel, guildId, state, message.member);
        }

        if (image && !_isImageUrl(image)) {
          await _modalError(submit, guildId, 'URL d\'image invalide.');
          busy = false;
          return _refresh(panel, guildId, state, message.member);
        }

        const nextEmbed = {
          ...(state.embedJson || {}),
          title       : title || null,
          description,
          color       : color ? _safeColor(color) : state.baseColor,
          image       : image || null,
          footer      : footer || null,
        };

        state.embedJson = nextEmbed;
        state.embedEnabled = true;

        db.setGuildConfig(guildId, 'leaveEmbedJson', JSON.stringify(nextEmbed));
        db.setGuildConfig(guildId, 'leaveEmbedEnabled', 1);

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state, message.member);
      }

      if (id === 'local:leavesettings:test') {
        await interaction.deferUpdate().catch(() => {});
        await _sendTest(message, guildId, state, deleteReply, deleteDelay);
        return _refresh(panel, guildId, state, message.member);
      }

      if (id === 'local:leavesettings:autodelete') {
        busy = true;

        const modalId = `local:ls:autodelete:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(
            modalId,
            'Suppression automatique',
            [
              _input(
                'delay',
                'Delai (0, 10s, 1m, 1h, 1d)',
                TextInputStyle.Short,
                {
                  value       : state.autoDeleteDelay > 0 ? `${state.autoDeleteDelay}s` : '0',
                  required    : true,
                  maxLength   : 16,
                  placeholder : '0 pour désactiver',
                }
              ),
            ]
          )
        ).then(() => true).catch(() => false);

        busy = false;

        if (!shown) {
          return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');
        }

        const submit = await _awaitOwnModal(interaction, modalId);
        if (!submit) return _refresh(panel, guildId, state, message.member);

        busy = true;

        const raw = submit.fields.getTextInputValue('delay').trim();
        const parsed = _parseDelayInput(raw);

        if (parsed === null) {
          await _modalError(submit, guildId, 'Delai invalide. Exemples : 0, 10s, 1m, 1h, 1d. Maximum 86400s.');
          busy = false;
          return _refresh(panel, guildId, state, message.member);
        }

        db.setGuildConfig(guildId, 'leaveAutoDeleteDelay', parsed);
        state.autoDeleteDelay = parsed;

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state, message.member);
      }

      if (id === 'local:leavesettings:disable') {
        const alreadyEmpty =
          !state.channelId &&
          !state.message &&
          !state.embedEnabled &&
          !state.embedJson &&
          (!state.autoDeleteDelay || state.autoDeleteDelay <= 0);

        if (alreadyEmpty) {
          return _ephemeral(interaction, guildId, 'Le système leave est déjà désactivé.');
        }

        state.channelId = null;
        state.message = null;
        state.embedEnabled = false;
        state.embedJson = null;

        state.autoDeleteDelay = 0;
        state.sendMode = 'message';

        db.setGuildConfig(guildId, 'leaveChannel', null);
        db.setGuildConfig(guildId, 'leaveMessage', null);
        db.setGuildConfig(guildId, 'leaveEmbedEnabled', 0);
        db.setGuildConfig(guildId, 'leaveEmbedJson', null);
        db.setGuildConfig(guildId, 'leaveAutoDeleteDelay', 0);
        db.setGuildConfig(guildId, 'leaveSendMode', null);

        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state, message.member);
      }

      await interaction.deferUpdate().catch(() => {});
    });

    collector.on('end', async (_, reason) => {
      embed.clearPrivateInteraction(panel);
      if (reason === 'closed') return;

      await panel.edit({
        components      : [],
        content         : '-# Session expirée, relance la commande pour reprendre.',
        allowedMentions : { parse: [] },
      }).catch(() => {});
    });
  },
};

function _stateFromConfig(config) {
  return {
    channelId       : config?.leaveChannel || null,
    message         : config?.leaveMessage || null,
    embedEnabled    : Number(config?.leaveEmbedEnabled) === 1,
    embedJson       : _parseEmbedJson(config?.leaveEmbedJson, config?.color),
    baseColor       : _safeColor(config?.color || '#2f3136'),
    autoDeleteDelay : Math.max(0, Number(config?.leaveAutoDeleteDelay ?? 0)),
    sendMode        : _normalizeLeaveMode(config),
  };
}

const _LEAVE_MODE_LABELS = {
  message       : 'Message simple',
  message_embed : 'Message en embed',
  embed         : 'Embed seul',
  both          : 'Message + embed',
};

function _normalizeLeaveMode(config) {
  const mode = String(config?.leaveSendMode || '').toLowerCase();
  if (['message', 'message_embed', 'embed', 'both'].includes(mode)) return mode;
  return Number(config?.leaveEmbedEnabled) === 1 ? 'embed' : 'message';
}

const _LEAVE_OPTIONS = [
  { value: 'leave_mode_message',       label: 'Mode leave : message simple',     description: 'Texte uniquement.',                        emoji: '💬' },
  { value: 'leave_mode_message_embed', label: 'Mode leave : message en embed',   description: 'Le message est envoyé dans un embed.',      emoji: '📦' },
  { value: 'leave_mode_embed',         label: 'Mode leave : embed seul',         description: 'Embed configuré uniquement.',               emoji: '📄' },
  { value: 'leave_mode_both',          label: 'Mode leave : message + embed',    description: 'Texte au-dessus, embed en dessous.',       emoji: '📑' },
  { value: 'leave_embed_import',       label: 'Configurer l\'embed de départ',   description: 'Importe l\'embed depuis un message.',      emoji: '✏️' },
  { value: 'leave_embed_from_message', label: 'Créer un embed depuis le message',description: 'Crée un embed simple à partir du texte.', emoji: '📋' },
  { value: 'leave_embed_clear',        label: 'Supprimer l\'embed de départ',    description: 'Supprime l\'embed configuré.',              emoji: '🗑️' },
];

const _LEAVE_SETTINGS_OPTIONS = [
  { value: 'leave_channel',    label: 'Modifier le salon du message de départ',         description: 'Salon où envoyer le message de départ.',       emoji: '📢' },
  { value: 'leave_message',    label: 'Modifier le message de départ',                  description: 'Message envoyé quand un membre quitte.',       emoji: '💬' },
  { value: 'leave_autodelete', label: 'Supprimer le message de départ automatiquement', description: 'Délai avant suppression automatique.',        emoji: '⏳' },
  { value: 'leave_embededit',  label: 'Modifier l\'embed simple',                       description: 'Modifier rapidement l\'embed de départ.',     emoji: '✏️' },
  { value: 'leave_test',       label: 'Prévisualiser le leave',                         description: 'Prévisualiser le message de départ.',      emoji: '👁️' },
  { value: 'leave_disable',    label: 'Désactiver le système leave',                    description: 'Réinitialiser la configuration de départ.', emoji: '' },
];

const _LEAVE_SETTINGS_MAP = {
  leave_channel    : 'local:leavesettings:channel',
  leave_message    : 'local:leavesettings:message',
  leave_autodelete : 'local:leavesettings:autodelete',
  leave_embededit  : 'local:leavesettings:embededit',
  leave_test       : 'local:leavesettings:test',
  leave_disable    : 'local:leavesettings:disable',
};

function _buildPanelEmbeds(guildId, state, member) {
  const messageExtract = _truncatePanelValue(state.message, 120);

  const control = new EmbedBuilder()
    .setTitle('Paramètres de départ')
    .setColor(_safeColor(state.embedJson?.color || state.baseColor))
    .addFields(
      {
        name  : 'Salon',
        value : state.channelId ? `<#${state.channelId}>` : '`Non configuré`',
      },
      {
        name  : 'Message de départ',
        value :
          `Mode : \`${_LEAVE_MODE_LABELS[state.sendMode] || 'Message simple'}\`\n` +
          `Message : ${messageExtract ? `\`${messageExtract}\`` : '`Défaut`'}\n` +
          `Suppression auto : ${state.autoDeleteDelay > 0 ? `\`${_formatDelay(state.autoDeleteDelay)}\`` : '`Désactivée`'}`,
      },
      {
        name  : 'Embed',
        value : `État : ${state.embedJson ? '`Configuré`' : '`Non configuré`'}`,
      },
      {
        name  : 'Variables',
        value : 'Liste complète : `+variables`',
      }
    );

  const embeds = [control];

  if (state.embedEnabled && state.embedJson) {
    embeds.push(_buildLeaveEmbed(guildId, state.embedJson, member, true));
  }

  return embeds;
}

function _buildRows(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('local:leavesettings:menu:settings')
        .setPlaceholder('Paramètres de départ')
        .setDisabled(disabled)
        .addOptions(_LEAVE_SETTINGS_OPTIONS.map(opt => ({
          value       : opt.value,
          label       : opt.label.slice(0, 100),
          description : opt.description.slice(0, 100),
          ...(opt.emoji ? { emoji: opt.emoji } : {}),
        })))
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('local:leavesettings:menu:mode')
        .setPlaceholder('Mode et embed départ')
        .setDisabled(disabled)
        .addOptions(_LEAVE_OPTIONS.map(opt => ({
          value       : opt.value,
          label       : opt.label.slice(0, 100),
          description : opt.description.slice(0, 100),
          ...(opt.emoji ? { emoji: opt.emoji } : {}),
        })))
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:leavesettings:close')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    ),
  ];
}

async function _sendTest(message, guildId, state, deleteReply, deleteDelay) {
  const channel = state.channelId
    ? message.guild.channels.cache.get(state.channelId)
    : message.channel;

  if (!channel?.isTextBased()) {
    return _sendError(message, 'Salon de départ introuvable.', deleteReply, deleteDelay);
  }

  const payload = _buildLeavePayload(guildId, state, message.member);

  const sentTest = await channel.send(payload).catch(() => null);

  if (!sentTest) {
    return _sendError(message, 'Impossible d\'envoyer le test.', deleteReply, deleteDelay);
  }

  if (Number(state.autoDeleteDelay) > 0) {
    embed.scheduleDelete(sentTest, Number(state.autoDeleteDelay));
  }

  const sent = await embed.reply(
    message,
    'Test de départ envoyé.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

function _buildLeavePayload(guildId, state, member) {
  const rawMessage = state.message || '{username} a quitté **{server}**.';
  const text       = _formatVars(rawMessage, member);

  let mode = state.sendMode || 'message';
  const hasEmbed = !!state.embedJson;

  if ((mode === 'embed' || mode === 'both') && !hasEmbed) {
    mode = 'message';
  }

  if (mode === 'message') {
    return {
      content         : text,
      allowedMentions : { parse: [] },
    };
  }

  if (mode === 'message_embed') {
    return {
      embeds          : [_buildAutoMessageEmbed(state, member)],
      allowedMentions : { parse: [] },
    };
  }

  if (mode === 'embed') {
    return {
      embeds          : [_buildLeaveEmbed(guildId, state.embedJson, member, false)],
      allowedMentions : { parse: [] },
    };
  }

  return {
    content         : text,
    embeds          : [_buildLeaveEmbed(guildId, state.embedJson, member, false)],
    allowedMentions : { parse: [] },
  };
}

function _buildAutoMessageEmbed(state, member) {
  const description = _formatVars(
    state.message || '{username} a quitté **{server}**.',
    member
  );

  return new EmbedBuilder()
    .setColor(_safeColor(state.baseColor || '#2f3136'))
    .setDescription(description || _formatVars('{username} a quitté **{server}**.', member));
}

function _buildLeaveEmbed(guildId, data, member, preview = false) {
  const e = new EmbedBuilder()
    .setColor(_safeColor(data?.color || '#2f3136'));

  const title = data?.title
    ? _formatVars(data.title, member)
    : null;

  const description = data?.description
    ? _formatVars(data.description, member)
    : null;

  const footerText = data?.footer
    ? _formatVars(data.footer, member)
    : null;

  const footerIcon = _renderImageUrlLocal(data?.footerIcon, member);
  const authorName = data?.author ? _formatVars(data.author, member) : null;
  const authorIcon = _renderImageUrlLocal(data?.authorIcon, member);
  const authorUrl  = _renderUrlLocal(data?.authorUrl, member);

  const titleUrl     = title ? _renderUrlLocal(data?.url, member) : null;
  const imageUrl     = _renderImageUrlLocal(data?.image, member);
  const thumbnailUrl = _renderImageUrlLocal(data?.thumbnail, member);

  if (title) e.setTitle(title);
  if (titleUrl) e.setURL(titleUrl);
  if (description) e.setDescription(description);

  if (authorName) {
    const authorOpts = { name: authorName.slice(0, 256) };
    if (authorIcon) authorOpts.iconURL = authorIcon;
    if (authorUrl) authorOpts.url = authorUrl;
    e.setAuthor(authorOpts);
  } else if (preview) {
    e.setAuthor({
      name   : member.user.username,
      iconURL: member.user.displayAvatarURL({ extension: 'gif', forceStatic: false }),
    });
  }

  if (footerText) {
    const footerOpts = { text: footerText.slice(0, 2048) };
    if (footerIcon) footerOpts.iconURL = footerIcon;
    e.setFooter(footerOpts);
  }

  if (imageUrl) e.setImage(imageUrl);
  if (thumbnailUrl) e.setThumbnail(thumbnailUrl);

  if (Array.isArray(data?.fields) && data.fields.length > 0) {
    const fields = data.fields.slice(0, 25).map(f => ({
      name   : _formatVars(String(f?.name || ''), member).slice(0, 256),
      value  : _formatVars(String(f?.value || ''), member).slice(0, 1024),
      inline : Boolean(f?.inline),
    })).filter(f => f.name && f.value);

    if (fields.length > 0) e.addFields(fields);
  }

  if (data?.timestamp === true) {
    e.setTimestamp(new Date());
  }

  const isEmpty =
    !title &&
    !description &&
    !authorName &&
    !footerText &&
    !imageUrl &&
    !thumbnailUrl &&
    (!Array.isArray(data?.fields) || data.fields.length === 0);

  if (isEmpty) {
    e.setDescription(_formatVars('{username} a quitté **{server}**.', member));
  }

  return e;
}

function _renderImageUrlLocal(value, member) {
  if (!value) return null;
  const rendered = _formatVars(String(value), member).trim();
  if (!rendered) return null;
  return _isImageUrl(rendered) ? rendered : null;
}

function _renderUrlLocal(value, member) {
  if (!value) return null;
  const rendered = _formatVars(String(value), member).trim();
  if (!rendered) return null;
  return _isUrl(rendered) ? rendered : null;
}

function _defaultLeaveEmbed(baseColor = '#2f3136') {
  return {
    title       : 'Départ de {username}',
    description : '{username} a quitté {server}. Nous sommes maintenant {membercount}.',
    color       : _safeColor(baseColor),
    image       : null,
    footer      : null,
  };
}

function _formatVars(template, member) {
  return replaceVariables(String(template || ''), {
    user   : member.user,
    member,
    guild  : member.guild,
    client : member.client,
  });
}

async function _resolveTextChannel(guild, query) {
  if (!query) return null;

  const raw = String(query).trim();
  const mention = raw.match(/^<#(\d{17,20})>$/);
  const id = mention?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);

  if (id) {
    const channel = guild.channels.cache.get(id)
      ?? await guild.channels.fetch(id).catch(() => null);

    return _isTextChannel(channel) ? channel : null;
  }

  const normalized = _normalizeName(raw);

  return guild.channels.cache.find(channel =>
    _isTextChannel(channel) &&
    _normalizeName(channel.name) === normalized
  ) ?? null;
}

function _isTextChannel(channel) {
  return Boolean(
    channel &&
    (
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement
    )
  );
}

function _buildModal(customId, title, inputs) {
  const modal = new ModalBuilder()
    .setCustomId(customId.slice(0, 100))
    .setTitle(title.slice(0, 45));

  modal.addComponents(inputs.map(input =>
    new ActionRowBuilder().addComponents(input)
  ));

  return modal;
}

function _input(customId, label, style, options = {}) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 45))
    .setStyle(style)
    .setRequired(Boolean(options.required));

  if (options.value) {
    input.setValue(String(options.value).slice(0, options.maxLength || 4000));
  }

  if (options.placeholder) {
    input.setPlaceholder(options.placeholder.slice(0, 100));
  }

  if (options.maxLength) {
    input.setMaxLength(options.maxLength);
  }

  return input;
}

async function _awaitOwnModal(interaction, customId) {
  try {
    return await interaction.awaitModalSubmit({
      filter: i =>
        i.customId === customId &&
        i.user.id === interaction.user.id,
      time: 120_000,
    });
  } catch {
    return null;
  }
}

async function _refresh(panel, guildId, state, member) {
  return panel.edit({
    embeds    : _buildPanelEmbeds(guildId, state, member),
    components: _buildRows(false),
  }).catch(() => {});
}

async function _ephemeral(interaction, guildId, content) {
  return interaction.reply({
    embeds: [
      embed.build(guildId, content, {
        color    : '#ED4245',
        timestamp: false,
      }),
    ],
    flags: 64,
  }).catch(() => {});
}

async function _modalError(submit, guildId, content) {
  return submit.reply({
    embeds: [
      embed.build(guildId, content, {
        color    : '#ED4245',
        timestamp: false,
      }),
    ],
    flags: 64,
  }).catch(() => {});
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

function _parseEmbedJson(value, baseColor = '#2f3136') {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return {
      title       : parsed.title || null,
      description : parsed.description || null,
      url         : parsed.url || null,
      color       : _safeColor(parsed.color || baseColor),
      image       : parsed.image || null,
      thumbnail   : parsed.thumbnail || null,
      footer      : parsed.footer || null,
      footerIcon  : parsed.footerIcon || null,
      author      : parsed.author || null,
      authorIcon  : parsed.authorIcon || null,
      authorUrl   : parsed.authorUrl || null,
      fields      : Array.isArray(parsed.fields) ? parsed.fields : [],
      timestamp   : Boolean(parsed.timestamp),
    };
  } catch {
    return null;
  }
}

function _safeColor(color) {
  if (typeof color === 'string' && /^#?[0-9a-f]{6}$/i.test(color)) {
    return color.startsWith('#') ? color : `#${color}`;
  }

  return '#2f3136';
}

function _isUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function _isImageUrl(value) {
  if (!_isUrl(value)) return false;

  const url = value.toLowerCase();
  const path = url.split('?')[0];

  return (
    path.endsWith('.png') ||
    path.endsWith('.jpg') ||
    path.endsWith('.jpeg') ||
    path.endsWith('.gif') ||
    path.endsWith('.webp') ||
    url.includes('cdn.discordapp.com/attachments/') ||
    url.includes('media.discordapp.net/attachments/') ||
    url.includes('cdn.discordapp.com/avatars/') ||
    url.includes('cdn.discordapp.com/icons/') ||
    url.includes('cdn.discordapp.com/banners/') ||
    url.includes('cdn.discordapp.com/guilds/') ||
    url.includes('cdn.discordapp.com/embed/avatars/') ||
    url.includes('i.imgur.com/') ||
    url.includes('media.tenor.com/') ||
    url.includes('media.giphy.com/')
  );
}

function _normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^#/, '')
    .trim();
}

function _truncatePanelValue(value, max = 120) {
  const text = String(value || '').replace(/`/g, "'").replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const cut = text.length > max ? `${text.slice(0, max - 3)}...` : text;
  return embed.breakLongTokens(cut);
}

function _truncate(value, max) {
  const text = String(value || '');
  const cut  = text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
  return embed.breakLongTokens(cut);
}

const _DELAY_MAX = 86400;

function _parseDelayInput(raw) {
  const v = String(raw || '').toLowerCase().trim();

  if (!v) return null;
  if (['0', 'none', 'aucun', 'off', 'disable', 'disabled'].includes(v)) return 0;

  const m = v.match(/^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days|j|jour|jours)?$/);
  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;

  const unit = m[2] || 's';
  let seconds;

  if (['s', 'sec', 'secs'].includes(unit))      seconds = n;
  else if (['m', 'min', 'mins'].includes(unit)) seconds = n * 60;
  else if (['h', 'hr', 'hrs'].includes(unit))   seconds = n * 3600;
  else                                          seconds = n * 86400;

  if (seconds === 0) return 0;
  if (seconds < 1)   return null;
  if (seconds > _DELAY_MAX) return null;

  return seconds;
}

function _formatDelay(seconds) {
  const s = Number(seconds) || 0;
  if (s <= 0)     return '0s';
  if (s < 60)     return `${s}s`;
  if (s < 3600)   return `${Math.floor(s / 60)}m`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}j`;
}


async function _handleLeaveSelect(message, guildId, panel, i, choice, state) {
  switch (choice) {
    case 'leave_mode_message':
      return _optSetLeaveMode(message, guildId, panel, i, state, 'message');
    case 'leave_mode_message_embed':
      return _optSetLeaveMode(message, guildId, panel, i, state, 'message_embed');
    case 'leave_mode_embed':
      return _optSetLeaveMode(message, guildId, panel, i, state, 'embed');
    case 'leave_mode_both':
      return _optSetLeaveMode(message, guildId, panel, i, state, 'both');
    case 'leave_embed_import':
      return _optLeaveEmbedImport(message, guildId, panel, i, state);
    case 'leave_embed_from_message':
      return _optLeaveEmbedFromMessage(message, guildId, panel, i, state);
    case 'leave_embed_clear':
      return _optLeaveEmbedClear(message, guildId, panel, i, state);
    default:
      await i.deferUpdate().catch(() => {});
      return;
  }
}

async function _optSetLeaveMode(message, guildId, panel, i, state, mode) {
  const config = db.getGuildConfig(guildId) || {};
  const currentMode = _normalizeLeaveMode(config);

  if (mode === currentMode) {
    await _ackInfo(i, 'Ce mode leave est déjà actif.');
    return;
  }

  if (mode === 'embed' || mode === 'both') {
    if (!_hasConfiguredLeaveEmbed(config)) {
      await _ackInfo(
        i,
        'Aucun embed de départ configuré. Utilisez d\'abord `Configurer l\'embed de départ` ou `Créer un embed depuis le message`.'
      );
      return;
    }
  }

  await i.deferUpdate().catch(() => {});
  db.setGuildConfig(guildId, 'leaveSendMode', mode);
  state.sendMode = mode;
  await _refresh(panel, guildId, state, message.member);

  const labels = {
    message       : 'Mode leave : message simple.',
    message_embed : 'Mode leave : message en embed.',
    embed         : 'Mode leave : embed seul.',
    both          : 'Mode leave : message + embed.',
  };

  await i.followUp({
    content         : labels[mode],
    flags           : 64,
    allowedMentions : { parse: [] },
  }).catch(() => {});
}

function _hasConfiguredLeaveEmbed(config) {
  if (Number(config?.leaveEmbedEnabled) !== 1) return false;
  if (typeof config?.leaveEmbedJson !== 'string') return false;

  const raw = config.leaveEmbedJson.trim();
  if (!raw) return false;

  try {
    const data = JSON.parse(raw);
    return !!data && typeof data === 'object';
  } catch {
    return false;
  }
}

function _parseMessageRef(raw, message) {
  if (!raw) return null;
  const trimmed = String(raw).trim();

  const link = trimmed.match(
    /^https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})$/i
  );
  if (link) {
    if (link[1] !== message.guild.id) return null;
    return { channelId: link[2], messageId: link[3] };
  }

  if (/^\d{17,20}$/.test(trimmed)) {
    return { channelId: message.channel.id, messageId: trimmed };
  }

  return null;
}

function _embedColorToHex(color) {
  if (typeof color !== 'number' || !Number.isFinite(color) || color < 0) return null;
  return `#${color.toString(16).padStart(6, '0')}`;
}

function _safeHexColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!/^#?[0-9a-f]{6}$/i.test(v)) return null;
  return v.startsWith('#') ? v : `#${v}`;
}

async function _ackInfo(i, content) {
  await i.reply({
    content,
    flags           : 64,
    allowedMentions : { parse: [] },
  }).catch(() => {});
}

async function _awaitJsModal(interaction, customId) {
  try {
    return await interaction.awaitModalSubmit({
      filter: x => x.customId === customId && x.user.id === interaction.user.id,
      time  : 120_000,
    });
  } catch {
    return null;
  }
}

async function _optLeaveEmbedImport(message, guildId, panel, i, state) {
  const wasConfigured = _hasConfiguredLeaveEmbed(db.getGuildConfig(guildId) || {});
  const modalId = `local:leavesettings:modal:embedimport:${i.id}`;

  const shown = await i.showModal(
    new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('Embed de départ')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('value')
            .setLabel('ID ou lien du message')
            .setPlaceholder('123456789012345678 ou lien Discord')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(200)
        )
      )
  ).then(() => true).catch(() => false);

  if (!shown) return;

  const submit = await _awaitJsModal(i, modalId);
  if (!submit) return;

  const raw = submit.fields.getTextInputValue('value').trim();
  const ref = _parseMessageRef(raw, message);

  if (!ref) {
    await submit.reply({ content: 'Lien ou ID invalide.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  const ch = message.guild.channels.cache.get(ref.channelId)
    ?? await message.guild.channels.fetch(ref.channelId).catch(() => null);

  if (!ch || !ch.isTextBased?.()) {
    await submit.reply({ content: 'Salon introuvable.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  const me = message.guild.members.me
    ?? await message.guild.members.fetchMe().catch(() => null);
  const botPerms = me ? ch.permissionsFor(me) : null;

  if (
    !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
    !botPerms?.has(PermissionsBitField.Flags.ReadMessageHistory)
  ) {
    await submit.reply({ content: 'Je ne peux pas lire ce message.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  const sourceMsg = await ch.messages.fetch(ref.messageId).catch(() => null);

  if (!sourceMsg) {
    await submit.reply({ content: 'Message introuvable.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  const firstEmbed = sourceMsg.embeds?.[0];

  if (!firstEmbed) {
    await submit.reply({ content: 'Ce message ne contient aucun embed.', flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  const data = firstEmbed.toJSON?.() || firstEmbed;
  const stored = {
    title       : data.title || null,
    description : data.description || null,
    url         : data.url || null,
    color       : _embedColorToHex(data.color),
    image       : data.image?.url || null,
    thumbnail   : data.thumbnail?.url || null,
    footer      : data.footer?.text || null,
    footerIcon  : data.footer?.icon_url || null,
    author      : data.author?.name || null,
    authorIcon  : data.author?.icon_url || null,
    authorUrl   : data.author?.url || null,
    fields      : Array.isArray(data.fields)
      ? data.fields.slice(0, 25).map(f => ({
          name   : String(f?.name || '').slice(0, 256),
          value  : String(f?.value || '').slice(0, 1024),
          inline : Boolean(f?.inline),
        })).filter(f => f.name && f.value)
      : [],
    timestamp   : Boolean(data.timestamp),
  };

  await submit.deferUpdate().catch(() => {});
  db.setGuildConfig(guildId, 'leaveEmbedJson', JSON.stringify(stored));
  db.setGuildConfig(guildId, 'leaveEmbedEnabled', 1);
  state.embedJson    = _parseEmbedJson(JSON.stringify(stored), state.baseColor);
  state.embedEnabled = true;
  await _refresh(panel, guildId, state, message.member);

  await submit.followUp({
    content         : wasConfigured ? 'Embed de départ remplacé.' : 'Embed de départ configuré.',
    flags           : 64,
    allowedMentions : { parse: [] },
  }).catch(() => {});
}

async function _optLeaveEmbedFromMessage(message, guildId, panel, i, state) {
  const config = db.getGuildConfig(guildId) || {};

  if (_hasConfiguredLeaveEmbed(config)) {
    await _ackInfo(i, 'Un embed de départ est déjà configuré. Supprimez-le avant d\'en créer un nouveau.');
    return;
  }

  const description = config.leaveMessage || '{username} a quitté **{server}**.';

  const stored = {
    title       : null,
    description,
    url         : null,
    color       : _safeHexColor(config.color),
    image       : null,
    thumbnail   : null,
    footer      : null,
    footerIcon  : null,
    author      : null,
    authorIcon  : null,
    authorUrl   : null,
    fields      : [],
    timestamp   : false,
  };

  await i.deferUpdate().catch(() => {});
  db.setGuildConfig(guildId, 'leaveEmbedJson', JSON.stringify(stored));
  db.setGuildConfig(guildId, 'leaveEmbedEnabled', 1);
  state.embedJson    = _parseEmbedJson(JSON.stringify(stored), state.baseColor);
  state.embedEnabled = true;
  await _refresh(panel, guildId, state, message.member);

  await i.followUp({
    content         : 'Embed créé depuis le message de départ.',
    flags           : 64,
    allowedMentions : { parse: [] },
  }).catch(() => {});
}

async function _optLeaveEmbedClear(message, guildId, panel, i, state) {
  const config = db.getGuildConfig(guildId) || {};

  if (!_hasConfiguredLeaveEmbed(config)) {
    await _ackInfo(i, 'Aucun embed de départ n\'est configuré.');
    return;
  }

  const currentMode = _normalizeLeaveMode(config);

  await i.deferUpdate().catch(() => {});
  db.setGuildConfig(guildId, 'leaveEmbedJson', null);
  db.setGuildConfig(guildId, 'leaveEmbedEnabled', 0);
  state.embedJson    = null;
  state.embedEnabled = false;

  if (currentMode === 'embed' || currentMode === 'both') {
    db.setGuildConfig(guildId, 'leaveSendMode', 'message');
    state.sendMode = 'message';
  }

  await _refresh(panel, guildId, state, message.member);

  await i.followUp({
    content         : 'Embed de départ supprimé.',
    flags           : 64,
    allowedMentions : { parse: [] },
  }).catch(() => {});
}

async function _optLeavePreview(message, guildId, i, state) {
  const config       = db.getGuildConfig(guildId) || {};
  const mode         = _normalizeLeaveMode(config);
  const modeLabel    = _LEAVE_MODE_LABELS[mode];
  const hasEmbedConf = _hasConfiguredLeaveEmbed(config);

  const rendered = _formatVars(
    config.leaveMessage || '{username} a quitté **{server}**.',
    message.member
  );

  const text =
    `Mode leave : \`${modeLabel}\`\n` +
    `Embed départ : ${hasEmbedConf ? '`Configuré`' : '`Non configuré`'}\n\n` +
    `Aperçu du message rendu :\n${_truncate(rendered, 1500)}\n\n` +
    'Note : la vraie notification n\'est envoyée que lors d\'un vrai départ. ' +
    '`{MemberMention}` ne ping pas dans cet aperçu.';

  await i.reply({
    embeds: [
      embed.build(guildId, text, {
        title     : 'Prévisualisation leave',
        timestamp : false,
      }),
    ],
    flags           : 64,
    allowedMentions : { parse: [] },
  }).catch(() => {});


  void state;
}
