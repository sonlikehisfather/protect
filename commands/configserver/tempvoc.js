'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? null;
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder    === 'function' &&
  typeof TextDisplayBuilder  === 'function' &&
  typeof SeparatorBuilder    === 'function'
);

function _hexToInt(hex) {
  try {
    const m = String(hex || '').replace(/^#/, '').match(/^[0-9a-fA-F]{6}$/);
    return m ? parseInt(m[0], 16) : 0x2f3136;
  } catch { return 0x2f3136; }
}

module.exports = {
  help: {
    name        : 'tempvoc',
    description : 'Configure les vocaux temporaires.',
    use         : 'tempvoc',
    usage       : 'tempvoc',
    aliases     : ['tempvoice', 'temporaryvoice'],
  },

  async run(client, message, args) {
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

    if (args[0]?.toLowerCase() === 'cmd') {
      return _showCmd(message, guildId, deleteReply, deleteDelay);
    }

    const tempvocConfig = db.getTempvocConfig(guildId);
    const state = _stateFromConfig(tempvocConfig, config);

    const panel = await message.channel.send(
      _buildPanelPayload(guildId, state, guild)
    ).catch(() => null);

    if (!panel) {
      return embed.replyError(
        message,
        'Impossible d\'ouvrir le panel tempvoc.',
        { timestamp: false }
      ).catch(() => {});
    }

    embed.registerPrivateInteraction(panel, message.author.id, 3_600_000);

    let busy = false;

    const collector = panel.createMessageComponentCollector({
      filter : interaction =>
        interaction.user.id === message.author.id &&
        interaction.message.id === panel.id,
      idle   : 3_600_000,
      time   : 3_600_000,
    });

    collector.on('collect', async interaction => {
      const id = interaction.customId;

      if (busy && id !== 'tv:close') {
        return _ephemeral(interaction, guildId, 'Une modification est déjà en cours.');
      }

      if (id === 'tv:close') {
        collector.stop('closed');
        embed.clearPrivateInteraction(panel);
        await interaction.deferUpdate().catch(() => {});
        await panel.delete().catch(() => {});
        return;
      }

      if (id === 'tv:toggle') {


        if (!state.enabled && !state.joinChannelId) {
          return interaction.reply({
            embeds : [embed.build(guildId, 'Configurez d\u2019abord le salon lobby tempvoc.', { color: '#ED4245', timestamp: false })],
            flags  : 64,
          }).catch(() => {});
        }
        state.enabled = !state.enabled;
        db.setTempvocConfig(guildId, 'enabled', state.enabled ? 1 : 0);
        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state, guild);
      }

      if (id === 'tv:reset') {
        await _deleteInfoEmbed(client, state).catch(() => {});

        state.enabled            = false;
        state.joinChannelId      = null;
        state.categoryId         = null;
        state.nameTemplate       = 'Vocal de {username}';
        state.userLimit          = 0;
        state.requiredRoles      = [];
        state.blockedRoles       = [];
        state.ownerManageChannel = false;
        state.ownerManagePerms   = false;
        state.ownerMoveMembers   = false;
        state.defaultInvisible   = false;
        state.embedChannelId     = null;
        state.embedMessageId     = null;

        for (const [k, v] of Object.entries({
          enabled: 0, joinChannelId: null, categoryId: null,
          nameTemplate: 'Vocal de {username}', userLimit: 0,
          requiredRoles: '[]', blockedRoles: '[]',
          ownerManageChannel: 0, ownerManagePerms: 0,
          ownerMoveMembers: 0, defaultInvisible: 0,
          embedChannelId: null, embedMessageId: null,
        })) db.setTempvocConfig(guildId, k, v);

        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state, guild);
      }

      if (id === 'tv:join') {
        busy = true;
        const modalId = `tv:join:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(modalId, 'Salon créateur', [
            _input('channel', 'Salon vocal créateur', TextInputStyle.Short, {
              value: state.joinChannelId ? `<#${state.joinChannelId}>` : '',
              required: true, maxLength: 100, placeholder: '#salon, ID ou nom',
            }),
          ])
        ).then(() => true).catch(() => false);
        busy = false;
        if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

        const submit = await _awaitOwnModal(interaction, modalId);
        if (!submit) return _refresh(panel, guildId, state, guild);
        busy = true;

        const value = submit.fields.getTextInputValue('channel').trim();
        const channel = await _resolveVoiceChannel(guild, value);

        if (!channel) {
          await _modalError(submit, guildId, 'Salon vocal introuvable ou invalide.');
          busy = false;
          return _refresh(panel, guildId, state, guild);
        }

        const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        const botPerms = me ? channel.permissionsFor(me) : null;

        if (
          !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
          !botPerms?.has(PermissionsBitField.Flags.Connect) ||
          !botPerms?.has(PermissionsBitField.Flags.MoveMembers)
        ) {
          await _modalError(submit, guildId, 'Je n\'ai pas les permissions nécessaires sur ce salon vocal.');
          busy = false;
          return _refresh(panel, guildId, state, guild);
        }

        db.setTempvocConfig(guildId, 'joinChannelId', channel.id);
        state.joinChannelId = channel.id;

        if (!state.categoryId && channel.parentId) {
          db.setTempvocConfig(guildId, 'categoryId', channel.parentId);
          state.categoryId = channel.parentId;
        }

        if (state.embedChannelId) {
          await _sendOrUpdateInfoEmbed(client, guild, state).catch(() => {});
        }

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state, guild);
      }

      if (id === 'tv:panel_channel') {
        busy = true;
        const modalId = `tv:pchan:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(modalId, 'Salon panel vocal', [
            _input('channel', 'Salon texte (reset = retirer)', TextInputStyle.Short, {
              value: state.embedChannelId ? `<#${state.embedChannelId}>` : '',
              required: false, maxLength: 100, placeholder: '#salon, ID, nom ou reset',
            }),
          ])
        ).then(() => true).catch(() => false);
        busy = false;
        if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

        const submit = await _awaitOwnModal(interaction, modalId);
        if (!submit) return _refresh(panel, guildId, state, guild);
        busy = true;

        const value = submit.fields.getTextInputValue('channel').trim();

        if (!value || value.toLowerCase() === 'reset') {
          await _deleteInfoEmbed(client, state).catch(() => {});
          state.embedChannelId = null;
          state.embedMessageId = null;
          db.setTempvocConfig(guildId, 'embedChannelId', null);
          db.setTempvocConfig(guildId, 'embedMessageId', null);
          await submit.deferUpdate().catch(() => {});
          busy = false;
          return _refresh(panel, guildId, state, guild);
        }

        const textChannel = await _resolveTextChannel(guild, value);
        if (!textChannel) {
          await _modalError(submit, guildId, 'Salon textuel introuvable ou invalide.');
          busy = false;
          return _refresh(panel, guildId, state, guild);
        }

        const meP = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        const botPermsP = meP ? textChannel.permissionsFor(meP) : null;
        if (
          !botPermsP?.has(PermissionFlagsBits.ViewChannel) ||
          !botPermsP?.has(PermissionFlagsBits.SendMessages) ||
          !botPermsP?.has(PermissionFlagsBits.EmbedLinks)
        ) {
          await _modalError(submit, guildId, 'Je n\'ai pas les permissions nécessaires (Voir, Envoyer, Embeds).');
          busy = false;
          return _refresh(panel, guildId, state, guild);
        }

        if (state.embedChannelId && state.embedChannelId !== textChannel.id) {
          await _deleteInfoEmbed(client, state).catch(() => {});
          state.embedMessageId = null;
        }

        state.embedChannelId = textChannel.id;
        db.setTempvocConfig(guildId, 'embedChannelId', textChannel.id);
        await _sendOrUpdateInfoEmbed(client, guild, state).catch(() => {});

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state, guild);
      }

      if (id === 'tv:name') {
        busy = true;
        const modalId = `tv:name:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(modalId, 'Nom des vocaux', [
            _input('name', 'Nom par défaut', TextInputStyle.Short, {
              value: state.nameTemplate || '', required: true,
              maxLength: 100, placeholder: 'Vocal de {username}',
            }),
          ])
        ).then(() => true).catch(() => false);
        busy = false;
        if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

        const submit = await _awaitOwnModal(interaction, modalId);
        if (!submit) return _refresh(panel, guildId, state, guild);
        busy = true;

        const value = submit.fields.getTextInputValue('name').trim();
        if (!value) {
          await _modalError(submit, guildId, 'Le nom ne peut pas être vide.');
          busy = false;
          return _refresh(panel, guildId, state, guild);
        }

        db.setTempvocConfig(guildId, 'nameTemplate', value);
        state.nameTemplate = value;
        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state, guild);
      }

      if (id === 'tv:category') {
        busy = true;
        const modalId = `tv:cat:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(modalId, 'Catégorie tempvoc', [
            _input('category', 'Catégorie', TextInputStyle.Short, {
              value: state.categoryId ? `<#${state.categoryId}>` : '',
              required: false, maxLength: 100, placeholder: '#catégorie, ID, nom ou reset',
            }),
          ])
        ).then(() => true).catch(() => false);
        busy = false;
        if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

        const submit = await _awaitOwnModal(interaction, modalId);
        if (!submit) return _refresh(panel, guildId, state, guild);
        busy = true;

        const value = submit.fields.getTextInputValue('category').trim();

        if (!value || value.toLowerCase() === 'reset') {
          db.setTempvocConfig(guildId, 'categoryId', null);
          state.categoryId = null;
          await submit.deferUpdate().catch(() => {});
          busy = false;
          return _refresh(panel, guildId, state, guild);
        }

        const category = await _resolveCategory(guild, value);
        if (!category) {
          await _modalError(submit, guildId, 'Catégorie introuvable ou invalide.');
          busy = false;
          return _refresh(panel, guildId, state, guild);
        }

        db.setTempvocConfig(guildId, 'categoryId', category.id);
        state.categoryId = category.id;
        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state, guild);
      }

      if (id === 'tv:limit') {
        busy = true;
        const modalId = `tv:limit:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(modalId, 'Limite utilisateur', [
            _input('limit', 'Limite', TextInputStyle.Short, {
              value: String(state.userLimit || 0),
              required: true, maxLength: 2, placeholder: '0 a 99',
            }),
          ])
        ).then(() => true).catch(() => false);
        busy = false;
        if (!shown) return _ephemeral(interaction, guildId, 'Impossible d\'ouvrir le formulaire.');

        const submit = await _awaitOwnModal(interaction, modalId);
        if (!submit) return _refresh(panel, guildId, state, guild);
        busy = true;

        const rawLimit = submit.fields.getTextInputValue('limit').trim();
        const limit = Number(rawLimit);

        if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
          await _modalError(submit, guildId, 'La limite doit etre un nombre entre 0 et 99.');
          busy = false;
          return _refresh(panel, guildId, state, guild);
        }

        db.setTempvocConfig(guildId, 'userLimit', limit);
        state.userLimit = limit;
        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state, guild);
      }

      if (id === 'tv:required_roles') {
        const ids = interaction.values ?? [];
        state.requiredRoles = ids;
        db.setTempvocConfig(guildId, 'requiredRoles', JSON.stringify(ids));
        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state, guild);
      }

      if (id === 'tv:blocked_roles') {
        const ids = interaction.values ?? [];
        state.blockedRoles = ids;
        db.setTempvocConfig(guildId, 'blockedRoles', JSON.stringify(ids));
        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state, guild);
      }

      if (id === 'tv:t:manage_channel') {
        state.ownerManageChannel = !state.ownerManageChannel;
        db.setTempvocConfig(guildId, 'ownerManageChannel', state.ownerManageChannel ? 1 : 0);
        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state, guild);
      }

      if (id === 'tv:t:manage_perms') {
        state.ownerManagePerms = !state.ownerManagePerms;
        db.setTempvocConfig(guildId, 'ownerManagePerms', state.ownerManagePerms ? 1 : 0);
        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state, guild);
      }

      if (id === 'tv:t:move_members') {
        state.ownerMoveMembers = !state.ownerMoveMembers;
        db.setTempvocConfig(guildId, 'ownerMoveMembers', state.ownerMoveMembers ? 1 : 0);
        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state, guild);
      }

      if (id === 'tv:t:invisible') {
        state.defaultInvisible = !state.defaultInvisible;
        db.setTempvocConfig(guildId, 'defaultInvisible', state.defaultInvisible ? 1 : 0);
        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state, guild);
      }

      await interaction.deferUpdate().catch(() => {});
    });

    collector.on('end', async (_, reason) => {
      embed.clearPrivateInteraction(panel);
      if (reason === 'closed') return;

      if (V2_AVAILABLE) {
        try {
          const accent = _hexToInt(state.baseColor);
          const ro = new ContainerBuilder().setAccentColor(accent);
          ro.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Tempvoc'),
          );
          const statusLine = state.enabled ? 'Activé' : 'Désactivé';
          const joinLine   = state.joinChannelId ? `<#${state.joinChannelId}>` : 'Aucun';
          const catLine    = state.categoryId ? `<#${state.categoryId}>` : 'Aucune';
          const nameLine   = `\`${_truncate(state.nameTemplate, 60)}\``;
          const limitLine  = state.userLimit ? `\`${state.userLimit}\`` : 'Aucune';
          ro.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `**État** ${statusLine}\n` +
              `**Salon créateur** ${joinLine}\n` +
              `**Catégorie** ${catLine}\n` +
              `**Nom** ${nameLine}\n` +
              `**Limite** ${limitLine}`
            ),
          );
          ro.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('-# Panel expiré'),
          );
          await panel.edit({
            flags      : COMPONENTS_V2_FLAG,
            components : [ro],
            allowedMentions: { parse: [] },
          }).catch(() => {});
        } catch {
          await panel.edit({ components: [] }).catch(() => {});
        }
      } else {
        await panel.edit({ components: [] }).catch(() => {});
      }

      if (deleteReply) {
        embed.scheduleDelete(panel, deleteDelay);
      }
    });
  },
};


