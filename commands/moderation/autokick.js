'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const PAGE_SIZE    = 25;
const PANEL_TIMEOUT = 600_000;
const MODAL_TIMEOUT = 120_000;
const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

module.exports = {
  help: {
    name        : 'autokick',
    description : 'Expulser automatiquement les utilisateurs de la liste à leur arrivée.',
    usage       : 'autokick',
    aliases     : ['akick'],
    defaultPermission: 'owner',
    permission  : {
      level   : 'owner',
      label   : 'Moderation',
      discord : ['KickMembers'],
    },
  },

  async run(client, message) {
    const guild = message.guild;
    if (!guild) return;

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has('KickMembers')) {
      return embed.replyError(message, 'Je n’ai pas la permission `Expulser des membres`.');
    }

    const entries = db.getAutoKickEntries(guild.id);
    let page = 0;
    let view = 'main';
    let notice = '';

    const buildPayload = (disabled = false) =>
      _buildPanelPayload(guild.id, entries, page, notice, view, disabled);
    const panel = await message.reply(buildPayload()).catch(() => null);
    if (!panel) return;

    embed.registerPrivateInteraction(panel, message.author.id, PANEL_TIMEOUT);
    const collector = panel.createMessageComponentCollector({
      filter : interaction => interaction.user.id === message.author.id,
      idle   : PANEL_TIMEOUT,
      time   : PANEL_TIMEOUT,
    });

    collector.on('collect', async interaction => {
      try {
        if (interaction.customId === 'autokick:close') {
          await interaction.deferUpdate();
          collector.stop('closed');
          embed.clearPrivateInteraction(panel);
          await panel.delete();
          return;
        }

        if (interaction.customId === 'autokick:add') {
          view = 'add';
          notice = '';
          await interaction.update(buildPayload());
          return;
        }

        if (interaction.customId === 'autokick:addId') {
          await _showIdModal(
            interaction,
            panel,
            guild,
            message.author.id,
            entries,
            buildPayload,
            setNotice,
            setView,
            setPage,
          );
          return;
        }

        if (interaction.customId === 'autokick:members' && interaction.isUserSelectMenu()) {
          await _showReasonModal(
            interaction,
            panel,
            guild,
            message.author.id,
            entries,
            buildPayload,
            setNotice,
            setView,
            setPage,
          );
          return;
        }

        if (interaction.customId === 'autokick:list') {
          view = 'list';
          notice = '';
          await interaction.update(buildPayload());
          return;
        }

        if (interaction.customId === 'autokick:back') {
          view = 'main';
          notice = '';
          await interaction.update(buildPayload());
          return;
        }

        if (interaction.customId === 'autokick:toggle') {
          const enabled = !db.isAutoKickEnabled(guild.id);
          db.setAutoKickEnabled(guild.id, enabled);
          notice = enabled
            ? 'La protection automatique est activée.'
            : 'La protection automatique est en pause.';
          await interaction.update(buildPayload());
          return;
        }

        if (interaction.customId === 'autokick:prev' && page > 0) {
          page--;
          notice = '';
          await interaction.update(buildPayload());
          return;
        }

        if (interaction.customId === 'autokick:next' && page < Math.ceil(entries.length / PAGE_SIZE) - 1) {
          page++;
          notice = '';
          await interaction.update(buildPayload());
          return;
        }

        if (interaction.customId === 'autokick:refresh') {
          const latestEntries = db.getAutoKickEntries(guild.id);
          entries.splice(0, entries.length, ...latestEntries);
          page = Math.min(page, Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1));
          notice = 'La liste a été actualisée.';
          await interaction.update(buildPayload());
          return;
        }

        if (interaction.customId === 'autokick:remove') {
          const userId = interaction.values?.[0];
          const removed = userId && db.removeAutoKickEntry(guild.id, userId);
          if (removed) {
            const index = entries.findIndex(entry => entry.userId === userId);
            if (index !== -1) entries.splice(index, 1);
            page = Math.min(page, Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1));
            notice = `L’utilisateur \`${userId}\` a été retiré de la liste.`;
          } else {
            notice = 'Cette entrée n’est plus dans la liste.';
          }
          await interaction.update(buildPayload());
        }
      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error('[autokick] Panel interaction error:', err);
        }
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(panel);
      if (reason === 'closed') return;
      panel.edit(_buildPanelPayload(guild.id, entries, page, notice, view, true)).catch(err => {
        if (err?.code !== 10008 && err?.code !== 'ChannelNotCached') {
          console.error('[autokick] Could not disable expired panel:', err);
        }
      });
    });

    function setNotice(value) {
      notice = value;
    }

    function setView(value) {
      view = value;
    }

    function setPage(value) {
      page = value;
    }
  },
};

