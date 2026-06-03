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
    name        : 'rolelog',
    description : "Affiche l'historique des rôles ajoutés/retirés d'un membre.",
    usage       : 'rolelog [membre/id/nom]',
    aliases     : ['rolehistory', 'roleslog'],
    category    : 'general',
  },

  async run(client, message, args) {
    const guildId     = message.guild.id;
    const guildConfig = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
    const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
    const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const target = await resolveUser(client, message, args);

    if (!target) {
      const sent = await embed.replyError(message, 'Membre introuvable.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const history     = db.getRolelog(target.id, guildId);
    const fetchedUser = await client.users.fetch(target.id, { force: false }).catch(() => target);
    const displayName = fetchedUser.globalName
      ? `${fetchedUser.globalName} (@${fetchedUser.username})`
      : `@${fetchedUser.username}`;

    const sent = V2_AVAILABLE
      ? await _sendV2(message, guildId, displayName, history)
      : await _sendEmbed(message, guildId, fetchedUser, displayName, history);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};

function _fmtEntry(r) {
  const tag = r.action === 'add' ? '[+]' : '[-]';
  return `\`${tag}\` <@&${r.roleId}> — <t:${r.changedAt}:R>`;
}

function _buildPages(history) {
  const pages = [];
  for (let i = 0; i < history.length; i += PAGE_SIZE) {
    pages.push(history.slice(i, i + PAGE_SIZE));
  }
  return pages.length ? pages : [[]];
}

function _buildContainer(displayName, page, pageIdx, totalPages, total) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Historique des rôles\n**${displayName}**`),
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  if (!total) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('Aucun changement de rôle enregistré pour ce membre.'),
    );
    return container;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(page.map(_fmtEntry).join('\n')),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Page ${pageIdx + 1}/${totalPages} · ${total} entrée(s)`),
  );

  return container;
}

function _buildNavRow(pageIdx, totalPages, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('rl:prev')
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || pageIdx === 0),
    new ButtonBuilder()
      .setCustomId('rl:next')
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || pageIdx >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId('rl:close')
      .setLabel('✖')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

async function _sendV2(message, guildId, displayName, history) {
  const pages = _buildPages(history);
  let pageIdx = 0;

  const buildPayload = (disabled = false) => {
    const container = _buildContainer(displayName, pages[pageIdx], pageIdx, pages.length, history.length);
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
      if (i.customId === 'rl:close') {
        await i.deferUpdate().catch(() => {});
        embed.clearPrivateInteraction(msg);
        collector.stop('closed');
        return msg.delete().catch(() => {});
      }
      if (i.customId === 'rl:prev' && pageIdx > 0) pageIdx--;
      if (i.customId === 'rl:next' && pageIdx < pages.length - 1) pageIdx++;
      await i.update(buildPayload());
    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) console.error('[rolelog]', err.message);
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(msg);
    if (reason === 'closed') return;
    msg.edit(buildPayload(true)).catch(() => {});
  });

  return msg;
}

async function _sendEmbed(message, guildId, fetchedUser, displayName, history) {
  const avatarURL = fetchedUser.displayAvatarURL({ dynamic: true, size: 256 });

  if (!history.length) {
    return message.channel.send({
      embeds: [embed.build(guildId, 'Aucun changement de rôle enregistré pour ce membre.', {
        title      : 'Historique des rôles',
        authorName : displayName,
        authorIcon : avatarURL,
        timestamp  : false,
      })],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  const pages  = _buildPages(history);
  let current  = 0;

  const buildEmbed = () => embed.build(guildId, pages[current].map(_fmtEntry).join('\n'), {
    title      : 'Historique des rôles',
    authorName : displayName,
    authorIcon : avatarURL,
    footer     : `Page ${current + 1}/${pages.length} · ${history.length} entrée(s)`,
    timestamp  : false,
  });

  const navRow = (disabled = false) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rl:prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(disabled || current === 0),
    new ButtonBuilder().setCustomId('rl:next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(disabled || current >= pages.length - 1),
    new ButtonBuilder().setCustomId('rl:close').setLabel('✖').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );

  const components = pages.length > 1 ? [navRow()] : [];
  const msg = await message.channel.send({ embeds: [buildEmbed()], components, allowedMentions: { parse: [] } }).catch(() => null);
  if (!msg || pages.length <= 1) return msg;

  const collector = msg.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: TIMEOUT_MS, idle: IDLE_MS });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'rl:close') { await i.deferUpdate().catch(() => {}); collector.stop('closed'); return msg.delete().catch(() => {}); }
      if (i.customId === 'rl:prev' && current > 0) current--;
      if (i.customId === 'rl:next' && current < pages.length - 1) current++;
      await i.update({ embeds: [buildEmbed()], components: [navRow()] });
    } catch {}
  });

  collector.on('end', (_, reason) => { if (reason === 'closed') return; msg.edit({ components: [navRow(true)] }).catch(() => {}); });

  return msg;
}

async function resolveUser(client, message, args) {
  const mention = message.mentions.users.first();
  if (mention) return mention;

  const raw = args.join(' ').trim();
  if (!raw) return message.author;

  const cleaned = raw.replace(/[<@!>]/g, '').trim();
  if (/^\d{17,20}$/.test(cleaned)) return client.users.fetch(cleaned).catch(() => null);

  const lowered = raw.toLowerCase();

  let member = message.guild.members.cache.find(m =>
    m.user.username.toLowerCase() === lowered ||
    (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
    m.displayName.toLowerCase() === lowered
  );
  if (member) return member.user;

  member = message.guild.members.cache.find(m =>
    m.user.username.toLowerCase().includes(lowered) ||
    (m.user.globalName && m.user.globalName.toLowerCase().includes(lowered)) ||
    m.displayName.toLowerCase().includes(lowered)
  );
  if (member) return member.user;

  const fetched = await message.guild.members.fetch().catch(() => null);
  if (fetched) {
    member = fetched.find(m =>
      m.user.username.toLowerCase() === lowered ||
      (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
      m.displayName.toLowerCase() === lowered
    );
    if (member) return member.user;
  }

  return null;
}
