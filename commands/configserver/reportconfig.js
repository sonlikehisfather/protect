'use strict';


const embed = require('../../utils/embed');

exports.help = {
  name        : 'reportconfig',
  description : 'Alias de +report settings.',
  usage       : 'reportconfig [on|off|channel|settings|...]',
  aliases     : [],
};

exports.run = async (client, message, args) => {
  const report = client.commands.get('report');

  if (!report || typeof report.run !== 'function') {
    return embed.replyError(
      message,
      'La commande report est indisponible.',
      { timestamp: false }
    ).catch(() => null);
  }

  return report.run(client, message, ['settings', ...(args || [])]);
};
