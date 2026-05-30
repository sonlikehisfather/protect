'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const imageResolver = require('../../utils/imageResolver');

const MAX_NAME_LENGTH    = 32;
const MIN_NAME_LENGTH    = 2;
const PANEL_IDLE_MS      = 120_000;
const PANEL_TIME_MS      = 300_000;
const MAX_IMAGE_BYTES    = 10 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 15_000;

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder  === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

function _hexToInt(hex) {
  const cleaned = String(hex || '').replace('#', '');
  const n       = parseInt(cleaned, 16);
  return Number.isNaN(n) ? 0x2f3136 : n;
}

module.exports = {
  help: {
    name        : 'set',
    description : 'Modifie le profil du bot.',
    use         : 'set <name/pic/banner/profil> [valeur]',
    usage       : 'set <name/pic/banner/profil> [valeur]',
    aliases     : ['setname', 'setpic', 'setavatar', 'setbanner', 'setprofil', 'setprofile'],
    category    : 'owner',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.isBuyer(message.author.id) && !perms.isGlobalOwner(message.author.id)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    const prefix      = config?.prefix || '+';

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const invoked = _getInvokedName(message, prefix).toLowerCase();
    const mapped  = _mapInvokedAlias(invoked);

    const action = mapped.action || args[0]?.toLowerCase();

    if (!action) {
      return _usage(message, deleteReply, deleteDelay);
    }


    if (!mapped.action && action === 'perm') {
      const setperm = client.commands?.get?.('setperm');
      if (setperm?.run) {
        return setperm.run(client, message, args.slice(1));
      }
    }

    const directArgs = mapped.action
      ? args
      : args.slice(1);

    if (['name', 'nom', 'username'].includes(action)) {
      return _setName(client, message, directArgs.join(' ').trim(), deleteReply, deleteDelay);
    }

    if (['pic', 'avatar', 'pdp', 'image'].includes(action)) {
      return _setAvatar(client, message, directArgs.join(' ').trim(), deleteReply, deleteDelay);
    }

    if (['banner', 'banniere', 'bannière'].includes(action)) {
      return _setBanner(client, message, directArgs.join(' ').trim(), deleteReply, deleteDelay);
    }

    if (['profil', 'profile'].includes(action)) {
      return _setProfile(client, message, directArgs.join(' ').trim(), deleteReply, deleteDelay);
    }

    if (action === 'server') {
      return _handleServer(client, message, directArgs, deleteReply, deleteDelay);
    }

    if (['modlogs', 'modlog'].includes(action)) {
      return _delegateLogsModlog(client, message, directArgs, deleteReply, deleteDelay);
    }

    if (['boostembed', 'boostmsg', 'boostmessage'].includes(action)) {
      return _delegateBoostembed(client, message, directArgs, deleteReply, deleteDelay);
    }

    return _usage(message, deleteReply, deleteDelay);
  },
};

async function _delegateLogsModlog(client, message, restArgs, deleteReply, deleteDelay) {
  const setlog = client.commands?.get?.('setlog')
    ?? client.commands?.get?.('modlog')
    ?? null;

  if (!setlog || typeof setlog.run !== 'function') {
    return _sendError(
      message,
      'La commande setlog est indisponible.',
      deleteReply,
      deleteDelay
    );
  }

  return setlog.run(client, message, ['modlog', ...(restArgs || [])]);
}

async function _delegateBoostembed(client, message, restArgs, deleteReply, deleteDelay) {
  const boostembed = client.commands?.get?.('boostembed')
    ?? client.commands?.get?.('setboostembed')
    ?? null;

  if (!boostembed || typeof boostembed.run !== 'function') {
    return _sendError(
      message,
      'La commande boostembed est indisponible.',
      deleteReply,
      deleteDelay
    );
  }

  return boostembed.run(client, message, [...(restArgs || [])]);
}

async function _setName(client, message, rawName, deleteReply, deleteDelay) {
  const name = String(rawName || '').trim();

  const validation = _validateName(name);

  if (validation) {
    return _sendError(message, validation, deleteReply, deleteDelay);
  }

  const oldName = client.user.username;

  if (oldName === name) {
    return _sendError(
      message,
      'Le bot possède déjà ce nom.',
      deleteReply,
      deleteDelay
    );
  }

  const changed = await _safeSetUsername(client, name);

  if (!changed) {
    return _sendError(
      message,
      'Impossible de modifier le nom du bot. Discord peut limiter les changements de nom.',
      deleteReply,
      deleteDelay
    );
  }

  return _sendReply(
    message,
    `Nom du bot modifié : \`${oldName}\` -> \`${name}\`.`,
    deleteReply,
    deleteDelay
  );
}