async function _showReasonModal(interaction, panel, guild, ownerId, entries, buildPayload, setNotice, setView, setPage) {
  const requestedIds = [...interaction.users.keys()].slice(0, 10);
  if (!requestedIds.length) {
    setNotice('Sélectionne au moins un membre dans le menu.');
    await interaction.update(buildPayload());
    return;
  }

  const { allowedIds, protectedIds } = await _partitionProtectedUsers(guild, requestedIds);
  if (!allowedIds.length) {
    setView('list');
    setNotice(`Ajout refusé : ${protectedIds.map(id => `\`${id}\``).join(', ')} ${protectedIds.length > 1 ? 'sont protégés' : 'est protégé'} par \`+pu\`, \`+angel\` ou une autre protection.`);
    await interaction.deferUpdate();
    await panel.edit(buildPayload());
    return;
  }

  const modalId = `autokick:reason:${interaction.id}`;
  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Raison (facultative)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Cette raison sera utilisée pour tous les membres sélectionnés.')
    .setMaxLength(400)
    .setRequired(false);
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(`Raison · ${allowedIds.length} membre${allowedIds.length > 1 ? 's' : ''}`)
    .addComponents(new ActionRowBuilder().addComponents(reasonInput));

  await interaction.showModal(modal);
  const submitted = await interaction.awaitModalSubmit({
    filter : candidate => candidate.customId === modalId && candidate.user.id === ownerId,
    time   : MODAL_TIMEOUT,
  }).catch(() => null);

  if (!submitted) return;

  const reason = submitted.fields.getTextInputValue('reason').trim() || null;
  const result = await _saveEntries(guild, allowedIds, reason, ownerId, entries);
  setPage(0);
  setView('list');
  setNotice(_formatSaveNotice(result, [...new Set([...protectedIds, ...result.protectedIds])]));
  await submitted.deferUpdate();
  await panel.edit(buildPayload());
}

async function _showIdModal(interaction, panel, guild, ownerId, entries, buildPayload, setNotice, setView, setPage) {
  const modalId = `autokick:id:${interaction.id}`;
  const userInput = new TextInputBuilder()
    .setCustomId('user')
    .setLabel('ID ou mention de l’utilisateur')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('123456789012345678')
    .setMinLength(17)
    .setMaxLength(22)
    .setRequired(true);
  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Raison (facultative)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Raison du futur kick automatique')
    .setMaxLength(400)
    .setRequired(false);
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle('Ajouter par ID')
    .addComponents(
      new ActionRowBuilder().addComponents(userInput),
      new ActionRowBuilder().addComponents(reasonInput),
    );

  await interaction.showModal(modal);
  const submitted = await interaction.awaitModalSubmit({
    filter : candidate => candidate.customId === modalId && candidate.user.id === ownerId,
    time   : MODAL_TIMEOUT,
  }).catch(() => null);
  if (!submitted) return;

  const rawId = submitted.fields.getTextInputValue('user').trim();
  const userId = rawId.replace(/[<@!>]/g, '');
  if (!/^\d{17,20}$/.test(userId)) {
    setNotice('ID invalide : entre un ID Discord ou une mention valide.');
    await submitted.deferUpdate();
    await panel.edit(buildPayload());
    return;
  }

  const reason = submitted.fields.getTextInputValue('reason').trim() || null;
  const result = await _saveEntries(guild, [userId], reason, ownerId, entries);
  setPage(0);
  setView('list');
  setNotice(_formatSaveNotice(result));
  await submitted.deferUpdate();
  await panel.edit(buildPayload());
}

async function _partitionProtectedUsers(guild, userIds) {
  const allowedIds = [];
  const protectedIds = [];

  for (const userId of userIds) {
    const member = guild.members.cache.get(userId)
      ?? await guild.members.fetch(userId).catch(() => null);
    if (
      perms.isProtected(userId, guild.id, member) ||
      perms.isAngelProtected(userId, guild.id)
    ) {
      protectedIds.push(userId);
    } else {
      allowedIds.push(userId);
    }
  }

  return { allowedIds, protectedIds };
}

async function _saveEntries(guild, userIds, reason, ownerId, entries) {
  const { allowedIds, protectedIds } = await _partitionProtectedUsers(guild, userIds);
  let added = 0;
  let updated = 0;
  const addedAt = Math.floor(Date.now() / 1000);

  for (const userId of allowedIds) {
    const existing = entries.find(entry => entry.userId === userId);
    db.addAutoKickEntry(guild.id, userId, reason, ownerId);

    if (existing) {
      existing.reason = reason;
      existing.addedBy = ownerId;
      existing.addedAt = addedAt;
      updated++;
    } else {
      entries.unshift({ guildId: guild.id, userId, reason, addedBy: ownerId, addedAt });
      added++;
    }
  }

  return { added, updated, protectedIds };
}

