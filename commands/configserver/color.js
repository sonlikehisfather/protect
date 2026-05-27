'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COLOR_NAMES = {
  noir   : '#000000',
  blanc  : '#FFFFFF',
  rouge  : '#FF0000',
  vert   : '#00FF00',
  bleu   : '#0000FF',
  jaune  : '#FFFF00',
  orange : '#FFA500',
  violet : '#800080',
  rose   : '#FFB6C1',
  gris   : '#808080',
};

exports.help = {
  name        : 'color',
  description : 'Changer la couleur des embeds du bot sur le serveur.',
  usage       : 'color <#hex|nom|reset>',
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

  const rawColor = args[0]?.trim();

  if (!rawColor) {
    const sent = await embed.replyError(
      message,
      'Précisez une couleur.\nExemples : `color #FFB6C1` ou `color bleu`'
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (['reset', 'default', 'none'].includes(rawColor.toLowerCase())) {

    if (!config?.color) {
      const sent = await embed.replyError(
        message,
        'Aucune couleur personnalisée n’est définie.'
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    db.setGuildConfig(guildId, 'color', '#2B2D31');

    const sent = await embed.reply(
      message,
      'Couleur réinitialisée sur la valeur par défaut.'
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

    return;
  }

  const color = _normalizeHexColor(rawColor);

  if (!color) {
    const sent = await embed.replyError(
      message,
      'Couleur invalide.\nUtilisez un hex valide ou un nom simple (ex : bleu, rouge, noir).'
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (String(config?.color || '').toLowerCase() === color.toLowerCase()) {
    const sent = await embed.replyError(
      message,
      `La couleur \`${color}\` est déjà utilisée sur ce serveur.`
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  db.setGuildConfig(guildId, 'color', color);

  const sent = await embed.reply(
    message,
    `Couleur des embeds définie sur \`${color}\`.`,
    {
      color,
      timestamp: false,
    }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};

function _normalizeHexColor(input) {
  const value = String(input || '').trim().toLowerCase();

  if (COLOR_NAMES[value]) {
    return COLOR_NAMES[value];
  }

  if (/^#?[0-9a-fA-F]{6}$/.test(value)) {
    return value.startsWith('#')
      ? value.toUpperCase()
      : `#${value.toUpperCase()}`;
  }

  return null;
}
