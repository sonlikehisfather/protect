'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'perms',
  description: 'Gérer le système de permissions.',
  use        : 'perms <action> [args]',
  usage      : 'perms <action> [args]',
  multi      : true,
};


exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const sub     = args[0]?.toLowerCase();

  if (!sub) return _list(message, guildId);

  switch (sub) {

    case 'list':
      return _listFull(message, guildId);

    case 'set': {
      const prefix = message.prefix || '+';
      return _handleSet(message, guildId, args[1], args.slice(2).join(' '), `${prefix}perms set <1-9> <@role|@membre>, <@autre>, ...`);
    }

    case 'del': {
      const prefix = message.prefix || '+';
      return _handleDel(message, guildId, args[1], args.slice(2).join(' '), `${prefix}perms del <1-9> <@role|@membre>, <@autre>, ...`);
    }

    case 'clear': {
      return _handleClear(message, guildId);
    }

    case 'cmd': {
      const cmdName = args[1]?.toLowerCase();
      const perm    = perms.parsePerm(args[2]);

      if (!cmdName || !perm) {
        return embed.replyError(message, 'Utilisation : `perms cmd <commande> <1-9|owner|buyer|public|everyone>`');
      }

      if (!perms.canEditPerm(message, perm)) {
        return embed.replyError(message, 'Vous ne pouvez pas assigner cette permission.');
      }

      if (!client.commands.has(cmdName)) {
        return embed.replyError(message, `Commande \`${cmdName}\` introuvable.`);
      }

      db.setCmdPerm(guildId, cmdName, perm);
      return embed.reply(message, `Commande \`${cmdName}\` → **${perms.permLabel(perm)}**`);
    }

    case 'cmdall': {
      const from = perms.parsePerm(args[1]);
      const to   = perms.parsePerm(args[2]);

      if (!from || !to) {
        return embed.replyError(message, 'Utilisation : `perms cmdall <ancienne> <nouvelle>`');
      }

      if (!perms.canEditPerm(message, from) || !perms.canEditPerm(message, to)) {
        return embed.replyError(message, 'Vous ne pouvez pas modifier ces permissions.');
      }

      db.moveCmdPerms(guildId, from, to);
      return embed.reply(
        message,
        `Toutes les commandes de **${perms.permLabel(from)}** déplacées vers **${perms.permLabel(to)}**.`
      );
    }

    case 'cmdreset': {
      if (
        !perms.isBuyer(message.author.id) &&
        !perms.isOwner(guildId, message.author.id)
      ) {
        return embed.replyError(
          message,
          'Permission refusée.'
        );
      }

      db.resetCmdPerms(guildId);

      return embed.reply(
        message,
        'Toutes les permissions de commandes ont été réinitialisées.'
      );
    }

    default:
      return _sendHelp(message, guildId);
  }
};


async function _handleSet(message, guildId, levelArg, targetsArg, usageHint) {
  if (levelArg?.toLowerCase() === 'owner') {
    return embed.replyError(message, 'Pour gérer les owners, utilisez `+owner add/remove @membre`.');
  }

  const level = parseInt(levelArg, 10);

  if (isNaN(level) || level < 1 || level > 9) {
    return embed.replyError(message, `Utilisation : \`${usageHint}\``);
  }

  if (!perms.canEditPerm(message, String(level))) {
    return embed.replyError(message, 'Vous ne pouvez pas modifier cette permission.');
  }

  const targets = _parseTargets(targetsArg, message.guild);

  if (!targets.length) {
    return embed.replyError(message, 'Aucune cible valide trouvée. Mentionnez des rôles ou membres.');
  }

  let ok = 0;
  let ko = 0;

  for (const t of targets) {
    const resolved = await _resolveTarget(t, message.guild);
    if (!resolved) { ko++; continue; }
    db.setPermLevel(guildId, level, resolved.id, resolved.type);
    ok++;
  }

  return embed.reply(
    message,
    `Perm **${level}** : **${ok}** cible(s) mise(s) à jour${ko ? `, **${ko}** invalide(s)` : ''}.`
  );
}

