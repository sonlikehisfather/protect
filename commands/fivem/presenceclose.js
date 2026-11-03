'use strict';

const {
  canUseFivem,
  getDeletePolicy,
  getModuleConfig,
  removeActivePresence,
  pruneActivePresences,
  logAction,
  reply,
  replyError,
} = require('./_shared');

module.exports = {
  help: {
    name        : 'presenceclose',
    description : 'Cloture une presence (libere la mission) et affiche le bilan. Sans argument : la plus recente. `all` : toutes.',
    usage       : 'presenceclose [message_id|all]',
    aliases     : ['pclose', 'closepresence'],
    category    : 'fivem',
    selfManaged : true,
  },

  async run(client, message, args) {
    const guild = message.guild;
    const guildId = guild.id;

    if (!canUseFivem(message, module.exports.help.name)) {
      return replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.", module.exports.help.name);
    }

    const del = getDeletePolicy(guildId);
    if (del.deleteCmd) await message.delete().catch(() => {});

    const cfg = getModuleConfig(guildId);
    const list = cfg.activePresences;
    if (!list.length) {
      return replyError(message, 'Aucune presence active.', module.exports.help.name);
    }

    const arg = (args[0] || '').trim().toLowerCase();
    let toClose;
    if (arg === 'all') {
      toClose = [...list];
    } else if (arg) {
      const id = arg.match(/\d{17,20}/)?.[0];
      const found = id && list.find(p => p.messageId === id);
      if (!found) return replyError(message, 'Presence introuvable parmi les presences actives.', module.exports.help.name);
      toClose = [found];
    } else {
      toClose = [list[list.length - 1]];
    }

    const blocks = [];
    for (const active of toClose) {
      let summary = 'bilan indisponible (message supprime)';
      const channel = guild.channels.cache.get(active.channelId);
      const target = channel?.isTextBased?.()
        ? await channel.messages.fetch(active.messageId).catch(() => null)
        : null;

      if (target) {
        const counts = { '✅': 0, '❌': 0, '⏳': 0 };
        for (const reaction of target.reactions.cache.values()) {
          const name = reaction.emoji?.name;
          if (!(name in counts)) continue;
          const users = await reaction.users.fetch().catch(() => null);
          if (!users) continue;
          counts[name] = users.filter(u => !u.bot).size;
        }
        summary = `✅ ${counts['✅']} ・ ❌ ${counts['❌']} ・ ⏳ ${counts['⏳']}`;
      }

      removeActivePresence(guildId, active.messageId);
      blocks.push(`**${active.title || 'Sans titre'}** (${active.type || '?'}${active.slot && active.slot !== 'op' ? ` - ${active.slot}` : ''}) : ${summary}`);
    }

    await pruneActivePresences(guild);

    await logAction(message, 'Presence cloturee', [
      { name: 'Presences', value: blocks.join('\n').slice(0, 1000), inline: false },
    ]);

    return reply(
      message,
      `${toClose.length} presence(s) cloturee(s).\n${blocks.join('\n')}`,
      { timestamp: false },
      module.exports.help.name
    );
  },
};
