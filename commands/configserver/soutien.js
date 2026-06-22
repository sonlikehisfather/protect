'use strict';


const {
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');

const PAGE_SIZE      = 10;
const LB_IDLE_MS     = 3_600_000;
const LB_TIMEOUT_MS  = 3_600_000;

const db          = require('../../core/database');
const embed       = require('../../utils/embed');
const perms       = require('../../utils/permissions');
const eligibility = require('../../utils/giveawayEligibility');
const { resolveMember } = require('../../utils/memberResolver');
const { syncSoutienGuild, getSoutienMatchInfo, cleanupTagOnlyGuild } = require('../../utils/soutienSync');

exports.help = {
  name        : 'soutien',
  description : 'Configurer le rôle soutien du serveur.',
  usage       : 'soutien <on|off|role|mode|keyword|tag|badge|settings|sync|cleanup|user|top>',
};

exports.run = async (client, message, args) => {
  if (!perms.check(message, exports.help.name)) return;

  const guildId = message.guild.id;
  const config  = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const sub = args[0]?.toLowerCase();

  if (!sub) {
    return _error(
      message,
      deleteReply,
      deleteDelay,
      'Utilisez `soutien on`, `off`, `role`, `mode`, `keyword`, `tag`, `badge`, `settings`, `sync`, `cleanup`, `user` ou `top`.'
    );
  }

  if (sub === 'user') {
    return _handleUser(message, args.slice(1), guildId, config, deleteReply, deleteDelay);
  }

  if (['top', 'lb', 'leaderboard'].includes(sub)) {
    return _handleLeaderboard(message, guildId, deleteReply, deleteDelay);
  }

  if (sub === 'sync') {
    return _handleSync(client, message, args.slice(1), guildId, config, deleteReply, deleteDelay);
  }

  if (sub === 'cleanup') {
    return _handleCleanup(client, message, args.slice(1), guildId, config, deleteReply, deleteDelay);
  }

  if (sub === 'settings') {
    const mode      = config?.soutienMode || 'status';
    const modeLabel = _modeLabel(mode);

    const sent = await embed.reply(
      message,
      null,
      {
        title  : 'Configuration du soutien',
        fields : [
          {
            name   : 'État',
            value  : Number(config?.soutienEnabled) ? 'Activé' : 'Désactivé',
            inline : true,
          },
          {
            name   : 'Mode',
            value  : modeLabel,
            inline : true,
          },
          {
            name   : 'Rôle',
            value  : config?.soutienRoleId ? `<@&${config.soutienRoleId}>` : 'Aucun',
            inline : true,
          },
          {
            name   : 'Mot-clé statut',
            value  : config?.soutienKeyword ? `\`${config.soutienKeyword}\`` : 'Aucun',
            inline : true,
          },
          {
            name   : 'Tag de guilde',
            value  : config?.soutienTag ? `\`${config.soutienTag}\`` : 'Aucun',
            inline : true,
          },
          {
            name   : 'Badge',
            value  : config?.soutienBadge ? `\`${config.soutienBadge}\`` : 'Non vérifié',
            inline : true,
          },
        ],
        timestamp: false,
      }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

    return;
  }

  if (sub === 'on' || sub === 'off') {
    const enabled = sub === 'on' ? 1 : 0;
    const mode    = config?.soutienMode || 'status';

    if (Number(config?.soutienEnabled) === enabled) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        enabled
          ? 'Le système soutien est déjà activé.'
          : 'Le système soutien est déjà désactivé.'
      );
    }

    if (enabled && !config?.soutienRoleId) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Définissez d’abord un rôle avec `soutien role @rôle`.'
      );
    }

    if (enabled && mode === 'status' && !config?.soutienKeyword) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Définissez d’abord un mot-clé avec `soutien keyword <mot-clé>`.'
      );
    }

    if (enabled && mode === 'tag' && !config?.soutienTag) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Définissez d’abord un tag avec `soutien tag <tag>`.'
      );
    }

    if (enabled && mode === 'both' && !config?.soutienKeyword && !config?.soutienTag) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'En mode `both`, définissez au moins un mot-clé (`soutien keyword`) ou un tag (`soutien tag`).'
      );
    }

    db.setGuildConfig(guildId, 'soutienEnabled', enabled);

    if (enabled) {
      setImmediate(() => syncSoutienGuild(client, message.guild, 'config.on').catch(() => {}));
    }

    return _success(
      message,
      deleteReply,
      deleteDelay,
      enabled
        ? 'Système soutien activé. Synchronisation lancée.'
        : 'Système soutien désactivé.'
    );
  }

  if (sub === 'role') {
    const role = _resolveRole(message, args[1]);

    if (!role) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Rôle invalide. Utilisez `soutien role @rôle`.'
      );
    }

    if (role.managed) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Ce rôle est géré par une intégration et ne peut pas être utilisé.'
      );
    }

    const me = message.guild.members.me;

    if (me && role.position >= me.roles.highest.position) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Je ne peux pas gérer ce rôle car il est au-dessus ou au même niveau que mon rôle.'
      );
    }

    if (config?.soutienRoleId === role.id) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        `Le rôle <@&${role.id}> est déjà utilisé comme rôle soutien.`
      );
    }

    db.setGuildConfig(guildId, 'soutienRoleId', role.id);

    if (Number(config?.soutienEnabled)) {
      setImmediate(() => syncSoutienGuild(client, message.guild, 'config.role').catch(() => {}));
    }

    return _success(
      message,
      deleteReply,
      deleteDelay,
      `Rôle soutien défini sur <@&${role.id}>.${Number(config?.soutienEnabled) ? ' Synchronisation lancée.' : ''}`
    );
  }

  if (sub === 'mode') {
    const mode = args[1]?.toLowerCase();

    if (!['status', 'tag', 'both'].includes(mode)) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Mode invalide. Utilisez `soutien mode status`, `soutien mode tag` ou `soutien mode both`.'
      );
    }

    if ((config?.soutienMode || 'status') === mode) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        `Le mode \`${mode}\` est déjà utilisé.`
      );
    }

    db.setGuildConfig(guildId, 'soutienMode', mode);

    if (Number(config?.soutienEnabled)) {
      setImmediate(() => syncSoutienGuild(client, message.guild, 'config.mode').catch(() => {}));
    }

    return _success(
      message,
      deleteReply,
      deleteDelay,
      `Mode soutien défini sur \`${mode}\` (${_modeLabel(mode)}).${Number(config?.soutienEnabled) ? ' Synchronisation lancée.' : ''}`
    );
  }

  if (sub === 'keyword') {
    const keyword = args.slice(1).join(' ').trim();

    if (!keyword) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Précisez un mot-clé.\nExemple : `soutien keyword .gg/shibuya`'
      );
    }

    if (keyword.length > 80) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Le mot-clé ne peut pas dépasser **80** caractères.'
      );
    }

    if (String(config?.soutienKeyword || '').toLowerCase() === keyword.toLowerCase()) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        `Le mot-clé \`${keyword}\` est déjà utilisé.`
      );
    }

    db.setGuildConfig(guildId, 'soutienKeyword', keyword);

    if (Number(config?.soutienEnabled)) {
      setImmediate(() => syncSoutienGuild(client, message.guild, 'config.keyword').catch(() => {}));
    }

    return _success(
      message,
      deleteReply,
      deleteDelay,
      `Mot-clé soutien défini sur \`${keyword}\`.${Number(config?.soutienEnabled) ? ' Synchronisation lancée.' : ''}`
    );
  }

  if (sub === 'tag') {
    const tag = args.slice(1).join(' ').trim();

    if (!tag) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Précisez un tag de guilde.\nExemple : `soutien tag bby`'
      );
    }

    if (tag.length > 16) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Le tag ne peut pas dépasser **16** caractères.'
      );
    }

    if (String(config?.soutienTag || '') === tag) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        `Le tag \`${tag}\` est déjà utilisé.`
      );
    }

    db.setGuildConfig(guildId, 'soutienTag', tag);

    if (Number(config?.soutienEnabled)) {
      setImmediate(() => syncSoutienGuild(client, message.guild, 'config.tag').catch(() => {}));
    }

    return _success(
      message,
      deleteReply,
      deleteDelay,
      `Tag soutien défini sur \`${tag}\`.${Number(config?.soutienEnabled) ? ' Synchronisation lancée.' : ''}`
    );
  }

  if (sub === 'badge') {
    const badge = args[1]?.trim();

    if (!badge) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Précisez un badge ou utilisez `soutien badge off`.'
      );
    }

    if (['off', 'reset', 'none'].includes(badge.toLowerCase())) {
      if (!config?.soutienBadge) {
        return _error(
          message,
          deleteReply,
          deleteDelay,
          'Aucun badge soutien n’est configuré.'
        );
      }

      db.setGuildConfig(guildId, 'soutienBadge', null);

      return _success(
        message,
        deleteReply,
        deleteDelay,
        'Vérification du badge désactivée. Seul le tag sera vérifié.'
      );
    }

    if (!/^[a-fA-F0-9]{16,64}$/.test(badge)) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Badge invalide. Utilisez la valeur `primaryGuild.badge` retournée par Discord.'
      );
    }

    if (String(config?.soutienBadge || '').toLowerCase() === badge.toLowerCase()) {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        'Ce badge est déjà utilisé.'
      );
    }

    db.setGuildConfig(guildId, 'soutienBadge', badge.toLowerCase());

    return _success(
      message,
      deleteReply,
      deleteDelay,
      'Badge soutien défini.'
    );
  }

  return _error(
    message,
    deleteReply,
    deleteDelay,
    'Action invalide. Utilisez `on`, `off`, `role`, `mode`, `keyword`, `tag`, `badge`, `settings`, `sync`, `cleanup`, `user` ou `top`.'
  );
};