async function _handleDel(message, guildId, levelArg, targetsArg, usageHint) {
  if (levelArg?.toLowerCase() === 'owner') {
    return embed.replyError(message, 'Pour gérer les owners, utilisez `+owner add/remove @membre`.');
  }

  const level = parseInt(levelArg, 10);

  if (isNaN(level) || level < 1 || level > 9) {
    return embed.replyError(message, `Utilisation : \`${usageHint}\``);
  }

  if (!perms.canEditPerm(message, String(level))) {
    return embed.replyError(message, 'Vous ne pouvez pas modifier cette permission.');
  }

  const targets = _parseTargets(targetsArg, message.guild);

  if (!targets.length) {
    return embed.replyError(message, 'Aucune cible valide trouvée. Mentionnez des rôles ou membres.');
  }

  let ok = 0;
  let ko = 0;

  for (const t of targets) {
    const resolved = await _resolveTarget(t, message.guild);
    if (!resolved) { ko++; continue; }
    db.removePermLevel(guildId, level, resolved.id);
    ok++;
  }

  return embed.reply(
    message,
    `Perm **${level}** retiré pour **${ok}** cible(s)${ko ? `, **${ko}** invalide(s)` : ''}.`
  );
}

async function _handleClear(message, guildId) {
  if (!perms.isBuyer(message.author.id)) {
    return embed.replyError(message, 'Seul le buyer peut supprimer toutes les perms.');
  }

  db.clearPermLevels(guildId);
  return embed.reply(message, 'Toutes les perms ont été supprimées.');
}

exports.handleSet   = _handleSet;
exports.handleDel   = _handleDel;
exports.handleClear = _handleClear;

async function _list(message, guildId) {
  const levels = db.getPermLevels(guildId);

  const fields = [];

  for (let i = 1; i <= 9; i++) {
    const entries = levels.filter(level => level.level === i);
    if (!entries.length) continue;

    const value = entries
      .map(entry => entry.targetType === 'role' ? `<@&${entry.targetId}>` : `<@${entry.targetId}>`)
      .join('\n');

    fields.push({
      name  : `Perm ${i}`,
      value : value.slice(0, 1024),
      inline: false,
    });
  }

  return _sendPaginated(message, guildId, {
    title : 'Permissions',
    fields,
  });
}

async function _listFull(message, guildId) {
  const levels   = db.getPermLevels(guildId);
  const owners   = db.getGlobalOwners();
  const cmdPerms = db.getAllCmdPerms(guildId);
  const prefix   = message.prefix || '+';

  const ownersLine = owners.length
    ? owners.map(id => `<@${id}>`).join(', ')
    : 'Aucun';

  const description =
    `**Buyer** - <@${perms.getBuyerId()}>\n` +
    `**Owners** - ${ownersLine}`;

  const fields = [];

  for (let i = 1; i <= 9; i++) {
    const entries = levels.filter(level => level.level === i);
    if (!entries.length) continue;

    const value = entries
      .map(entry => entry.targetType === 'role' ? `<@&${entry.targetId}>` : `<@${entry.targetId}>`)
      .join('\n');

    fields.push({
      name  : `Perm ${i}`,
      value : value.slice(0, 1024),
      inline: false,
    });
  }

  if (cmdPerms.length) {
    const grouped = {};
    for (const row of cmdPerms) {
      if (!grouped[row.perm]) grouped[row.perm] = [];
      grouped[row.perm].push(`\`${row.commandName}\``);
    }

    const order = [];
    for (let i = 1; i <= 9; i++) {
      if (grouped[String(i)]) order.push(String(i));
    }
    for (const k of ['owner', 'buyer', 'public', 'everyone']) {
      if (grouped[k]) order.push(k);
    }

    const lines = order.map(k => `**${perms.permLabel(k)}** : ${grouped[k].join(', ')}`);

    fields.push({
      name  : 'Commandes personnalisées',
      value : lines.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  return _sendPaginated(message, guildId, {
    title      : 'Permissions',
    description,
    fields,
    footer     : `Voir ${prefix}helpall pour voir les commandes auxquelles chaque permission donne accès`,
  });
}


function _paginateFields(fields) {
  const MAX_FIELDS = 25;
  const MAX_CHARS  = 5500;

  const pages = [];
  let current  = [];
  let chars    = 0;

  for (const f of fields) {
    const size = (f?.name?.length ?? 0) + (f?.value?.length ?? 0);

    if (current.length >= MAX_FIELDS || (current.length > 0 && chars + size > MAX_CHARS)) {
      pages.push(current);
      current = [];
      chars   = 0;
    }

    current.push(f);
    chars += size;
  }

  if (current.length > 0) pages.push(current);
  if (pages.length === 0) pages.push([]);

  return pages;
}

async function _sendPaginated(message, guildId, opts) {
  const { title, description = null, footer = null, fields = [] } = opts;

  const pages = _paginateFields(fields);
  const total = pages.length;

  const buildEmbed = (idx) => {
    let pageFooter = null;
    if (total > 1) {
      pageFooter = footer
        ? `Page ${idx + 1}/${total} \u00b7 ${footer}`
        : `Page ${idx + 1}/${total}`;
    } else if (footer) {
      pageFooter = footer;
    }

    const buildOpts = {
      title,
      fields   : pages[idx],
      timestamp: false,
    };
    if (pageFooter) buildOpts.footer = pageFooter;

    return embed.build(guildId, description, buildOpts);
  };

  if (total <= 1) {
    return message.reply({
      embeds         : [buildEmbed(0)],
      allowedMentions: { parse: [] },
    });
  }

  let current = 0;

  const buildRow = (idx) => new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:perms:prev')
      .setLabel('\u2190')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(idx === 0),
    new ButtonBuilder()
      .setCustomId('local:perms:next')
      .setLabel('\u2192')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(idx === total - 1),
    new ButtonBuilder()
      .setCustomId('local:perms:close')
      .setLabel('\u2716')
      .setStyle(ButtonStyle.Danger),
  );

  const panel = await message.reply({
    embeds         : [buildEmbed(current)],
    components     : [buildRow(current)],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (!panel) return;

  embed.registerPrivateInteraction(panel, message.author.id, 300_000);

  const collector = panel.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter       : i =>
      i.user.id === message.author.id &&
      i.message.id === panel.id,
    idle : 120_000,
    time : 300_000,
  });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'local:perms:close') {
        collector.stop('closed');
        embed.clearPrivateInteraction(panel);
        await i.deferUpdate().catch(() => {});
        await panel.delete().catch(() => {});
        return;
      }

      if (i.customId === 'local:perms:prev' && current > 0) {
        current--;
      } else if (i.customId === 'local:perms:next' && current < total - 1) {
        current++;
      }

      await i.update({
        embeds    : [buildEmbed(current)],
        components: [buildRow(current)],
      }).catch(() => {});
    } catch {}
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(panel);
    if (reason === 'closed') return;
    panel.edit({
      components     : [],
      allowedMentions: { parse: [] },
    }).catch(() => {});
  });
}