function _stateFromConfig(tempvocConfig, guildConfig) {
  return {
    enabled            : Number(tempvocConfig?.enabled) === 1,
    joinChannelId      : tempvocConfig?.joinChannelId || null,
    categoryId         : tempvocConfig?.categoryId || null,
    nameTemplate       : tempvocConfig?.nameTemplate || 'Vocal de {username}',
    userLimit          : Number(tempvocConfig?.userLimit) || 0,
    requiredRoles      : _parseJsonArray(tempvocConfig?.requiredRoles),
    blockedRoles       : _parseJsonArray(tempvocConfig?.blockedRoles),
    ownerManageChannel : Number(tempvocConfig?.ownerManageChannel) === 1,
    ownerManagePerms   : Number(tempvocConfig?.ownerManagePerms) === 1,
    ownerMoveMembers   : Number(tempvocConfig?.ownerMoveMembers) === 1,
    defaultInvisible   : Number(tempvocConfig?.defaultInvisible) === 1,
    baseColor          : _safeColor(guildConfig?.color || '#2f3136'),
    embedChannelId     : tempvocConfig?.embedChannelId || null,
    embedMessageId     : tempvocConfig?.embedMessageId || null,
  };
}

function _parseJsonArray(value) {
  if (!value) return [];
  try { const arr = JSON.parse(value); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}


function _buildPanelPayload(guildId, state, guild) {
  if (V2_AVAILABLE) {
    try {
      const payload = _buildV2(guildId, state, guild);
      if (payload) return payload;
    } catch {}
  }
  return _buildLegacy(guildId, state);
}

function _buildV2(guildId, state, guild) {
  const accent    = _hexToInt(state.baseColor);
  const container = new ContainerBuilder().setAccentColor(accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Tempvoc'),
  );

  const statusLine = state.enabled ? 'Activé' : 'Désactivé';
  const joinLine   = state.joinChannelId ? `<#${state.joinChannelId}>` : 'Aucun';
  const catLine    = state.categoryId ? `<#${state.categoryId}>` : 'Aucune';
  const nameLine   = `\`${_truncate(state.nameTemplate, 60)}\``;
  const limitLine  = state.userLimit ? `\`${state.userLimit}\`` : 'Aucune';

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**État** ${statusLine}\n` +
      `**Salon créateur** ${joinLine}\n` +
      `**Catégorie** ${catLine}\n` +
      `**Nom** ${nameLine}\n` +
      `**Limite** ${limitLine}`
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());


  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('**Configuration**'),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tv:join').setLabel('Salon createur').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tv:name').setLabel('Nom').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tv:category').setLabel('Categorie').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tv:limit').setLabel('Limite').setStyle(ButtonStyle.Secondary),
    ),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '-# Variables nom : `{username}` `{user}` `{id}` `{server}` `{tag}`'
    ),
  );

  const embedChanLine = state.embedChannelId ? `<#${state.embedChannelId}>` : 'Non configuré';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**Salon panel vocal** ${embedChanLine}`),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tv:panel_channel').setLabel('Set').setStyle(ButtonStyle.Secondary),
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  const reqSelect = new RoleSelectMenuBuilder()
    .setCustomId('tv:required_roles')
    .setPlaceholder('Rôles requis pour créer un vocal')
    .setMinValues(0)
    .setMaxValues(10);

  try {
    const isValid = id => guild?.roles?.cache?.has?.(id) ?? false;
    const reqIds = state.requiredRoles.filter(isValid).slice(0, 10);
    if (reqIds.length && typeof reqSelect.setDefaultValues === 'function') {
      reqSelect.setDefaultValues(reqIds);
    }
  } catch {}

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('**Rôles requis**'),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(reqSelect),
  );

  const blkSelect = new RoleSelectMenuBuilder()
    .setCustomId('tv:blocked_roles')
    .setPlaceholder('Rôles interdits')
    .setMinValues(0)
    .setMaxValues(10);

  try {
    const isValid = id => guild?.roles?.cache?.has?.(id) ?? false;
    const blkIds = state.blockedRoles.filter(isValid).slice(0, 10);
    if (blkIds.length && typeof blkSelect.setDefaultValues === 'function') {
      blkSelect.setDefaultValues(blkIds);
    }
  } catch {}

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('**Rôles interdits**'),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(blkSelect),
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('**Permissions propriétaire**'),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      _toggleBtn('tv:t:manage_channel', 'Gérer le salon',      state.ownerManageChannel),
      _toggleBtn('tv:t:manage_perms',   'Gérer les perms',     state.ownerManagePerms),
      _toggleBtn('tv:t:move_members',   'Déplacer les membres', state.ownerMoveMembers),
    ),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('**Options**'),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      _toggleBtn('tv:t:invisible', 'Invisible par défaut', state.defaultInvisible),
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tv:toggle')
        .setLabel(state.enabled ? 'Désactiver' : 'Activer')
        .setStyle(state.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('tv:reset')
        .setLabel('Réinitialiser')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('tv:close')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Secondary),
    ),
  );


  return {
    flags           : COMPONENTS_V2_FLAG,
    components      : [container],
    allowedMentions : { parse: [] },
  };
}