async function _setAvatar(client, message, rawValue, deleteReply, deleteDelay) {
  const image = _resolveImageInput(message, rawValue);

  if (!image) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}set pic <url>\` ou envoyez une image avec la commande.`,
      deleteReply,
      deleteDelay
    );
  }

  if (!_isImageUrl(image)) {
    return _sendError(
      message,
      "URL d'image invalide. Formats acceptés : png, jpg, jpeg, webp, gif ou CDN Discord.",
      deleteReply,
      deleteDelay
    );
  }

  const result = await _safeSetAvatar(client, image);

  if (!result.ok) {
    return _sendError(
      message,
      `Impossible de modifier l'avatar du bot : ${result.error}`,
      deleteReply,
      deleteDelay
    );
  }

  return _sendReply(
    message,
    'Avatar du bot modifié.',
    deleteReply,
    deleteDelay
  );
}

async function _setBanner(client, message, rawValue, deleteReply, deleteDelay) {
  const value = String(rawValue || '').trim();

  if (_isRemoveValue(value)) {
    const result = await _safeSetBanner(client, null);

    if (!result.ok) {
      return _sendError(
        message,
        `Impossible de retirer la bannière du bot : ${result.error}`,
        deleteReply,
        deleteDelay
      );
    }

    return _sendReply(
      message,
      'Bannière du bot retirée.',
      deleteReply,
      deleteDelay
    );
  }

  const image = _resolveImageInput(message, value);

  if (!image) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}set banner <url>\` ou envoyez une image avec la commande.`,
      deleteReply,
      deleteDelay
    );
  }

  if (!_isImageUrl(image)) {
    return _sendError(
      message,
      "URL d'image invalide. Formats acceptés : png, jpg, jpeg, webp, gif ou CDN Discord.",
      deleteReply,
      deleteDelay
    );
  }

  const result = await _safeSetBanner(client, image);

  if (!result.ok) {
    return _sendError(
      message,
      `Impossible de modifier la bannière du bot : ${result.error}`,
      deleteReply,
      deleteDelay
    );
  }

  return _sendReply(
    message,
    'Bannière du bot modifiée.',
    deleteReply,
    deleteDelay
  );
}

async function _handleServer(client, message, args, deleteReply, deleteDelay) {
  const sub = String(args[0] || '').toLowerCase();

  if (!sub || ['profil', 'profile'].includes(sub)) {
    return _openServerProfilePanel(client, message, deleteReply, deleteDelay);
  }

  if (['name', 'nom'].includes(sub)) {
    return _setServerName(client, message, args.slice(1).join(' ').trim(), deleteReply, deleteDelay);
  }

  if (['pic', 'avatar', 'pdp', 'image', 'banner', 'banniere', 'bio', 'description'].includes(sub)) {
    return _sendError(
      message,
      'Discord ne permet pas de modifier cette information uniquement sur ce serveur.',
      deleteReply,
      deleteDelay
    );
  }

  return _sendError(
    message,
    'Sous-commande inconnue. Utilisez `name`, `pic`, `banner`, `bio` ou `profil`.',
    deleteReply,
    deleteDelay
  );
}

async function _setServerName(client, message, rawName, deleteReply, deleteDelay) {
  const guild = message.guild;

  const me = guild.members.me
    ?? await guild.members.fetchMe().catch(() => null);

  if (!me) {
    return _sendError(message, 'Impossible de recuperer le membre du bot.', deleteReply, deleteDelay);
  }

  const name = String(rawName || '').trim();

  if (!name) {
    return _sendError(
      message,
      'Indiquez un pseudo ou utilisez `+set server name reset`.',
      deleteReply,
      deleteDelay
    );
  }

  if (_isRemoveValue(name)) {
    const changed = await me.setNickname(null, 'set server name reset')
      .then(() => true).catch(() => false);

    if (!changed) {
      return _sendError(
        message,
        'Impossible de réinitialiser le pseudo local. Vérifiez les permissions.',
        deleteReply,
        deleteDelay
      );
    }

    return _sendReply(message, 'Pseudo local réinitialisé.', deleteReply, deleteDelay);
  }

  const validation = _validateName(name);
  if (validation) {
    return _sendError(message, validation, deleteReply, deleteDelay);
  }

  const changed = await me.setNickname(name, 'set server name')
    .then(() => true).catch(() => false);

  if (!changed) {
    return _sendError(
      message,
      'Impossible de modifier le pseudo local. Vérifiez les permissions.',
      deleteReply,
      deleteDelay
    );
  }

  return _sendReply(message, `Pseudo local modifié : \`${name}\`.`, deleteReply, deleteDelay);
}