async function _handleSync(client, message, args, guildId, config, deleteReply, deleteDelay) {
  if (!Number(config?.soutienEnabled)) {
    return _error(message, deleteReply, deleteDelay, 'Le système soutien n\'est pas activé.');
  }

  if (!config?.soutienRoleId) {
    return _error(message, deleteReply, deleteDelay, 'Aucun rôle soutien n\'est configuré.');
  }


  const arg0 = args[0]?.toLowerCase();
  const arg1 = args[1]?.toLowerCase();
  const force = arg0 === 'force';

  if (force && arg1 !== 'confirm') {
    const mode = config?.soutienMode || 'status';
    return _error(
      message,
      deleteReply,
      deleteDelay,
      [
        '**Confirmation requise.**',
        `Cette commande retirera STRICTEMENT le rôle soutien aux membres qui ne matchent plus le mode actuel (\`${mode}\`),`,
        '**y compris les membres offline / presence inconnue**.',
        'Les membres en `manual_ignored` restent intouches.',
        '',
        'Pour confirmer, tapez :',
        '`+soutien sync force confirm`',
      ].join('\n')
    );
  }

  const result = await syncSoutienGuild(client, message.guild, force ? 'manual.force' : 'manual', { force });

  const lines = [
    force ? 'Synchronisation soutien (force) terminée.' : 'Synchronisation soutien terminée.',
    `Ajoutés : **${result.added}**`,
    `Retirés : **${result.removed}**`,
    `Déjà OK : **${result.tracked}**`,
  ];
  if (result.ignoredOffline) lines.push(`Ignorés offline : **${result.ignoredOffline}**`);
  if (result.ignored)        lines.push(`Ignorés manuellement : **${result.ignored}**`);
  if (result.errors)         lines.push(`Erreurs : **${result.errors}**`);

  return _success(message, deleteReply, deleteDelay, lines.join('\n'));
}

