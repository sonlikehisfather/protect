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
  name        : 'unwl',
  description : 'Retirer un membre ou un r\u00f4le de la whitelist.',
  usage       : 'unwl <@cible|ID>',
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

  const existing = new Set(
    db.getAntiraidWhitelist(guildId).map(e => e.targetId)
  );

  const removed  = [];
  const notInWl  = [];
  const notFound = [];

  for (const token of tokens) {
    const resolved = _resolveId(token);

    if (!resolved) {
      notFound.push(token);
      continue;
    }

    if (!existing.has(resolved.id)) {
      notInWl.push(resolved);
      continue;
    }

    db.removeAntiraidWhitelist(guildId, resolved.id);
    existing.delete(resolved.id);
    removed.push(resolved);
  }

  const parts = [];
  parts.push('## Whitelist antiraid');

  if (removed.length) {
    parts.push('**Retir\u00e9(s)** \u203a ' + removed.map(t => t.display).join(', '));
  }
  if (notInWl.length) {
    parts.push('**Pas en whitelist** \u203a ' + notInWl.map(t => t.display).join(', '));
  }
  if (notFound.length) {
    parts.push('**Introuvable(s)** \u203a ' + notFound.map(t => `\`${t}\``).join(', '));
  }
  if (!removed.length && !notInWl.length && !notFound.length) {
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

function _resolveId(input) {
  input = input.trim();
  if (!input) return null;

  const roleMention = input.match(/^<@&(\d{17,20})>$/);
  if (roleMention) return { id: roleMention[1], display: `<@&${roleMention[1]}>` };

  const userMention = input.match(/^<@!?(\d{17,20})>$/);
  if (userMention) return { id: userMention[1], display: `<@${userMention[1]}>` };

  const cleaned = input.replace(/[<@!&>]/g, '').trim();
  if (/^\d{17,20}$/.test(cleaned)) {
    return { id: cleaned, display: `\`${cleaned}\`` };
  }

  return null;
}