function _toggleBtn(customId, label, active) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(active ? ButtonStyle.Primary : ButtonStyle.Secondary);
}

function _buildLegacy(guildId, state) {
  const desc =
    `**État** : ${state.enabled ? 'Activé' : 'Désactivé'}\n` +
    `**Salon créateur** : ${state.joinChannelId ? `<#${state.joinChannelId}>` : 'Aucun'}\n` +
    `**Catégorie** : ${state.categoryId ? `<#${state.categoryId}>` : 'Aucune'}\n` +
    `**Nom** : \`${_truncate(state.nameTemplate, 80)}\`\n` +
    `**Limite** : ${state.userLimit ? `\`${state.userLimit}\`` : 'Aucune'}\n` +
    `**Gérer salon** : ${state.ownerManageChannel ? 'Oui' : 'Non'}\n` +
    `**Gérer perms** : ${state.ownerManagePerms ? 'Oui' : 'Non'}\n` +
    `**Déplacer** : ${state.ownerMoveMembers ? 'Oui' : 'Non'}\n` +
    `**Invisible** : ${state.defaultInvisible ? 'Oui' : 'Non'}\n` +
    `**Salon panel vocal** : ${state.embedChannelId ? `<#${state.embedChannelId}>` : 'Non configuré'}\n\n` +
    `Variables : \`{username}\`, \`{user}\`, \`{id}\`, \`{server}\``;

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tv:join').setLabel('Salon créateur').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tv:name').setLabel('Nom').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tv:category').setLabel('Catégorie').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tv:limit').setLabel('Limite').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tv:panel_channel').setLabel('Set').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      _toggleBtn('tv:t:manage_channel', 'Gérer salon',   state.ownerManageChannel),
      _toggleBtn('tv:t:manage_perms',   'Gérer perms',   state.ownerManagePerms),
      _toggleBtn('tv:t:move_members',   'Déplacer',      state.ownerMoveMembers),
      _toggleBtn('tv:t:invisible',      'Invisible',     state.defaultInvisible),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tv:toggle')
        .setLabel(state.enabled ? 'Désactiver' : 'Activer')
        .setStyle(state.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('tv:reset')
        .setLabel('Réinitialiser')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('tv:close')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return {
    embeds          : [new EmbedBuilder().setTitle('Tempvoc').setColor(state.baseColor).setDescription(desc)],
    components      : rows,
    allowedMentions : { parse: [] },
  };
}