async function _handleCleanup(client, message, args, guildId, config, deleteReply, deleteDelay) {
  if (!Number(config?.soutienEnabled)) {
    return _error(message, deleteReply, deleteDelay, 'Le système soutien n\'est pas activé.');
  }
  if (!config?.soutienRoleId) {
    return _error(message, deleteReply, deleteDelay, 'Aucun rôle soutien n\'est configuré.');
  }

  const arg0 = args[0]?.toLowerCase();
  const arg1 = args[1]?.toLowerCase();


  if (arg0 === 'tag') {
    if (arg1 !== 'confirm') {
      return _error(
        message,
        deleteReply,
        deleteDelay,
        [
          '**Confirmation requise.**',
          'Cette commande retirera le rôle soutien aux membres dont le tracking indique',
          'uniquement un tag valide (sans statut valide).',
          'Utile après un passage de mode `tag` ou `both` vers `status`.',
          '',
          'Garde-fous : `manual_ignored` respecté, membres dont le statut courant matche',
          'sont au contraire promus en "status valide" plutôt que retirés.',
          '',
          'Pour confirmer, tapez :',
          '`+soutien cleanup tag confirm`',
        ].join('\n')
      );
    }

    const result = await cleanupTagOnlyGuild(client, message.guild);

    if (result.reason === 'cannot_manage_role') {
      return _error(message, deleteReply, deleteDelay, 'Impossible de gérer le rôle soutien (permissions ou hiérarchie).');
    }

    const lines = [
      'Cleanup tag-only terminé.',
      `Candidats : **${result.candidates}**`,
      `Retirés : **${result.removed}**`,
    ];
    if (result.ignoredManual)      lines.push(`Ignorés manuellement : **${result.ignoredManual}**`);
    if (result.ignoredAlreadyOff)  lines.push(`Ignorés (déjà sans rôle) : **${result.ignoredAlreadyOff}**`);
    if (result.ignoredStatusMatch) lines.push(`Promus en statut valide : **${result.ignoredStatusMatch}**`);
    if (result.errors)             lines.push(`Erreurs : **${result.errors}**`);

    return _success(message, deleteReply, deleteDelay, lines.join('\n'));
  }


  if (arg0 !== 'confirm') {
    const mode = config?.soutienMode || 'status';
    return _error(
      message,
      deleteReply,
      deleteDelay,
      [
        '**Confirmation requise.**',
        `Cette commande applique strictement le mode actuel (\`${mode}\`) :`,
        'les membres qui ne matchent plus seront retirés, **y compris s’ils sont offline**.',
        'Les membres en `manual_ignored` restent intouches.',
        '',
        'Variantes :',
        '`+soutien cleanup confirm`        - sync strict (équivalent `sync force confirm`)',
        '`+soutien cleanup tag confirm`    - retire uniquement les tag-only via tracking',
      ].join('\n')
    );
  }

  const result = await syncSoutienGuild(client, message.guild, 'manual.cleanup', { force: true });

  const lines = [
    'Cleanup soutien (mode strict) terminé.',
    `Ajoutés : **${result.added}**`,
    `Retirés : **${result.removed}**`,
    `Déjà OK : **${result.tracked}**`,
  ];
  if (result.ignoredOffline) lines.push(`Ignorés offline : **${result.ignoredOffline}**`);
  if (result.ignored)        lines.push(`Ignorés manuellement : **${result.ignored}**`);
  if (result.errors)         lines.push(`Erreurs : **${result.errors}**`);

  return _success(message, deleteReply, deleteDelay, lines.join('\n'));
}

