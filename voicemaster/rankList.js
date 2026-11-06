'use strict';

/**
 * VoiceMaster - liste paginée des membres d'un rang (=ow, =sys, =sys+, =wl sans argument).
 * Boutons : premier / précédent / page / suivant / dernier.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('discord.js');

const embed = require('../utils/embed');

const PAGE_SIZE = 10;
const IDLE_MS   = 60_000;
const TOTAL_MS  = 120_000;

function _buildPayload({ guild, title, ids, authorId, page, totalPages, disabled = false }) {
  const slice = ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const lines = slice.length
    ? slice.map((id, index) => `${page * PAGE_SIZE + index + 1}. <@${id}>`).join('\n')
    : 'Aucun';

  const footer = `-# Total : ${ids.length} ・ Demandé par <@${authorId}>`;

  const button = (id, label, off) =>
    new ButtonBuilder()
      .setCustomId(`vm:ranklist:${id}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || off);

  const row = new ActionRowBuilder().addComponents(
    button('first', '«', page === 0),
    button('prev',  '‹', page === 0),
    button('page',  `${page + 1}/${totalPages}`, true),
    button('next',  '›', page >= totalPages - 1),
    button('last',  '»', page >= totalPages - 1),
  );

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${lines}\n\n${footer}`));

  if (totalPages > 1) container.addActionRowComponents(row);

  return {
    embeds          : [],
    components      : [container],
    flags           : MessageFlags.IsComponentsV2,
    allowedMentions : { parse: [] },
  };
}

async function sendRankList(message, title, ids) {
  const guild      = message.guild;
  const authorId   = message.author.id;
  const totalPages = Math.max(1, Math.ceil(ids.length / PAGE_SIZE));
  let page = 0;

  const state = () => ({ guild, title, ids, authorId, page, totalPages });

  const panel = await message.reply({
    ..._buildPayload(state()),
    allowedMentions: { parse: [], repliedUser: false },
  }).catch(() => null);

  if (!panel || totalPages <= 1) return;

  embed.registerPrivateInteraction(panel, authorId, TOTAL_MS);

  const collector = panel.createMessageComponentCollector({
    filter : i => i.user.id === authorId && i.message.id === panel.id,
    idle   : IDLE_MS,
    time   : TOTAL_MS,
  });

  collector.on('collect', async i => {
    const action = i.customId.split(':')[2];
    if (action === 'first') page = 0;
    if (action === 'prev')  page = Math.max(0, page - 1);
    if (action === 'next')  page = Math.min(totalPages - 1, page + 1);
    if (action === 'last')  page = totalPages - 1;

    await i.deferUpdate().catch(() => {});
    await panel.edit(_buildPayload(state())).catch(() => {});
  });

  collector.on('end', () => {
    embed.clearPrivateInteraction(panel);
    panel.edit(_buildPayload({ ...state(), disabled: true })).catch(() => {});
  });
}

module.exports = { sendRankList };