function _formatSaveNotice(result, previouslyProtectedIds = []) {
  const protectedIds = [...new Set([...previouslyProtectedIds, ...result.protectedIds])];
  const summary = `${result.added} membre${result.added === 1 ? '' : 's'} ajouté${result.added === 1 ? '' : 's'}${result.updated ? ` · ${result.updated} entrée${result.updated === 1 ? '' : 's'} mise${result.updated === 1 ? '' : 's'} à jour` : ''}.`;
  if (!protectedIds.length) return summary;
  return `${summary} Ajout refusé pour ${protectedIds.map(id => `\`${id}\``).join(', ')} : utilisateur${protectedIds.length > 1 ? 's protégés' : ' protégé'} par \`+pu\`, \`+angel\` ou une autre protection.`;
}

function _buildPanelPayload(guildId, entries, page, notice, view, disabled = false) {
  const enabled = db.isAutoKickEnabled(guildId);
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const pageEntries = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const list = pageEntries.length
    ? pageEntries.map((entry, index) => {
      const reason = entry.reason ? ` — ${entry.reason.replace(/\s+/g, ' ').slice(0, 80)}` : '';
      return `\`${page * PAGE_SIZE + index + 1}.\` <@${entry.userId}> · \`${entry.userId}\`${reason}`;
    }).join('\n')
    : 'La liste est vide. Ajoute un utilisateur pour activer l’expulsion à sa prochaine arrivée.';

  const commonHeader = `## ◈ AutoKick ・ Gestion\n\n**État** ・ ${enabled ? '◆ ACTIVÉ' : '◇ EN PAUSE'}\n**Entrées** ・ \`${entries.length}\` utilisateur${entries.length === 1 ? '' : 's'}`;
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(commonHeader));

  if (view === 'add') {
    const memberSelect = new UserSelectMenuBuilder()
      .setCustomId('autokick:members')
      .setPlaceholder('» Rechercher et sélectionner des membres')
      .setMinValues(1)
      .setMaxValues(10)
      .setDisabled(disabled);
    const addControls = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('autokick:back')
        .setLabel('‹ Retour à la liste')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('autokick:addId')
        .setLabel('» Ajouter par ID')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('autokick:close')
        .setLabel('× Fermer')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    );

    container
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        '### ◈ Ajouter des membres\n\nRecherche directement dans les membres du serveur. Tu peux en sélectionner jusqu’à **10** ; après la sélection, une fenêtre te permet d’ajouter une raison commune.'
      ))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addActionRowComponents(new ActionRowBuilder().addComponents(memberSelect))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addActionRowComponents(addControls);
  } else if (view === 'list') {
    const removeMenu = new StringSelectMenuBuilder()
      .setCustomId('autokick:remove')
      .setPlaceholder(pageEntries.length ? '» Sélectionner une entrée à retirer' : '» Liste vide')
      .setDisabled(disabled || !pageEntries.length)
      .addOptions(pageEntries.length
        ? pageEntries.map(entry => ({
          label       : `Retirer ${entry.userId}`,
          value       : entry.userId,
          description : (entry.reason || 'Aucune raison enregistrée').replace(/\s+/g, ' ').slice(0, 100),
        }))
        : [{ label: 'Liste vide', value: 'empty' }]);
    const controls = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('autokick:prev').setLabel('‹').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 0),
      new ButtonBuilder().setCustomId('autokick:next').setLabel('›').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page >= totalPages - 1),
      new ButtonBuilder().setCustomId('autokick:refresh').setLabel('↺ Actualiser').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('autokick:add').setLabel('» Ajouter').setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId('autokick:back').setLabel('‹ Retour').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    );

    container
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ◈ Liste des utilisateurs\n\n${list}\n\n-# Page \`${page + 1}/${totalPages}\``.slice(0, 4000)))
      .addActionRowComponents(new ActionRowBuilder().addComponents(removeMenu))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addActionRowComponents(controls);
  } else {
    const controls = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('autokick:add').setLabel('» Ajouter').setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId('autokick:list').setLabel('≡ Ouvrir la liste').setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('autokick:toggle').setLabel(enabled ? '◇ Mettre en pause' : '◆ Réactiver').setStyle(enabled ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('autokick:close').setLabel('× Fermer').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    );
    container
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        '### ◈ Configuration\n\nLes membres inscrits sont expulsés dès leur arrivée, tant que le système est activé.\n\n-# Les membres déjà présents ne sont pas expulsés. Les comptes protégés et les membres que le bot ne peut pas expulser sont ignorés.'
      ))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addActionRowComponents(controls);
  }

  if (notice) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`> ◇ ${notice}`.slice(0, 1000)));
  }

  return {
    embeds: [],
    components: [container],
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { parse: [] },
  };
}
