'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db           = require('../../core/database');
const embed        = require('../../utils/embed');
const TIMEOUTS     = require('../../utils/interactionTimeouts');
const perms        = require('../../utils/permissions');
const errorHandler = require('../../utils/errorHandler');
const { replaceVariables } = require('../../utils/variables');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? null;
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder   === 'function' &&
  typeof TextDisplayBuilder === 'function' &&
  typeof SeparatorBuilder   === 'function'
);

function _hexToInt(hex) {
  if (typeof hex !== 'string') return 0x2F3136;
  const m = hex.replace(/^#/, '').match(/^[0-9a-fA-F]{6}$/);
  return m ? parseInt(m[0], 16) : 0x2F3136;
}

const COMPONENT_TYPES = ['select', 'button', 'reaction'];
const MENU_MODES      = ['toggle', 'add', 'remove', 'sync'];
const BUTTON_STYLES   = ['Secondary', 'Primary', 'Success', 'Danger'];
const FEEDBACK_MODES  = ['embed', 'message', 'none'];
const ROLE_SPACINGS   = ['compact', 'normal', 'large'];

module.exports = {
  help: {
    name        : 'rolemenu',
    description : 'Crée ou modifie un menu de rôles.',
    use         : 'rolemenu [ID | list | clean]',
    usage       : 'rolemenu [ID | list | clean]',
    aliases     : ['rolesmenu', 'reactionrole', 'reactionroles'],
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

    const menuIdArg = args[0]?.trim();

    if (menuIdArg === 'clean' || menuIdArg === 'cleanup') {
      return _handleClean(message, guildId, deleteReply, deleteDelay);
    }

    if (menuIdArg === 'clearall' || menuIdArg === 'deleteall') {
      return _handleClearAll(message, guildId, deleteReply, deleteDelay);
    }

    if (menuIdArg === 'clear' && args[1]?.trim()?.toLowerCase() === 'all') {
      return _handleClearAll(message, guildId, deleteReply, deleteDelay);
    }

    if (menuIdArg === 'list' || menuIdArg === 'liste') {
      return _handleList(client, message, guildId, deleteReply, deleteDelay);
    }

    const { menu, isNew } = await _loadOrCreateMenu(message, menuIdArg, config);

    if (!menu) {
      const sent = await embed.replyError(
        message,
        'Menu introuvable ou invalide.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const state = _stateFromMenu(menu, config);
    state.options = db.getRoleMenuOptions(state.id);
    state._isNew  = isNew;
    state._edited = false;

    const panel = await message.channel.send(
      _buildPanelPayload(guildId, state)
    ).catch(() => null);

    if (!panel) {
      return embed.replyError(
        message,
        'Impossible d\'ouvrir le panel rolemenu.',
        { timestamp: false }
      ).catch(() => {});
    }

    embed.registerPrivateInteraction(panel, message.author.id, 3_600_000);

    let busy = false;
    let edited = false;

    const collector = panel.createMessageComponentCollector({
      filter : interaction =>
        interaction.user.id === message.author.id &&
        interaction.message.id === panel.id,
      idle   : 3_600_000,
      time   : 3_600_000,
    });

    collector.on('collect', async interaction => {
      let id = interaction.customId;


      if (id === 'local:rolemenu:confirm_delete' || id === 'local:rolemenu:cancel_delete') return;

      if (interaction.isStringSelectMenu()) {
        const val = interaction.values?.[0];
        if (id === 'local:rolemenu:sel_options') {
          id = val === 'add' ? 'local:rolemenu:add' : val === 'remove' ? 'local:rolemenu:remove' : null;
        } else if (id === 'local:rolemenu:sel_params') {
          const paramMap = {
            channel: 'local:rolemenu:channel', message: 'local:rolemenu:message',
            type: 'local:rolemenu:type', mode: 'local:rolemenu:mode',
            text: 'local:rolemenu:text', placeholder: 'local:rolemenu:placeholder',
            format: 'local:rolemenu:format', restrict: 'local:rolemenu:restrict',
            style: 'local:rolemenu:style', feedback: 'local:rolemenu:feedback',
          };
          id = paramMap[val] || null;
        }
        if (!id) {
          return interaction.deferUpdate().catch(() => {});
        }
      }

      if (busy) {
        return _ephemeral(interaction, guildId, 'Une modification est déjà en cours.');
      }

      if (id === 'local:rolemenu:close') {
        collector.stop('closed');
        embed.clearPrivateInteraction(panel);
        await interaction.deferUpdate().catch(() => {});
        await panel.delete().catch(() => {});
        await message.delete().catch(() => {});
        return;
      }

      if (id === 'local:rolemenu:type') {
        edited = true;
        state._edited = true;
        state.componentType = _nextValue(COMPONENT_TYPES, state.componentType || 'select');
        _saveMenuState(state);

        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state);
      }

      if (id === 'local:rolemenu:mode') {


        await interaction.deferUpdate().catch(() => {});

        const previousMode = state.mode || 'toggle';
        state.mode = _nextValue(MENU_MODES, previousMode);

        try {
          _saveMenuState(state);
          edited = true;
          state._edited = true;
        } catch (err) {
          state.mode = previousMode;
          errorHandler.handle(err, { source: 'rolemenu.modeSwitch', guildId, menuId: state.id });
          await interaction.followUp({
            embeds: [embed.build(guildId,
              'Impossible de changer le mode. Redémarrez le bot pour appliquer les migrations.',
              { color: '#ED4245', timestamp: false })],
            flags: 64,
          }).catch(() => {});
          return _refresh(panel, guildId, state);
        }

        return _refresh(panel, guildId, state);
      }

      if (id === 'local:rolemenu:style') {
        edited = true;
        state._edited = true;
        state.buttonStyle = _nextValue(BUTTON_STYLES, state.buttonStyle || 'Secondary');
        _saveMenuState(state);

        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state);
      }

      if (id === 'local:rolemenu:feedback') {
        edited = true;
        state._edited = true;
        state.feedbackMode = _nextValue(FEEDBACK_MODES, _normalizeFeedback(state.feedbackMode));
        _saveMenuState(state);

        await interaction.deferUpdate().catch(() => {});
        return _refresh(panel, guildId, state);
      }

      if (id === 'local:rolemenu:channel') {
        busy = true;

        const modalId = `local:rm:channel:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(
            modalId,
            'Salon du menu',
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
        if (!submit) return _refresh(panel, guildId, state);

        busy = true;

        const value = submit.fields.getTextInputValue('channel').trim();
        const channel = await _resolveTextChannel(guild, value);

        if (!channel) {
          await _modalError(submit, guildId, 'Salon introuvable ou invalide.');
          busy = false;
          return _refresh(panel, guildId, state);
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
          return _refresh(panel, guildId, state);
        }

        edited = true;
        state._edited = true;
        state.channelId = channel.id;
        _saveMenuState(state);

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state);
      }

      if (id === 'local:rolemenu:message') {
        busy = true;

        const modalId = `local:rm:message:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(
            modalId,
            'Message existant',
            [
              _input(
                'messageId',
                'ID du message',
                TextInputStyle.Short,
                {
                  value       : state.messageId || '',
                  required    : false,
                  maxLength   : 25,
                  placeholder : 'ID du message ou vide pour reset',
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
        if (!submit) return _refresh(panel, guildId, state);

        busy = true;

        const value = submit.fields.getTextInputValue('messageId').trim();

        if (!value || value.toLowerCase() === 'reset') {
          edited = true;
          state._edited = true;
          state.messageId = null;
          db.clearRoleMenuMessage(state.id);
          _saveMenuState(state);

          await submit.deferUpdate().catch(() => {});
          busy = false;
          return _refresh(panel, guildId, state);
        }

        if (!/^\d{17,20}$/.test(value)) {
          await _modalError(submit, guildId, 'ID de message invalide.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        if (!state.channelId) {
          await _modalError(submit, guildId, 'Configurez d\'abord le salon du message.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        const channel = guild.channels.cache.get(state.channelId)
          ?? await guild.channels.fetch(state.channelId).catch(() => null);

        if (!channel?.isTextBased()) {
          await _modalError(submit, guildId, 'Salon configuré introuvable.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        const targetMessage = await channel.messages.fetch(value).catch(() => null);

        if (!targetMessage) {
          await _modalError(submit, guildId, 'Message introuvable dans ce salon.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        edited = true;
        state._edited = true;
        state.messageId = targetMessage.id;
        _saveMenuState(state);

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state);
      }

      if (id === 'local:rolemenu:text') {
        busy = true;

        const modalId = `local:rm:text:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(
            modalId,
            'Texte du menu',
            [
              _input(
                'title',
                'Titre',
                TextInputStyle.Short,
                {
                  value       : state.title || '',
                  required    : false,
                  maxLength   : 256,
                  placeholder : 'Vide = aucun titre',
                }
              ),
              _input(
                'description',
                'Description',
                TextInputStyle.Paragraph,
                {
                  value       : state.description || '',
                  required    : true,
                  maxLength   : 4000,
                  placeholder : 'Sélectionnez les rôles que vous souhaitez obtenir.',
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
        if (!submit) return _refresh(panel, guildId, state);

        busy = true;

        const title = submit.fields.getTextInputValue('title').trim();
        const description = submit.fields.getTextInputValue('description').trim();

        if (!description) {
          await _modalError(submit, guildId, 'La description est obligatoire.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        edited = true;
        state._edited = true;
        state.title = title || '';
        state.description = description;

        _saveMenuState(state);

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state);
      }

      if (id === 'local:rolemenu:placeholder') {
        busy = true;

        const modalId = `local:rm:placeholder:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(
            modalId,
            'Placeholder du select',
            [
              _input(
                'placeholder',
                'Placeholder',
                TextInputStyle.Short,
                {
                  value       : state.placeholder || '',
                  required    : true,
                  maxLength   : 100,
                  placeholder : 'Choisir un rôle',
                }
              ),
              _input(
                'maxValues',
                'Nombre max de choix',
                TextInputStyle.Short,
                {
                  value       : String(state.maxValues || 1),
                  required    : true,
                  maxLength   : 2,
                  placeholder : '1 à 25',
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
        if (!submit) return _refresh(panel, guildId, state);

        busy = true;

        const placeholder = submit.fields.getTextInputValue('placeholder').trim();
        const maxValuesRaw = submit.fields.getTextInputValue('maxValues').trim();
        const maxValues = Number(maxValuesRaw);

        if (!placeholder) {
          await _modalError(submit, guildId, 'Le placeholder ne peut pas être vide.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        if (!Number.isInteger(maxValues) || maxValues < 1 || maxValues > 25) {
          await _modalError(submit, guildId, 'Le nombre max doit être entre 1 et 25.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        edited = true;
        state._edited = true;
        state.placeholder = placeholder;
        state.maxValues = maxValues;

        _saveMenuState(state);

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state);
      }

      if (id === 'local:rolemenu:format') {
        busy = true;

        const modalId = `local:rm:format:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(
            modalId,
            'Format des rôles',
            [
              _input(
                'separator',
                'Séparateur',
                TextInputStyle.Short,
                {
                  value       : state.roleSeparator || '・',
                  required    : true,
                  maxLength   : 10,
                  placeholder : '・ ou ︲ ou •',
                }
              ),
              _input(
                'spacing',
                'Espacement',
                TextInputStyle.Short,
                {
                  value       : state.roleSpacing || 'normal',
                  required    : true,
                  maxLength   : 10,
                  placeholder : 'compact, normal ou large',
                }
              ),
              _input(
                'format',
                'Format de ligne',
                TextInputStyle.Short,
                {
                  value       : state.roleFormat || '{emoji} {separator} {role}',
                  required    : true,
                  maxLength   : 200,
                  placeholder : '{emoji} {separator} {role}',
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
        if (!submit) return _refresh(panel, guildId, state);

        busy = true;

        const separator = submit.fields.getTextInputValue('separator').trim();
        const spacing = submit.fields.getTextInputValue('spacing').trim().toLowerCase();
        const format = submit.fields.getTextInputValue('format').trim();

        if (!separator) {
          await _modalError(submit, guildId, 'Le séparateur ne peut pas être vide.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        if (!ROLE_SPACINGS.includes(spacing)) {
          await _modalError(submit, guildId, 'Espacement invalide. Utilisez compact, normal ou large.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        if (!_isValidRoleFormat(format)) {
          await _modalError(
            submit,
            guildId,
            'Format invalide. Variables autorisées : {emoji}, {separator}, {role}, {label}, {description}.'
          );
          busy = false;
          return _refresh(panel, guildId, state);
        }

        edited = true;
        state._edited = true;
        state.roleSeparator = separator;
        state.roleSpacing = spacing;
        state.roleFormat = format;

        _saveMenuState(state);

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state);
      }

      if (id === 'local:rolemenu:add') {
        busy = true;

        const modalId = `local:rm:add:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(
            modalId,
            'Ajouter un rôle',
            [
              _input(
                'role',
                'Rôle',
                TextInputStyle.Short,
                {
                  required    : true,
                  maxLength   : 100,
                  placeholder : '@rôle, ID ou nom',
                }
              ),
              _input(
                'label',
                'Texte',
                TextInputStyle.Short,
                {
                  required    : false,
                  maxLength   : 100,
                  placeholder : 'Nom affiché',
                }
              ),
              _input(
                'description',
                'Description',
                TextInputStyle.Short,
                {
                  required    : false,
                  maxLength   : 100,
                  placeholder : 'Description optionnelle',
                }
              ),
              _input(
                'emoji',
                'Emoji',
                TextInputStyle.Short,
                {
                  required    : false,
                  maxLength   : 100,
                  placeholder : 'Emoji optionnel',
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
        if (!submit) return _refresh(panel, guildId, state);

        busy = true;

        const roleQuery = submit.fields.getTextInputValue('role').trim();
        const labelRaw = submit.fields.getTextInputValue('label').trim();
        const descriptionRaw = submit.fields.getTextInputValue('description').trim();
        const emojiRaw = submit.fields.getTextInputValue('emoji').trim();

        const role = await _resolveRole(guild, roleQuery);

        if (!role) {
          await _modalError(submit, guildId, 'Rôle introuvable.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        const roleError = await _validateRole(guild, role);

        if (roleError) {
          await _modalError(submit, guildId, roleError);
          busy = false;
          return _refresh(panel, guildId, state);
        }

        if (state.options.length >= 25) {
          await _modalError(submit, guildId, 'Un menu ne peut pas contenir plus de 25 rôles.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        const label = labelRaw || role.name;
        const description = descriptionRaw || null;
        const emoji = emojiRaw || null;

        edited = true;
        state._edited = true;
        db.addRoleMenuOption(state.id, role.id, {
          label,
          description,
          emoji,
        });

        state.options = db.getRoleMenuOptions(state.id);

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state);
      }

      if (id === 'local:rolemenu:remove') {
        busy = true;

        const modalId = `local:rm:remove:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(
            modalId,
            'Retirer un rôle',
            [
              _input(
                'role',
                'Rôle à retirer',
                TextInputStyle.Short,
                {
                  required    : true,
                  maxLength   : 100,
                  placeholder : '@rôle, ID ou nom',
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
        if (!submit) return _refresh(panel, guildId, state);

        busy = true;

        const roleQuery = submit.fields.getTextInputValue('role').trim();
        const role = await _resolveRole(guild, roleQuery);

        if (!role) {
          await _modalError(submit, guildId, 'Rôle introuvable.');
          busy = false;
          return _refresh(panel, guildId, state);
        }

        edited = true;
        state._edited = true;
        db.removeRoleMenuOption(state.id, role.id);
        state.options = db.getRoleMenuOptions(state.id);

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state);
      }

      if (id === 'local:rolemenu:send') {
        if (busy) {
          return _ephemeral(interaction, guildId, 'Une modification est déjà en cours.');
        }

        edited = true;
        state._edited = true;
        busy = true;

        await interaction.deferUpdate().catch(() => {});

        try {
          await _sendOrUpdateMenu(client, message, panel, state, deleteReply, deleteDelay);
        } catch (err) {
          errorHandler.handle(err, {
            source : 'rolemenu.send',
            guildId,
            userId : message.author.id,
          });

          await _sendError(
            message,
            'Impossible d\'envoyer ou de mettre à jour le menu.',
            deleteReply,
            deleteDelay
          );
        } finally {
          busy = false;
          await _refresh(panel, guildId, state).catch(() => {});
        }

        return;
      }

      if (id === 'local:rolemenu:restrict') {
        busy = true;

        const modalId = `local:rm:restrict:${interaction.id}`;
        const shown = await interaction.showModal(
          _buildModal(
            modalId,
            'Restrictions du menu',
            [
              _input(
                'required',
                'Rôles requis (max 4)',
                TextInputStyle.Short,
                {
                  value       : state.requiredRoleIds.map(id => id).join(', '),
                  required    : false,
                  maxLength   : 400,
                  placeholder : '@role, ID ou nom exact, separes par ,',
                }
              ),
              _input(
                'forbidden',
                'Rôles interdits (max 4)',
                TextInputStyle.Short,
                {
                  value       : state.forbiddenRoleIds.map(id => id).join(', '),
                  required    : false,
                  maxLength   : 400,
                  placeholder : '@role, ID ou nom exact, separes par ,',
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
        if (!submit) return _refresh(panel, guildId, state);

        busy = true;

        const requiredRaw  = submit.fields.getTextInputValue('required').trim();
        const forbiddenRaw = submit.fields.getTextInputValue('forbidden').trim();

        const requiredResult  = await _parseRoleList(guild, requiredRaw, 4);
        const forbiddenResult = await _parseRoleList(guild, forbiddenRaw, 4);

        if (requiredResult.error) {
          await _modalError(submit, guildId, `Roles requis : ${requiredResult.error}`);
          busy = false;
          return _refresh(panel, guildId, state);
        }

        if (forbiddenResult.error) {
          await _modalError(submit, guildId, `Roles interdits : ${forbiddenResult.error}`);
          busy = false;
          return _refresh(panel, guildId, state);
        }

        edited = true;
        state._edited = true;
        state.requiredRoleIds  = requiredResult.ids;
        state.forbiddenRoleIds = forbiddenResult.ids;

        db.updateRoleMenuRestrictions(
          state.id,
          state.requiredRoleIds.length ? state.requiredRoleIds : null,
          state.forbiddenRoleIds.length ? state.forbiddenRoleIds : null
        );

        await submit.deferUpdate().catch(() => {});
        busy = false;
        return _refresh(panel, guildId, state);
      }

      if (id === 'local:rolemenu:delete') {
        busy = true;

        const chan  = state.channelId ? `<#${state.channelId}>` : '`Non defini`';
        const msg   = state.messageId ? 'Oui' : 'Non';
        const count = state.options?.length ?? 0;

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('local:rolemenu:confirm_delete')
            .setLabel('Confirmer')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('local:rolemenu:cancel_delete')
            .setLabel('Annuler')
            .setStyle(ButtonStyle.Secondary),
        );

        let confirmPayload;
        if (V2_AVAILABLE) {
          try {
            const c = new ContainerBuilder().setAccentColor(0xED4245);
            c.addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                `## Supprimer ce rolemenu ?\n${_truncate(state.title, 60) || 'Sans titre'} - Salon : ${chan} - Options : ${count}\n\nCette action est irreversible.`
              ),
            );
            c.addActionRowComponents(confirmRow);
            confirmPayload = { flags: COMPONENTS_V2_FLAG, embeds: [], components: [c] };
          } catch {}
        }
        if (!confirmPayload) {
          const confirmEmbed = embed.build(guildId, [
            `**${_truncate(state.title, 60)}**`,
            `Salon : ${chan}`,
            `Message publie : ${msg}`,
            `Options : \`${count}\``,
            '',
            'Cette action est irreversible.',
          ].join('\n'), { title: 'Supprimer ce rolemenu ?', color: '#ED4245', timestamp: false });
          confirmPayload = { embeds: [confirmEmbed], components: [confirmRow] };
        }

        await interaction.update(confirmPayload).catch(() => {});

        let confirmInteraction;
        try {
          confirmInteraction = await panel.awaitMessageComponent({
            filter : i => i.user.id === message.author.id &&
              (i.customId === 'local:rolemenu:confirm_delete' || i.customId === 'local:rolemenu:cancel_delete'),
            time : TIMEOUTS.CONFIRM_TIME_MS,
          });
        } catch {
          confirmInteraction = null;
        }

        if (!confirmInteraction || confirmInteraction.customId === 'local:rolemenu:cancel_delete') {
          busy = false;
          if (confirmInteraction) await confirmInteraction.deferUpdate().catch(() => {});
          return _refresh(panel, guildId, state);
        }

        edited = true;
        state._edited = true;

        await confirmInteraction.deferUpdate().catch(() => {});
        await _deletePublishedMenu(guild, state).catch(() => {});

        db.clearRoleMenuOptions(state.id);
        db.deleteRoleMenu(state.id);

        collector.stop('deleted');
        embed.clearPrivateInteraction(panel);
        await panel.delete().catch(() => {});

        const sent = await embed.reply(
          message,
          'Menu de rôles supprimé.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }

        busy = false;
        return;
      }

      await interaction.deferUpdate().catch(() => {});
    });

    collector.on('end', async (_, reason) => {
       embed.clearPrivateInteraction(panel);

      if (isNew && !edited) {
        db.deleteRoleMenu(state.id);
      }

      if (reason === 'closed' || reason === 'deleted') return;

      await panel.edit({
        components: [],
        content   : '-# Session expirée, relance la commande pour reprendre.',
      }).catch(() => {});
    });
  },
};

async function _loadOrCreateMenu(message, menuIdArg, config) {
  const guildId = message.guild.id;

  if (menuIdArg && /^\d+$/.test(menuIdArg)) {
    const num = Number(menuIdArg);


    const allMenus = db.getRoleMenus(guildId);
    if (num >= 1 && num <= allMenus.length) {
      return { menu: allMenus[num - 1], isNew: false };
    }


    if (/^\d{17,20}$/.test(menuIdArg)) {
      const byMsg = db.getRoleMenuByMessageId(menuIdArg);
      if (byMsg && byMsg.guildId === guildId) {
        return { menu: byMsg, isNew: false };
      }
    }

    const existing = db.getRoleMenu(num);
    if (existing && existing.guildId === guildId) {
      return { menu: existing, isNew: false };
    }

    return { menu: null, isNew: false };
  }

  const menuId = db.createRoleMenu(
    guildId,
    null,
    message.author.id,
    {
      title         : 'Menu de rôles',
      description   : 'Sélectionnez les rôles que vous souhaitez obtenir.',
      placeholder   : 'Choisir un rôle',
      mode          : 'toggle',
      minValues     : 0,
      maxValues     : 1,
      componentType : 'select',
      buttonStyle   : 'Secondary',
      roleSpacing   : 'normal',
      roleSeparator : '・',
      roleFormat    : '{emoji} {separator} {role}',
    }
  );

  const menu = db.getRoleMenu(menuId);

  if (menu && !menu.componentType) {
    db.updateRoleMenu(menuId, {
      componentType: 'select',
      buttonStyle  : 'Secondary',
    });

    return { menu: db.getRoleMenu(menuId), isNew: true };
  }

  return { menu, isNew: true };
}

function _stateFromMenu(menu, config) {
  return {
    id            : menu.id,
    guildId       : menu.guildId,
    channelId     : menu.channelId || null,
    messageId     : menu.messageId || null,
    title         : menu.title ?? 'Menu de rôles',
    description   : menu.description || 'Sélectionnez les rôles que vous souhaitez obtenir.',
    placeholder   : menu.placeholder || 'Choisir un rôle',
    mode          : menu.mode || 'toggle',
    minValues     : Number(menu.minValues) || 0,
    maxValues     : Number(menu.maxValues) || 1,
    componentType : menu.componentType || menu.panelType || 'select',
    buttonStyle   : menu.buttonStyle || 'Secondary',
    roleSpacing   : menu.roleSpacing || 'normal',
    roleSeparator : menu.roleSeparator || '・',
    roleFormat       : menu.roleFormat || '{emoji} {separator} {role}',
    feedbackMode     : _normalizeFeedback(menu.feedbackMode),
    requiredRoleIds  : _parseJsonArray(menu.requiredRoleIds),
    forbiddenRoleIds : _parseJsonArray(menu.forbiddenRoleIds),
    baseColor        : _safeColor(config?.color || '#2f3136'),
    options          : [],
  };
}

function _saveMenuState(state) {
  db.updateRoleMenu(state.id, {
    channelId     : state.channelId,
    messageId     : state.messageId,
    title         : state.title,
    description   : state.description,
    placeholder   : state.placeholder,
    mode          : state.mode,
    minValues     : state.minValues,
    maxValues     : state.maxValues,
    componentType : state.componentType,
    buttonStyle   : state.buttonStyle,
    roleSpacing   : state.roleSpacing,
    roleSeparator : state.roleSeparator,
    roleFormat    : state.roleFormat,
    feedbackMode  : state.feedbackMode,
  });
}

function _buildPanelPayload(guildId, state) {
  const isNew  = state._isNew && !state._edited;
  const statut = isNew ? 'Brouillon' : (state.messageId ? 'Publie' : 'Brouillon');
  const chan    = state.channelId ? `<#${state.channelId}>` : 'Non configure';
  const msg     = state.messageId ? 'Configure' : 'Non envoye';

  const summary =
    `> Statut : ${statut}\n` +
    `> Salon : ${chan}\n` +
    `> Message : ${msg}\n` +
    `> Type : ${state.componentType} - Mode : ${state.mode} - Style : ${state.buttonStyle || 'Secondary'}\n` +
    `> Feedback : ${_feedbackLabel(state.feedbackMode)}`;

  const restrictions = [];
  if (state.requiredRoleIds.length)  restrictions.push(`Requis : ${_formatRoleIdList(state.requiredRoleIds)}`);
  if (state.forbiddenRoleIds.length) restrictions.push(`Interdits : ${_formatRoleIdList(state.forbiddenRoleIds)}`);

  const optLines = state.options.length
    ? state.options.slice(0, 15).map((o, i) => {
        const em = o.emoji ? `${o.emoji} ` : '';
        return `> ${i + 1}. ${em}<@&${o.roleId}> - ${_truncate(o.label, 60)}`;
      }).join('\n') +
      (state.options.length > 15 ? `\n> ...et ${state.options.length - 15} autre(s).` : '')
    : '> Aucune option configuree';

  if (V2_AVAILABLE) {
    try {
      const accent    = _hexToInt(state.baseColor);
      const container = new ContainerBuilder().setAccentColor(accent);

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## Rolemenu'),
      );
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(summary),
      );
      container.addSeparatorComponents(new SeparatorBuilder());

      const optHeader = `**Options (${state.options.length})**`;
      const optBody   = restrictions.length
        ? `${optHeader}\n${optLines}\n\n**Restrictions**\n${restrictions.join('\n')}`
        : `${optHeader}\n${optLines}`;

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(optBody),
      );

      for (const row of _buildRows(false, state.options.length, state.messageId)) {
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


  const configBlock =
    `Statut : \`${statut}\`\n` +
    `Salon : ${state.channelId ? `<#${state.channelId}>` : '`Non configure`'}\n` +
    `Message : \`${msg}\`\n` +
    `Type : \`${state.componentType}\` - Mode : \`${state.mode}\` - Style : \`${state.buttonStyle || 'Secondary'}\`\n` +
    `Feedback : \`${_feedbackLabel(state.feedbackMode)}\``;

  const legacyOpts = state.options.length
    ? state.options.slice(0, 15).map((o, i) => {
        const em = o.emoji ? `${o.emoji} ` : '';
        return `\`${i + 1}.\` ${em}<@&${o.roleId}> - ${_truncate(o.label, 60)}`;
      }).join('\n') +
      (state.options.length > 15 ? `\n...et \`${state.options.length - 15}\` autre(s).` : '')
    : '`Aucune option configuree`';

  const eb = new EmbedBuilder()
    .setTitle('Rolemenu')
    .setColor(state.baseColor)
    .setDescription(configBlock);

  if (restrictions.length) {
    eb.addFields({ name: 'Restrictions', value: restrictions.join('\n'), inline: false });
  }
  eb.addFields({ name: `Options (${state.options.length})`, value: legacyOpts, inline: false });

  return {
    embeds          : [eb],
    components      : _buildRows(false, state.options.length, state.messageId),
    allowedMentions : { parse: [] },
  };
}

function _buildRows(disabled = false, optionCount = 0, messageId = null) {
  const rows = [];


  if (optionCount === 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:rolemenu:add')
        .setLabel('Ajouter une option')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
    ));
  } else if (optionCount === 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:rolemenu:add')
        .setLabel('Ajouter une option')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('local:rolemenu:remove')
        .setLabel("Retirer l'option")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    ));
  } else {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('local:rolemenu:sel_options')
        .setPlaceholder('Options de roles...')
        .setDisabled(disabled)
        .addOptions([
          { label: 'Ajouter une option', value: 'add',    description: 'Ajouter un role au menu',  emoji: '➕' },
          { label: 'Retirer une option', value: 'remove', description: 'Retirer un role du menu',  emoji: '➖' },
        ]),
    ));
  }


  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('local:rolemenu:sel_params')
      .setPlaceholder('Parametres du rolemenu...')
      .setDisabled(disabled)
      .addOptions([
        { label: 'Salon',        value: 'channel',     description: 'Salon du menu',                           emoji: '📢' },
        { label: 'Message',      value: 'message',     description: 'ID du message existant',                  emoji: '💬' },
        { label: 'Type',         value: 'type',        description: 'button / select / reaction',              emoji: '🔀' },
        { label: 'Mode',         value: 'mode',        description: 'toggle / add / remove / sync',             emoji: '🔄' },
        { label: 'Texte',        value: 'text',        description: 'Titre et description',                    emoji: '✏️' },
        { label: 'Selecteur',    value: 'placeholder', description: 'Placeholder et choix max',                emoji: '📋' },
        { label: 'Format',       value: 'format',      description: 'Separateur, espacement, format',          emoji: '🎨' },
        { label: 'Restrictions', value: 'restrict',    description: 'Rôles requis / interdits',                emoji: '🔒' },
        { label: 'Style bouton', value: 'style',       description: 'Primary / Secondary / Success / Danger',  emoji: '🏛️' },
        { label: 'Feedback',     value: 'feedback',    description: 'Embed / message / aucun',                 emoji: '📣' },
      ]),
  ));


  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:rolemenu:send')
      .setLabel(messageId ? 'Mettre a jour' : 'Publier')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:rolemenu:delete')
      .setLabel('Supprimer')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:rolemenu:close')
      .setLabel('Fermer')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  ));

  return rows;
}

async function _sendOrUpdateMenu(client, message, panel, state, deleteReply, deleteDelay) {
  const guild = message.guild;
  const guildId = guild.id;

  if (!state.channelId) {
    return _sendError(message, 'Configurez d\'abord le salon du menu.', deleteReply, deleteDelay);
  }

  if (!state.options.length) {
    return _sendError(message, 'Ajoutez au moins un rôle au menu.', deleteReply, deleteDelay);
  }

  if (state.options.length > 25) {
    return _sendError(message, 'Un menu ne peut pas contenir plus de 25 rôles.', deleteReply, deleteDelay);
  }

  if (state.componentType === 'reaction') {
    const missingEmoji = state.options.find(option => !option.emoji);

    if (missingEmoji) {
      return _sendError(
        message,
        'En mode reaction, chaque rôle doit avoir un emoji.',
        deleteReply,
        deleteDelay
      );
    }
  }

  const channel = guild.channels.cache.get(state.channelId)
    ?? await guild.channels.fetch(state.channelId).catch(() => null);

  if (!channel?.isTextBased()) {
    return _sendError(message, 'Salon configuré introuvable ou invalide.', deleteReply, deleteDelay);
  }

  const me = guild.members.me
    ?? await guild.members.fetchMe().catch(() => null);

  const botPerms = me ? channel.permissionsFor(me) : null;

  if (
    !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
    !botPerms?.has(PermissionsBitField.Flags.SendMessages)
  ) {
    return _sendError(message, 'Je n\'ai pas les permissions nécessaires dans ce salon.', deleteReply, deleteDelay);
  }

  if (
    state.componentType === 'reaction' &&
    !botPerms?.has(PermissionsBitField.Flags.AddReactions)
  ) {
    return _sendError(
      message,
      'Je n\'ai pas la permission d\'ajouter des réactions dans ce salon.',
      deleteReply,
      deleteDelay
    );
  }

  const payload = _buildPublicPayload(guildId, state, guild);

  let targetMessage = null;
  let updated = false;

  if (state.messageId) {
    targetMessage = await channel.messages.fetch(state.messageId).catch(() => null);
  }

  if (targetMessage) {
    const isBotMessage = targetMessage.author?.id === client.user.id;

    if (state.componentType === 'reaction' && !isBotMessage) {
      updated = true;
    } else {
      if (!isBotMessage) {
        return _sendError(
          message,
          'Je ne peux ajouter des boutons ou selects que sur mes propres messages. Pour un message externe, utilisez le type reaction.',
          deleteReply,
          deleteDelay
        );
      }


      const editPayload = { components: payload.components };

      const edited = await targetMessage.edit(editPayload)
        .then(msg => msg)
        .catch(() => null);

      if (!edited) {
        return _sendError(message, 'Impossible de mettre à jour le menu de rôles.', deleteReply, deleteDelay);
      }

      targetMessage = edited;
      updated = true;
    }
  } else {
    targetMessage = await channel.send(payload).catch(() => null);
    updated = false;
  }

  if (!targetMessage) {
    return _sendError(message, 'Impossible d\'envoyer le menu de rôles.', deleteReply, deleteDelay);
  }

  state.messageId = targetMessage.id;
  _saveMenuState(state);

  await _syncReactionMode(message, targetMessage, state);

  await _refresh(panel, guildId, state);

  const sent = await embed.reply(
    message,
    `Menu de rôles ${updated ? 'mis à jour' : 'envoyé'} dans ${channel}.`,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

function _buildPublicPayload(guildId, state, guild = null) {
  const ctx = guild ? { guild } : {};
  const publicEmbed = new EmbedBuilder()
    .setDescription(replaceVariables(_buildPublicDescription(state), ctx))
    .setColor(state.baseColor);

  if (state.title) {
    publicEmbed.setTitle(replaceVariables(state.title, ctx));
  }

  const components = [];

  if (state.componentType === 'select') {
    if (state.options.length < 2) {

      components.push(..._buildButtonRows(state));
    } else {
      components.push(_buildSelectRow(state));
    }
  }

  if (state.componentType === 'button') {
    components.push(..._buildButtonRows(state));
  }

  return {
    embeds          : [publicEmbed],
    components,
    allowedMentions : { parse: [] },
  };
}

function _buildPublicDescription(state) {
  if (state.componentType !== 'reaction') {
    return state.description;
  }

  const joiner = _spacingJoiner(state.roleSpacing);

  const list = state.options
    .map(option => _formatRoleLine(option, state))
    .join(joiner);

  return `${state.description}\n\n${list}`;
}

function _buildSelectRow(state) {
  const maxValues = Math.min(
    Math.max(Number(state.maxValues) || 1, 1),
    Math.max(state.options.length, 1),
    25
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`rolemenu:select:${state.id}`)
    .setPlaceholder(state.placeholder || 'Choisir un rôle')
    .setMinValues(Number(state.minValues) || 0)
    .setMaxValues(maxValues)
    .addOptions(
      state.options.map(option => {
        const opt = new StringSelectMenuOptionBuilder()
          .setLabel(String(option.label || 'Rôle').slice(0, 100))
          .setValue(option.roleId);

        if (option.description) {
          opt.setDescription(String(option.description).slice(0, 100));
        }

        if (option.emoji) {
          opt.setEmoji(option.emoji);
        }

        return opt;
      })
    );

  return new ActionRowBuilder().addComponents(menu);
}

function _buildButtonRows(state) {
  const style = _buttonStyle(state.buttonStyle);
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (const option of state.options) {
    if (currentRow.components.length >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }

    const button = new ButtonBuilder()
      .setCustomId(`rolemenu:button:${state.id}:${option.roleId}`)
      .setLabel(String(option.label || 'Rôle').slice(0, 80))
      .setStyle(style);

    if (option.emoji) {
      button.setEmoji(option.emoji);
    }

    currentRow.addComponents(button);
  }

  if (currentRow.components.length) {
    rows.push(currentRow);
  }

  return rows.slice(0, 5);
}

async function _syncReactionMode(message, targetMessage, state) {
  const guildId = message.guild.id;

  const oldReactions = db.getRoleReactions(guildId, targetMessage.id);

  for (const old of oldReactions) {
    db.removeRoleReaction(guildId, targetMessage.id, old.emoji);
  }

  await targetMessage.reactions.removeAll().catch(() => {});

  if (state.componentType !== 'reaction') {
    return;
  }

  for (const option of state.options) {
    if (!option.emoji) continue;

    const reacted = await targetMessage.react(option.emoji)
      .then(() => true)
      .catch(() => false);

    if (reacted) {
      db.addRoleReaction(guildId, targetMessage.id, option.emoji, option.roleId);
    }
  }
}

async function _deletePublishedMenu(guild, state) {
  if (!state.channelId || !state.messageId) return;

  const channel = guild.channels.cache.get(state.channelId)
    ?? await guild.channels.fetch(state.channelId).catch(() => null);

  if (!channel?.isTextBased()) return;

  const msg = await channel.messages.fetch(state.messageId).catch(() => null);

  if (msg) {
    await msg.delete().catch(() => {});
  }
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

async function _resolveRole(guild, query) {
  if (!query) return null;

  const mention = String(query).trim().match(/^<@&(\d{17,20})>$/);
  const id = mention?.[1] ?? (/^\d{17,20}$/.test(String(query).trim()) ? String(query).trim() : null);

  if (id) {
    return guild.roles.cache.get(id)
      ?? await guild.roles.fetch(id).catch(() => null);
  }

  const normalized = _normalizeName(query);

  return guild.roles.cache.find(role =>
    _normalizeName(role.name) === normalized
  ) ?? null;
}

async function _validateRole(guild, role) {
  if (!role || role.id === guild.id) {
    return 'Rôle invalide.';
  }

  if (role.managed) {
    return 'Ce rôle est géré par une intégration et ne peut pas être utilisé.';
  }

  const me = guild.members.me
    ?? await guild.members.fetchMe().catch(() => null);

  if (!me) {
    return 'Impossible de vérifier mes permissions.';
  }

  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return 'Je n\'ai pas la permission de gérer les rôles.';
  }

  if (role.position >= me.roles.highest.position) {
    return 'Ce rôle est au-dessus ou au même niveau que mon rôle le plus haut.';
  }

  return null;
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

async function _refresh(panel, guildId, state) {
  state.options = db.getRoleMenuOptions(state.id);

  return panel.edit(_buildPanelPayload(guildId, state)).catch(() => {});
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

function _buttonStyle(style) {
  const normalized = String(style || 'Secondary').toLowerCase();

  if (normalized === 'primary') return ButtonStyle.Primary;
  if (normalized === 'success') return ButtonStyle.Success;
  if (normalized === 'danger') return ButtonStyle.Danger;

  return ButtonStyle.Secondary;
}

function _normalizeFeedback(mode) {
  if (mode === 'message' || mode === 'none') return mode;
  return 'embed';
}

function _feedbackLabel(mode) {
  const m = _normalizeFeedback(mode);
  if (m === 'none') return 'aucun';
  if (m === 'message') return 'message discret';
  return 'embed discret';
}

function _nextValue(values, current) {
  const index = values.indexOf(current);

  if (index === -1) {
    return values[0];
  }

  return values[(index + 1) % values.length];
}

function _safeColor(color) {
  if (typeof color === 'string' && /^#?[0-9a-f]{6}$/i.test(color)) {
    return color.startsWith('#') ? color : `#${color}`;
  }

  return '#2f3136';
}

function _normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^#/, '')
    .trim();
}

function _truncate(value, max) {
  const text = String(value || '');
  const cut  = text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
  return embed.breakLongTokens(cut);
}

function _spacingJoiner(spacing) {
  if (spacing === 'compact') return '\n';
  if (spacing === 'large') return '\n\n\n';
  return '\n\n';
}

function _formatRoleLine(option, state) {
  const emoji = option.emoji || '';
  const separator = state.roleSeparator || '・';
  const role = `<@&${option.roleId}>`;
  const label = option.label || '';
  const description = option.description || '';

  return String(state.roleFormat || '{emoji} {separator} {role}')
    .replace(/{emoji}/gi, emoji)
    .replace(/{separator}/gi, separator)
    .replace(/{role}/gi, role)
    .replace(/{label}/gi, label)
    .replace(/{description}/gi, description)
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function _isValidRoleFormat(format) {
  if (!format || format.length > 200) return false;

  const cleaned = format
    .replace(/{emoji}/gi, '')
    .replace(/{separator}/gi, '')
    .replace(/{role}/gi, '')
    .replace(/{label}/gi, '')
    .replace(/{description}/gi, '');

  return !/{.+?}/.test(cleaned);
}

function _parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function _formatRoleIdList(ids) {
  if (!ids || !ids.length) return '`Aucun`';
  return ids.map(id => `<@&${id}>`).join(', ');
}

async function _parseRoleList(guild, raw, max) {
  if (!raw) return { ids: [], error: null };

  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);

  if (parts.length > max) {
    return { ids: [], error: `Maximum ${max} roles.` };
  }

  const ids = [];

  for (const part of parts) {
    const role = await _resolveRole(guild, part);

    if (!role) {
      return { ids: [], error: `Role introuvable : "${_truncate(part, 40)}".` };
    }

    if (role.id === guild.id) {
      return { ids: [], error: '@everyone ne peut pas etre utilise.' };
    }

    if (ids.includes(role.id)) continue;

    ids.push(role.id);
  }

  return { ids, error: null };
}


const LIST_PER_PAGE = 10;

async function _handleList(client, message, guildId, deleteReply, deleteDelay) {
  const menus = db.getRoleMenus(guildId);

  if (!menus.length) {
    const sent = await embed.reply(
      message,
      'Aucun rolemenu configuré sur ce serveur.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const entries = menus.map((m, idx) => {
    const opts  = db.getRoleMenuOptions(m.id);
    const count = opts?.length ?? 0;
    const chan  = m.channelId ? `<#${m.channelId}>` : '`Non defini`';
    const type  = m.componentType || 'select';
    const mode  = m.mode || 'toggle';

    let status;
    if (m.messageId && m.channelId) {
      status = '\u2714\uFE0F Publi\u00e9';
    } else if (!m.messageId && count > 0) {
      status = 'Brouillon';
    } else if (!m.messageId && count === 0) {
      status = '\u00c0 nettoyer';
    } else {
      status = 'Incomplet';
    }

    return (
      `**${idx + 1}.** ${status}\n` +
      `Salon : ${chan}\n` +
      `Type : \`${type}\` - Mode : \`${mode}\` - Options : \`${count}\``
    );
  });

  const pages = [];
  for (let i = 0; i < entries.length; i += LIST_PER_PAGE) {
    pages.push(entries.slice(i, i + LIST_PER_PAGE).join('\n\n'));
  }

  let page = 0;

  const buildEmbed = () => embed.build(
    guildId,
    pages[page],
    {
      title     : `Rolemenus (${menus.length}) - Page ${page + 1}/${pages.length}`,
      timestamp : false,
    }
  );

  const buildPayload = () => {
    if (V2_AVAILABLE) {
      try {
        const accent    = _hexToInt(embed.getGuildColor(guildId));
        const container = new ContainerBuilder().setAccentColor(accent);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## Rolemenus (${menus.length}) - Page ${page + 1}/${pages.length}`
          ),
        );
        container.addSeparatorComponents(new SeparatorBuilder());
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(pages[page]),
        );
        for (const row of buildRows(false)) {
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
    return {
      embeds          : [buildEmbed()],
      components      : buildRows(false),
      allowedMentions : { parse: [] },
    };
  };

  const buildRows = (disabled) => {
    const rows = [];


    if (menus.length === 1) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('local:rmlist:open')
          .setLabel('Ouvrir')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
      ));
    } else {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('local:rmlist:sel_open')
          .setPlaceholder('Ouvrir un rolemenu...')
          .setDisabled(disabled)
          .addOptions(
            menus.slice(0, 25).map((m, i) => {
              const opts  = db.getRoleMenuOptions(m.id);
              const count = opts?.length ?? 0;
              const lbl   = m.messageId ? 'Publie' : 'Brouillon';
              return {
                label       : `${i + 1}. ${lbl}`,
                value       : String(i + 1),
                description : `${count} option(s)`,
              };
            })
          ),
      ));
    }

    const buttons = [];

    if (pages.length > 1) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId('local:rmlist:prev')
          .setLabel('\u25C0')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page === 0),
        new ButtonBuilder()
          .setCustomId('local:rmlist:next')
          .setLabel('\u25B6')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page >= pages.length - 1),
      );
    }

    buttons.push(
      new ButtonBuilder()
        .setCustomId('local:rmlist:tools')
        .setLabel('Outils')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('local:rmlist:close')
        .setLabel('Fermer')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    );

    rows.push(new ActionRowBuilder().addComponents(buttons));

    return rows;
  };

  const buildToolsPayload = () => {
    const toolsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:rmlist:clean')
        .setLabel('Nettoyer')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:rmlist:drafts')
        .setLabel('Suppr. brouillons')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:rmlist:clearall')
        .setLabel('Tout supprimer')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('local:rmlist:tools_back')
        .setLabel('Retour')
        .setStyle(ButtonStyle.Secondary),
    );

    if (V2_AVAILABLE) {
      try {
        const accent    = _hexToInt(embed.getGuildColor(guildId));
        const container = new ContainerBuilder().setAccentColor(accent);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent('## Outils'),
        );
        container.addSeparatorComponents(new SeparatorBuilder());
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            '> Nettoyer : retire les menus avec salon ou message invalide\n' +
            '> Suppr. brouillons : supprime les menus sans options\n' +
            '> Tout supprimer : supprime tous les rolemenus du serveur'
          ),
        );
        container.addActionRowComponents(toolsRow);
        return {
          flags           : COMPONENTS_V2_FLAG,
          embeds          : [],
          components      : [container],
          allowedMentions : { parse: [] },
        };
      } catch {}
    }

    return {
      embeds          : [],
      components      : [toolsRow],
      allowedMentions : { parse: [] },
    };
  };

  const panel = await message.channel.send(
    buildPayload()
  ).catch(() => null);

  if (!panel) return;

  embed.registerPrivateInteraction(panel, message.author.id, 3_600_000);

  const collector = panel.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : 3_600_000,
    time   : 3_600_000,
  });

  collector.on('collect', async (interaction) => {
    const id = interaction.customId;

    if (id === 'local:rmlist:close') {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      await message.delete().catch(() => {});
      return;
    }

    if (id === 'local:rmlist:open') {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      await module.exports.run(client, message, ['1']);
      return;
    }

    if (id === 'local:rmlist:sel_open') {
      const idx = interaction.values?.[0];
      if (!idx) return interaction.deferUpdate().catch(() => {});
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      await module.exports.run(client, message, [idx]);
      return;
    }

    if (id === 'local:rmlist:tools') {
      await interaction.update(buildToolsPayload()).catch(() => {});
      return;
    }

    if (id === 'local:rmlist:tools_back') {
      await interaction.update(buildPayload()).catch(() => {});
      return;
    }

    if (id === 'local:rmlist:clean') {
      await interaction.deferUpdate().catch(() => {});
      collector.stop('cleaning');
      embed.clearPrivateInteraction(panel);
      await panel.edit({ components: [] }).catch(() => {});
      await _handleCleanFromList(message, guildId, panel, deleteReply, deleteDelay);
      return;
    }

    if (id === 'local:rmlist:drafts') {
      await interaction.deferUpdate().catch(() => {});
      collector.stop('cleaning');
      embed.clearPrivateInteraction(panel);
      await panel.edit({ components: [] }).catch(() => {});
      await _handleDeleteDrafts(message, guildId, deleteReply, deleteDelay);
      return;
    }

    if (id === 'local:rmlist:clearall') {
      await interaction.deferUpdate().catch(() => {});
      collector.stop('cleaning');
      embed.clearPrivateInteraction(panel);
      await panel.edit({ components: [] }).catch(() => {});
      await _handleClearAll(message, guildId, deleteReply, deleteDelay);
      return;
    }

    if (id === 'local:rmlist:prev' && page > 0) page--;
    if (id === 'local:rmlist:next' && page < pages.length - 1) page++;

    await interaction.update(buildPayload()).catch(() => {});
  });

  collector.on('end', async (_, reason) => {
    embed.clearPrivateInteraction(panel);
    if (reason === 'closed' || reason === 'cleaning') return;

    await panel.edit({
      components : [],
      content    : '-# Session expirée, relance la commande pour reprendre.',
    }).catch(() => {});
  });
}