function _resolveRole(message, raw) {
  return message.mentions.roles.first()
    ?? (raw ? message.guild.roles.cache.get(String(raw).replace(/[<@&>]/g, '')) : null);
}

async function _error(message, deleteReply, deleteDelay, text) {
  const sent = await embed.replyError(
    message,
    text,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _success(message, deleteReply, deleteDelay, text) {
  const sent = await embed.reply(
    message,
    text,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}


async function _handleUser(message, args, guildId, config, deleteReply, deleteDelay) {
  const member = await resolveMember(message, args);

  if (!member) {
    return _error(message, deleteReply, deleteDelay, 'Utilisateur introuvable.');
  }

  const mode    = config?.soutienMode || 'status';
  const roleId  = config?.soutienRoleId;
  const keyword = String(config?.soutienKeyword || '').trim().toLowerCase();
  const tag     = String(config?.soutienTag || '').trim();

  const hasRole = roleId ? member.roles.cache.has(roleId) : false;


  if (hasRole) {
    const existing = db.getSoutienTracking(guildId, member.id);
    if (!existing || !existing.roleGrantedAt) {
      db.grantSoutienRoleTracking(guildId, member.id, true);
    }
  }

  const presence    = member.presence;
  const statusText  = _getCustomStatusText(presence);
  const statusValid = keyword && statusText.toLowerCase().includes(keyword);


  const primaryGuild = member.user?.primaryGuild;
  const userTag      = String(primaryGuild?.tag || '').trim();
  const tagValid     = tag && userTag === tag;

  if ((mode === 'status' || mode === 'both') && statusValid) {
    db.markSoutienStatusValid(guildId, member.id, true);
  }
  if ((mode === 'tag' || mode === 'both') && tagValid) {
    db.markSoutienTagValid(guildId, member.id, true);
  }

  const tracking = db.getSoutienTracking(guildId, member.id);

  const roleSinceStr   = tracking?.roleGrantedAt    ? `<t:${tracking.roleGrantedAt}:R>`    : 'Non tracke';
  const statusSinceStr = tracking?.statusValidSince ? `<t:${tracking.statusValidSince}:R>` : 'Non tracke';
  const tagSinceStr    = tracking?.tagValidSince    ? `<t:${tracking.tagValidSince}:R>`    : 'Non tracke';

  const roleText = hasRole ? `> Oui - <@&${roleId}>` : `> ${_code(roleId ? 'Non' : 'Non configure')}`;

  const fields = [
    { name: 'Rôle soutien',      value: roleText,                       inline: true },
    { name: 'Rôle depuis',       value: hasRole ? `> ${roleSinceStr}` : `> ${_code('-')}`, inline: true },
    { name: 'Mode',              value: `> ${_code(_modeLabel(mode))}`, inline: true },
  ];

  if (mode === 'status' || mode === 'both') {
    fields.push(
      { name: 'Statut personnalise', value: `> ${_code(statusText || 'Aucun')}`,      inline: false },
      { name: 'Statut valide',       value: `> ${_code(statusValid ? 'Oui' : 'Non')}`, inline: true },
      { name: 'Statut valide depuis', value: `> ${statusValid ? statusSinceStr : _code('-')}`, inline: true }
    );
  }
  if (mode === 'tag' || mode === 'both') {
    fields.push(
      { name: 'Tag de guilde',      value: `> ${_code(userTag || 'Aucun')}`,        inline: true },
      { name: 'Tag valide',         value: `> ${_code(tagValid ? 'Oui' : 'Non')}`,  inline: true },
      { name: 'Tag valide depuis',  value: `> ${tagValid ? tagSinceStr : _code('-')}`, inline: true }
    );
  }

  try {
    const activeGws = db.getActiveGiveaways().filter(g => g.guildId === guildId);
    if (activeGws.length) {
      let participating = 0;
      let eligible      = 0;
      let ineligible    = 0;
      const issues      = [];

      for (const gw of activeGws) {
        if (db.hasEnteredGiveaway(gw.id, member.id)) participating++;
        const result = await eligibility.checkGiveawayEligibility(member, gw, client);
        if (result.eligible) {
          eligible++;
        } else {
          ineligible++;
          if (issues.length < 3) {
            const prize = gw.prize?.slice(0, 30) || '?';
            issues.push(`${prize} : ${result.reasons[0]}`);
          }
        }
      }

      let gwValue = `${participating} participation(s), ${eligible} eligible(s), ${ineligible} non-eligible(s)`;
      fields.push({
        name: `Giveaways actifs (${activeGws.length})`,
        value: `> ${_code(gwValue)}`,
        inline: false,
      });

      if (issues.length) {
        fields.push({
          name: 'Problemes eligibilite',
          value: issues.map(i => `> ${i}`).join('\n'),
          inline: false,
        });
      }
    }
  } catch {
  }

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        null,
        {
          title     : `Soutien - ${member.user.globalName ?? member.user.username}`,
          thumbnail : member.user.displayAvatarURL({ size: 128 }),
          fields,
          timestamp : false,
        }
      ),
    ],
  }).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

