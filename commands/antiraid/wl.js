'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name        : 'wl',
  description : 'G\u00e9rer la whitelist antiraid.',
  usage       : 'wl <@cible|ID|list>',
  aliases     : ['whitelist'],
  multi       : true,
};

exports.run = async (client, message, args) => {
  const authorId = message.author.id;
  const guildId  = message.guild.id;
  const guild    = message.guild;
  const config   = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (
    !perms.isBuyer(authorId) &&
    !perms.isOwner(guildId, authorId)
  ) {
    const sent = await embed.replyError(
      message,
      'Permission refus\u00e9e.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const sub = args[0]?.toLowerCase();

  if (sub === 'list') {
    return _showList(message, guildId);
  }

  const tokens = _parseTokens(args);

  if (!tokens.length) {
    const sent = await embed.replyError(
      message,
      'Mentionnez un membre ou un r\u00f4le, ou fournissez un ID.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (tokens.length > 4) {
    const sent = await embed.replyError(
      message,
      'Vous pouvez fournir 4 cibles maximum.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  const added    = [];
  const already  = [];
  const notFound = [];

  const existing = new Set(
    db.getAntiraidWhitelist(guildId).map(e => e.targetId)
  );

  for (const token of tokens) {
    const resolved = await _resolveTarget(guild, token);

    if (!resolved) {
      notFound.push(token);
      continue;
    }

    if (existing.has(resolved.id)) {
      already.push(resolved);
      continue;
    }

    db.addAntiraidWhitelist(guildId, resolved.id, resolved.type);
    existing.add(resolved.id);
    added.push(resolved);
  }

  const parts = [];
  parts.push('## Whitelist antiraid');

  if (added.length) {
    parts.push('**Ajout\u00e9(s)** \u203a ' + added.map(t => t.display).join(', '));
  }
  if (already.length) {
    parts.push('**D\u00e9j\u00e0 whitelist** \u203a ' + already.map(t => t.display).join(', '));
  }
  if (notFound.length) {
    parts.push('**Introuvable(s)** \u203a ' + notFound.map(t => `\`${t}\``).join(', '));
  }
  if (!added.length && !already.length && !notFound.length) {
    parts.push('> Aucune action.');
  }

  const text = parts.join('\n\n');

  if (embed.shouldUseV2(guildId, module.exports.help.name)) {
    try {
      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
      const sent = await message.channel.send({
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    } catch {}
  }

  const sent = await message.channel.send({
    embeds: [
      embed.build(guildId, text.replace(/^##[^\n]*\n/, ''), { timestamp: false })
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};


async function _showList(message, guildId) {
  const list = db.getAntiraidWhitelist(guildId);
  const config = db.getGuildConfig(guildId);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (!list.length) {
    const text = '## Whitelist antiraid\n\n> Whitelist vide.';
    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
        const sent = await message.channel.send({
          components      : [container],
          flags           : COMPONENTS_V2_FLAG,
          allowedMentions : { parse: [] },
        }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      } catch {}
    }
    const sent = await embed.reply(message, 'Whitelist antiraid vide.').catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const PAGE_SIZE  = 10;
  const totalPages = Math.ceil(list.length / PAGE_SIZE);
  let   page       = 0;

  const buildPayload = (disabled = false) => {
    const slice  = list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const offset = page * PAGE_SIZE;

    const lines = slice.map((e, i) => {
      const display = e.targetType === 'role' ? `<@&${e.targetId}>` : `<@${e.targetId}>`;
      return `**${offset + i + 1}.** ${display}`;
    });

    const header = `## \u2630 Whitelist (${list.length})\n`;
    const body   = header + lines.join('\n\n');
    const footer = `-# Page ${page + 1}/${totalPages}`;

    const prevBtn = new ButtonBuilder()
      .setCustomId('local:wl:prev')
      .setLabel('\u2190')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page === 0);

    const nextBtn = new ButtonBuilder()
      .setCustomId('local:wl:next')
      .setLabel('\u2192')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page >= totalPages - 1);

    const navRow = new ActionRowBuilder().addComponents(prevBtn, nextBtn);

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
        if (totalPages > 1) container.addActionRowComponents(navRow);
        return { embeds: [], components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
      } catch {}
    }

    return {
      embeds: [embed.build(guildId, null, {
        title    : `\u2630 Whitelist (${list.length})`,
        description: slice.map((e, i) => {
          const display = e.targetType === 'role' ? `<@&${e.targetId}>` : `<@${e.targetId}>`;
          return `**${offset + i + 1}.** ${display}`;
        }).join('\n'),
        footer   : { text: `Page ${page + 1}/${totalPages}` },
        timestamp: false,
      })],
      components: totalPages > 1 ? [navRow] : [],
      allowedMentions: { parse: [] },
    };
  };

  const panel = await message.channel.send(buildPayload()).catch(() => null);
  if (!panel || totalPages <= 1) {
    if (panel && deleteReply) embed.scheduleDelete(panel, deleteDelay);
    return;
  }

  embed.registerPrivateInteraction(panel, message.author.id, 120_000);

  const collector = panel.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id && i.message.id === panel.id,
    idle   : 60_000,
    time   : 120_000,
  });

  collector.on('collect', async i => {
    if (i.customId === 'local:wl:prev') page = Math.max(0, page - 1);
    if (i.customId === 'local:wl:next') page = Math.min(totalPages - 1, page + 1);
    await i.deferUpdate().catch(() => {});
    await panel.edit(buildPayload()).catch(() => {});
  });

  collector.on('end', () => {
    embed.clearPrivateInteraction(panel);
    panel.edit(buildPayload(true)).catch(() => {});
  });
}


function _parseTokens(args) {
  const tokens = [];

  for (const arg of args) {
    if (arg === ',') continue;

    if (arg.includes(',')) {
      for (const part of arg.split(',')) {
        const trimmed = part.trim();
        if (trimmed) tokens.push(trimmed);
      }
    } else {
      tokens.push(arg);
    }
  }

  return [...new Set(tokens)];
}

async function _resolveTarget(guild, input) {
  input = input.trim();
  if (!input) return null;

  const roleMention = input.match(/^<@&(\d{17,20})>$/);
  if (roleMention) {
    const role = guild.roles.cache.get(roleMention[1])
      ?? await guild.roles.fetch(roleMention[1]).catch(() => null);
    if (role) return { id: role.id, type: 'role', display: `<@&${role.id}>` };
    return null;
  }

  const userMention = input.match(/^<@!?(\d{17,20})>$/);
  if (userMention) {
    const member = guild.members.cache.get(userMention[1])
      ?? await guild.members.fetch(userMention[1]).catch(() => null);
    if (member) return { id: member.id, type: 'user', display: `<@${member.id}>` };
    return null;
  }

  const cleaned = input.replace(/[<@!&>]/g, '').trim();
  if (/^\d{17,20}$/.test(cleaned)) {
    const role = guild.roles.cache.get(cleaned)
      ?? await guild.roles.fetch(cleaned).catch(() => null);
    if (role && role.id !== guild.id) {
      return { id: role.id, type: 'role', display: `<@&${role.id}>` };
    }

    const member = guild.members.cache.get(cleaned)
      ?? await guild.members.fetch(cleaned).catch(() => null);
    if (member) return { id: member.id, type: 'user', display: `<@${member.id}>` };

    return null;
  }

  const lowered = input.toLowerCase();
  const roleMatch = guild.roles.cache.filter(r =>
    r.name.toLowerCase() === lowered && r.id !== guild.id
  );
  if (roleMatch.size === 1) {
    const role = roleMatch.first();
    return { id: role.id, type: 'role', display: `<@&${role.id}>` };
  }


  const memberMatch = guild.members.cache.filter(m =>
    m.user.username.toLowerCase() === lowered ||
    (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
    m.displayName.toLowerCase() === lowered
  );
  if (memberMatch.size === 1) {
    const member = memberMatch.first();
    return { id: member.id, type: 'user', display: `<@${member.id}>` };
  }


  try {
    const fetched = await guild.members.fetch({ query: lowered, limit: 5 });
    const exact = fetched.filter(m =>
      m.user.username.toLowerCase() === lowered ||
      (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
      m.displayName.toLowerCase() === lowered
    );
    if (exact.size === 1) {
      const member = exact.first();
      return { id: member.id, type: 'user', display: `<@${member.id}>` };
    }
  } catch {}

  return null;
}