async function _refresh(panel, guildId, state, guild) {
  return panel.edit(_buildPanelPayload(guildId, state, guild)).catch(() => {});
}

async function _showCmd(message, guildId, deleteReply, deleteDelay) {
  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `Commandes disponibles :\n` +
        `\`${message.prefix || '+'}tempvoc\` - ouvrir le panel de configuration\n` +
        `\`${message.prefix || '+'}tempvoc cmd\` - afficher cette aide\n\n` +
        `Les commandes utilisateur des vocaux temporaires seront ajoutees ensuite.`,
        { title: 'Tempvoc cmd', timestamp: false }
      ),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _resolveVoiceChannel(guild, query) {
  const ch = await _resolveChannel(guild, query);
  return ch?.type === ChannelType.GuildVoice ? ch : null;
}

async function _resolveCategory(guild, query) {
  const ch = await _resolveChannel(guild, query);
  return ch?.type === ChannelType.GuildCategory ? ch : null;
}

async function _resolveTextChannel(guild, query) {
  const ch = await _resolveChannel(guild, query);
  return ch?.type === ChannelType.GuildText ? ch : null;
}

function _buildInfoEmbed(guild, state) {
  const joinMention = state.joinChannelId ? `<#${state.joinChannelId}>` : '`·`';
  const desc =
    `Crée ton propre vocal temporaire en rejoignant le salon **·** ${joinMention}\n` +
    `*Une fois dedans, utilise les commandes ci-dessous pour gérer ton salon.*\n\n` +
    `*__Commandes utiles :__*\n` +
    `> \`+voc lock\` - fermer l'accès au vocal\n` +
    `> \`+voc unlock\` - rouvrir l'accès\n` +
    `> \`+voc hide\` - cacher le vocal\n` +
    `> \`+voc unhide\` - afficher le vocal\n` +
    `> \`+voc limit <0-99>\` - changer la limite\n` +
    `> \`+voc name <nom>\` - renommer le vocal\n` +
    `> \`+voc claim\` - récupérer le vocal si le propriétaire est absent\n\n` +
    `*__Gestion des membres :__*\n` +
    `> \`+voc permit <membre>\` - autoriser un membre\n` +
    `> \`+voc reject <membre>\` - refuser un membre\n` +
    `> \`+voc kick <membre>\` - expulser un membre\n` +
    `> \`+voc owner <membre>\` - transférer le vocal`;

  return new EmbedBuilder()
    .setTitle('Vocaux temporaires')
    .setDescription(desc)
    .setFooter({ text: 'Le vocal est supprimé automatiquement quand il est vide.' })
    .setColor(state.baseColor || '#2f3136');
}