function _code(value) {
  return `\`${String(value ?? '-').replace(/`/g, "'")}\``;
}

function _modeLabel(mode) {
  if (mode === 'tag')  return 'Tag de guilde';
  if (mode === 'both') return 'Statut + Tag (both)';
  return 'Statut personnalisé';
}


async function _handleLeaderboard(message, guildId, deleteReply, deleteDelay) {
  const config = db.getGuildConfig(guildId);
  const roleId = config?.soutienRoleId;

  if (!Number(config?.soutienEnabled) || !roleId) {
    const sent = await embed.reply(
      message,
      'Le système soutien n\'est pas activé ou aucun rôle n\'est configuré.',
      { title: 'Classement soutien', timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const entries = _buildActiveSoutienList(message.guild, config, roleId);

  if (!entries.length) {
    const sent = await embed.reply(
      message,
      'Aucun soutien actif actuellement.',
      { title: 'Classement soutien', timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const total     = entries.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  let   current   = 0;

  const firstEmbed = _buildLeaderboardPage(guildId, entries, current, pageCount, total);

  const panel = await message.channel.send({
    embeds          : [firstEmbed],
    components      : [_buildLeaderboardRow(current, pageCount, false)],
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!panel) return;

  embed.registerPrivateInteraction(panel, message.author.id, LB_TIMEOUT_MS);

  const collector = panel.createMessageComponentCollector({
    componentType : ComponentType.Button,
    filter        : i =>
      i.user.id === message.author.id &&
      i.message.id === panel.id,
    idle          : LB_IDLE_MS,
    time          : LB_TIMEOUT_MS,
  });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'local:soutientop:close') {
        await i.deferUpdate().catch(() => {});
        collector.stop('closed');
        embed.clearPrivateInteraction(panel);
        await panel.delete().catch(() => {});
        return;
      }

      if (i.customId === 'local:soutientop:prev' && current > 0) {
        current--;
      } else if (i.customId === 'local:soutientop:next' && current < pageCount - 1) {
        current++;
      } else {
        return i.deferUpdate().catch(() => {});
      }

      await i.update({
        embeds     : [_buildLeaderboardPage(guildId, entries, current, pageCount, total)],
        components : [_buildLeaderboardRow(current, pageCount, false)],
      }).catch(() => {});
    } catch {}
  });

  collector.on('end', async (_, reason) => {
    embed.clearPrivateInteraction(panel);

    if (reason === 'closed') return;

    await panel.edit({
      components      : [],
      content         : '-# Session expirée, relance la commande pour reprendre.',
      allowedMentions : { parse: [] },
    }).catch(() => {});
  });
}

function _buildActiveSoutienList(guild, config, roleId) {
  const guildId = guild.id;
  const entries = [];

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;
    if (!member.roles.cache.has(roleId)) continue;
    if (db.isSoutienManualIgnored(guildId, member.id, roleId)) continue;

    const info = getSoutienMatchInfo(member, config);
    if (!info.matches) continue;

    const tracking = db.getSoutienTracking(guildId, member.id);
    const sinceTs  = tracking?.roleGrantedAt
      || tracking?.statusValidSince
      || tracking?.tagValidSince
      || null;

    entries.push({ userId: member.id, label: info.label, sinceTs });
  }

  entries.sort((a, b) => (a.sinceTs || Infinity) - (b.sinceTs || Infinity));
  return entries;
}

function _buildLeaderboardPage(guildId, entries, pageIndex, pageCount, total) {
  const offset = pageIndex * PAGE_SIZE;
  const page   = entries.slice(offset, offset + PAGE_SIZE);

  const lines = page.map((entry, idx) => {
    const rank     = offset + idx + 1;
    const sinceStr = entry.sinceTs ? `<t:${entry.sinceTs}:R>` : '`-`';
    return `#${rank} <@${entry.userId}> - \`${entry.label}\` - depuis ${sinceStr}`;
  });

  const body = lines.length ? lines.join('\n') : 'Aucune entrée sur cette page.';

  return embed.build(guildId, body, {
    title     : 'Classement soutien',
    footer    : `Page ${pageIndex + 1}/${pageCount} - ${total} soutien${total > 1 ? 's' : ''} actif${total > 1 ? 's' : ''}`,
    timestamp : false,
  });
}

function _buildLeaderboardRow(current, pageCount, disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:soutientop:prev')
      .setLabel('\u2190')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || current === 0),

    new ButtonBuilder()
      .setCustomId('local:soutientop:page')
      .setLabel(`${current + 1}/${pageCount}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),

    new ButtonBuilder()
      .setCustomId('local:soutientop:next')
      .setLabel('\u2192')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || current >= pageCount - 1),

    new ButtonBuilder()
      .setCustomId('local:soutientop:close')
      .setLabel('\u2716')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

function _getCustomStatusText(presence) {
  const custom = presence?.activities?.find(activity =>
    activity.type === ActivityType.Custom
  );
  if (!custom) return '';
  return [
    custom.state,
    custom.name,
  ]
    .filter(Boolean)
    .join(' ');
}
