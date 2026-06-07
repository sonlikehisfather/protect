'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name        : 'secur',
  description : 'Configurer la sécurité du serveur (antiraid).',
  usage       : 'secur [on|max|off|invite <on/off>]',
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const sub     = args[0]?.toLowerCase();
  const config  = db.getGuildConfig(guildId);

  if (!perms.check(message, exports.help.name)) {
    return;
  }

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  if (!sub) {
    const sent = await _showConfig(message, guildId).catch(() => null);
    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (sub === 'off') {
    if (_currentProfile(guildId) === 'off') {
      const sent = await embed.replyError(
        message,
        'La sécurité antiraid est déjà désactivée.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    _setProfile(guildId, 'off');

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          'La sécurité antiraid a été désactivée.',
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (sub === 'on') {
    if (_currentProfile(guildId) === 'base') {
      const sent = await embed.replyError(
        message,
        'La sécurité antiraid est déjà en mode **base**.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    _setProfile(guildId, 'base');

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          'La sécurité antiraid a été activée avec les modules de base.',
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (sub === 'invite') {
    return _handleInvite(message, args, deleteReply, deleteDelay);
  }

  if (sub === 'max') {
    if (_currentProfile(guildId) === 'max') {
      const sent = await embed.replyError(
        message,
        'La sécurité antiraid est déjà en mode **maximal**.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    _setProfile(guildId, 'max');

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          'La sécurité antiraid a été activée en mode maximal.',
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  const sent = await embed.replyError(
    message,
    'Utilisez `secur on`, `secur max`, `secur off` ou `secur invite <on/off>`.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};

const ALL_MODULES = [
  'antilinkEnabled',
  'antispamEnabled',
  'antiEveryoneEnabled',
  'antibotEnabled',

  'antitokenEnabled',

  'antiwebhookEnabled',
  'antichannelEnabled',
  'antibanEnabled',
  'antiupdateEnabled',
  'antivanityEnabled',
  'antidecoEnabled',
  'antiroleEnabled',
  'antiunbanEnabled',
  'blrankEnabled',
  'antibadwordEnabled',
  'antimassmentionEnabled',
];

const BASE_MODULES = [
  'antilinkEnabled',
  'antispamEnabled',
  'antiEveryoneEnabled',
  'antibotEnabled',
  'antibadwordEnabled',
  'antimassmentionEnabled',
];

function _currentProfile(guildId) {
  const guildConfig    = db.getGuildConfig(guildId) || {};
  const antiraidConfig = db.getAntiraidConfig(guildId) || {};

  if (Number(guildConfig.antiraidEnabled) !== 1) return 'off';

  const allOn = ALL_MODULES.every(m => Number(antiraidConfig[m] ?? 0) === 1);
  if (allOn) return 'max';

  const baseSet = new Set(BASE_MODULES);
  const matchesBase =
    BASE_MODULES.every(m => Number(antiraidConfig[m] ?? 0) === 1) &&
    ALL_MODULES.filter(m => !baseSet.has(m)).every(m => Number(antiraidConfig[m] ?? 0) === 0);

  if (matchesBase) return 'base';

  return 'custom';
}

function _setProfile(guildId, profile) {

  const allModules = ALL_MODULES;
  const baseModules = BASE_MODULES;

  for (const moduleName of allModules) {
    db.setAntiraidConfig(guildId, moduleName, 0);
  }

  if (profile === 'base') {
    for (const moduleName of baseModules) {
      db.setAntiraidConfig(guildId, moduleName, 1);
    }
    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    return;
  }

  if (profile === 'max') {
    for (const moduleName of allModules) {
      db.setAntiraidConfig(guildId, moduleName, 1);
    }
    db.setGuildConfig(guildId, 'antiraidEnabled', 1);
    return;
  }

  db.setGuildConfig(guildId, 'antiraidEnabled', 0);
}

async function _showConfig(message, guildId) {

  const guildConfig    = db.getGuildConfig(guildId) || {};
  const antiraidConfig = db.getAntiraidConfig(guildId) || {};

  const status = (value) => value ? 'Activé' : 'Désactivé';

  return message.channel.send({
    embeds: [
      embed.build(guildId, null, {
        title : 'Configuration antiraid',
        fields: [

          {
            name   : 'Antiraid global',
            value  : status(guildConfig.antiraidEnabled),
            inline : true,
          },

          {
            name   : 'Antispam',
            value  : `${status(antiraidConfig.antispamEnabled)} - Seuil : ${antiraidConfig.antispamThreshold ?? 5} messages / ${antiraidConfig.antispamWindow ?? 5} secondes`,
            inline : true,
          },

          {
            name   : 'Antilink',
            value  : `${status(antiraidConfig.antilinkEnabled)} - Mode : ${antiraidConfig.antilinkMode ?? 'all'}`,
            inline : true,
          },

          {
            name   : 'Antibadword',
            value  : `${status(antiraidConfig.antibadwordEnabled)} - Voir \`+badword list\``,
            inline : true,
          },

          {
            name   : 'Antimassmention',
            value  : `${status(antiraidConfig.antimassmentionEnabled)} - Seuil : ${antiraidConfig.antimassmentionThreshold ?? 5} mentions`,
            inline : true,
          },

          {
            name   : 'Antieveryone',
            value  : status(antiraidConfig.antiEveryoneEnabled),
            inline : true,
          },

          {
            name   : 'Antibot',
            value  : `${status(antiraidConfig.antibotEnabled)} - Punition : ${antiraidConfig.antibotPunish ?? 'kick'}`,
            inline : true,
          },

          {
            name   : 'Antitoken',
            value  : `${status(antiraidConfig.antitokenEnabled)} - ${antiraidConfig.antitokenThreshold ?? 0}/${antiraidConfig.antitokenWindow ?? 0}s`,
            inline : true,
          },

          {
            name   : 'Antiwebhook',
            value  : status(antiraidConfig.antiwebhookEnabled),
            inline : true,
          },

          {
            name   : 'Antichannel',
            value  : `${status(antiraidConfig.antichannelEnabled)} - ${antiraidConfig.antichannelThreshold ?? 0}/${antiraidConfig.antichannelWindow ?? 0}s`,
            inline : true,
          },

          {
            name   : 'Antiban',
            value  : `${status(antiraidConfig.antibanEnabled)} - ${antiraidConfig.antibanThreshold ?? 0}/${antiraidConfig.antibanWindow ?? 0}s`,
            inline : true,
          },

          {
            name   : 'Antiupdate',
            value  : status(antiraidConfig.antiupdateEnabled),
            inline : true,
          },

          {
            name   : 'Antivanity',
            value  : `${status(antiraidConfig.antivanityEnabled)} - Punition : ${antiraidConfig.antivanityPunish ?? 'derank'}`,
            inline : true,
          },

          {
            name   : 'Antideco',
            value  : status(antiraidConfig.antidecoEnabled),
            inline : true,
          },

          {
            name   : 'Antirole',
            value  : status(antiraidConfig.antiroleEnabled),
            inline : true,
          },

          {
            name   : 'Antiunban',
            value  : status(antiraidConfig.antiunbanEnabled),
            inline : true,
          },

          {
            name   : 'Creation limit',
            value  : antiraidConfig.creationLimit
              ? _formatDuration(antiraidConfig.creationLimit)
              : 'Désactivé',
            inline : true,
          },

          {
            name   : 'Raidping',
            value  : antiraidConfig.raidPingRole
              ? `<@&${antiraidConfig.raidPingRole}>`
              : 'Non configuré',
            inline : true,
          },

          {
            name   : 'Secur invite (global)',
            value  : db.getBotSetting('securInvite') === '1' ? 'Activé' : 'Désactivé',
            inline : true,
          },

        ],
        footer    : 'secur on | secur max | secur off | secur invite <on/off>',
        timestamp : false,
      })
    ],
    allowedMentions: { repliedUser: false },
  });
}

async function _handleInvite(message, args, deleteReply, deleteDelay) {
  if (!perms.isBuyer(message.author.id) && !perms.isOwner(guildId,message.author.id)) {
    const sent = await embed.replyError(
      message,
      'Seul le buyer ou un owner global peut configurer le secur invite (réglage global).',
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const guildId = message.guild.id;
  const value   = args[1]?.toLowerCase();

  if (!value) {
    const current = db.getBotSetting('securInvite') === '1';
    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Secur invite est actuellement **${current ? 'activé' : 'désactivé'}** (global).`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (value === 'on') {
    if (db.getBotSetting('securInvite') === '1') {
      const sent = await embed.replyError(
        message,
        'Secur invite est déjà activé.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.setBotSetting('securInvite', '1');

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          'Secur invite **activé**. Le bot quittera automatiquement les serveurs non autorisés.',
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (value === 'off') {
    if (db.getBotSetting('securInvite') !== '1') {
      const sent = await embed.replyError(
        message,
        'Secur invite est déjà désactivé.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.setBotSetting('securInvite', '0');

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          'Secur invite **désactivé**.',
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const sent = await embed.replyError(
    message,
    'Utilisez `secur invite on` ou `secur invite off`.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

function _formatDuration(seconds) {

  const value = Number(seconds) || 0;

  if (!value) return '0s';
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m`;
  if (value < 86400) return `${Math.floor(value / 3600)}h`;

  return `${Math.floor(value / 86400)}j`;
}
