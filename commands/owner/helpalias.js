'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'helpalias',
    description : 'Active ou désactive l’affichage des aliases dans le help.',
    use         : 'helpalias <on/off>',
    usage       : 'helpalias <on/off>',
    aliases     : ['aliaseshelp'],
    category    : 'owner',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const state = _parseToggle(args[0]);

    if (state === null) {
      const current = Number(config?.helpAliasEnabled ?? 1) === 1
        ? 'Activé'
        : 'Désactivé';

      return _reply(
        message,
        `Affichage des aliases dans le help : \`${current}\`.\nUtilisation : \`${message.prefix || '+'}helpalias <on/off>\``,
        deleteReply,
        deleteDelay
      );
    }

    db.setGuildConfig(guildId, 'helpAliasEnabled', state ? 1 : 0);

    return _reply(
      message,
      `Affichage des aliases dans le help ${state ? 'activé' : 'désactivé'}.`,
      deleteReply,
      deleteDelay
    );
  },
};

function _parseToggle(value) {
  const raw = String(value || '').toLowerCase();

  if (['on', 'enable', 'enabled', 'true', 'yes', 'oui', '1'].includes(raw)) return true;
  if (['off', 'disable', 'disabled', 'false', 'no', 'non', '0'].includes(raw)) return false;

  return null;
}

async function _reply(message, content, deleteReply, deleteDelay) {
  const sent = await embed.reply(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
