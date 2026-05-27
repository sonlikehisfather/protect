'use strict';


const { parseDuration, formatDuration } = require('../../utils/parseDuration.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const STEP_SANCTIONS = ['delete', 'warn', 'mute', 'kick', 'ban', 'derank'];
const CRITICAL_SANCTIONS = ['derank', 'kick', 'ban'];
const AUTOMOD_SANCTIONS  = ['delete', 'warn', 'mute', 'kick', 'ban'];

const CRITICAL_MODULES = {
  antiban       : 'antibanPunish',
  antichannel   : 'antichannelPunish',
  antiupdate    : 'antiupdatePunish',
  antivanity    : 'antivanityPunish',
  antibot       : 'antibotPunish',
  antideco      : 'antidecoPunish',
  antirole      : 'antirolePunish',
  antiunban     : 'antiunbanPunish',
  antiwebhook   : 'antiwebhookPunish',
  creationlimit : 'creationLimitPunish',
  blrank        : 'blrankPunish',
};

const AUTOMOD_MODULES = {
  antilink        : 'antilinkPunish',
  antispam        : 'antispamPunish',
  antibadword     : 'antibadwordPunish',
  antimassmention : 'antimassmentionPunish',
  antieveryone    : 'antiEveryonePunish',
};

const MODULE_COLUMNS = { ...CRITICAL_MODULES, ...AUTOMOD_MODULES };

module.exports = {
  help: {
    name        : 'punish',
    description : 'Configurer les paliers de punition automod.',
    usage       : 'punish [add|del|setup|list]',
    aliases     : ['punition'],
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, 'punish')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    const prefix = message.prefix || '+';
    const sub    = args[0]?.toLowerCase();

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    if (sub && (sub === 'all' || MODULE_COLUMNS[sub])) {
      const sanction    = args[1]?.toLowerCase();
      const isCritical  = sub === 'all' ? null : Boolean(CRITICAL_MODULES[sub]);
      const allowed     = isCritical === null ? CRITICAL_SANCTIONS : (isCritical ? CRITICAL_SANCTIONS : AUTOMOD_SANCTIONS);

      if (!allowed.includes(sanction)) {
        const hint = isCritical
          ? 'Module critique : sanctions acceptees'
          : (isCritical === false ? 'Module automod : sanctions acceptees' : 'Sanctions acceptees');
        const sent = await embed.replyError(
          message,
          `${hint} : \`${allowed.join('`, `')}\`.`,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (sub === 'all') {
        const automodOk = AUTOMOD_SANCTIONS.includes(sanction);

        for (const column of Object.values(CRITICAL_MODULES)) {
          db.setAntiraidConfig(guildId, column, sanction);
        }

        if (automodOk) {
          for (const column of Object.values(AUTOMOD_MODULES)) {
            db.setAntiraidConfig(guildId, column, sanction);
          }
        }

        const scope = automodOk
          ? 'Tous les modules'
          : 'Modules critiques uniquement (la sanction `' + sanction + '` ne s\'applique pas aux modules automod)';

        const sent = await embed.reply(
          message,
          `${scope} utilisent maintenant la punition \`${sanction}\`.`,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      db.setAntiraidConfig(guildId, MODULE_COLUMNS[sub], sanction);

      const sent = await embed.reply(
        message,
        `Le module \`${sub}\` utilise maintenant la punition \`${sanction}\`.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!sub || sub === 'list') {
      const sent = await _showSteps(message, guildId, prefix).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (sub === 'setup') {
      const antiraidConfig = db.getAntiraidConfig(guildId);
      const existing = _readSteps(antiraidConfig?.punishSteps);

      if (existing.length > 0 && args[1]?.toLowerCase() !== 'confirm') {
        const sent = await embed.reply(
          message,
          `Il y a deja **${existing.length}** palier(s) configures. Utilisez \`${prefix}punish setup confirm\` pour ecraser.`,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      const defaults = [
        { strikes: 2, windowMs: 3_600_000,  sanction: 'mute', duration: 600 },
        { strikes: 3, windowMs: 3_600_000,  sanction: 'mute', duration: 3600 },
        { strikes: 4, windowMs: 21_600_000, sanction: 'mute', duration: 21600 },
        { strikes: 5, windowMs: 86_400_000, sanction: 'mute', duration: 86400 },
      ];

      db.setAntiraidConfig(guildId, 'punishSteps', JSON.stringify(defaults));

      const guildConfig = db.getGuildConfig(guildId);
      const useTimeout  = Boolean(guildConfig?.useTimeout);
      const muteRoleId  = guildConfig?.muteRoleId ?? null;

      const lines = [
        'Paliers par defaut configures :',
        '`2 strikes / 1h` - mute 10m',
        '`3 strikes / 1h` - mute 1h',
        '`4 strikes / 6h` - mute 6h',
        '`5 strikes / 24h` - mute 24h',
        '',
        'Le ban automatique n\'est pas inclus par defaut. Ajoutez-le manuellement si necessaire.',
      ];

      if (!useTimeout && !muteRoleId) {
        lines.push('');
        lines.push(`Les paliers utilisent mute. Activez les timeouts avec \`${prefix}muteconfig timeout on\` ou configurez un role mute avec \`${prefix}muteconfig setup\`.`);
      }

      const sent = await embed.reply(
        message,
        lines.join('\n'),
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (sub === 'add') {
      const strikes  = Number.parseInt(args[1], 10);
      const windowMs = parseDuration(args[2]);
      const sanction = args[3]?.toLowerCase();

      if (!Number.isInteger(strikes) || strikes < 1) {
        const sent = await embed.replyError(
          message,
          `Nombre de strikes invalide.\nExemple : \`${prefix}punish add 2 1h mute 10m\``,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (!windowMs) {
        const sent = await embed.replyError(
          message,
          'Fenêtre de temps invalide. Exemples : `10m`, `1h`, `24h`.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (!STEP_SANCTIONS.includes(sanction)) {
        const sent = await embed.replyError(
          message,
          `Sanction invalide. Valeurs acceptées : \`${STEP_SANCTIONS.join('`, `')}\`.`,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      let duration = null;

      if (args[4]) {
        const parsedDuration = parseDuration(args[4]);

        if (!parsedDuration) {
          const sent = await embed.replyError(
            message,
            'Durée de sanction invalide. Exemples : `10m`, `1h`, `7d`.',
            { timestamp: false }
          ).catch(() => null);

          if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
          return;
        }

        duration = Math.floor(parsedDuration / 1000);
      }

      if (sanction === 'mute' && !duration) {
        const sent = await embed.replyError(
          message,
          `La sanction \`mute\` nécessite une durée.\nExemple : \`${prefix}punish add ${strikes} ${args[2]} mute 10m\``,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (['delete', 'warn', 'kick', 'ban', 'derank'].includes(sanction) && duration) {
        const sent = await embed.replyError(
          message,
          `La sanction \`${sanction}\` ne doit pas avoir de durée.`,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      const antiraidConfig = db.getAntiraidConfig(guildId);
      const steps = _readSteps(antiraidConfig?.punishSteps);

      steps.push({
        strikes,
        windowMs,
        sanction,
        duration,
      });

      steps.sort((a, b) => a.strikes - b.strikes || a.windowMs - b.windowMs);

      db.setAntiraidConfig(guildId, 'punishSteps', JSON.stringify(steps));

      const sent = await embed.reply(
        message,
        `Palier ajouté : \`${strikes} strikes / ${args[2]}\` - \`${sanction}\`${duration ? ` (${args[4]})` : ''}.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (sub === 'del') {
      const index = Number.parseInt(args[1], 10) - 1;
      const antiraidConfig = db.getAntiraidConfig(guildId);
      const steps = _readSteps(antiraidConfig?.punishSteps);

      if (!Number.isInteger(index) || index < 0 || index >= steps.length) {
        const sent = await embed.replyError(
          message,
          `Numéro invalide. Utilisez \`${prefix}punish\` pour voir la liste.`,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      const removed = steps.splice(index, 1)[0];

      db.setAntiraidConfig(guildId, 'punishSteps', JSON.stringify(steps));

      const sent = await embed.reply(
        message,
        `Palier \`#${index + 1}\` supprimé : \`${removed.strikes} strikes / ${_formatMs(removed.windowMs)}\` - \`${removed.sanction}\`.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const sent = await _showSteps(message, guildId, prefix).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function _showSteps(message, guildId, prefix) {
  const antiraidConfig = db.getAntiraidConfig(guildId);
  const steps = _readSteps(antiraidConfig?.punishSteps);

  if (!steps.length) {
    return message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Aucun palier configuré.\nUtilisez \`${prefix}punish add <strikes> <durée> <sanction> [durée_sanction]\` ou \`${prefix}punish setup\`.`,
          { timestamp: false }
        ),
      ],
      allowedMentions: { repliedUser: false },
    });
  }

  const lines = steps.map((step, index) =>
    `\`${index + 1}.\` ${step.strikes} strikes / ${_formatMs(step.windowMs)} - **${step.sanction}**${step.duration ? ` (${_formatSeconds(step.duration)})` : ''}`
  );

  const hasBanOrKick = steps.some(s => s.sanction === 'ban' || s.sanction === 'kick');

  const fields = [
    {
      name   : 'Paliers',
      value  : lines.join('\n').slice(0, 1024),
      inline : false,
    },
  ];

  if (hasBanOrKick) {
    fields.push({
      name   : 'Attention',
      value  : `Un palier ban ou kick est actif. Utilisez \`${prefix}punish setup confirm\` pour remplacer par des paliers sans ban, ou \`${prefix}punish del <numero>\` pour retirer un palier.`,
      inline : false,
    });
  }

  const hasMute = steps.some(s => s.sanction === 'mute');

  if (hasMute) {
    const guildConfig = db.getGuildConfig(guildId);
    const useTimeout  = Boolean(guildConfig?.useTimeout);
    const muteRoleId  = guildConfig?.muteRoleId ?? null;

    if (!useTimeout && !muteRoleId) {
      fields.push({
        name   : 'Mute non configure',
        value  : `Des paliers mute sont configures, mais aucun systeme de mute n'est pret.\nActivez les timeouts avec \`${prefix}muteconfig timeout on\` ou configurez un role mute avec \`${prefix}muteconfig setup\`.`,
        inline : false,
      });
    }
  }

  fields.push({
    name   : 'Commandes',
    value  : [
      `\`${prefix}punish add 2 1h mute 10m\``,
      `\`${prefix}punish add 3 1h mute 1h\``,
      `\`${prefix}punish del <numero>\``,
      `\`${prefix}punish setup\``,
      `\`${prefix}punition <module critique> <derank/kick/ban>\``,
      `\`${prefix}punition <module automod> <delete/warn/mute/kick/ban>\``,
      `\`${prefix}punition all <derank/kick/ban>\``,
    ].join('\n'),
    inline : false,
  });

  return message.channel.send({
    embeds: [
      embed.build(
        guildId,
        null,
        {
          title  : 'Paliers de punition automod',
          fields,
          timestamp: false,
        }
      ),
    ],
    allowedMentions: { repliedUser: false },
  });
}

function _readSteps(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function _formatMs(value) {
  return formatDuration(value, { format: 'fr-long' }) || `${value}ms`;
}

function _formatSeconds(seconds) {
  if (!seconds) return '';
  return _formatMs(seconds * 1000);
}
