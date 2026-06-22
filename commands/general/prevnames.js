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
  typeof ContainerBuilder    === 'function' &&
  typeof TextDisplayBuilder  === 'function' &&
  typeof SeparatorBuilder    === 'function'
);

const PAGE_SIZE  = 5;
const IDLE_MS    = 120_000;
const TIMEOUT_MS = 300_000;

module.exports = {
  help: {
    name        : 'prevnames',
    description : "Affiche l'historique des pseudos d'un utilisateur.",
    usage       : 'prevnames <membre/id/nom>',
    aliases     : ['pn', 'oldnames', 'namehist'],
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
      const sent = await embed.replyError(message, 'Utilisateur introuvable.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const history = db.getPrevNames(target.id, guildId);

    const fetchedUser = await client.users.fetch(target.id, { force: false }).catch(() => target);
    const displayName = fetchedUser.globalName
      ? `${fetchedUser.globalName} (@${fetchedUser.username})`
      : `@${fetchedUser.username}`;

    const usernames   = history.filter(r => r.type === 'username');
    const globalNames = history.filter(r => r.type === 'globalname');
    const nicknames   = history.filter(r => r.type === 'nickname');

    const sent = V2_AVAILABLE
      ? await _sendV2(message, guildId, displayName, history, usernames, globalNames, nicknames)
      : await _sendEmbed(message, guildId, fetchedUser, displayName, history, usernames, globalNames, nicknames);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};

async function resolveUser(client, message, args) {
  if (message.reference?.messageId) {
    const replied = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (replied?.author) return replied.author;
  }

  const mention = message.mentions.users.first();
  if (mention) return mention;

  const raw = args.join(' ').trim();
  if (!raw) return message.author;

  const cleaned = raw.replace(/[<@!>]/g, '').trim();

  if (/^\d{17,20}$/.test(cleaned)) {
    return client.users.fetch(cleaned).catch(() => null);
  }

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

    member = fetched.find(m =>
      m.user.username.toLowerCase().includes(lowered) ||
      (m.user.globalName && m.user.globalName.toLowerCase().includes(lowered)) ||
      m.displayName.toLowerCase().includes(lowered)
    );
    if (member) return member.user;
  }

  return null;
}

function _fmtEntry(r) {
  return `\`${r.name}\` ・ <t:${r.changedAt}:R>`;
}

function _buildPages(usernames, globalNames, nicknames) {
  const pages = [];

  const sections = [
    { label: "Noms d'utilisateur", rows: usernames },
    { label: 'Noms affichés',      rows: globalNames },
    { label: 'Pseudos serveur',    rows: nicknames },
  ].filter(s => s.rows.length > 0);

  for (const { label, rows } of sections) {
    for (let i = 0; i < rows.length; i += PAGE_SIZE) {
      pages.push({ label, entries: rows.slice(i, i + PAGE_SIZE), total: rows.length });
    }
  }

  return pages;
}

function _buildContainer(displayName, page, pageIdx, totalPages) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Historique des pseudos\n**${displayName}**`),
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  if (!page) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('Aucun ancien pseudo enregistré pour cet utilisateur.'),
    );
    return container;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**${page.label} (${page.total})**\n` +
      page.entries.map(_fmtEntry).join('\n'),
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Page ${pageIdx + 1}/${totalPages} · ${page.total} pseudo(s)`),
  );

  return container;
}

function _buildNavRow(pageIdx, totalPages, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('pn:prev')
      .setLabel('\u2190')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || pageIdx === 0),
    new ButtonBuilder()
      .setCustomId('pn:next')
      .setLabel('\u2192')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || pageIdx >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId('pn:close')
      .setLabel('\u2716')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

async function _sendV2(message, guildId, displayName, history, usernames, globalNames, nicknames) {
  const pages = _buildPages(usernames, globalNames, nicknames);
  let pageIdx = 0;

  const buildPayload = (disabled = false) => {
    const container = _buildContainer(
      displayName,
      pages[pageIdx] ?? null,
      pageIdx,
      pages.length || 1,
    );

    const payload = {
      flags      : COMPONENTS_V2_FLAG,
      components : [container],
      embeds     : [],
      allowedMentions: { parse: [] },
    };

    if (pages.length > 1) {
      container.addActionRowComponents(_buildNavRow(pageIdx, pages.length, disabled));
    }

    return payload;
  };

  const msg = await message.channel.send(buildPayload()).catch(() => null);
  if (!msg) return null;

  if (pages.length <= 1) return msg;

  embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

  const collector = msg.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : IDLE_MS,
    time   : TIMEOUT_MS,
  });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'pn:close') {
        await i.deferUpdate().catch(() => {});
        embed.clearPrivateInteraction(msg);
        collector.stop('closed');
        return msg.delete().catch(() => {});
      }

      if (i.customId === 'pn:prev' && pageIdx > 0) pageIdx--;
      if (i.customId === 'pn:next' && pageIdx < pages.length - 1) pageIdx++;

      await i.update(buildPayload());
    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) {
        console.error('[prevnames] collect error:', err.message);
      }
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(msg);
    if (reason === 'closed') return;
    msg.edit(buildPayload(true)).catch(() => {});
  });

  return msg;
}

async function _sendEmbed(message, guildId, fetchedUser, displayName, history, usernames, globalNames, nicknames) {
  const avatarURL = fetchedUser.displayAvatarURL({ dynamic: true, size: 256 });

  if (!history.length) {
    return message.channel.send({
      embeds: [embed.build(guildId, 'Aucun ancien pseudo enregistré pour cet utilisateur.', {
        title      : 'Historique des pseudos',
        authorName : fetchedUser.globalName ?? fetchedUser.username,
        color      : '#FEE75C',
        timestamp  : false,
      })],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  const fields = [];

  if (usernames.length) {
    fields.push({
      name  : `Noms d'utilisateur (${usernames.length})`,
      value : _fmtEntries(usernames),
      inline: false,
    });
  }

  if (globalNames.length) {
    fields.push({
      name  : `Noms affichés (${globalNames.length})`,
      value : _fmtEntries(globalNames),
      inline: false,
    });
  }

  if (nicknames.length) {
    fields.push({
      name  : `Pseudos serveur (${nicknames.length})`,
      value : _fmtEntries(nicknames),
      inline: false,
    });
  }

  return message.channel.send({
    embeds: [embed.build(guildId, null, {
      title      : 'Historique des pseudos',
      authorName : displayName,
      thumbnail  : avatarURL,
      fields,
      footer     : `${history.length} pseudo(s) affiché(s) (max ${MAX_DISPLAY})`,
      timestamp  : false,
    })],
    allowedMentions: { parse: [] },
  }).catch(() => null);
}