function _sendHelp(message, guildId) {
  return embed.reply(message, null, {
    title : 'Gestion des permissions',
    fields: [
      { name: 'perms list',                         value: 'Affiche toutes les perms configurées', inline: false },
      { name: 'perms set <1-9> <@cible>, <@autre>', value: 'Assigne une perm (multi-cible avec , ou ,,)', inline: false },
      { name: 'perms del <1-9> <@cible>, <@autre>', value: 'Retire une perm (multi-cible avec , ou ,,)', inline: false },
      { name: 'perms clear',                        value: 'Supprime toutes les perms', inline: false },
      { name: 'perms cmd <commande> <perm>',        value: 'Change la permission d\'une commande', inline: false },
      { name: 'perms cmdall <ancien> <nouveau>',    value: 'Déplace toutes les commandes d\'une perm', inline: false },
      { name: 'perms cmdreset',                     value: 'Réinitialise toutes les permissions de commandes', inline: false },
    ],
    timestamp: false,
  });
}

function _parseTargets(raw) {
  if (!raw) return [];
  return raw.split(/,,|,/).map(s => s.trim()).filter(Boolean);
}

async function _resolveTarget(raw, guild) {
  const memberMatch = raw.match(/^<@!?(\d+)>$/);
  if (memberMatch) {
    const id = memberMatch[1];
    const m  = guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
    return m ? { id: m.id, type: 'user' } : null;
  }

  const roleMatch = raw.match(/^<@&(\d+)>$/);
  if (roleMatch) {
    const id = roleMatch[1];
    const r  = guild.roles.cache.get(id) ?? await guild.roles.fetch(id).catch(() => null);
    return r ? { id: r.id, type: 'role' } : null;
  }

  if (/^\d{17,20}$/.test(raw)) {
    const r = guild.roles.cache.get(raw);
    if (r) return { id: r.id, type: 'role' };

    const m = guild.members.cache.get(raw) ?? await guild.members.fetch(raw).catch(() => null);
    if (m) return { id: m.id, type: 'user' };
  }

  return null;
}
