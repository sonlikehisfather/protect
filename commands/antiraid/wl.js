'use strict';

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
    !perms.isGlobalOwner(authorId)
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
    const list = db.getAntiraidWhitelist(guildId);

    const lines = list.map(entry =>
      entry.targetType === 'role'
        ? `<@&${entry.targetId}>`
        : `<@${entry.targetId}>`
    );

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          null,
          {
            title : 'Whitelist antiraid',
            fields: [
              {
                name   : `${list.length} entr\u00e9e(s)`,
                value  : list.length
                  ? lines.join('\n').slice(0, 1024)
                  : 'Whitelist antiraid vide.',
                inline : false,
              },
            ],
            timestamp: false,
          }
        )
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
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

  const lines = [];
  if (added.length)    lines.push(`**${added.length}** ajout\u00e9(s) : ${added.map(t => t.display).join(', ')}`);
  if (already.length)  lines.push(`**${already.length}** d\u00e9j\u00e0 whitelist : ${already.map(t => t.display).join(', ')}`);
  if (notFound.length) lines.push(`**${notFound.length}** introuvable(s) : ${notFound.map(t => `\`${t}\``).join(', ')}`);

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        lines.join('\n').slice(0, 2000),
        { timestamp: false }
      )
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};


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
