'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const store    = require('../store');
const messages = require('../messages');
const embed    = require('../../utils/embed');
const { LEVELS } = require('../config');

const PAGE_SIZE = 10;
const IDLE_MS   = 60_000;
const TOTAL_MS  = 120_000;

function _collectEntries(guild) {
  const entries = [];

  for (const pv of store.listPv(guild.id)) {
    const channel = guild.channels.cache.get(pv.channelId);

    if (!channel) {
      store.removePv(guild.id, pv.channelId);
      continue;
    }

    entries.push({
      channelId : pv.channelId,
      ownerId   : pv.ownerId,
      access    : store.countAccess(guild.id, pv.channelId),
      present   : channel.members?.size ?? 0,
    });
  }

  return entries;
}

function _buildPayload(guild, authorId, entries, page, totalPages, disabled = false) {
  const slice = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const blocks = slice.map(e =>
    `<#${e.channelId}> - Propriétaire : <@${e.ownerId}>\n` +
    `-# ${messages.pvAccessCount(e.access)} ・ ${messages.pvPresentCount(e.present)}`
  );

  const description = [
    `__Salons privés__ › ${entries.length}`,
    '',
    blocks.join('\n\n'),
    '',
    `→ Demandé par <@${authorId}>`,
  ].join('\n');

  const button = (id, label, off) =>
    new ButtonBuilder()
      .setCustomId(`vm:pvlist:${id}`)
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

  if (embed.shouldUseV2(guild.id, 'pvlist')) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### Liste des salons privés
${description}`)
    );
    if (totalPages > 1) container.addActionRowComponents(row);

    return {
      embeds          : [],
      components      : [container],
      flags           : MessageFlags.IsComponentsV2,
      allowedMentions : { parse: [] },
    };
  }

  return {
    embeds: [embed.build(guild.id, description, {
      title     : 'Liste des salons privés',
      timestamp : false,
    })],
    components      : totalPages > 1 ? [row] : [],
    allowedMentions : { parse: [] },
  };
}

module.exports = {
  name    : 'pvlist',
  description : "Affiche la liste des salons privés.",
  minRank : LEVELS.OWNER,
  usage   : '=pvlist',

  async run({ message, reply }) {
    const guild    = message.guild;
    const authorId = message.author.id;

    const entries = _collectEntries(guild);
    if (!entries.length) return reply(messages.pvListEmpty());

    const totalPages = Math.ceil(entries.length / PAGE_SIZE);
    let page = 0;

    const panel = await message.reply({
      ..._buildPayload(guild, authorId, entries, page, totalPages),
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
      await panel.edit(_buildPayload(guild, authorId, entries, page, totalPages)).catch(() => {});
    });

    collector.on('end', () => {
      embed.clearPrivateInteraction(panel);
      panel.edit(_buildPayload(guild, authorId, entries, page, totalPages, true)).catch(() => {});
    });
  },
};