async function _openServerProfilePanel(client, message, deleteReply, deleteDelay) {
  const guildId = message.guild.id;
  const guild   = message.guild;

  const me = guild.members.me
    ?? await guild.members.fetchMe().catch(() => null);

  const state = {
    name       : null,
    nameRemove : false,
  };

  const panel = await message.channel.send(
    _buildServerProfilePayload(client, guildId, me, state)
  ).catch(() => null);

  if (!panel) {
    return _sendError(message, "Impossible d'ouvrir le panel.", deleteReply, deleteDelay);
  }

  embed.registerPrivateInteraction(panel, message.author.id, PANEL_TIME_MS);

  let busy = false;

  const collector = panel.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter       : interaction =>
      interaction.user.id === message.author.id &&
      interaction.message.id === panel.id,
    idle         : PANEL_IDLE_MS,
    time         : PANEL_TIME_MS,
  });

  collector.on('collect', async interaction => {
    const id = interaction.customId;

    if (busy) {
      return _ephemeral(interaction, guildId, 'Une modification est déjà en cours.');
    }

    if (id === 'local:setserver:close') {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      await message.delete().catch(() => {});
      return;
    }

    if (id === 'local:setserver:name') {
      busy = true;

      const currentNick = me?.nickname || client.user.username;
      const modalId     = `local:setserver:name:${interaction.id}`;

      const shown = await interaction.showModal(
        _buildModal(
          modalId,
          'Pseudo local du bot',
          [
            _input(
              'name',
              'Pseudo local (vide = réinitialiser)',
              TextInputStyle.Short,
              {
                value       : state.name || currentNick || '',
                required    : false,
                maxLength   : MAX_NAME_LENGTH,
                placeholder : 'Pseudo ou vide pour réinitialiser',
              }
            ),
          ]
        )
      ).then(() => true).catch(() => false);

      if (!shown) {
        busy = false;
        return _ephemeral(interaction, guildId, "Impossible d'ouvrir le formulaire.");
      }

      busy = false;
      const submit = await _awaitOwnModal(interaction, modalId);

      if (!submit) {
        busy = false;
        return;
      }

      const name = submit.fields.getTextInputValue('name').trim();

      if (!name || _isRemoveValue(name)) {
        state.name       = null;
        state.nameRemove = true;
      } else {
        const error = _validateName(name);
        if (error) {
          busy = false;
          await _modalError(submit, guildId, error);
          return _refreshServerProfilePanel(panel, client, guildId, me, state);
        }
        state.name       = name;
        state.nameRemove = false;
      }

      busy = false;
      await submit.deferUpdate().catch(() => {});
      return _refreshServerProfilePanel(panel, client, guildId, me, state);
    }

    if (id === 'local:setserver:apply') {
      busy = true;
      await interaction.deferUpdate().catch(() => {});

      if (!state.name && !state.nameRemove) {
        busy = false;
        return _followUp(interaction, guildId, 'Aucune modification a appliquer.', true);
      }

      const currentMe = guild.members.me
        ?? await guild.members.fetchMe().catch(() => null);

      const applyName = state.nameRemove ? null : state.name;
      const changed   = await currentMe?.setNickname(applyName, 'set server profil')
        .then(() => true).catch(() => false) ?? false;

      if (!changed) {
        busy = false;
        return _followUp(interaction, guildId, 'Impossible de modifier le pseudo local.', true);
      }

      state.name       = null;
      state.nameRemove = false;
      busy = false;

      return _followUp(
        interaction,
        guildId,
        applyName ? `Pseudo local modifié : \`${applyName}\`.` : 'Pseudo local réinitialisé.',
        false
      );
    }

    await interaction.deferUpdate().catch(() => {});
  });

  collector.on('end', async (_, reason) => {
    embed.clearPrivateInteraction(panel);
    if (reason === 'closed') return;
    await panel.edit({ components: [] }).catch(() => {});
    if (deleteReply) embed.scheduleDelete(panel, deleteDelay);
  });
}

