'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const TRIGGERS = ['spam', 'link', 'badword', 'mention', 'everyone'];

const TRIGGER_LABELS = {
  spam     : 'Spam',
  link     : 'Lien',
  badword  : 'Mot interdit',
  mention  : 'Mentions massives',
  everyone : 'Everyone / here',
};

const SCOPES = ['ancien', 'nouveau'];

const MIN_STRIKES = 1;
const MAX_STRIKES = 20;

exports.help = {
  name        : 'strikes',
  description : 'Configurer le poids de strike par déclencheur automod.',
  usage       : 'strikes [déclencheur] [nombre] [ancien|nouveau]',
  aliases     : ['strike'],
};

exports.run = async (client, message, args) => {
  if (!perms.check(message, exports.help.name)) return;

  const guildId = message.guild.id;
  const config  = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const triggerArg = args[0]?.toLowerCase();

  if (!triggerArg) {
    return _showList(message, guildId, deleteReply, deleteDelay);
  }

  if (!TRIGGERS.includes(triggerArg)) {
    return _replyError(
      message,
      `Déclencheur invalide. Valeurs acceptées : \`${TRIGGERS.join('`, `')}\`.`,
      deleteReply,
      deleteDelay
    );
  }

  const number = Number.parseInt(args[1], 10);

  if (!Number.isInteger(number) || number < MIN_STRIKES || number > MAX_STRIKES) {
    return _replyError(
      message,
      `Nombre de strikes invalide. Entier entre **${MIN_STRIKES}** et **${MAX_STRIKES}**.`,
      deleteReply,
      deleteDelay
    );
  }

  const scopeArg = args[2]?.toLowerCase();

  if (scopeArg && !SCOPES.includes(scopeArg)) {
    return _replyError(
      message,
      `Cible invalide. Utilisez \`ancien\`, \`nouveau\` ou laissez vide pour les deux.`,
      deleteReply,
      deleteDelay
    );
  }

  const existing = db.getStrikeTrigger(guildId, triggerArg);
  const current  = {
    strikes   : Number(existing?.strikes   ?? 1),
    ancienStr : Number(existing?.ancienStr ?? 1),
  };

  let nextStrikes   = current.strikes;
  let nextAncienStr = current.ancienStr;

  if (!scopeArg) {
    nextStrikes   = number;
    nextAncienStr = number;
  } else if (scopeArg === 'nouveau') {
    nextStrikes = number;
  } else if (scopeArg === 'ancien') {
    nextAncienStr = number;
  }

  db.setStrikeTrigger(guildId, triggerArg, nextStrikes, nextAncienStr);

  const label = TRIGGER_LABELS[triggerArg] || triggerArg;

  return _replySuccess(
    message,
    guildId,
    `Strikes \`${label}\` mis à jour.\n` +
    `Nouveau membre : **${nextStrikes}**\n` +
    `Ancien membre : **${nextAncienStr}**`,
    deleteReply,
    deleteDelay
  );
};

async function _showList(message, guildId, deleteReply, deleteDelay) {
  const lines = TRIGGERS.map(trigger => {
    const cfg       = db.getStrikeTrigger(guildId, trigger);
    const strikes   = Number(cfg?.strikes   ?? 1);
    const ancienStr = Number(cfg?.ancienStr ?? 1);
    const label     = TRIGGER_LABELS[trigger] || trigger;

    return `\`${trigger}\` ${label}\nNouveau : **${strikes}** - Ancien : **${ancienStr}**`;
  });

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        null,
        {
          title  : 'Poids de strikes par déclencheur',
          fields : [
            {
              name   : 'Configuration',
              value  : lines.join('\n\n').slice(0, 1024),
              inline : false,
            },
            {
              name   : 'Information',
              value  : 'Un membre est ancien après la durée configurée avec `+ancien`.',
              inline : false,
            },
          ],
          timestamp: false,
        }
      ),
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _replySuccess(message, guildId, content, deleteReply, deleteDelay) {
  const sent = await message.channel.send({
    embeds: [
      embed.build(guildId, content, { timestamp: false }),
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _replyError(message, content, deleteReply, deleteDelay) {
  const sent = await embed.replyError(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
