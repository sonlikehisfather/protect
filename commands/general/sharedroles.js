'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
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
const IDLE_MS    = 120_000;
const TIMEOUT_MS = 300_000;

module.exports = {
  help: {
    name        : 'sharedroles',
    description : 'Affiche les rôles en commun entre deux membres.',
    usage       : 'sharedroles <membre/id/nom> [membre/id/nom]',
    aliases     : ['commonroles', 'rolesincommon', 'shroles'],
    category    : 'general',
  },

  async run(client, message, args) {
    const guildId     = message.guild.id;
    const guildConfig = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
    const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
    const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const members = message.mentions.members;

    let memberA, memberB;

    if (members.size >= 2) {
      const arr = [...members.values()];
      memberA   = arr[0];
      memberB   = arr[1];
    } else if (members.size === 1) {
      memberA = message.member;
      memberB = members.first();
    } else if (args.length >= 2) {
      memberA = await message.guild.members.fetch(args[0]).catch(() => null);
      memberB = await message.guild.members.fetch(args[1]).catch(() => null);
    } else if (args.length === 1) {
      memberA = message.member;
      memberB = await message.guild.members.fetch(args[0]).catch(() => null);
    } else {
      const sent = await embed.replyError(message, 'Mentionne au moins un membre.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!memberA || !memberB) {
      const sent = await embed.replyError(message, 'Membre(s) introuvable(s).', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const rolesA = memberA.roles.cache.filter(r => r.id !== guildId);
    const rolesB = memberB.roles.cache.filter(r => r.id !== guildId);
    const shared = rolesA.filter(r => rolesB.has(r.id)).sort((a, b) => b.position - a.position);

    const nameA = memberA.displayName;
    const nameB = memberB.displayName;

    const sent = V2_AVAILABLE
      ? await _sendV2(message, guildId, nameA, nameB, [...shared.values()], deleteReply, deleteDelay)
      : await _sendEmbed(message, guildId, nameA, nameB, [...shared.values()]);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};

function _buildPages(roles) {
  const pages = [];
  for (let i = 0; i < roles.length; i += PAGE_SIZE) {
    pages.push(roles.slice(i, i + PAGE_SIZE));
  }
  return pages.length ? pages : [[]];
}

function _buildContainer(nameA, nameB, page, pageIdx, totalPages, total) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Rôles en commun\n**${nameA}** et **${nameB}**`),
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  if (!total) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('Aucun rôle en commun.'),
    );
    return container;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(page.map(r => `<@&${r.id}> \`${r.name}\``).join('\n')),
  );

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Page ${pageIdx + 1}/${totalPages} · ${total} rôle(s) en commun`),
  );

  return container;
}

function _buildNavRow(pageIdx, totalPages, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('sr:prev')
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || pageIdx === 0),
    new ButtonBuilder()
      .setCustomId('sr:next')
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || pageIdx >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId('sr:close')
      .setLabel('✖')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

async function _sendV2(message, guildId, nameA, nameB, roles, deleteReply, deleteDelay) {
  const pages = _buildPages(roles);
  let pageIdx = 0;

  const buildPayload = (disabled = false) => {
    const container = _buildContainer(nameA, nameB, pages[pageIdx], pageIdx, pages.length, roles.length);
    if (pages.length > 1) container.addActionRowComponents(_buildNavRow(pageIdx, pages.length, disabled));
    return { flags: COMPONENTS_V2_FLAG, components: [container], embeds: [], allowedMentions: { parse: [] } };
  };

  const msg = await message.channel.send(buildPayload()).catch(() => null);
  if (!msg || pages.length <= 1) return msg;

  embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

  const collector = msg.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : IDLE_MS,
    time   : TIMEOUT_MS,
  });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'sr:close') {
        await i.deferUpdate().catch(() => {});
        embed.clearPrivateInteraction(msg);
        collector.stop('closed');
        return msg.delete().catch(() => {});
      }
      if (i.customId === 'sr:prev' && pageIdx > 0) pageIdx--;
      if (i.customId === 'sr:next' && pageIdx < pages.length - 1) pageIdx++;
      await i.update(buildPayload());
    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) console.error('[sharedroles]', err.message);
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(msg);
    if (reason === 'closed') return;
    msg.edit(buildPayload(true)).catch(() => {});
  });

  return msg;
}

async function _sendEmbed(message, guildId, nameA, nameB, roles) {
  if (!roles.length) {
    return message.channel.send({
      embeds: [embed.build(guildId, 'Aucun rôle en commun.', {
        title     : `Rôles en commun · ${nameA} & ${nameB}`,
        timestamp : false,
      })],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  const chunks = _buildPages(roles);
  let current  = 0;

  const buildEmbed = () => embed.build(guildId, chunks[current].map(r => `${r} \`${r.name}\``).join('\n'), {
    title     : `Rôles en commun · ${nameA} & ${nameB}`,
    footer    : `Page ${current + 1}/${chunks.length} · ${roles.length} rôle(s)`,
    timestamp : false,
  });

  const row = (disabled = false) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sr:prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(disabled || current === 0),
    new ButtonBuilder().setCustomId('sr:next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(disabled || current >= chunks.length - 1),
    new ButtonBuilder().setCustomId('sr:close').setLabel('✖').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );

  const components = chunks.length > 1 ? [row()] : [];
  const msg = await message.channel.send({ embeds: [buildEmbed()], components, allowedMentions: { parse: [] } }).catch(() => null);
  if (!msg || chunks.length <= 1) return msg;

  const collector = msg.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: TIMEOUT_MS, idle: IDLE_MS });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'sr:close') { await i.deferUpdate().catch(() => {}); collector.stop('closed'); return msg.delete().catch(() => {}); }
      if (i.customId === 'sr:prev' && current > 0) current--;
      if (i.customId === 'sr:next' && current < chunks.length - 1) current++;
      await i.update({ embeds: [buildEmbed()], components: [row()] });
    } catch {}
  });

  collector.on('end', (_, reason) => { if (reason === 'closed') return; msg.edit({ components: [row(true)] }).catch(() => {}); });

  return msg;
}