function _classifyMenus(menus, client) {
  const emptyOrphans = [];
  const staleEmpty   = [];
  const staleDraft   = [];

  for (const m of menus) {
    const opts  = db.getRoleMenuOptions(m.id);
    const count = opts?.length ?? 0;

    if (!m.messageId && count === 0) {
      emptyOrphans.push(m);
      continue;
    }

    if (m.messageId) {
      const channel = m.channelId
        ? client.channels.cache.get(m.channelId)
        : null;

      if (!channel) {
        if (count === 0) staleEmpty.push(m);
        else staleDraft.push(m);
        continue;
      }

      const msg = channel.messages?.cache.get(m.messageId);
      if (msg === undefined) {

      }
    }
  }

  return { emptyOrphans, staleEmpty, staleDraft };
}

async function _classifyMenusDeep(menus, client) {
  const emptyOrphans = [];
  const staleEmpty   = [];
  const staleDraft   = [];

  for (const m of menus) {
    const opts  = db.getRoleMenuOptions(m.id);
    const count = opts?.length ?? 0;

    if (!m.messageId && count === 0) {
      emptyOrphans.push(m);
      continue;
    }

    if (m.messageId) {
      let found = false;

      const channel = m.channelId
        ? (client.channels.cache.get(m.channelId)
          ?? await client.channels.fetch(m.channelId).catch(() => null))
        : null;

      if (channel) {
        const msg = await channel.messages.fetch(m.messageId).catch(() => null);
        if (msg) found = true;
      }

      if (!found) {
        if (count === 0) staleEmpty.push(m);
        else staleDraft.push(m);
      }
    }
  }

  return { emptyOrphans, staleEmpty, staleDraft };
}

