'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder   === 'function' &&
  typeof TextDisplayBuilder === 'function' &&
  typeof SeparatorBuilder   === 'function'
);

const PAGE_SIZE  = 10;
const TIMEOUT_MS = 300_000;

const VIEW_MAIN   = 'main';
const VIEW_CONFIG = 'config';

module.exports = {
  help: {
    name        : 'keyword',
    description : 'Ouvre le panel de gestion de tes mots-clés (notifications DM).',
    usage       : 'keyword',
    aliases     : ['kw', 'keywords', 'highlight'],
    category    : 'general',
  },

  async run(client, message) {
    const guildId     = message.guild.id;
    const guildConfig = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);

    if (deleteCmd) await message.delete().catch(() => {});

    await openPanel(message.channel, message.author, guildId, deleteCmd ? null : message);
  },
};

function buildMainPayload(ownerId, guildId, status = null, disabled = false, pageIdx = 0) {
  const list  = db.getKeywords(ownerId, guildId);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page  = list.slice(pageIdx * PAGE_SIZE, (pageIdx + 1) * PAGE_SIZE);
  const offset = pageIdx * PAGE_SIZE;

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Mots-clés — notifications DM\nTu seras notifié en DM quand un mot-clé est mentionné dans ce serveur.`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  if (list.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        page.map((r, i) => {
          const targets = r.targets ?? [ownerId];
          const targetStr = targets.length === 1 && targets[0] === ownerId
            ? ''
            : ' \u2192 ' + targets.map(t => `<@${t}>`).join(', ');
          return `**${offset + i + 1}.** \`${r.keyword}\`${targetStr}`;
        }).join('\n'),
      ),
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('Aucun mot-clé enregistré.'),
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder());
  if (status) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${status}`),
    );
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${list.length} mot(s)-clé(s)${pages > 1 ? ` · page ${pageIdx + 1}/${pages}` : ''}`),
  );

  const actionBtns = [
    new ButtonBuilder()
      .setCustomId('kw:add')
      .setLabel('Ajouter')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('kw:remove')
      .setLabel('Retirer')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || list.length === 0),
    new ButtonBuilder()
      .setCustomId('kw:config')
      .setLabel('Config')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || list.length === 0),
    new ButtonBuilder()
      .setCustomId('kw:clear')
      .setLabel('Tout effacer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled || list.length === 0),
    new ButtonBuilder()
      .setCustomId('kw:close')
      .setLabel('\u2716')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  ];
  container.addActionRowComponents(new ActionRowBuilder().addComponents(...actionBtns));

  if (pages > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('kw:prev')
          .setLabel('◄')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || pageIdx === 0),
        new ButtonBuilder()
          .setCustomId('kw:next')
          .setLabel('►')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || pageIdx >= pages - 1),
      ),
    );
  }

  return { flags: COMPONENTS_V2_FLAG, components: [container], embeds: [], allowedMentions: { parse: [] } };
}