function _buildServerProfilePayload(client, guildId, me, state) {
  const globalName = client.user.username;
  const localName  = me?.nickname ?? null;

  const pendingDisplay = state.nameRemove
    ? '`Réinitialiser`'
    : (state.name ? `\`${state.name}\`` : '`Non modifié`');

  const summary =
    `> Nom global : \`${globalName}\`\n` +
    `> Pseudo local actuel : ${localName ? `\`${localName}\`` : '`Aucun`'}\n` +
    `> Pseudo local prévu : ${pendingDisplay}\n` +
    `> Avatar local : \`Non supporté par Discord\`\n` +
    `> Bannière locale : \`Non supportée par Discord\`\n` +
    `> Bio locale : \`Non supportée par Discord\``;

  if (V2_AVAILABLE) {
    try {
      const accent    = _hexToInt(embed.getGuildColor(guildId));
      const container = new ContainerBuilder().setAccentColor(accent);

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## Profil serveur'),
      );
      container.addSeparatorComponents(new SeparatorBuilder());
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(summary),
      );

      for (const row of _buildServerProfileRows(false)) {
        container.addActionRowComponents(row);
      }

      return {
        flags           : COMPONENTS_V2_FLAG,
        embeds          : [],
        components      : [container],
        allowedMentions : { parse: [] },
      };
    } catch {}
  }

  const e = new EmbedBuilder()
    .setColor(embed.getGuildColor(guildId))
    .setTitle('Profil serveur')
    .setDescription(
      `Nom global : \`${globalName}\`\n` +
      `Pseudo local actuel : ${localName ? `\`${localName}\`` : '`Aucun`'}\n` +
      `Pseudo local prévu : ${pendingDisplay}\n\n` +
      'Avatar, bannière et bio : Non supportés par Discord pour un bot sur un seul serveur.'
    );

  return {
    embeds          : [e],
    components      : _buildServerProfileRows(false),
    allowedMentions : { parse: [] },
  };
}

function _buildServerProfileRows(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:setserver:name')
        .setLabel('Pseudo local')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('local:setserver:avatar_ns')
        .setLabel('Avatar (non supporté)')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('local:setserver:banner_ns')
        .setLabel('Bannière (non supporté)')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('local:setserver:apply')
        .setLabel('Enregistrer')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('local:setserver:close')
        .setLabel('Fermer')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
  ];
}

async function _refreshServerProfilePanel(panel, client, guildId, me, state) {
  return panel.edit(_buildServerProfilePayload(client, guildId, me, state)).catch(() => {});
}

async function _setProfile(client, message, _rawValue, deleteReply, deleteDelay) {
  return _openProfilePanel(client, message, deleteReply, deleteDelay);
}

async function _openProfilePanel(client, message, deleteReply, deleteDelay) {
  const guildId = message.guild.id;

  const state = {
    name        : null,
    avatarUrl   : null,
    bannerUrl   : null,
    avatarRemove: false,
    bannerRemove: false,
    view        : 'main',
  };

  const panel = await message.channel.send(
    _buildProfilePayload(client, guildId, state)
  ).catch(() => null);

  if (!panel) {
    return _sendError(
      message,
      "Impossible d'ouvrir le panel de profil.",
      deleteReply,
      deleteDelay
    );
  }

  embed.registerPrivateInteraction(panel, message.author.id, PANEL_TIME_MS);

  let busy = false;

  const collector = panel.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter       : interaction =>
      interaction.user.id === message.author.id &&
      interaction.message.id === panel.id,
    idle         : PANEL_IDLE_MS,
    time         : PANEL_TIME_MS,
  });

  collector.on('collect', async interaction => {
    const id = interaction.customId;

    if (busy) {
      return _ephemeral(interaction, guildId, 'Une modification est déjà en cours.');
    }

    if (id === 'local:setprofile:close') {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      await message.delete().catch(() => {});
      return;
    }

    if (id === 'local:setprofile:name') {
      busy = true;

      const modalId = `local:setprofile:name:${interaction.id}`;
      const shown = await interaction.showModal(
        _buildModal(
          modalId,
          'Nom du bot',
          [
            _input(
              'name',
              'Nouveau nom',
              TextInputStyle.Short,
              {
                value       : state.name || client.user.username || '',
                required    : true,
                minLength   : MIN_NAME_LENGTH,
                maxLength   : MAX_NAME_LENGTH,
                placeholder : 'Nom du bot',
              }
            ),
          ]
        )
      ).then(() => true).catch(() => false);

      if (!shown) {
        busy = false;
        return _ephemeral(interaction, guildId, "Impossible d'ouvrir le formulaire.");
      }


      busy = false;
      const submit = await _awaitOwnModal(interaction, modalId);

      if (!submit) {
        busy = false;
        return;
      }

      const name = submit.fields.getTextInputValue('name').trim();
      const error = _validateName(name);

      if (error) {
        busy = false;
        await _modalError(submit, guildId, error);
        return _refreshProfilePanel(panel, client, guildId, state);
      }

      state.name = name;
      busy = false;

      await submit.deferUpdate().catch(() => {});
      return _refreshProfilePanel(panel, client, guildId, state);
    }

    if (id === 'local:setprofile:avatar') {
      busy = true;

      const modalId = `local:setprofile:avatar:${interaction.id}`;
      const shown = await interaction.showModal(
        _buildModal(
          modalId,
          'Avatar du bot',
          [
            _input(
              'avatar',
              "URL de l'avatar",
              TextInputStyle.Short,
              {
                value       : state.avatarUrl || '',
                required    : false,
                maxLength   : 512,
                placeholder : 'https://...',
              }
            ),
          ]
        )
      ).then(() => true).catch(() => false);

      if (!shown) {
        busy = false;
        return _ephemeral(interaction, guildId, "Impossible d'ouvrir le formulaire.");
      }


      busy = false;
      const submit = await _awaitOwnModal(interaction, modalId);

      if (!submit) {
        busy = false;
        return;
      }

      const avatarUrl = submit.fields.getTextInputValue('avatar').trim();

      if (avatarUrl && !_isImageUrl(avatarUrl)) {
        busy = false;
        await _modalError(submit, guildId, "URL d'avatar invalide.");
        return _refreshProfilePanel(panel, client, guildId, state);
      }

      state.avatarUrl = avatarUrl || null;
      busy = false;

      await submit.deferUpdate().catch(() => {});
      return _refreshProfilePanel(panel, client, guildId, state);
    }

    if (id === 'local:setprofile:tools') {
      state.view = 'tools';
      await interaction.deferUpdate().catch(() => {});
      return _refreshProfilePanel(panel, client, guildId, state);
    }

    if (id === 'local:setprofile:tools:back') {
      state.view = 'main';
      await interaction.deferUpdate().catch(() => {});
      return _refreshProfilePanel(panel, client, guildId, state);
    }

    if (id === 'local:setprofile:bannerremove') {
      state.bannerUrl    = null;
      state.bannerRemove = true;
      await interaction.deferUpdate().catch(() => {});
      return _refreshProfilePanel(panel, client, guildId, state);
    }

    if (id === 'local:setprofile:avatarremove') {
      state.avatarUrl    = null;
      state.avatarRemove = true;
      await interaction.deferUpdate().catch(() => {});
      return _refreshProfilePanel(panel, client, guildId, state);
    }

    if (id === 'local:setprofile:resetprofile') {
      state.avatarUrl    = null;
      state.avatarRemove = true;
      state.bannerUrl    = null;
      state.bannerRemove = true;
      await interaction.deferUpdate().catch(() => {});
      return _refreshProfilePanel(panel, client, guildId, state);
    }

    if (id === 'local:setprofile:banner') {
      busy = true;

      const modalId = `local:setprofile:banner:${interaction.id}`;
      const shown = await interaction.showModal(
        _buildModal(
          modalId,
          'Bannière du bot',
          [
            _input(
              'banner',
              'URL de la bannière',
              TextInputStyle.Short,
              {
                value       : state.bannerRemove ? 'remove' : (state.bannerUrl || ''),
                required    : false,
                maxLength   : 512,
                placeholder : 'https://... ou remove',
              }
            ),
          ]
        )
      ).then(() => true).catch(() => false);

      if (!shown) {
        busy = false;
        return _ephemeral(interaction, guildId, "Impossible d'ouvrir le formulaire.");
      }


      busy = false;
      const submit = await _awaitOwnModal(interaction, modalId);

      if (!submit) {
        busy = false;
        return;
      }

      const bannerUrl = submit.fields.getTextInputValue('banner').trim();

      if (_isRemoveValue(bannerUrl)) {
        state.bannerUrl = null;
        state.bannerRemove = true;
      } else {
        if (bannerUrl && !_isImageUrl(bannerUrl)) {
          busy = false;
          await _modalError(submit, guildId, 'URL de bannière invalide.');
          return _refreshProfilePanel(panel, client, guildId, state);
        }

        state.bannerUrl = bannerUrl || null;
        state.bannerRemove = false;
      }

      busy = false;

      await submit.deferUpdate().catch(() => {});
      return _refreshProfilePanel(panel, client, guildId, state);
    }

    if (id === 'local:setprofile:apply') {
      busy = true;

      await interaction.deferUpdate().catch(() => {});

      const errors = _validateProfileState(state);

      if (errors.length) {
        busy = false;
        return _followUp(interaction, guildId, errors.join('\n'), true);
      }

      const result = await _applyProfileState(client, state);

      state.name         = null;
      state.avatarUrl    = null;
      state.bannerUrl    = null;
      state.avatarRemove = false;
      state.bannerRemove = false;
      state.view         = 'main';

      await _refreshProfilePanel(panel, client, guildId, state);

      busy = false;

      return _followUp(interaction, guildId, _formatProfileResult(result), !result.ok);
    }

    await interaction.deferUpdate().catch(() => {});
  });

  collector.on('end', async (_, reason) => {
    embed.clearPrivateInteraction(panel);

    if (reason === 'closed') return;

    await panel.edit({ components: [] }).catch(() => {})

    if (deleteReply) {
      embed.scheduleDelete(panel, deleteDelay);
    }
  });
}

function _validateProfileState(state) {
  const errors = [];

  if (!state.name && !state.avatarUrl && !state.bannerUrl && !state.avatarRemove && !state.bannerRemove) {
    errors.push('Aucune modification à appliquer.');
  }

  if (state.name) {
    const error = _validateName(state.name);
    if (error) errors.push(error);
  }

  if (state.avatarUrl && !_isImageUrl(state.avatarUrl)) {
    errors.push("URL d'avatar invalide.");
  }

  if (state.bannerUrl && !_isImageUrl(state.bannerUrl)) {
    errors.push('URL de bannière invalide.');
  }

  return errors;
}

async function _applyProfileState(client, state) {
  const success = [];
  const failed  = [];
  const errors  = [];

  if (state.name) {
    const changed = await _safeSetUsername(client, state.name);

    if (changed) success.push('Nom');
    else failed.push('Nom');
  }

  if (state.avatarRemove) {
    const r = await _safeSetAvatar(client, null);

    if (r.ok) success.push('Avatar retire');
    else { failed.push('Avatar'); errors.push(`Avatar : ${r.error}`); }
  } else if (state.avatarUrl) {
    const r = await _safeSetAvatar(client, state.avatarUrl);

    if (r.ok) success.push('Avatar');
    else { failed.push('Avatar'); errors.push(`Avatar : ${r.error}`); }
  }

  if (state.bannerRemove) {
    const r = await _safeSetBanner(client, null);

    if (r.ok) success.push('Bannière retirée');
    else { failed.push('Bannière'); errors.push(`Bannière : ${r.error}`); }
  } else if (state.bannerUrl) {
    const r = await _safeSetBanner(client, state.bannerUrl);

    if (r.ok) success.push('Bannière');
    else { failed.push('Bannière'); errors.push(`Bannière : ${r.error}`); }
  }

  return {
    ok: failed.length === 0,
    success,
    failed,
    errors,
  };
}

async function _safeSetUsername(client, name) {
  try {
    await client.user.setUsername(name);
    return true;
  } catch {
    return false;
  }
}

async function _safeSetAvatar(client, image) {
  if (image === null) {
    try {
      await client.user.setAvatar(null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: _formatDiscordError(err) };
    }
  }

  const fetched = await imageResolver.downloadImage(image, {
    maxBytes  : MAX_IMAGE_BYTES,
    timeoutMs : IMAGE_FETCH_TIMEOUT_MS,
  });
  if (!fetched.ok) return { ok: false, error: fetched.error };

  try {
    await client.user.setAvatar(fetched.dataUri);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: _formatDiscordError(err, fetched.contentType) };
  }
}

async function _safeSetBanner(client, image) {
  if (image === null) {
    try {
      await client.user.setBanner(null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: _formatDiscordError(err) };
    }
  }

  const fetched = await imageResolver.downloadImage(image, {
    maxBytes  : MAX_IMAGE_BYTES,
    timeoutMs : IMAGE_FETCH_TIMEOUT_MS,
  });
  if (!fetched.ok) return { ok: false, error: fetched.error };

  try {
    await client.user.setBanner(fetched.dataUri);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: _formatDiscordError(err, fetched.contentType) };
  }
}

function _formatDiscordError(err, contentType) {
  if (!err) return 'Erreur inconnue.';


  if (err.code === 50035 && String(contentType || '').toLowerCase() === 'image/webp') {
    return 'Les WebP animés passent mal pour les avatars/bannières Discord. Utilisez un GIF pour une image animée.';
  }

  if (err.code === 50035) return 'Discord a refusé l\'image (format ou contenu invalide).';
  if (err.code === 40005) return 'Image trop volumineuse pour Discord.';
  if (err.code === 50013) return 'Permissions insuffisantes.';
  if (err.status === 429 || err.code === 429) return 'Rate limit Discord, reessayez dans quelques secondes.';
  if (err.message) return `Discord : ${err.message}`;
  return 'Erreur API.';
}

function _buildProfilePayload(client, guildId, state) {
  const currentName   = client.user.username;
  const currentAvatar = client.user.displayAvatarURL({ dynamic: true, size: 1024 });
  const currentBanner = typeof client.user.bannerURL === 'function'
    ? client.user.bannerURL({ size: 1024 })
    : null;

  const avatarPrev = state.avatarRemove
    ? '`Suppression`'
    : (state.avatarUrl ? '`Configuré`' : '`Non modifié`');
  const bannerPrev = state.bannerRemove
    ? '`Suppression`'
    : (state.bannerUrl ? '`Configurée`' : '`Non modifiée`');

  const summary =
    `> Nom actuel : \`${currentName}\`\n` +
    `> Nom prévu : ${state.name ? `\`${state.name}\`` : '`Non modifié`'}\n` +
    `> Avatar prévu : ${avatarPrev}\n` +
    `> Bannière prévue : ${bannerPrev}\n` +
    `> Bio : \`Non supportée\``;

  const isTools = state.view === 'tools';
  const title   = isTools ? '## Profil du bot - Outils' : '## Profil du bot';
  const helpTxt = isTools
    ? '> Les actions préparées ne sont appliquées qu\'après avoir appuyé sur le bouton `Enregistrer`.'
    : null;
  const rows = isTools ? _buildProfileToolsRows(false) : _buildProfileMainRows(false);

  if (V2_AVAILABLE) {
    try {
      const accent    = _hexToInt(embed.getGuildColor(guildId));
      const container = new ContainerBuilder().setAccentColor(accent);

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(title),
      );
      container.addSeparatorComponents(new SeparatorBuilder());
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(summary),
      );
      if (helpTxt) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(helpTxt),
        );
      }

      for (const row of rows) {
        container.addActionRowComponents(row);
      }

      return {
        flags           : COMPONENTS_V2_FLAG,
        embeds          : [],
        components      : [container],
        allowedMentions : { parse: [] },
      };
    } catch {}
  }


  const e = new EmbedBuilder()
    .setColor(embed.getGuildColor(guildId))
    .setTitle(isTools ? 'Set profil - Outils' : 'Set profil')
    .setDescription(
      `Nom actuel : \`${currentName}\`\n` +
      `Nom prévu : ${state.name ? `\`${state.name}\`` : '`Non modifié`'}\n` +
      `Avatar prévu : ${avatarPrev}\n` +
      `Bannière prévue : ${bannerPrev}\n\n` +
      (isTools
        ? '> Les actions préparées ne sont appliquées qu\'après avoir appuyé sur le bouton `Enregistrer`.'
        : 'Utilisez les boutons pour préparer les modifications, puis appliquez.')
    )
    .setThumbnail(state.avatarUrl || currentAvatar);

  if (state.bannerUrl) {
    e.setImage(state.bannerUrl);
  } else if (currentBanner) {
    e.setImage(currentBanner);
  }

  return {
    embeds          : [e],
    components      : rows,
    allowedMentions : { parse: [] },
  };
}

function _buildProfileMainRows(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:setprofile:name')
        .setLabel('Nom')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId('local:setprofile:avatar')
        .setLabel('Avatar')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId('local:setprofile:banner')
        .setLabel('Bannière')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId('local:setprofile:tools')
        .setLabel('Outils')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:setprofile:apply')
        .setLabel('Enregistrer')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId('local:setprofile:close')
        .setLabel('Fermer')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
  ];
}

function _buildProfileToolsRows(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:setprofile:avatarremove')
        .setLabel('Retirer avatar')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId('local:setprofile:bannerremove')
        .setLabel('Retirer bannière')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId('local:setprofile:resetprofile')
        .setLabel('Reset profil')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:setprofile:tools:back')
        .setLabel('↩')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
  ];
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

  if (options.minLength) {
    input.setMinLength(options.minLength);
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
      time: PANEL_TIME_MS,
    });
  } catch {
    return null;
  }
}

async function _refreshProfilePanel(panel, client, guildId, state) {
  return panel.edit(_buildProfilePayload(client, guildId, state)).catch(() => {});
}

function _resolveImageInput(message, rawValue) {
  const value = String(rawValue || '').trim();

  if (value) {
    return value;
  }


  const attachment = message.attachments?.find(file =>
    file?.url && (
      file.contentType?.startsWith('image/') ||
      _isImageUrl(file.url)
    )
  );

  return attachment?.url || null;
}

function _validateName(name) {
  if (!name) {
    return 'Vous devez indiquer un nom.';
  }

  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    return `Le nom doit contenir entre ${MIN_NAME_LENGTH} et ${MAX_NAME_LENGTH} caractères.`;
  }

  if (/@everyone|@here/i.test(name)) {
    return 'Le nom ne peut pas contenir `@everyone` ou `@here`.';
  }

  return null;
}

function _isRemoveValue(value) {
  const raw = String(value || '').toLowerCase().trim();

  return ['remove', 'delete', 'del', 'clear', 'reset', 'off', 'none', 'null', 'aucune'].includes(raw);
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

  try {
    const { pathname, hostname } = new URL(value);
    const path = pathname.toLowerCase();

    const hasImageExtension =
      path.endsWith('.png') ||
      path.endsWith('.jpg') ||
      path.endsWith('.jpeg') ||
      path.endsWith('.gif') ||
      path.endsWith('.webp');

    if (hasImageExtension) return true;

    const trustedHosts = [
      'cdn.discordapp.com',
      'media.discordapp.net',
      'i.imgur.com',
      'media.tenor.com',
      'media.giphy.com',
    ];

    return trustedHosts.some(h => hostname === h || hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

function _mapInvokedAlias(invoked) {
  const map = {
    setname   : 'name',
    setpic    : 'pic',
    setavatar : 'pic',
    setbanner : 'banner',
    setprofil : 'profil',
    setprofile: 'profil',
  };

  return {
    action: map[invoked] || null,
  };
}


function _getInvokedName(message, prefix) {
  const content = String(message.content || '');

  if (content.startsWith(prefix)) {
    return content
      .slice(prefix.length)
      .trim()
      .split(/\s+/)[0] || module.exports.help.name;
  }

  return module.exports.help.name;
}

function _formatProfileResult(result) {
  if (!result.success.length && !result.failed.length) {
    return 'Aucune modification appliquée.';
  }

  const lines = [];

  if (result.success.length) {
    lines.push(`Modifié : \`${result.success.join('`, `')}\`.`);
  }

  if (result.failed.length) {
    lines.push(`Échec : \`${result.failed.join('`, `')}\`.`);
  }

  if (Array.isArray(result.errors) && result.errors.length) {
    for (const err of result.errors) {
      lines.push(`> ${err}`);
    }
  }

  return lines.join('\n');
}

async function _sendReply(message, content, deleteReply, deleteDelay) {
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

async function _followUp(interaction, guildId, content, error = false) {
  return interaction.followUp({
    embeds: [
      embed.build(guildId, content, {
        color    : error ? '#ED4245' : undefined,
        timestamp: false,
      }),
    ],
    flags: 64,
  }).catch(() => {});
}

async function _usage(message, deleteReply, deleteDelay) {
  const p = message.prefix || '+';
  return _sendError(
    message,
    `Utilisation :\n` +
    `\`${p}set name <nom>\`\n` +
    `\`${p}set pic <url ou image jointe>\`\n` +
    `\`${p}set banner <url ou image jointe>\`\n` +
    `\`${p}set banner remove\`\n` +
    `\`${p}set profil\`\n` +
    `\`${p}set server name <nom>\`\n` +
    `\`${p}set server name reset\`\n` +
    `\`${p}set server profil\``,
    deleteReply,
    deleteDelay
  );
}
