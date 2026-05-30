'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'ticketstats',
  description: 'Affiche les statistiques des tickets du serveur.',
  usage      : 'ticketstats',
  category   : 'tickets',
};

exports.run = async (client, message) => {
  const guildId = message.guild.id;

  if (!perms.check(message, 'mod')) {
    return embed.replyError(message, 'Permission refusée.', { timestamp: false });
  }

  const stats = db.getTicketStats(guildId);

  const avgRatingStr = stats.avgRating !== null
    ? `${'⭐'.repeat(Math.round(stats.avgRating))} (${Number(stats.avgRating).toFixed(1)}/5)`
    : 'Aucune évaluation';

  let avgCloseStr = 'N/A';
  if (stats.avgClose !== null) {
    const secs = Math.round(stats.avgClose);
    if (secs < 3600) {
      avgCloseStr = `${Math.round(secs / 60)} min`;
    } else if (secs < 86400) {
      avgCloseStr = `${Math.round(secs / 3600)}h`;
    } else {
      avgCloseStr = `${Math.round(secs / 86400)}j`;
    }
  }

  return embed.reply(message, null, {
    title  : 'Statistiques des tickets',
    fields : [
      { name: 'Tickets fermés',     value: String(stats.total),   inline: true },
      { name: 'Tickets évalués',    value: String(stats.rated),   inline: true },
      { name: 'Note moyenne',       value: avgRatingStr,          inline: false },
      { name: 'Durée moyenne',      value: avgCloseStr,           inline: true },
    ],
    timestamp: false,
  });
};