function _buildCleanReport(guildId, emptyOrphans, staleEmpty, staleDraft) {
  const parts = [];

  if (emptyOrphans.length) {
    const ids = emptyOrphans.slice(0, 20).map(m => `\`#${m.id}\``).join(', ');
    const extra = emptyOrphans.length > 20 ? `\n...et ${emptyOrphans.length - 20} autre(s).` : '';
    parts.push(`**\u00c0 nettoyer** (suppression) : ${emptyOrphans.length}\n${ids}${extra}`);
  }

  if (staleEmpty.length) {
    const ids = staleEmpty.slice(0, 20).map(m => `\`#${m.id}\``).join(', ');
    const extra = staleEmpty.length > 20 ? `\n...et ${staleEmpty.length - 20} autre(s).` : '';
    parts.push(`**Message introuvable, sans option** (suppression) : ${staleEmpty.length}\n${ids}${extra}`);
  }

  if (staleDraft.length) {
    const ids = staleDraft.slice(0, 20).map(m => `\`#${m.id}\``).join(', ');
    const extra = staleDraft.length > 20 ? `\n...et ${staleDraft.length - 20} autre(s).` : '';
    parts.push(`**Message introuvable, avec options** (brouillon) : ${staleDraft.length}\n${ids}${extra}`);
  }

  return parts.join('\n\n');
}

