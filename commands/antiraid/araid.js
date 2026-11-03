'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const { parseDuration, formatDuration } = require('../../utils/parseDuration.js');

const RESTORE_OPTIONS = {
  channel : { key: 'antichannelRestore', label: 'Recréer les salons supprimés (antichannel)' },
  roles   : { key: 'antirolesRestore',   label: 'Restaurer les rôles (antiroles)' },
  ban     : { key: 'antibanRestore',     label: 'Débannir les victimes d’un ban en masse (antiban)' },
  channeledit : { key: 'antichanneleditRestore', label: 'Remettre permissions/nom d’un salon modifié (antichanneledit)' },
  everyone    : { key: 'antieverypermRestore',    label: 'Remettre les permissions du rôle @everyone (antieveryoneperm)' },
  thread  : { key: 'antithreadRestore', label: 'Supprimer les fils créés pendant la rafale (antithread)' },
  invite  : { key: 'antiinviteRestore', label: 'Supprimer les invitations créées pendant la rafale (antiinvite)' },
  unban   : { key: 'antiunbanRestore',   label: 'Rebannir la cible d’un unban (antiunban)' },
};

module.exports = {
  help: {
    name        : 'araid',
    description : 'Options globales de l’antiraid (restaurations, protectuser, durée de mute, antitoken).',
    usage       : 'araid [protectuser|muteduration|tokenrestore|derankbackup|alerts|autolockdown|lockdown|restore] [valeur]',
    aliases     : ['antiraidoptions', 'aropt'],
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

    if (!perms.check(message, 'araid')) return;
    if (del.deleteCmd) await message.delete().catch(() => {});

    const reply = async (text, error = false) => {
      const sent = error
        ? await embed.replyError(message, text, { timestamp: false }).catch(() => null)
        : await embed.sendEmbed(message.channel, guildId, text, { timestamp: false, allowedMentions: { parse: [] } });
      if (sent && del.deleteReply) embed.scheduleDelete(sent, del.deleteDelay);
      return sent;
    };

    const prefix = message.prefix || '+';
    const sub    = args[0]?.toLowerCase();
    const value  = args[1]?.toLowerCase();
    const onOff  = v => (v === 'on' || v === 'off' ? (v === 'on' ? 1 : 0) : null);

    if (!sub) return reply(_summary(db.getAntiraidConfig(guildId), prefix));

    if (sub === 'protectuser') {
      const v = onOff(value);
      if (v === null) return reply(`Utilisation : \`${prefix}araid protectuser <on|off>\``, true);
      db.setAntiraidConfig(guildId, 'antiraidProtectUserBypass', v);
      return reply(v
        ? 'Les **protectuser** sont maintenant **exemptés** de l’antiraid.'
        : 'Les **protectuser** ne sont **plus exemptés** de l’antiraid (ils peuvent être sanctionnés).');
    }

    if (sub === 'alerts') {
      const v = onOff(value);
      if (v === null) return reply(`Utilisation : \`${prefix}araid alerts <on|off>\``, true);
      db.setAntiraidConfig(guildId, 'antiraidAlertDm', v);
      return reply(`Alertes par message privé (buyers et owners) : **${v ? 'activées' : 'désactivées'}**.`);
    }

    if (sub === 'autolockdown') {
      const v = onOff(value);
      if (v === null) return reply(`Utilisation : \`${prefix}araid autolockdown <on|off>\``, true);
      db.setAntiraidConfig(guildId, 'antiraidAutoLockdown', v);
      return reply(`Lockdown automatique quand l’antitoken se déclenche : **${v ? 'activé' : 'désactivé'}**.`);
    }

    if (sub === 'lockdown') {
      const keys = { channels: 'antiraidLockdownChannels', verif: 'antiraidLockdownVerif', invites: 'antiraidLockdownInvites' };
      const key = keys[value];
      const v = onOff(args[2]?.toLowerCase());
      if (!key || v === null) {
        return reply(`Utilisation : \`${prefix}araid lockdown <channels|verif|invites> <on|off>\``, true);
      }
      db.setAntiraidConfig(guildId, key, v);
      return reply(`Lockdown - ${value} : **${v ? 'inclus' : 'ignoré'}**.`);
    }

    if (sub === 'derankbackup') {
      const v = onOff(value);
      if (v === null) return reply(`Utilisation : \`${prefix}araid derankbackup <on|off>\``, true);
      db.setAntiraidConfig(guildId, 'antiraidDerankBackup', v);
      return reply(`Sauvegarde des rôles retirés par un derank antiraid : **${v ? 'activée' : 'désactivée'}** (\`${prefix}underank\` pour restaurer).`);
    }

    if (sub === 'muteduration') {
      const seconds = parseDuration(args[1] || '', { unit: 's', defaultUnit: 's' });
      if (!seconds || seconds < 10 || seconds > 28 * 86400) {
        return reply(`Utilisation : \`${prefix}araid muteduration <durée>\` (10 s à 28 jours, ex : 10m, 2h).`, true);
      }
      db.setAntiraidConfig(guildId, 'antiraidMuteDuration', seconds);
      return reply(`Durée du mute antiraid : **${formatDuration(seconds * 1000)}**.`);
    }

    if (sub === 'tokenrestore') {
      if (value === 'off' || value === '0') {
        db.setAntiraidConfig(guildId, 'antitokenRestoreMinutes', 0);
        return reply('Antitoken : le niveau de vérification ne sera **pas** remis automatiquement.');
      }
      const seconds = parseDuration(args[1] || '', { unit: 's', defaultUnit: 'm' });
      const minutes = seconds ? Math.round(seconds / 60) : 0;
      if (!minutes || minutes < 1 || minutes > 1440) {
        return reply(`Utilisation : \`${prefix}araid tokenrestore <durée|off>\` (1 minute à 24 h, ex : 30m, 2h).`, true);
      }
      db.setAntiraidConfig(guildId, 'antitokenRestoreMinutes', minutes);
      return reply(`Antitoken : niveau de vérification remis après **${minutes} min**.`);
    }

    if (sub === 'restore') {
      const target = RESTORE_OPTIONS[value];
      const v = onOff(args[2]?.toLowerCase());
      if (!target || v === null) {
        return reply(
          `Utilisation : \`${prefix}araid restore <${Object.keys(RESTORE_OPTIONS).join('|')}> <on|off>\``,
          true
        );
      }
      db.setAntiraidConfig(guildId, target.key, v);
      return reply(`${target.label} : **${v ? 'activé' : 'désactivé'}**.`);
    }

    return reply(`Option inconnue. Utilise \`${prefix}araid\` pour voir la liste.`, true);
  },
};

