'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  PermissionsBitField,
} = require('discord.js');

const {
  COMPONENTS_V2_FLAG,
  canUseFivem,
  getDeletePolicy,
  getModuleConfig,
  wrapByMode,
  reply,
  replyError,
} = require('./_shared');

const PANEL_IDLE_MS = 180_000;
const PANEL_TIME_MS = 900_000;

module.exports = {
  help: {
    name        : 'promu',
    description : 'Promotion auto via panneau interactif (hierarchie page 4).',
    usage       : 'promu',
    aliases     : ['promotion'],
    category    : 'fivem',
  },

  async run(client, message) {
    const guild = message.guild;
    const guildId = guild.id;

    if (!canUseFivem(message, module.exports.help.name)) {
      return replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.", module.exports.help.name);
    }

    const del = getDeletePolicy(guildId);
    if (del.deleteCmd) await message.delete().catch(() => {});

    const cfg = getModuleConfig(guildId);
    if (!cfg.promotionUpChannelId) {
      return replyError(message, 'Aucun salon Rank-Up configure. Configure-le dans fconfig page 4.', module.exports.help.name);
    }

    const hierarchy = (cfg.promotionRankHierarchy || []).slice(0, 15);
    if (!hierarchy.length) {
      return replyError(message, 'Aucune hierarchie de ranks configuree. Utilisez fconfig page promotion.', module.exports.help.name);
    }

    const state = {
      targetId: null,
      reason  : 'Aucune raison',
    };

    const panel = await message.channel.send(_panelPayload(guildId, state, false)).catch(() => null);
    if (!panel) return replyError(message, 'Impossible d\'ouvrir le panneau promotion.', module.exports.help.name);

    const collector = panel.createMessageComponentCollector({
      filter: i => i.user.id === message.author.id && i.message.id === panel.id,
      idle  : PANEL_IDLE_MS,
      time  : PANEL_TIME_MS,
    });

    let busy = false;

    collector.on('collect', async interaction => {
      const id = interaction.customId;
      if (busy && id !== 'prm:close') {
        await interaction.deferUpdate().catch(() => {});
        return;
      }

      if (id === 'prm:close') {
        collector.stop('closed');
        await interaction.deferUpdate().catch(() => {});
        await panel.delete().catch(() => {});
        return;
      }

      if (id === 'prm:userselect') {
        state.targetId = interaction.values?.[0] || null;
        await interaction.deferUpdate().catch(() => {});
        await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
        return;
      }

      if (id === 'prm:reason') {
        busy = true;
        const ok = await _askReason(interaction, state.reason);
        busy = false;
        if (!ok) return;
        state.reason = ok;
        await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
        return;
      }

      if (id === 'prm:apply') {
        busy = true;
        const result = await _applyPromotion(guild, message, state);
        busy = false;
        if (!result.ok) {
          await interaction.reply({ content: result.error, flags: 64 }).catch(() => {});
          return;
        }

        collector.stop('done');
        await interaction.deferUpdate().catch(() => {});
        await panel.edit(_panelPayload(guildId, state, true)).catch(() => {});
        await reply(message, 'Promotion appliquee et envoyee.', { timestamp: false }, module.exports.help.name);
        return;
      }

      await interaction.deferUpdate().catch(() => {});
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'closed' || reason === 'done') return;
      await panel.edit(_panelPayload(guildId, state, true)).catch(() => {});
    });
  },
};

function _panelPayload(guildId, state, disabled) {
  const content = [
    '## Promotion',
    '',
    `Joueur ・ ${state.targetId ? `<@${state.targetId}>` : 'Non selectionne'}`,
    `Raison ・ ${state.reason || 'Aucune raison'}`,
  ].join('\n');

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('prm:userselect')
          .setPlaceholder('Selectionne le joueur (recherche possible)')
          .setMinValues(1)
          .setMaxValues(1)
          .setDisabled(disabled),
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prm:reason').setLabel('Raison').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('prm:apply').setLabel('Valider Rank-Up').setStyle(ButtonStyle.Success).setDisabled(disabled || !state.targetId),
        new ButtonBuilder().setCustomId('prm:close').setLabel('Fermer').setStyle(ButtonStyle.Danger).setDisabled(disabled),
      )
    );

  return wrapByMode(guildId, {
    components      : [container],
    flags           : COMPONENTS_V2_FLAG,
    embeds          : [],
    allowedMentions : { parse: [] },
  }, module.exports.help.name);
}

async function _askReason(interaction, initialReason) {
  const modalId = `prm:modal:reason:${interaction.id}`;
  const input = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Raison')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(900);

  if (initialReason) input.setValue(String(initialReason).slice(0, 900));

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle('Raison promotion')
    .addComponents(new ActionRowBuilder().addComponents(input));

  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  if (!shown) return null;

  const submit = await interaction.awaitModalSubmit({
    filter: i => i.customId === modalId && i.user.id === interaction.user.id,
    time  : 120_000,
  }).catch(() => null);
  if (!submit) return null;

  const reason = (submit.fields.getTextInputValue('reason') || '').trim() || 'Aucune raison';
  await submit.deferUpdate().catch(() => {});
  return reason;
}

async function _applyPromotion(guild, message, state) {
  const cfg = getModuleConfig(guild.id);
  const hierarchy = (cfg.promotionRankHierarchy || []).slice(0, 15);
  const target = await guild.members.fetch(state.targetId).catch(() => null);
  if (!target) return { ok: false, error: 'Joueur introuvable.' };

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return { ok: false, error: "Je n'ai pas la permission de gerer les roles." };
  }

  const matchedIndices = hierarchy
    .map((roleId, idx) => (target.roles.cache.has(roleId) ? idx : -1))
    .filter(idx => idx >= 0);

  if (!matchedIndices.length) return { ok: false, error: 'Ce membre ne possede aucun role de la hierarchie.' };

  const currentIdx = Math.max(...matchedIndices);
  if (currentIdx <= 0) return { ok: false, error: 'Ce membre est deja au plus haut rang.' };

  const oldRank = guild.roles.cache.get(hierarchy[currentIdx]);
  const newRank = guild.roles.cache.get(hierarchy[currentIdx - 1]);
  if (!oldRank || !newRank) return { ok: false, error: 'Un role de hierarchie est introuvable.' };
  if (oldRank.position >= me.roles.highest.position || newRank.position >= me.roles.highest.position) {
    return { ok: false, error: 'Hierarchie invalide pour mes permissions.' };
  }

  const removeOk = await target.roles.remove(oldRank.id, `Promotion auto by ${message.author.tag}`).then(() => true).catch(() => false);
  if (!removeOk) return { ok: false, error: 'Impossible de retirer l\'ancien grade.' };

  const addOk = await target.roles.add(newRank.id, `Promotion auto by ${message.author.tag}`).then(() => true).catch(() => false);
  if (!addOk) return { ok: false, error: 'Impossible d\'ajouter le nouveau grade.' };

  const channel = guild.channels.cache.get(cfg.promotionUpChannelId || cfg.promotionChannelId || '');
  if (!channel?.isTextBased?.()) return { ok: false, error: 'Salon Rank-Up introuvable.' };

  const body = [
    '```ini',
    '[Rank-Up]',
    '```',
    '**Promotion:**',
    '',
    `-> Joueur : <@${target.id}>`,
    `-> Raison : ${state.reason || 'Aucune raison'}`,
    `-> Ancien grade : <@&${oldRank.id}>`,
    `-> Nouveau grade : <@&${newRank.id}>`,
  ].join('\n');

  await channel.send({
    content: body,
    allowedMentions: { parse: [] },
  }).catch(() => null);

  return { ok: true };
}