function buildConfigPayload(ownerId, guildId, selectedKw = null, status = null, disabled = false) {
  const list = db.getKeywords(ownerId, guildId);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Config — Notifications par mot-clé\nChoisis un mot-clé puis sélectionne les personnes à notifier (multi-select).`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  if (list.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        list.map((r, i) => {
          const sel = selectedKw === r.keyword ? '**>** ' : '';
          const targets = r.targets ?? [ownerId];
          const targetStr = targets.length === 1 && targets[0] === ownerId
            ? ' \u2192 toi'
            : ' \u2192 ' + targets.map(t => `<@${t}>`).join(', ');
          return `${sel}**${i + 1}.** \`${r.keyword}\`${targetStr}`;
        }).join('\n'),
      ),
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder());
  if (status) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${status}`),
    );
  }

  const kwButtons = list.slice(0, 5).map((r, i) =>
    new ButtonBuilder()
      .setCustomId(`kw:sel:${Buffer.from(r.keyword).toString('base64')}`)
      .setLabel(`${i + 1}. ${r.keyword.slice(0, 15)}`)
      .setStyle(selectedKw === r.keyword ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled),
  );

  if (kwButtons.length) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(...kwButtons));
  }

  if (selectedKw) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`kw:settarget:${Buffer.from(selectedKw).toString('base64')}`)
          .setPlaceholder('Sélectionne les personnes à notifier')
          .setMinValues(1)
          .setMaxValues(10)
          .setDisabled(disabled),
      ),
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`kw:resettarget:${Buffer.from(selectedKw).toString('base64')}`)
          .setLabel('Remettre sur moi')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
      ),
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('kw:back')
        .setLabel('Retour')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
  );

  return { flags: COMPONENTS_V2_FLAG, components: [container], embeds: [], allowedMentions: { parse: [] } };
}

async function openPanel(channel, author, guildId, invokeMsg = null) {
  if (!V2_AVAILABLE) {
    const list = db.getKeywords(author.id, guildId);
    const desc = list.length
      ? list.map((r, i) => `**${i + 1}.** \`${r.keyword}\``).join('\n')
      : 'Aucun mot-clé enregistré.';
    return channel.send({
      embeds: [embed.build(guildId, desc, {
        title  : 'Mots-clés — notifications DM',
        footer : `${list.length}/${MAX_KEYWORDS}`,
        timestamp: false,
      })],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  const msg = await channel.send(buildMainPayload(author.id, guildId)).catch(() => null);
  if (!msg) return null;

  embed.registerPrivateInteraction(msg, author.id, TIMEOUT_MS);

  let view       = VIEW_MAIN;
  let selectedKw = null;
  let pageIdx    = 0;

  const collector = msg.createMessageComponentCollector({
    filter : i => i.user.id === author.id,
    time   : TIMEOUT_MS,
  });

  collector.on('collect', async i => {
    try {
      // ── Fermer ──────────────────────────────────────────────────────────
      if (i.customId === 'kw:close') {
        await i.deferUpdate().catch(() => {});
        embed.clearPrivateInteraction(msg);
        collector.stop('closed');
        if (invokeMsg) invokeMsg.delete().catch(() => {});
        return msg.delete().catch(() => {});
      }

      // ── Vue principale ───────────────────────────────────────────────────
      if (i.customId === 'kw:back') {
        view = VIEW_MAIN;
        selectedKw = null;
        return i.update(buildMainPayload(author.id, guildId, null, false, pageIdx)).catch(() => {});
      }

      if (i.customId === 'kw:prev') {
        if (pageIdx > 0) pageIdx--;
        return i.update(buildMainPayload(author.id, guildId, null, false, pageIdx)).catch(() => {});
      }

      if (i.customId === 'kw:next') {
        pageIdx++;
        return i.update(buildMainPayload(author.id, guildId, null, false, pageIdx)).catch(() => {});
      }

      if (i.customId === 'kw:config') {
        view = VIEW_CONFIG;
        selectedKw = null;
        return i.update(buildConfigPayload(author.id, guildId, null)).catch(() => {});
      }

      if (i.customId === 'kw:clear') {
        db.clearKeywords(author.id, guildId);
        view = VIEW_MAIN;
        selectedKw = null;
        pageIdx = 0;
        return i.update(buildMainPayload(author.id, guildId, 'Tous les mots-clés effacés.')).catch(() => {});
      }

      if (i.customId === 'kw:add') {
        const modal = new ModalBuilder()
          .setCustomId(`kw:modal:add:${msg.id}`)
          .setTitle('Ajouter un mot-clé');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('keyword')
              .setLabel('Mot-clé (2–50 caractères)')
              .setStyle(TextInputStyle.Short)
              .setMinLength(2)
              .setMaxLength(50)
              .setRequired(true)
              .setPlaceholder('Ex: mon pseudo, mon projet...'),
          ),
        );
        return i.showModal(modal).catch(() => {});
      }

      if (i.customId === 'kw:remove') {
        const modal = new ModalBuilder()
          .setCustomId(`kw:modal:remove:${msg.id}`)
          .setTitle('Retirer un mot-clé');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('keyword')
              .setLabel('Mot-clé exact à retirer')
              .setStyle(TextInputStyle.Short)
              .setMinLength(2)
              .setMaxLength(50)
              .setRequired(true)
              .setPlaceholder('Saisis exactement le mot-clé à supprimer'),
          ),
        );
        return i.showModal(modal).catch(() => {});
      }

      // ── Vue Config ───────────────────────────────────────────────────────
      if (i.customId.startsWith('kw:sel:')) {
        const kw = Buffer.from(i.customId.slice('kw:sel:'.length), 'base64').toString();
        selectedKw = selectedKw === kw ? null : kw;
        return i.update(buildConfigPayload(author.id, guildId, selectedKw)).catch(() => {});
      }

      if (i.customId.startsWith('kw:settarget:') && i.isUserSelectMenu?.()) {
        const kw = Buffer.from(i.customId.slice('kw:settarget:'.length), 'base64').toString();
        db.setKeywordTargets(author.id, guildId, kw, i.values);
        selectedKw = kw;
        const names = i.values.map(id => `<@${id}>`).join(', ');
        return i.update(buildConfigPayload(author.id, guildId, selectedKw, `${names} seront notifiés pour \`${kw}\`.`)).catch(() => {});
      }

      if (i.customId.startsWith('kw:resettarget:')) {
        const kw = Buffer.from(i.customId.slice('kw:resettarget:'.length), 'base64').toString();
        db.setKeywordTargets(author.id, guildId, kw, [author.id]);
        selectedKw = kw;
        return i.update(buildConfigPayload(author.id, guildId, selectedKw, `Notifications remises sur toi pour \`${kw}\`.`)).catch(() => {});
      }

    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) console.error('[keyword]', err.message);
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(msg);
    if (reason === 'closed') return;
    if (view === VIEW_MAIN) msg.edit(buildMainPayload(author.id, guildId, null, true, pageIdx)).catch(() => {});
    else msg.edit(buildConfigPayload(author.id, guildId, selectedKw, null, true)).catch(() => {});
  });

  return msg;
}