function _executeClean(emptyOrphans, staleEmpty, staleDraft) {
  let deleted   = 0;
  let converted = 0;

  for (const m of emptyOrphans) {
    db.deleteRoleMenu(m.id);
    deleted++;
  }

  for (const m of staleEmpty) {
    db.deleteRoleMenu(m.id);
    deleted++;
  }

  for (const m of staleDraft) {
    db.clearRoleMenuMessage(m.id);
    converted++;
  }

  return { deleted, converted };
}

async function _handleClean(message, guildId, deleteReply, deleteDelay) {
  const menus = db.getRoleMenus(guildId);

  const { emptyOrphans, staleEmpty, staleDraft } =
    await _classifyMenusDeep(menus, message.client);

  const total = emptyOrphans.length + staleEmpty.length + staleDraft.length;

  if (!total) {
    const sent = await embed.reply(
      message,
      'Aucun rolemenu vide ou message supprim\u00e9 \u00e0 nettoyer.\nLes brouillons avec options sont conserv\u00e9s.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const report = _buildCleanReport(guildId, emptyOrphans, staleEmpty, staleDraft);

  const toDelete  = emptyOrphans.length + staleEmpty.length;
  const toDraft   = staleDraft.length;

  const labelParts = [];
  if (toDelete)  labelParts.push(`${toDelete} suppr.`);
  if (toDraft)   labelParts.push(`${toDraft} brouillon`);

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:rolemenu:confirmclean')
      .setLabel(`Confirmer (${labelParts.join(' + ')})`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('local:rolemenu:cancelclean')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
  );

  const confirmMsg = await message.reply({
    embeds: [
      embed.build(
        guildId,
        `${report}\n\nConfirmer le nettoyage ?`,
        { timestamp: false }
      ),
    ],
    components      : [confirmRow],
    allowedMentions : { repliedUser: false, parse: [] },
  }).catch(() => null);

  if (!confirmMsg) return;

  embed.registerPrivateInteraction(confirmMsg, message.author.id, TIMEOUTS.CONFIRM_TIME_MS);

  try {
    const interaction = await confirmMsg.awaitMessageComponent({
      componentType : ComponentType.Button,
      filter        : i => i.user.id === message.author.id,
      time          : TIMEOUTS.CONFIRM_TIME_MS,
    });

    await interaction.deferUpdate().catch(() => {});
    embed.clearPrivateInteraction(confirmMsg);

    if (interaction.customId === 'local:rolemenu:confirmclean') {
      const result = _executeClean(emptyOrphans, staleEmpty, staleDraft);

      const lines = [];
      if (result.deleted)   lines.push(`**${result.deleted}** supprime(s)`);
      if (result.converted) lines.push(`**${result.converted}** passe(s) en brouillon`);

      await confirmMsg.edit({
        embeds     : [embed.build(guildId, lines.join('\n'), { timestamp: false })],
        components : [],
      }).catch(() => {});
    } else {
      await confirmMsg.edit({
        embeds     : [embed.build(guildId, 'Nettoyage annule.', { timestamp: false })],
        components : [],
      }).catch(() => {});
    }
  } catch {
    embed.clearPrivateInteraction(confirmMsg);
    await confirmMsg.edit({ components: [] }).catch(() => {});
  }
}

async function _handleCleanFromList(message, guildId, listPanel, deleteReply, deleteDelay) {
  const menus = db.getRoleMenus(guildId);

  const { emptyOrphans, staleEmpty, staleDraft } =
    _classifyMenus(menus, message.client);

  const total = emptyOrphans.length + staleEmpty.length + staleDraft.length;

  if (!total) {
    const sent = await message.channel.send({
      embeds: [embed.build(guildId, 'Aucun rolemenu vide ou message supprim\u00e9 \u00e0 nettoyer.\nLes brouillons avec options sont conserv\u00e9s.', { timestamp: false })],
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const report = _buildCleanReport(guildId, emptyOrphans, staleEmpty, staleDraft);

  const toDelete  = emptyOrphans.length + staleEmpty.length;
  const toDraft   = staleDraft.length;

  const labelParts = [];
  if (toDelete)  labelParts.push(`${toDelete} suppr.`);
  if (toDraft)   labelParts.push(`${toDraft} brouillon`);

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:rmlist:confirmclean')
      .setLabel(`Confirmer (${labelParts.join(' + ')})`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('local:rmlist:cancelclean')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
  );

  const confirmMsg = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `${report}\n\nConfirmer le nettoyage ?`,
        { timestamp: false }
      ),
    ],
    components      : [confirmRow],
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!confirmMsg) return;

  embed.registerPrivateInteraction(confirmMsg, message.author.id, TIMEOUTS.CONFIRM_TIME_MS);

  try {
    const interaction = await confirmMsg.awaitMessageComponent({
      componentType : ComponentType.Button,
      filter        : i => i.user.id === message.author.id,
      time          : TIMEOUTS.CONFIRM_TIME_MS,
    });

    await interaction.deferUpdate().catch(() => {});
    embed.clearPrivateInteraction(confirmMsg);

    if (interaction.customId === 'local:rmlist:confirmclean') {
      const result = _executeClean(emptyOrphans, staleEmpty, staleDraft);

      const lines = [];
      if (result.deleted)   lines.push(`**${result.deleted}** supprime(s)`);
      if (result.converted) lines.push(`**${result.converted}** passe(s) en brouillon`);

      await confirmMsg.edit({
        embeds     : [embed.build(guildId, lines.join('\n'), { timestamp: false })],
        components : [],
      }).catch(() => {});
    } else {
      await confirmMsg.edit({
        embeds     : [embed.build(guildId, 'Nettoyage annule.', { timestamp: false })],
        components : [],
      }).catch(() => {});
    }
  } catch {
    embed.clearPrivateInteraction(confirmMsg);
    await confirmMsg.edit({ components: [] }).catch(() => {});
  }
}

async function _handleDeleteDrafts(message, guildId, deleteReply, deleteDelay) {
  const menus  = db.getRoleMenus(guildId);
  const drafts = menus.filter(m => {
    if (m.messageId) return false;
    const opts = db.getRoleMenuOptions(m.id);
    return opts && opts.length > 0;
  });

  if (!drafts.length) {
    const sent = await message.channel.send({
      embeds: [embed.build(guildId, 'Aucun brouillon avec options.', { timestamp: false })],
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const ids   = drafts.slice(0, 20).map(m => `\`#${m.id}\``).join(', ');
  const extra = drafts.length > 20 ? `\n...et ${drafts.length - 20} autre(s).` : '';

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:rmlist:confirmdrafts')
      .setLabel(`Supprimer ${drafts.length} brouillon(s)`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('local:rmlist:canceldrafts')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
  );

  const confirmMsg = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `**${drafts.length}** brouillon(s) avec options :\n${ids}${extra}\n\nLeurs options seront Perdues. Supprimer ?`,
        { timestamp: false }
      ),
    ],
    components      : [confirmRow],
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!confirmMsg) return;

  embed.registerPrivateInteraction(confirmMsg, message.author.id, TIMEOUTS.CONFIRM_TIME_MS);

  try {
    const interaction = await confirmMsg.awaitMessageComponent({
      componentType : ComponentType.Button,
      filter        : i => i.user.id === message.author.id,
      time          : TIMEOUTS.CONFIRM_TIME_MS,
    });

    await interaction.deferUpdate().catch(() => {});
    embed.clearPrivateInteraction(confirmMsg);

    if (interaction.customId === 'local:rmlist:confirmdrafts') {
      let deleted = 0;
      for (const m of drafts) {
        db.deleteRoleMenu(m.id);
        deleted++;
      }

      await confirmMsg.edit({
        embeds     : [embed.build(guildId, `**${deleted}** brouillon(s) supprim\u00e9(s).`, { timestamp: false })],
        components : [],
      }).catch(() => {});
    } else {
      await confirmMsg.edit({
        embeds     : [embed.build(guildId, 'Suppression annul\u00e9e.', { timestamp: false })],
        components : [],
      }).catch(() => {});
    }
  } catch {
    embed.clearPrivateInteraction(confirmMsg);
    await confirmMsg.edit({ components: [] }).catch(() => {});
  }
}


async function _handleClearAll(message, guildId, deleteReply, deleteDelay) {
  const guild = message.guild;
  const menus = db.getRoleMenus(guildId);

  if (!menus.length) {
    const sent = await embed.reply(
      message,
      'Aucun rolemenu sur ce serveur.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  let published  = 0;
  let draft      = 0;
  let toClean    = 0;
  let incomplete = 0;

  for (const m of menus) {
    const opts  = db.getRoleMenuOptions(m.id);
    const count = opts?.length ?? 0;

    if (m.messageId && m.channelId) published++;
    else if (!m.messageId && count > 0) draft++;
    else if (!m.messageId && count === 0) toClean++;
    else incomplete++;
  }

  const lines = [
    `**${menus.length}** rolemenu(s) au total :`,
    `- Publi\u00e9s : **${published}**`,
    `- Brouillons : **${draft}**`,
    `- \u00c0 nettoyer : **${toClean}**`,
    `- Incomplets : **${incomplete}**`,
    '',
    'Cette action va **supprimer tous les rolemenus** du serveur, y compris les publi\u00e9s.',
    'Les messages publics seront supprim\u00e9s si possible.',
  ];

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:rolemenu:confirmclearall')
      .setLabel('Confirmer suppression totale')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('local:rolemenu:cancelclearall')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
  );

  const confirmMsg = await message.channel.send({
    embeds: [
      embed.build(guildId, lines.join('\n'), { timestamp: false }),
    ],
    components      : [confirmRow],
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!confirmMsg) return;

  embed.registerPrivateInteraction(confirmMsg, message.author.id, TIMEOUTS.CONFIRM_TIME_MS);

  try {
    const interaction = await confirmMsg.awaitMessageComponent({
      componentType : ComponentType.Button,
      filter        : i => i.user.id === message.author.id,
      time          : TIMEOUTS.CONFIRM_TIME_MS,
    });

    await interaction.deferUpdate().catch(() => {});
    embed.clearPrivateInteraction(confirmMsg);

    if (interaction.customId === 'local:rolemenu:confirmclearall') {
      let deleted    = 0;
      let msgDeleted = 0;
      let msgMissing = 0;
      let errors     = 0;

      for (const m of menus) {
        try {
          if (m.channelId && m.messageId) {
            const channel = guild.channels.cache.get(m.channelId)
              ?? await guild.channels.fetch(m.channelId).catch(() => null);

            if (channel?.isTextBased()) {
              const msg = await channel.messages.fetch(m.messageId).catch(() => null);
              if (msg) {
                await msg.delete().catch(() => {});
                msgDeleted++;
              } else {
                msgMissing++;
              }
            } else {
              msgMissing++;
            }
          }

          db.deleteRoleMenu(m.id);
          deleted++;
        } catch {
          errors++;
        }
      }

      const report = [
        `**${deleted}** rolemenu(s) supprim\u00e9(s)`,
        `**${msgDeleted}** message(s) public(s) supprim\u00e9(s)`,
      ];

      if (msgMissing) report.push(`**${msgMissing}** message(s) introuvable(s)`);
      if (errors)     report.push(`**${errors}** erreur(s) ignor\u00e9e(s)`);

      await confirmMsg.edit({
        embeds     : [embed.build(guildId, report.join('\n'), { timestamp: false })],
        components : [],
      }).catch(() => {});
    } else {
      await confirmMsg.edit({
        embeds     : [embed.build(guildId, 'Suppression annul\u00e9e.', { timestamp: false })],
        components : [],
      }).catch(() => {});
    }
  } catch {
    embed.clearPrivateInteraction(confirmMsg);
    await confirmMsg.edit({ components: [] }).catch(() => {});
  }
}

