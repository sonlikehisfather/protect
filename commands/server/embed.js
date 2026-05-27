  'use strict';


  const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    EmbedBuilder,
    ChannelType,
    MessageFlags,
    ModalBuilder,
    SeparatorBuilder,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
  } = require('discord.js');

  const db    = require('../../core/database');
  const embed = require('../../utils/embed');
  const perms = require('../../utils/permissions');
  const { replaceVariables } = require('../../utils/variables');
  const TIMEOUTS = require('../../utils/interactionTimeouts');

  const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
  const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                             typeof TextDisplayBuilder === 'function' &&
                             typeof SeparatorBuilder   === 'function';

  const RESERVED_NAMES = new Set([
    'edit', 'copy', 'list', 'delete', 'del', 'remove', 'save', 'sauvegarder',
  ]);

  function _hexToInt(hex) {
    if (typeof hex !== 'string') return 0x2f3136;
    const m = hex.replace(/^#/, '').match(/^[0-9a-fA-F]{6}$/);
    return m ? parseInt(m[0], 16) : 0x2f3136;
  }

  module.exports = {
    help: {
      name        : 'embed',
      description : 'Affiche un générateur d\'embed interactif.',
      usage       : 'embed [edit|copy|list|delete <nom>|<nom>]',
      aliases     : [],
    },

    async run(client, message, args) {
      const guild      = message.guild;
      const guildId    = guild.id;

      const varCtx = {
        guild,
        client,
        prefix : (db.getGuildConfig(guildId) || {}).prefix,
      };

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

      const defaultColor = _safeColor(config?.color);

      let mode         = 'create';
      let editTarget   = null;
      let sourceEmbed  = null;

      const sub = (args?.[0] || '').toLowerCase();

      if (sub === 'edit' || sub === 'copy') {
        mode = sub;

        let fetchChannel = message.channel;
        let rawId        = args[1];


        if (args[1] && args[2]) {
          const resolved = await _resolveTextChannel(guild, args[1]);
          if (!resolved) {
            const s = await embed.replyError(message, 'Salon introuvable ou invalide.', { timestamp: false }).catch(() => null);
            if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
            return;
          }
          fetchChannel = resolved;
          rawId = args[2];
        }

        if (!rawId || !/^\d{17,20}$/.test(rawId)) {
          const s = await embed.replyError(message, 'ID de message invalide.', { timestamp: false }).catch(() => null);
          if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
          return;
        }

        const targetMsg = await fetchChannel.messages.fetch(rawId).catch(() => null);

        if (!targetMsg) {
          const s = await embed.replyError(message, 'Message introuvable.', { timestamp: false }).catch(() => null);
          if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
          return;
        }

        if (!targetMsg.embeds?.length) {
          const s = await embed.replyError(message, 'Ce message ne contient aucun embed.', { timestamp: false }).catch(() => null);
          if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
          return;
        }

        if (mode === 'edit' && targetMsg.author?.id !== client.user.id) {
          const s = await embed.replyError(message, 'Je ne peux modifier que mes propres messages.', { timestamp: false }).catch(() => null);
          if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
          return;
        }

        sourceEmbed = targetMsg.embeds[0];
        if (mode === 'edit') editTarget = targetMsg;
      }

      if (sub === 'list') {
        const templates = db.listEmbeds(guildId);
        if (!templates.length) {
          const s = await embed.replyError(message, 'Aucun template sauvegardé.', { timestamp: false }).catch(() => null);
          if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
          return;
        }
        const lines = templates.slice(0, 25).map(t => `\`${t.name}\` - créé par <@${t.createdBy}>`);
        if (templates.length > 25) lines.push(`…et ${templates.length - 25} autre(s).`);
        const s = await message.channel.send({
          embeds: [embed.build(guildId, lines.join('\n'), { title: 'Templates sauvegardés', timestamp: false })],
          allowedMentions: { parse: [] },
        }).catch(() => null);
        if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
        return;
      }

      if (sub === 'delete' || sub === 'del' || sub === 'remove') {
        const rawName = _normalizeTemplateName(args?.[1]);
        if (!rawName) {
          const s = await embed.replyError(message, 'Utilisation : `+embed delete <nom>`.', { timestamp: false }).catch(() => null);
          if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
          return;
        }
        const existing = db.getEmbed(guildId, rawName);
        if (!existing) {
          const s = await embed.replyError(message, `Template introuvable : \`${rawName}\`.`, { timestamp: false }).catch(() => null);
          if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
          return;
        }
        const confirmMsg = await message.channel.send({
          embeds: [embed.build(guildId, `Supprimer le template \`${rawName}\` ?`, { timestamp: false })],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('embed:tpl:delconfirm').setLabel('Supprimer').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId('embed:tpl:delcancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
            ),
          ],
          allowedMentions: { parse: [] },
        }).catch(() => null);
        if (!confirmMsg) return;
        try {
          const btn = await confirmMsg.awaitMessageComponent({
            filter: i => i.user.id === message.author.id,
            time: 30_000,
          });
          if (btn.customId === 'embed:tpl:delconfirm') {
            db.deleteEmbed(guildId, rawName);
            await btn.update({
              embeds: [embed.build(guildId, `Template supprimé : \`${rawName}\`.`, { timestamp: false })],
              components: [],
              allowedMentions: { parse: [] },
            }).catch(() => {});
          } else {
            await btn.update({
              embeds: [embed.build(guildId, 'Suppression annulée.', { timestamp: false })],
              components: [],
              allowedMentions: { parse: [] },
            }).catch(() => {});
          }
          if (deleteReply) embed.scheduleDelete(confirmMsg, deleteDelay);
        } catch {
          await confirmMsg.edit({
            embeds: [embed.build(guildId, 'Suppression expirée.', { timestamp: false })],
            components: [],
            allowedMentions: { parse: [] },
          }).catch(() => {});
          if (deleteReply) embed.scheduleDelete(confirmMsg, deleteDelay);
        }
        return;
      }

      let templateData = null;
      if (sub && !RESERVED_NAMES.has(sub)) {
        const saved = db.getEmbed(guildId, sub);
        if (!saved) {
          const s = await embed.replyError(message, `Template introuvable : \`${sub}\`.`, { timestamp: false }).catch(() => null);
          if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
          return;
        }
        templateData = saved.data;
      }

      const state = sourceEmbed
        ? _stateFromEmbed(sourceEmbed, defaultColor)
        : {
            title       : null,
            description : null,
            author      : null,
            authorIcon  : null,
            authorUrl   : null,
            footer      : null,
            footerIcon  : null,
            thumbnail   : null,
            image       : null,
            url         : null,
            color       : defaultColor,
            timestamp   : false,
            fields      : [],
            view        : 'main',
          };

      if (templateData) {
        _loadTemplateIntoState(state, templateData, defaultColor);
      }

      const panel = await message.channel.send(_buildPanelPayload(state, mode)).catch(() => null);

      if (!panel) {
        await embed.replyError(
          message,
          'Impossible d\'ouvrir le générateur d\'embed.',
          { timestamp: false }
        ).catch(() => {});
        return;
      }

      embed.registerPrivateInteraction(panel, message.author.id, TIMEOUTS.LONG_TIME_MS);

      let busy = false;

      const collector = panel.createMessageComponentCollector({
        filter : interaction =>
          interaction.user.id === message.author.id &&
          interaction.message.id === panel.id,
        idle   : TIMEOUTS.LONG_TIME_MS,
        time   : TIMEOUTS.LONG_TIME_MS,
      });

      collector.on('collect', async interaction => {
        const id = interaction.customId;

        if (busy) {
          await _ephemeral(interaction, guildId, 'Une modification est déjà en cours.');
          return;
        }

        if (id === 'embed:close') {
          collector.stop('closed');
          await interaction.deferUpdate().catch(() => {});
          await panel.delete().catch(() => {});
          return;
        }

        if (id.startsWith('embed:nav:')) {
          const target = id.slice('embed:nav:'.length);
          if (['main', 'content', 'images', 'fields', 'tools'].includes(target)) {
            state.view = target;
            await interaction.deferUpdate().catch(() => {});
            await _refresh(panel, state, mode);
          } else {
            await interaction.deferUpdate().catch(() => {});
          }
          return;
        }

        if (id === 'embed:apercu') {
          if (!_hasEmbedContent(state)) {
            await _ephemeral(interaction, guildId, 'Aucun contenu à prévisualiser.');
            return;
          }
          await interaction.reply({
            embeds          : [_buildPreview(state, false, varCtx)],
            flags           : 64,
            allowedMentions : { parse: [] },
          }).catch(() => {});
          return;
        }

        if (id === 'embed:variables') {
          await interaction.reply({
            content: [
              '**Serveur**',
              '`{server}` \u2192 Nom du serveur',
              '`{membercount}` \u2192 Nombre de membres',
              '`{ServerIcon}` \u2192 Ic\u00f4ne du serveur',
              '`{ServerBoostsCount}` \u2192 Nombre de boosts',
              '`{ServerLevel}` \u2192 Niveau boost',
              '',
              '**Bot**',
              '`{BotPic}` \u2192 Avatar du bot',
              '`{prefix}` \u2192 Pr\u00e9fixe',
              '`{BotCommandsCount}` \u2192 Nombre total de commandes du bot',
              '',
              '**Date/Heure**',
              '`{date}` \u2192 Date du jour',
              '`{time}` \u2192 Heure actuelle',
            ].join('\n'),
            flags           : 64,
            allowedMentions : { parse: [] },
          }).catch(() => {});
          return;
        }

        if (id === 'embed:reset:request') {
          state.view = 'tools_reset';
          await interaction.deferUpdate().catch(() => {});
          await _refresh(panel, state, mode);
          return;
        }

        if (id === 'embed:reset:cancel') {
          state.view = 'tools';
          await interaction.deferUpdate().catch(() => {});
          await _refresh(panel, state, mode);
          return;
        }

        if (id === 'embed:reset:confirm') {
          state.title       = null;
          state.description = null;
          state.author      = null;
          state.authorIcon  = null;
          state.authorUrl   = null;
          state.footer      = null;
          state.footerIcon  = null;
          state.thumbnail   = null;
          state.image       = null;
          state.url         = null;
          state.color       = defaultColor;
          state.timestamp   = false;
          state.fields      = [];
          state.view        = 'tools';
          await interaction.deferUpdate().catch(() => {});
          await _refresh(panel, state, mode);
          return;
        }

        if (id === 'embed:copy') {
          busy = true;
          const modalId = `embed:copy:modal:${panel.id}:${interaction.id}`;
          const shown = await interaction.showModal(
            _buildModal(modalId, 'Copier un embed existant', [
              _input('channel', 'Salon source', TextInputStyle.Short, {
                maxLength: 100, required: true, placeholder: '#salon, ID ou nom',
              }),
              _input('message', 'ID du message', TextInputStyle.Short, {
                maxLength: 20, required: true, placeholder: '123456789012345678',
              }),
            ])
          ).then(() => true).catch(() => false);

          busy = false;
          if (!shown) return;

          const submit = await _awaitOwnModal(interaction, modalId);
          if (!submit) { await _refresh(panel, state, mode); return; }

          busy = true;
          const channelQuery = submit.fields.getTextInputValue('channel').trim();
          const messageId    = submit.fields.getTextInputValue('message').trim();
          const sourceChannel = await _resolveTextChannel(guild, channelQuery);

          if (!sourceChannel) {
            await _modalError(submit, guildId, 'Salon introuvable ou invalide.');
            busy = false;
            await _refresh(panel, state, mode);
            return;
          }

          if (!/^[0-9]{17,20}$/.test(messageId)) {
            await _modalError(submit, guildId, 'ID de message invalide.');
            busy = false;
            await _refresh(panel, state, mode);
            return;
          }

          const targetMsg = await sourceChannel.messages.fetch(messageId).catch(() => null);
          if (!targetMsg) {
            await _modalError(submit, guildId, 'Message introuvable.');
            busy = false;
            await _refresh(panel, state, mode);
            return;
          }

          if (!targetMsg.embeds?.length) {
            await _modalError(submit, guildId, 'Ce message ne contient aucun embed.');
            busy = false;
            await _refresh(panel, state, mode);
            return;
          }

          const copied = _stateFromEmbed(targetMsg.embeds[0], defaultColor);
          Object.assign(state, copied);
          state.view = 'main';
          mode = 'copy';
          await submit.deferUpdate().catch(() => {});
          await submit.followUp({
            content         : 'Embed chargé avec succès.',
            flags           : 64,
            allowedMentions : { parse: [] },
          }).catch(() => {});
          busy = false;
          await _refresh(panel, state, mode);
          return;
        }

        if (id === 'embed:save') {
          if (!_hasEmbedContent(state)) {
            await _ephemeral(interaction, guildId, 'Aucun contenu à sauvegarder.');
            return;
          }

          busy = true;
          const modalId = `embed:save:modal:${panel.id}:${interaction.id}`;
          const shown = await interaction.showModal(
            _buildModal(modalId, 'Sauvegarder l\'embed', [
              _input('name', 'Nom du template', TextInputStyle.Short, {
                maxLength: 32, required: true, placeholder: 'notifications',
              }),
            ])
          ).then(() => true).catch(() => false);

          busy = false;
          if (!shown) return;

          const submit = await _awaitOwnModal(interaction, modalId);
          if (!submit) { await _refresh(panel, state, mode); return; }

          busy = true;
          const rawName = _normalizeTemplateName(submit.fields.getTextInputValue('name'));

          if (!_isTemplateNameValid(rawName)) {
            await _modalError(submit, guildId, 'Nom invalide. 1-32 caractères : a-z, 0-9, tiret, underscore. Noms réservés interdits.');
            busy = false;
            await _refresh(panel, state, mode);
            return;
          }

          const data = _stateToSaveData(state);
          const existingTpl = db.getEmbed(guildId, rawName);

          if (existingTpl) {
            state._pendingSave = { name: rawName, data };
            state.view = 'tools_save_confirm';
            await submit.deferUpdate().catch(() => {});
            busy = false;
            await _refresh(panel, state, mode);
            return;
          }

          const tplCount = db.listEmbeds(guildId).length;
          if (tplCount >= 25) {
            await _modalError(submit, guildId, 'Limite atteinte : 25 templates maximum par serveur.');
            busy = false;
            await _refresh(panel, state, mode);
            return;
          }

          db.saveEmbed(guildId, rawName, data, message.author.id);
          await submit.deferUpdate().catch(() => {});
          await submit.followUp({
            content         : `Template sauvegardé : \`${rawName}\`.`,
            flags           : 64,
            allowedMentions : { parse: [] },
          }).catch(() => {});
          busy = false;
          state.view = 'tools';
          await _refresh(panel, state, mode);
          return;
        }

        if (id === 'embed:save:confirm') {
          if (!state._pendingSave) {
            state.view = 'tools';
            await interaction.deferUpdate().catch(() => {});
            await _refresh(panel, state, mode);
            return;
          }
          const { name: saveName, data: saveData } = state._pendingSave;
          db.saveEmbed(guildId, saveName, saveData, message.author.id);
          state._pendingSave = null;
          state.view = 'tools';
          await interaction.deferUpdate().catch(() => {});
          await interaction.followUp({
            content         : `Template remplacé : \`${saveName}\`.`,
            flags           : 64,
            allowedMentions : { parse: [] },
          }).catch(() => {});
          await _refresh(panel, state, mode);
          return;
        }

        if (id === 'embed:save:cancel') {
          state._pendingSave = null;
          state.view = 'tools';
          await interaction.deferUpdate().catch(() => {});
          await _refresh(panel, state, mode);
          return;
        }

        if (id === 'embed:edit') {
          const selected = interaction.values?.[0];
          if (!selected) { await interaction.deferUpdate().catch(() => {}); return; }

          if (selected === 'timestamp') {
            state.timestamp = !state.timestamp;
            await interaction.deferUpdate().catch(() => {});
            await _refresh(panel, state, mode);
            return;
          }

          const modalConfig = _modalConfig(selected, state);
          if (!modalConfig) { await interaction.deferUpdate().catch(() => {}); return; }

          busy = true;
          const modalId = `embed:${selected}:${panel.id}:${interaction.id}`;
          const shown = await interaction.showModal(
            _buildModal(modalId, modalConfig.title, modalConfig.inputs)
          ).then(() => true).catch(() => false);

          busy = false;
          if (!shown) return;

          const submit = await _awaitOwnModal(interaction, modalId);
          if (!submit) { await _refresh(panel, state, mode); return; }

          busy = true;
          const value = submit.fields.getTextInputValue('value').trim();
          state._lastSuccess = null;
          const error = await _applyModalValue(selected, value, state, message, client);
          if (error) {
            await _modalError(submit, guildId, error);
            busy = false;
            state._lastSuccess = null;
            await _refresh(panel, state, mode);
            return;
          }

          await submit.deferUpdate().catch(() => {});

          if (state._lastSuccess) {
            const successMsg = state._lastSuccess;
            state._lastSuccess = null;
            await submit.followUp({
              content         : successMsg,
              flags           : 64,
              allowedMentions : { parse: [] },
            }).catch(() => {});
          }

          busy = false;
          await _refresh(panel, state, mode);
          return;
        }

        if (id === 'embed:fields') {
          const selected = interaction.values?.[0];
          if (!selected) { await interaction.deferUpdate().catch(() => {}); return; }

          if (selected === 'add_field') {
            if (state.fields.length >= 25) {
              await _ephemeral(interaction, guildId, 'Un embed ne peut pas contenir plus de 25 fields.');
              return;
            }

            busy = true;

            const modalId = `embed:addfield:${panel.id}:${interaction.id}`;
            const shown = await interaction.showModal(
              _buildModal(modalId, 'Ajouter un field', [
                _input('name', 'Nom du field', TextInputStyle.Short, {
                  maxLength: 256, required: true, placeholder: 'Titre du field',
                }),
                _input('value', 'Contenu du field', TextInputStyle.Paragraph, {
                  maxLength: 1024, required: true, placeholder: 'Contenu du field',
                }),
              ])
            ).then(() => true).catch(() => false);

            busy = false;
            if (!shown) return;

            const submit = await _awaitOwnModal(interaction, modalId);
            if (!submit) { await _refresh(panel, state, mode); return; }

            busy = true;

            const name  = submit.fields.getTextInputValue('name').trim();
            const value = submit.fields.getTextInputValue('value').trim();

            if (!name || !value) {
              await _modalError(submit, guildId, 'Le nom et le contenu du field sont obligatoires.');
              busy = false;
              await _refresh(panel, state, mode);
              return;
            }

            state.fields.push({ name, value, inline: false });

            await submit.deferUpdate().catch(() => {});
            busy = false;
            await _refresh(panel, state, mode);
            return;
          }

          if (selected === 'del_field') {
            if (!state.fields.length) {
              await _ephemeral(interaction, guildId, 'Aucun field a supprimer.');
              return;
            }

            busy = true;

            const modalId = `embed:delfield:${panel.id}:${interaction.id}`;
            const shown = await interaction.showModal(
              _buildModal(modalId, 'Supprimer un field', [
                _input('index', 'Numéro du field', TextInputStyle.Short, {
                  maxLength: 2, required: true, placeholder: '1',
                }),
              ])
            ).then(() => true).catch(() => false);

            busy = false;
            if (!shown) return;

            const submit = await _awaitOwnModal(interaction, modalId);
            if (!submit) { await _refresh(panel, state, mode); return; }

            busy = true;

            const rawIndex = submit.fields.getTextInputValue('index').trim();
            const index = Number(rawIndex) - 1;

            if (!Number.isInteger(index) || !state.fields[index]) {
              await _modalError(submit, guildId, 'Numéro invalide.');
              busy = false;
              await _refresh(panel, state, mode);
              return;
            }

            state.fields.splice(index, 1);

            await submit.deferUpdate().catch(() => {});
            busy = false;
            await _refresh(panel, state, mode);
            return;
          }

          await interaction.deferUpdate().catch(() => {});
          return;
        }

        if (id === 'embed:send') {
          busy = true;

          if (!_hasEmbedContent(state)) {
            state.description = 'Embed vide.';
          }

          if (_totalChars(state) > 6000) {
            await _ephemeral(interaction, guildId, 'L\'embed depasse la limite de 6000 caracteres au total. Reduisez le contenu avant d\'envoyer.');
            busy = false;
            return;
          }

          if (mode === 'edit' && editTarget) {
            await interaction.deferUpdate().catch(() => {});

            const edited = await editTarget.edit({
              embeds          : [_buildPreview(state, false, varCtx)],
              allowedMentions : { parse: [] },
            }).catch(() => null);

            if (!edited) {
              busy = false;
              await _temporaryError(message, guildId, 'Impossible de modifier ce message. Il a peut-etre ete supprime.');
              await _refresh(panel, state, mode);
              return;
            }

            await panel.delete().catch(() => {});

            const sent = await message.channel.send({
              embeds: [
                embed.build(guildId, 'Embed modifie.', { timestamp: false }),
              ],
              allowedMentions: { repliedUser: false },
            }).catch(() => null);

            if (sent && deleteReply) {
              embed.scheduleDelete(sent, deleteDelay);
            }

            busy = false;
            collector.stop('sent');
            return;
          }

          const modalId = `embed:send:${panel.id}:${interaction.id}`;
          const shown = await interaction.showModal(
            _buildModal(modalId, 'Envoyer l\'embed', [
              _input('channel', 'Salon cible', TextInputStyle.Short, {
                maxLength: 100, required: true, placeholder: '#salon, ID ou nom',
              }),
            ])
          ).then(() => true).catch(() => false);

          busy = false;
          if (!shown) return;

          const submit = await _awaitOwnModal(interaction, modalId);
          if (!submit) { await _refresh(panel, state, mode); return; }

          busy = true;

          const query = submit.fields.getTextInputValue('channel').trim();
          const channel = await _resolveTextChannel(guild, query);

          if (!channel) {
            await _modalError(submit, guildId, 'Salon introuvable ou invalide.');
            busy = false;
            await _refresh(panel, state, mode);
            return;
          }

          await submit.deferUpdate().catch(() => {});

          const sentEmbed = await channel.send({
            embeds: [_buildPreview(state, false, varCtx)],
            allowedMentions: { parse: [] },
          }).catch(() => null);

          if (!sentEmbed) {
            busy = false;
            await _temporaryError(message, guildId, 'Impossible d\'envoyer l\'embed dans ce salon.');
            await _refresh(panel, state, mode);
            return;
          }

          await panel.delete().catch(() => {});

          const confirmText = mode === 'copy' ? 'Embed envoye.' : `Embed envoye dans ${channel}.`;

          const sent = await message.channel.send({
            embeds: [
              embed.build(guildId, confirmText, { timestamp: false }),
            ],
            allowedMentions: { repliedUser: false },
          }).catch(() => null);

          if (sent && deleteReply) {
            embed.scheduleDelete(sent, deleteDelay);
          }

          busy = false;
          collector.stop('sent');
          return;
        }

        await interaction.deferUpdate().catch(() => {});
      });

      collector.on('end', async (_, reason) => {
        embed.clearPrivateInteraction(panel);
        if (reason === 'closed' || reason === 'sent') return;

        await panel.edit(_buildClosedPayload(state, 'Session expirée, relance la commande pour reprendre.')).catch(() => {});
      });
    },
  };

  function _buildRows(mode) {
    const editSelect = new StringSelectMenuBuilder()
      .setCustomId('embed:edit')
      .setPlaceholder('Modifier l\'embed...')
      .addOptions([
        { label: 'Titre',         value: 'title',        description: 'Modifier le titre',                  emoji: '✏️' },
        { label: 'Description',   value: 'description',  description: 'Modifier la description',            emoji: '📝' },
        { label: 'Auteur',        value: 'author',       description: 'Modifier l\'auteur',                 emoji: '👤' },
        { label: 'Icône auteur',  value: 'author_icon',  description: 'URL de l\'icône auteur',              emoji: '🖼️' },
        { label: 'URL auteur',    value: 'author_url',   description: 'URL cliquable de l\'auteur',          emoji: '🔗' },
        { label: 'Footer',        value: 'footer',       description: 'Modifier le footer',                 emoji: '🔻' },
        { label: 'Icône footer',  value: 'footer_icon',  description: 'URL de l\'icône footer',              emoji: '🖼️' },
        { label: 'Couleur',       value: 'color',        description: 'Modifier la couleur hex',            emoji: '🎨' },
        { label: 'Thumbnail',     value: 'thumbnail',    description: 'URL du thumbnail',                   emoji: '🖼️' },
        { label: 'Image',         value: 'image',        description: 'URL de l\'image',                     emoji: '🏞️' },
        { label: 'URL',           value: 'url',          description: 'URL du titre',                       emoji: '🔗' },
        { label: 'Timestamp',     value: 'timestamp',    description: 'Activer/désactiver le timestamp',    emoji: '🕐' },
      ]);

    const fieldsSelect = new StringSelectMenuBuilder()
      .setCustomId('embed:fields')
      .setPlaceholder('Gerer les champs...')
      .addOptions([
        { label: 'Ajouter un champ',   value: 'add_field', description: 'Ajouter un field a l\'embed',    emoji: '➕' },
        { label: 'Supprimer un champ', value: 'del_field', description: 'Supprimer un field par numéro', emoji: '🗑️' },
      ]);

    const sendLabel = mode === 'edit' ? 'Sauvegarder' : mode === 'copy' ? 'Envoyer la copie' : 'Envoyer';

    return [
      new ActionRowBuilder().addComponents(editSelect),
      new ActionRowBuilder().addComponents(fieldsSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('embed:send')
          .setLabel(sendLabel)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('embed:copy')
          .setLabel('Copier')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('embed:save')
          .setLabel('Sauvegarder')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('embed:close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger),
      ),
    ];
  }

  function _buildControlEmbed(state, mode) {
    const total = _totalChars(state);
    const panelTitle = mode === 'edit' ? 'Édition d\'embed' : mode === 'copy' ? 'Copie d\'embed' : 'Générateur d\'embed';

    return new EmbedBuilder()
      .setTitle(panelTitle)
      .setDescription(
        'Configurez l\'embed avec les menus ci-dessous.\n' +
        'Les valeurs vides peuvent etre reinitialisees avec `reset` dans les formulaires.'
      )
      .setColor(_safeColor(state.color))
      .addFields(
        {
          name  : 'Titre',
          value : state.title ? 'Défini' : 'Non défini',
          inline: true,
        },
        {
          name  : 'Description',
          value : state.description ? `${state.description.length}/4096` : 'Non définie',
          inline: true,
        },
        {
          name  : 'Auteur',
          value : state.author ? 'Défini' : 'Non défini',
          inline: true,
        },
        {
          name  : 'Footer',
          value : state.footer ? 'Défini' : 'Non défini',
          inline: true,
        },
        {
          name  : 'Images',
          value : `${state.thumbnail ? 'Thumbnail' : 'Aucun thumbnail'}\n${state.image ? 'Image' : 'Aucune image'}`,
          inline: true,
        },
        {
          name  : 'Fields',
          value : `${state.fields.length}/25`,
          inline: true,
        },
        {
          name  : 'Couleur',
          value : state.color || '#2f3136',
          inline: true,
        },
        {
          name  : 'Timestamp',
          value : state.timestamp ? 'Activé' : 'Désactivé',
          inline: true,
        },
        {
          name  : 'Total',
          value : `${total}/6000 caractères`,
          inline: true,
        },
      )
      .setTimestamp();
  }

  function _buildPreview(state, previewMode = false, ctx = null) {
    const v = (text) => ctx ? replaceVariables(text, ctx) : (text ?? '');
    const e = new EmbedBuilder().setColor(_safeColor(state.color));

    if (state.title) e.setTitle(v(state.title));
    if (state.description) e.setDescription(v(state.description));

    if (state.author) {
      const authorOpts = { name: v(state.author) };
      if (state.authorIcon) authorOpts.iconURL = state.authorIcon;
      if (state.authorUrl)  authorOpts.url     = state.authorUrl;
      e.setAuthor(authorOpts);
    }

    if (state.footer) {
      const footerOpts = { text: v(state.footer) };
      if (state.footerIcon) footerOpts.iconURL = state.footerIcon;
      e.setFooter(footerOpts);
    }

    if (state.thumbnail) e.setThumbnail(state.thumbnail);
    if (state.image) e.setImage(state.image);
    if (state.url && state.title) e.setURL(state.url);
    if (state.timestamp) e.setTimestamp();
    if (state.fields.length) {
      e.addFields(state.fields.map(f => ({
        name   : v(f.name  || ''),
        value  : v(f.value || ''),
        inline : f.inline ?? false,
      })));
    }

    if (previewMode && !_hasEmbedContent(state)) {
      e.setDescription('Prévisualisation vide.');
    }

    return e;
  }

  function _modalConfig(field, state) {
    const configs = {
      title: {
        title      : 'Modifier le titre',
        label      : 'Titre',
        style      : TextInputStyle.Short,
        value      : state.title || '',
        maxLength  : 256,
        required   : false,
        placeholder: 'Tapez reset pour retirer le titre',
      },

      description: {
        title      : 'Modifier la description',
        label      : 'Description',
        style      : TextInputStyle.Paragraph,
        value      : state.description || '',
        maxLength  : 4000,
        required   : false,
        placeholder: 'Tapez reset pour vider la description',
      },

      author: {
        title      : 'Modifier l\'auteur',
        label      : 'Auteur',
        style      : TextInputStyle.Short,
        value      : state.author || '',
        maxLength  : 256,
        required   : false,
        placeholder: 'Tapez reset pour retirer l\'auteur',
      },

      footer: {
        title      : 'Modifier le footer',
        label      : 'Footer',
        style      : TextInputStyle.Short,
        value      : state.footer || '',
        maxLength  : 2048,
        required   : false,
        placeholder: 'Tapez reset pour retirer le footer',
      },

      author_icon: {
        title      : 'Icône auteur',
        label      : 'Icône auteur',
        style      : TextInputStyle.Short,
        value      : state.authorIcon || '',
        maxLength  : 512,
        required   : false,
        placeholder: 'me, @user, serveur, bot, URL ou reset',
      },

      author_url: {
        title      : 'URL auteur',
        label      : 'URL cliquable de l\'auteur',
        style      : TextInputStyle.Short,
        value      : state.authorUrl || '',
        maxLength  : 512,
        required   : false,
        placeholder: 'Tapez reset ou mettez une URL http(s)',
      },

      footer_icon: {
        title      : 'Icône footer',
        label      : 'Icône footer',
        style      : TextInputStyle.Short,
        value      : state.footerIcon || '',
        maxLength  : 512,
        required   : false,
        placeholder: 'me, @user, serveur, bot, URL ou reset',
      },

      thumbnail: {
        title      : 'Modifier le thumbnail',
        label      : 'Image ou raccourci',
        style      : TextInputStyle.Short,
        value      : state.thumbnail || '',
        maxLength  : 512,
        required   : false,
        placeholder: 'me, @user, serveur, bot, URL ou reset',
      },

      image: {
        title      : 'Modifier l\'image',
        label      : 'Image ou raccourci',
        style      : TextInputStyle.Short,
        value      : state.image || '',
        maxLength  : 512,
        required   : false,
        placeholder: 'me, @user, serveur, bot, URL ou reset',
      },

      url: {
        title      : 'Modifier l\'URL du titre',
        label      : 'URL du titre',
        style      : TextInputStyle.Short,
        value      : state.url || '',
        maxLength  : 512,
        required   : false,
        placeholder: 'Tapez reset pour retirer l\'URL',
      },

      color: {
        title      : 'Modifier la couleur',
        label      : 'Couleur hex',
        style      : TextInputStyle.Short,
        value      : state.color || '',
        maxLength  : 7,
        required   : false,
        placeholder: '#2f3136',
      },
    };

    const current = configs[field];
    if (!current) return null;

    return {
      title : current.title,
      inputs: [
        _input(
          'value',
          current.label,
          current.style,
          {
            value      : current.value,
            maxLength  : current.maxLength,
            required   : current.required,
            placeholder: current.placeholder,
          }
        ),
      ],
    };
  }

  async function _applyModalValue(field, value, state, message, client) {
    const lower = value.toLowerCase();

    if (field === 'title') {
      if (!value || lower === 'reset') {
        state.title = null;
        state.url = null;
        return null;
      }

      if (value.length > 256) return 'Le titre ne peut pas dépasser 256 caractères.';

      state.title = value;
      return null;
    }

    if (field === 'description') {
      if (!value || lower === 'reset') {
        state.description = null;
        return null;
      }

      if (value.length > 4096) return 'La description ne peut pas dépasser 4096 caractères.';

      state.description = value;
      return null;
    }

    if (field === 'author') {
      if (!value || lower === 'reset') {
        state.author = null;
        state.authorIcon = null;
        state.authorUrl = null;
        return null;
      }

      if (value.length > 256) return 'L\'auteur ne peut pas dépasser 256 caractères.';

      state.author = value;
      return null;
    }

    if (field === 'footer') {
      if (!value || lower === 'reset') {
        state.footer = null;
        state.footerIcon = null;
        return null;
      }

      if (value.length > 2048) return 'Le footer ne peut pas dépasser 2048 caractères.';

      state.footer = value;
      return null;
    }

    if (field === 'thumbnail') {
      const resolved = await _resolveImageInput(value, message, client);
      if (!resolved.ok) return resolved.error;

      state.thumbnail = resolved.value;
      state._lastSuccess = resolved.reset ? 'Thumbnail supprimée.' : 'Thumbnail définie.';
      return null;
    }

    if (field === 'image') {
      const resolved = await _resolveImageInput(value, message, client);
      if (!resolved.ok) return resolved.error;

      state.image = resolved.value;
      state._lastSuccess = resolved.reset ? 'Image supprimée.' : 'Image définie.';
      return null;
    }

    if (field === 'url') {
      if (!value || lower === 'reset') {
        state.url = null;
        return null;
      }

      if (!state.title) {
        return 'Aucun titre défini. L\'URL ne sera pas visible sans titre.';
      }

      if (!_isUrl(value)) return 'URL invalide.';

      state.url = value;
      return null;
    }

    if (field === 'author_icon') {
      const isResetInput = !value || ['reset', 'clear', 'none', 'aucun', 'supprimer'].includes(lower);

      if (!state.author && !isResetInput) {
        return 'Définissez d\'abord le texte auteur.';
      }

      const resolved = await _resolveImageInput(value, message, client);
      if (!resolved.ok) return resolved.error;

      state.authorIcon = resolved.value;
      state._lastSuccess = resolved.reset ? 'Icône auteur supprimée.' : 'Icône auteur définie.';
      return null;
    }

    if (field === 'author_url') {
      if (!value || lower === 'reset') {
        state.authorUrl = null;
        return null;
      }

      if (!state.author) {
        return 'Définissez d\'abord le texte auteur.';
      }

      if (!_isUrl(value)) return 'URL invalide.';

      state.authorUrl = value;
      return null;
    }

    if (field === 'footer_icon') {
      const isResetInput = !value || ['reset', 'clear', 'none', 'aucun', 'supprimer'].includes(lower);

      if (!state.footer && !isResetInput) {
        return 'Définissez d\'abord le footer.';
      }

      const resolved = await _resolveImageInput(value, message, client);
      if (!resolved.ok) return resolved.error;

      state.footerIcon = resolved.value;
      state._lastSuccess = resolved.reset ? 'Icône footer supprimée.' : 'Icône footer définie.';
      return null;
    }

    if (field === 'color') {
      if (!value || lower === 'reset') {
        state.color = '#2f3136';
        return null;
      }

      if (!/^#?[0-9a-f]{6}$/i.test(value)) {
        return 'Couleur invalide. Exemple : #2f3136.';
      }

      state.color = value.startsWith('#') ? value : `#${value}`;
      return null;
    }

    return null;
  }

  function _buildModal(customId, title, inputs) {
    const modal = new ModalBuilder()
      .setCustomId(customId.slice(0, 100))
      .setTitle(title.slice(0, 45));

    modal.addComponents(inputs.map(i =>
      new ActionRowBuilder().addComponents(i)
    ));

    return modal;
  }

  function _input(customId, label, style, { value, maxLength, required = true, placeholder } = {}) {
    const input = new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label.slice(0, 45))
      .setStyle(style)
      .setRequired(required);

    if (placeholder) {
      input.setPlaceholder(placeholder.slice(0, 100));
    }

    if (value != null && value !== '') {
      input.setValue(String(value).slice(0, maxLength || 4000));
    }

    if (maxLength) {
      input.setMaxLength(maxLength);
    }

    return input;
  }

  async function _awaitOwnModal(interaction, customId) {
    try {
      return await interaction.awaitModalSubmit({
        filter: i => i.customId === customId && i.user.id === interaction.user.id,
        time  : 5 * 60 * 1000,
      });
    } catch {
      return null;
    }
  }

  async function _refresh(panel, state, mode) {
    return panel.edit(_buildPanelPayload(state, mode)).catch(() => {});
  }

  function _buildSummary(state) {
    const total = _totalChars(state);
    const titlePrev = state.title ? `\`${_truncate(state.title, 60)}\`` : '`Non défini`';
    const descPrev  = state.description ? `\`${_truncate(state.description, 80)}\`` : '`Non définie`';
    const authPrev  = state.author ? `\`${_truncate(state.author, 60)}\`` : '`Non défini`';
    const footPrev  = state.footer ? `\`${_truncate(state.footer, 60)}\`` : '`Non défini`';
    const colorPrev = state.color || '#2f3136';
    const tsPrev    = state.timestamp ? '`Activé`' : '`Désactivé`';
    const thumbPrev = state.thumbnail ? '`Définie`' : '`Aucune`';
    const imgPrev   = state.image ? '`Définie`' : '`Aucune`';

    return [
      `> Titre : ${titlePrev}`,
      `> Description : ${descPrev}`,
      `> Auteur : ${authPrev}`,
      `> Footer : ${footPrev}`,
      `> Thumbnail : ${thumbPrev}`,
      `> Image : ${imgPrev}`,
      `> Couleur : \`${colorPrev}\``,
      `> Timestamp : ${tsPrev}`,
      `> Fields : \`${state.fields.length}/25\``,
      `> Total : \`${total}/6000\``,
    ].join('\n');
  }

  function _truncate(str, max) {
    const s = String(str || '');
    const cut = s.length <= max
      ? s.replace(/`/g, '\u02cb')
      : `${s.slice(0, max - 1).replace(/`/g, '\u02cb')}…`;
    return embed.breakLongTokens(cut);
  }

  function _buildPanelPayload(state, mode) {
    const view = state.view || 'main';

    if (V2_AVAILABLE) {
      try {
        const accent    = _hexToInt(state.color);
        const container = new ContainerBuilder().setAccentColor(accent);

        const panelTitle = mode === 'edit' ? 'Édition d\'embed' : mode === 'copy' ? 'Copie d\'embed' : 'Générateur d\'embed';
        const sendLabel  = mode === 'edit' ? 'Sauvegarder' : mode === 'copy' ? 'Envoyer la copie' : 'Envoyer';

        if (view === 'main') {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${panelTitle}`),
          );
          container.addSeparatorComponents(new SeparatorBuilder());
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(_buildSummary(state)),
          );
          container.addSeparatorComponents(new SeparatorBuilder());

          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('embed:nav:content').setLabel('Contenu').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId('embed:nav:images').setLabel('Images').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId('embed:nav:fields').setLabel('Champs').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId('embed:nav:tools').setLabel('Outils').setStyle(ButtonStyle.Secondary),
            ),
          );
          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('embed:send').setLabel(sendLabel).setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId('embed:apercu').setLabel('Apercu').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId('embed:close').setLabel('Fermer').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId('embed:copy').setLabel('Copier').setStyle(ButtonStyle.Secondary),
            ),
          );
        } else if (view === 'content') {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Contenu'),
          );
          container.addSeparatorComponents(new SeparatorBuilder());
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(_buildSummary(state)),
          );
          container.addSeparatorComponents(new SeparatorBuilder());

          const editSelect = new StringSelectMenuBuilder()
            .setCustomId('embed:edit')
            .setPlaceholder('Modifier l\'embed...')
            .addOptions([
              { label: 'Titre',         value: 'title',        description: 'Modifier le titre',                  emoji: '✏️' },
              { label: 'Description',   value: 'description',  description: 'Modifier la description',            emoji: '📝' },
              { label: 'Auteur',        value: 'author',       description: 'Modifier l\'auteur',                 emoji: '👤' },
              { label: 'Icône auteur',  value: 'author_icon',  description: 'URL de l\'icône auteur',              emoji: '🖼️' },
              { label: 'URL auteur',    value: 'author_url',   description: 'URL cliquable de l\'auteur',          emoji: '🔗' },
              { label: 'Footer',        value: 'footer',       description: 'Modifier le footer',                 emoji: '🔻' },
              { label: 'Icône footer',  value: 'footer_icon',  description: 'URL de l\'icône footer',              emoji: '🖼️' },
              { label: 'Couleur',       value: 'color',        description: 'Modifier la couleur hex',            emoji: '🎨' },
              { label: 'URL',           value: 'url',          description: 'URL du titre',                       emoji: '🔗' },
              { label: 'Timestamp',     value: 'timestamp',    description: 'Activer/désactiver le timestamp',    emoji: '🕐' },
            ]);

          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(editSelect),
          );
          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('embed:nav:main').setLabel('↩️').setStyle(ButtonStyle.Secondary),
            ),
          );
        } else if (view === 'images') {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Images'),
          );
          container.addSeparatorComponents(new SeparatorBuilder());
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `> Thumbnail : ${state.thumbnail ? '\`Définie\`' : '\`Aucune\`'}\n` +
              `> Image : ${state.image ? '\`Définie\`' : '\`Aucune\`'}`,
            ),
          );
          container.addSeparatorComponents(new SeparatorBuilder());

          const imgSelect = new StringSelectMenuBuilder()
            .setCustomId('embed:edit')
            .setPlaceholder('Modifier les images...')
            .addOptions([
              { label: 'Thumbnail', value: 'thumbnail', description: 'URL ou raccourci (me, server, bot)', emoji: '🖼️' },
              { label: 'Image',     value: 'image',     description: 'URL ou raccourci (me, server, bot)', emoji: '🏞️' },
            ]);

          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(imgSelect),
          );
          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('embed:nav:main').setLabel('↩️').setStyle(ButtonStyle.Secondary),
            ),
          );
        } else if (view === 'fields') {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## Champs (${state.fields.length}/25)`),
          );
          container.addSeparatorComponents(new SeparatorBuilder());

          const list = state.fields.length
            ? state.fields.map((f, i) => `**${i + 1}.** \`${_truncate(f.name || '', 40)}\``).join('\n')
            : '_Aucun field._';
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(list),
          );
          container.addSeparatorComponents(new SeparatorBuilder());

          const fieldsSelect = new StringSelectMenuBuilder()
            .setCustomId('embed:fields')
            .setPlaceholder('Gérer les champs...')
            .addOptions([
              { label: 'Ajouter un champ',   value: 'add_field', description: 'Ajouter un field a l\'embed',     emoji: '➕' },
              { label: 'Supprimer un champ', value: 'del_field', description: 'Supprimer un field par numéro', emoji: '🗑️' },
            ]);

          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(fieldsSelect),
          );
          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('embed:nav:main').setLabel('↩️').setStyle(ButtonStyle.Secondary),
            ),
          );
        } else if (view === 'tools') {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Outils'),
          );
          container.addSeparatorComponents(new SeparatorBuilder());
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('> Réinitialiser l\'embed efface tous les champs.'),
          );
          container.addSeparatorComponents(new SeparatorBuilder());

          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('embed:reset:request').setLabel('Reset embed').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId('embed:variables').setLabel('Variables').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId('embed:copy').setLabel('Copier').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId('embed:save').setLabel('Sauvegarder').setStyle(ButtonStyle.Primary),
            ),
          );
          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('embed:nav:main').setLabel('↩️').setStyle(ButtonStyle.Secondary),
            ),
          );
        } else if (view === 'tools_reset') {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Réinitialiser l\'embed'),
          );
          container.addSeparatorComponents(new SeparatorBuilder());
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('> Cette action efface titre, description, auteur, footer, images, couleur, timestamp et tous les fields. Continuer ?'),
          );
          container.addSeparatorComponents(new SeparatorBuilder());

          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('embed:reset:confirm').setLabel('Confirmer').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId('embed:reset:cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
            ),
          );
        } else if (view === 'tools_save_confirm') {
          const saveName = state._pendingSave?.name || '???';
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Remplacer le template'),
          );
          container.addSeparatorComponents(new SeparatorBuilder());
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`> Le template \`${saveName}\` existe déjà. Remplacer ?`),
          );
          container.addSeparatorComponents(new SeparatorBuilder());
          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('embed:save:confirm').setLabel('Remplacer').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId('embed:save:cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
            ),
          );
        }

        return {
          flags           : COMPONENTS_V2_FLAG,
          components      : [container],
          allowedMentions : { parse: [], repliedUser: false },
        };
      } catch {}
    }

    return {
      embeds          : [_buildControlEmbed(state, mode), _buildPreview(state, true)],
      components      : _buildRows(mode),
      allowedMentions : { parse: [], repliedUser: false },
    };
  }

  function _buildClosedPayload(state, text) {
    if (V2_AVAILABLE) {
      try {
        const container = new ContainerBuilder().setAccentColor(_hexToInt(state.color));
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(text),
        );
        return {
          flags           : COMPONENTS_V2_FLAG,
          components      : [container],
          allowedMentions : { parse: [], repliedUser: false },
        };
      } catch {}
    }
    return {
      embeds          : [embed.build(null, text, { timestamp: false })],
      components      : [],
      allowedMentions : { parse: [], repliedUser: false },
    };
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

  async function _temporaryError(message, guildId, content) {
    const _teCfg   = db.getGuildConfig(guildId);
    const _teDelay = _teCfg?.autoDeleteDelay ?? 4;

    const sent = await message.channel.send({
      embeds: [embed.build(guildId, content, { timestamp: false })],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent) embed.scheduleDelete(sent, _teDelay);
  }

  async function _resolveTextChannel(guild, query) {
    const clean = query.replace(/[<#>]/g, '');

    if (/^\d{17,20}$/.test(clean)) {
      const channel =
        guild.channels.cache.get(clean) ??
        await guild.channels.fetch(clean).catch(() => null);

      if (
        channel?.type === ChannelType.GuildText ||
        channel?.type === ChannelType.GuildAnnouncement
      ) {
        return channel;
      }

      return null;
    }

    const lower = query.toLowerCase();

    return guild.channels.cache.find(
      ch =>
        (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) &&
        ch.name.toLowerCase() === lower
    ) ?? null;
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

    const lower = String(value).toLowerCase();
    const path  = lower.split('?')[0];

    if (/\.(png|jpe?g|gif|webp)$/i.test(path)) return true;
    if (/^https:\/\/(cdn|media)\.discordapp\.(com|net)\//i.test(lower)) return true;
    if (/^https:\/\/i\.imgur\.com\//i.test(lower)) return true;
    if (/^https:\/\/media\.tenor\.com\//i.test(lower)) return true;
    if (/^https:\/\/media\.giphy\.com\//i.test(lower)) return true;

    return false;
  }

  function _extractUserId(value) {
    const match = String(value || '').match(/^<@!?(\d{17,20})>$|^(\d{17,20})$/);
    return match?.[1] || match?.[2] || null;
  }

  async function _resolveImageInput(raw, message, client) {
    const value = String(raw || '').trim();

    if (!value) {
      return { ok: true, value: null, reset: true };
    }

    const lower = value.toLowerCase();

    if (['reset', 'clear', 'none', 'aucun', 'supprimer'].includes(lower)) {
      return { ok: true, value: null, reset: true };
    }

    if (['me', 'moi', 'mon avatar', 'avatar'].includes(lower)) {
      return {
        ok    : true,
        value : message.author.displayAvatarURL({ size: 1024 }),
      };
    }

    if (['server', 'serveur', 'guild', 'icone serveur', 'icône serveur', 'server icon'].includes(lower)) {
      const icon = message.guild?.iconURL({ size: 1024 });
      if (!icon) {
        return { ok: false, error: 'Le serveur n\'a pas d\'icône.' };
      }
      return { ok: true, value: icon };
    }

    if (['bot', 'avatar bot', 'bot avatar'].includes(lower)) {
      return {
        ok    : true,
        value : client.user.displayAvatarURL({ size: 1024 }),
      };
    }

    const userId = _extractUserId(value);
    if (userId) {
      const member =
        message.guild?.members.cache.get(userId)
        || await message.guild?.members.fetch(userId).catch(() => null);

      const user =
        member?.user
        || await client.users.fetch(userId).catch(() => null);

      if (!user) {
        return { ok: false, error: 'Utilisateur introuvable.' };
      }

      return {
        ok    : true,
        value : user.displayAvatarURL({ size: 1024 }),
      };
    }

    if (_isImageUrl(value)) {
      return { ok: true, value };
    }

    return { ok: false, error: 'Image invalide.' };
  }

  function _hasEmbedContent(state) {
    return Boolean(
      state.title ||
      state.description ||
      state.author ||
      state.footer ||
      state.thumbnail ||
      state.image ||
      state.fields.length
    );
  }

  function _totalChars(state) {
    const fieldChars = state.fields.reduce(
      (acc, f) => acc + (f.name?.length ?? 0) + (f.value?.length ?? 0),
      0
    );

    return (
      (state.title?.length ?? 0) +
      (state.description?.length ?? 0) +
      (state.author?.length ?? 0) +
      (state.footer?.length ?? 0) +
      fieldChars
    );
  }

  function _safeColor(color) {
    if (typeof color === 'string' && /^#?[0-9a-f]{6}$/i.test(color)) {
      return color.startsWith('#') ? color : `#${color}`;
    }

    return '#2f3136';
  }

  function _stateFromEmbed(embedData, defaultColor) {
    const raw = embedData?.data || embedData?.toJSON?.() || embedData || {};
    return {
      title       : raw.title || null,
      description : raw.description || null,
      author      : raw.author?.name || null,
      authorIcon  : raw.author?.icon_url || raw.author?.iconURL || null,
      authorUrl   : raw.author?.url || null,
      footer      : raw.footer?.text || null,
      footerIcon  : raw.footer?.icon_url || raw.footer?.iconURL || null,
      thumbnail   : raw.thumbnail?.url || null,
      image       : raw.image?.url || null,
      url         : raw.url || null,
      color       : raw.color != null ? `#${raw.color.toString(16).padStart(6, '0')}` : defaultColor,
      timestamp   : Boolean(raw.timestamp),
      fields      : Array.isArray(raw.fields)
        ? raw.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline ?? false }))
        : [],
      view        : 'main',
    };
  }

  function _stateToSaveData(state) {
    return {
      title       : state.title || null,
      description : state.description || null,
      author      : state.author || null,
      authorIcon  : state.authorIcon || null,
      authorUrl   : state.authorUrl || null,
      footer      : state.footer || null,
      footerIcon  : state.footerIcon || null,
      thumbnail   : state.thumbnail || null,
      image       : state.image || null,
      url         : state.url || null,
      color       : state.color || null,
      timestamp   : Boolean(state.timestamp),
      fields      : (state.fields || []).map(f => ({
        name   : f.name || '',
        value  : f.value || '',
        inline : f.inline ?? false,
      })),
    };
  }

  function _loadTemplateIntoState(state, savedData, defaultColor) {
    state.title       = savedData.title || null;
    state.description = savedData.description || null;
    state.author      = savedData.author || null;
    state.authorIcon  = savedData.authorIcon || null;
    state.authorUrl   = savedData.authorUrl || null;
    state.footer      = savedData.footer || null;
    state.footerIcon  = savedData.footerIcon || null;
    state.thumbnail   = savedData.thumbnail || null;
    state.image       = savedData.image || null;
    state.url         = savedData.url || null;
    state.color       = _safeColor(savedData.color) || defaultColor;
    state.timestamp   = Boolean(savedData.timestamp);
    state.fields      = Array.isArray(savedData.fields)
      ? savedData.fields.slice(0, 25).map(f => ({
          name   : String(f.name || ''),
          value  : String(f.value || ''),
          inline : f.inline ?? false,
        }))
      : [];
    state.view = 'main';
  }

  function _normalizeTemplateName(input) {
    return String(input || '').toLowerCase().trim();
  }

  function _isTemplateNameValid(name) {
    if (!name || name.length < 1 || name.length > 32) return false;
    if (!/^[a-z0-9_-]+$/.test(name)) return false;
    if (RESERVED_NAMES.has(name)) return false;
    return true;
  }