async function _sendOrUpdateInfoEmbed(client, guild, state) {
  const guildId = guild.id;

  const channel = guild.channels.cache.get(state.embedChannelId)
    ?? await guild.channels.fetch(state.embedChannelId).catch(() => null);

  if (!channel) {
    state.embedChannelId = null;
    state.embedMessageId = null;
    db.setTempvocConfig(guildId, 'embedChannelId', null);
    db.setTempvocConfig(guildId, 'embedMessageId', null);
    return null;
  }

  const infoEmbed = _buildInfoEmbed(guild, state);

  if (state.embedMessageId) {
    const existing = await channel.messages.fetch(state.embedMessageId).catch(() => null);
    if (existing) {
      await existing.edit({ embeds: [infoEmbed], allowedMentions: { parse: [] } }).catch(() => {});
      return existing;
    }
  }

  const sent = await channel.send({ embeds: [infoEmbed], allowedMentions: { parse: [] } }).catch(() => null);
  if (sent) {
    state.embedMessageId = sent.id;
    db.setTempvocConfig(guildId, 'embedMessageId', sent.id);
  }
  return sent;
}

async function _deleteInfoEmbed(client, state) {
  if (!state.embedChannelId || !state.embedMessageId) return;

  for (const [, guild] of client.guilds.cache) {
    const channel = guild.channels.cache.get(state.embedChannelId);
    if (!channel) continue;
    const msg = await channel.messages.fetch(state.embedMessageId).catch(() => null);
    if (msg) await msg.delete().catch(() => {});
    break;
  }
}

