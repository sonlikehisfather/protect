'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const KIND_LABELS = {
  sanction : 'Sanction',
  restore  : 'Restauration',
  lockdown : 'Lockdown',
};

module.exports = {
  help: {
    name        : 'raidhistory',
    description : 'Historique des actions de l’antiraid (sanctions, restaurations, lockdown).',
    usage       : 'raidhistory [nombre|@membre] | raidhistory clear confirm',
    aliases     : ['raidlogs', 'rh'],
    category    : 'antiraid',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;
    const config  = db.getGuildConfig(guildId);
    const del = {
      deleteCmd   : Boolean(config?.autoDeleteModCmds),
      deleteReply : Boolean(config?.autoDeleteModReplies),
      deleteDelay : config?.autoDeleteDelay ?? 5,
    };

    if (!perms.check(message, 'raidhistory')) return;
    if (del.deleteCmd) await message.delete().catch(() => {});

    const reply = async (text, error = false, options = {}) => {
      const sent = error
        ? await embed.replyError(message, text, { timestamp: false }).catch(() => null)
        : await embed.sendEmbed(message.channel, guildId, text, { timestamp: false, allowedMentions: { parse: [] }, ...options });
      if (sent && del.deleteReply) embed.scheduleDelete(sent, del.deleteDelay);
      return sent;
    };

    if (args[0]?.toLowerCase() === 'clear') {
      if (!perms.isBuyer(message.author.id)) return reply('Commande réservée au buyer.', true);
      if (args[1]?.toLowerCase() !== 'confirm') return reply('Confirme avec : `raidhistory clear confirm`', true);
      const n = db.clearAntiraidHistory(guildId);
      return reply(`Historique vidé (${n} entrée${n > 1 ? 's' : ''}).`);
    }

    let limit = 15;
    let executorId = null;

    const mention = message.mentions.users.first();
    if (mention) {
      executorId = mention.id;
    } else if (args[0] && /^\d{17,20}$/.test(args[0])) {
      executorId = args[0];
    } else if (args[0] && /^\d{1,2}$/.test(args[0])) {
      limit = Math.min(Math.max(parseInt(args[0], 10), 1), 30);
    }

    const rows = db.getAntiraidHistory(guildId, limit, executorId);
    if (!rows.length) return reply('Aucune action enregistrée.');

    const lines = rows.map(r => {
      const who = r.executorId ? ` <@${r.executorId}>` : '';
      return `<t:${r.at}:d> <t:${r.at}:T> ・ **${KIND_LABELS[r.kind] ?? r.kind}** \`${r.source}\`${who}${r.detail ? ` ・ ${r.detail}` : ''}`;
    });

    return reply(lines.join('\n').slice(0, 3900), false, {
      title: `Historique antiraid (${rows.length})`,
    });
  },
};