function _summary(cfg, prefix) {
  const on = v => (v ? 'activé' : 'désactivé');
  return [
    '**Options globales antiraid**',
    '',
    `\`protectuser\` exemptés de l’antiraid : **${on(cfg.antiraidProtectUserBypass)}**`,
    `\`muteduration\` durée du mute : **${formatDuration((Number(cfg.antiraidMuteDuration) || 600) * 1000)}**`,
    `\`tokenrestore\` remise du niveau de vérification (antitoken) : **${cfg.antitokenRestoreMinutes > 0 ? `${cfg.antitokenRestoreMinutes} min` : 'jamais'}**`,
    `\`derankbackup\` sauvegarde des rôles retirés : **${on(cfg.antiraidDerankBackup !== 0)}**`,
    '',
    `\`alerts\` alertes en message privé aux buyers/owners : **${on(cfg.antiraidAlertDm !== 0)}**`,
    `\`autolockdown\` lockdown auto sur antitoken : **${on(cfg.antiraidAutoLockdown)}**`,
    `\`lockdown\` contenu du lockdown : salons **${on(cfg.antiraidLockdownChannels !== 0)}**, vérification **${on(cfg.antiraidLockdownVerif !== 0)}**, invitations **${on(cfg.antiraidLockdownInvites !== 0)}**`,
    '',
    '**Restaurations** (`restore <option> <on|off>`)',
    ...Object.entries(RESTORE_OPTIONS).map(([k, o]) => `\`${k}\` ${o.label} : **${on(cfg[o.key])}**`),
    '',
    `Exemple : \`${prefix}araid restore channel on\``,
  ].join('\n');
}