async function _resolveChannel(guild, query) {
  if (!query) return null;
  const raw = String(query).trim();
  const mention = raw.match(/^<#(\d{17,20})>$/);
  const id = mention?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);

  if (id) {
    return guild.channels.cache.get(id)
      ?? await guild.channels.fetch(id).catch(() => null);
  }

  const normalized = _normalizeName(raw);
  return guild.channels.cache.find(ch =>
    _normalizeName(ch.name) === normalized
  ) ?? null;
}

function _buildModal(customId, title, inputs) {
  const modal = new ModalBuilder()
    .setCustomId(customId.slice(0, 100))
    .setTitle(title.slice(0, 45));
  modal.addComponents(inputs.map(i => new ActionRowBuilder().addComponents(i)));
  return modal;
}

function _input(customId, label, style, options = {}) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 45))
    .setStyle(style)
    .setRequired(Boolean(options.required));

  if (options.value)       input.setValue(String(options.value).slice(0, options.maxLength || 4000));
  if (options.placeholder) input.setPlaceholder(options.placeholder.slice(0, 100));
  if (options.maxLength)   input.setMaxLength(options.maxLength);

  return input;
}

async function _awaitOwnModal(interaction, customId) {
  try {
    return await interaction.awaitModalSubmit({
      filter: i => i.customId === customId && i.user.id === interaction.user.id,
      time: 120_000,
    });
  } catch { return null; }
}

async function _ephemeral(interaction, guildId, content) {
  return interaction.reply({
    embeds: [embed.build(guildId, content, { color: '#ED4245', timestamp: false })],
    flags: 64,
  }).catch(() => {});
}

async function _modalError(submit, guildId, content) {
  return submit.reply({
    embeds: [embed.build(guildId, content, { color: '#ED4245', timestamp: false })],
    flags: 64,
  }).catch(() => {});
}

function _safeColor(color) {
  if (typeof color === 'string' && /^#?[0-9a-f]{6}$/i.test(color)) {
    return color.startsWith('#') ? color : `#${color}`;
  }
  return '#2f3136';
}

function _normalizeName(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/^#/, '').trim();
}

function _truncate(value, max) {
  const text = String(value || '');
  const cut  = text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
  return embed.breakLongTokens(cut);
}