async function handleModalSubmit(interaction) {
  const parts  = interaction.customId.split(':');
  const action = parts[2];
  const msgId  = parts[3];

  const guildId = interaction.guild?.id;
  const userId  = interaction.user.id;
  const keyword = interaction.fields.getTextInputValue('keyword').trim().toLowerCase();

  await interaction.deferUpdate().catch(() => {});

  const msg = interaction.message ?? await interaction.channel?.messages.fetch(msgId).catch(() => null);

  if (action === 'add') {
    if (keyword.length < 2 || keyword.length > 50) {
      return msg?.edit(buildMainPayload(userId, guildId, 'Mot-clé invalide (2–50 caractères).')).catch(() => {});
    }
    const added = db.addKeyword(userId, guildId, keyword);
    const status = added
      ? `Mot-clé \`${keyword}\` ajouté.`
      : `\`${keyword}\` est déjà dans ta liste ou la limite de ${MAX_KEYWORDS} est atteinte.`;
    return msg?.edit(buildMainPayload(userId, guildId, status)).catch(() => {});
  }

  if (action === 'remove') {
    const removed = db.removeKeyword(userId, guildId, keyword);
    const status = removed
      ? `Mot-clé \`${keyword}\` retiré.`
      : `\`${keyword}\` introuvable dans ta liste.`;
    return msg?.edit(buildMainPayload(userId, guildId, status)).catch(() => {});
  }
}

module.exports.openPanel        = openPanel;
module.exports.handleModalSubmit = handleModalSubmit;
