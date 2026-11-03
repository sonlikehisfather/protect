'use strict';

const db       = require('../../core/database');
const embed    = require('../../utils/embed');
const perms    = require('../../utils/permissions');
const lockdown = require('../../utils/lockdown');

module.exports = {
  help: {
    name        : 'lockdown',
    description : 'Mode panique : verrouille les salons, le niveau de vérification et les invitations.',
    usage       : 'lockdown <on|off|status>',
    aliases     : ['panic', 'panique'],
    category    : 'antiraid',
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);
    const del = {
      deleteCmd   : Boolean(config?.autoDeleteModCmds),
      deleteReply : Boolean(config?.autoDeleteModReplies),
      deleteDelay : config?.autoDeleteDelay ?? 5,
    };

    if (!perms.check(message, 'lockdown')) return;
    if (del.deleteCmd) await message.delete().catch(() => {});

    const reply = async (text, error = false) => {
      const sent = error
        ? await embed.replyError(message, text, { timestamp: false }).catch(() => null)
        : await embed.sendEmbed(message.channel, guildId, text, { timestamp: false, allowedMentions: { parse: [] } });
      if (sent && del.deleteReply) embed.scheduleDelete(sent, del.deleteDelay);
      return sent;
    };

    const sub = args[0]?.toLowerCase();

    if (sub === 'on') {
      const progress = await message.channel.send({ content: 'Lockdown en cours...', allowedMentions: { parse: [] } }).catch(() => null);
      const r = await lockdown.enable(client, guild, message.author.id);
      if (progress) progress.delete().catch(() => {});
      if (!r.ok) return reply(r.error, true);
      return reply([
        '**Lockdown activé.**',
        `Salons verrouillés : **${r.channels}**${r.failed ? ` (échecs : ${r.failed})` : ''}`,
        `Niveau de vérification maximal : **${r.verification ? 'oui' : 'non / inchangé'}**`,
        `Invitations coupées : **${r.invites ? 'oui' : 'non / inchangé'}**`,
        'Utilise `lockdown off` pour tout remettre.',
      ].join('\n'));
    }

    if (sub === 'off') {
      const progress = await message.channel.send({ content: 'Fin du lockdown en cours...', allowedMentions: { parse: [] } }).catch(() => null);
      const r = await lockdown.disable(client, guild, message.author.id);
      if (progress) progress.delete().catch(() => {});
      if (!r.ok) return reply(r.error, true);
      return reply([
        '**Lockdown désactivé.**',
        `Salons rétablis : **${r.channels}**${r.failed ? ` (échecs : ${r.failed})` : ''}`,
        `Niveau de vérification remis : **${r.verification ? 'oui' : 'non / inchangé'}**`,
        `Invitations réactivées : **${r.invites ? 'oui' : 'non / inchangé'}**`,
      ].join('\n'));
    }

    if (sub === 'status' || !sub) {
      const state = db.getLockdownState(guildId);
      if (!state) return reply('Le serveur n’est **pas** en lockdown.');
      return reply(`Le serveur est en **lockdown** depuis <t:${state.lockedAt}:R> (par <@${state.lockedBy}>).\n${Object.keys(state.data.channels || {}).length} salon(s) verrouillé(s).`);
    }

    return reply('Utilisation : `lockdown <on|off|status>`', true);
  },
};
