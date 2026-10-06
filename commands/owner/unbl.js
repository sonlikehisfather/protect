'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'unbl',
  description: 'Retirer un membre de la blacklist globale.',
  use        : 'unbl <@membre/ID>',
  usage      : 'unbl <@membre/ID>',
  category   : 'owner',
};

exports.run = async (client, message, args) => {
  const authorId = message.author.id;
  const guildId  = message.guild.id;

  if (
    !perms.isBuyer(authorId) &&
    !perms.isOwner(guildId, authorId)
  ) {
    return embed.replyError(message, 'Permission refusée.');
  }

  if (!args[0]) {
    return embed.replyError(message, 'Utilisation : `unbl <@membre/ID>`');
  }

  const target =
    message.mentions.users.first() ??
    await client.users.fetch(args[0]).catch(() => null);

  if (!target) {
    return embed.replyError(message, 'Utilisateur introuvable.');
  }

  const entry = db.getBlacklistEntry(target.id);

  if (!entry) {
    return embed.replyError(message, `${target.username} n'est pas dans la blacklist.`);
  }

  const guilds = [...client.guilds.cache.values()];
  const progressDescription =
    `**Membre :** <@${target.id}> (\`${target.id}\`)\n\n` +
    `Retrait de la blacklist et débannissement en cours sur ${guilds.length} serveur(s)...`;
  const panel = await message.channel.send(
    _statusPayload(guildId, `Unblacklist de ${target.username}`, progressDescription)
  ).catch(() => null);

  if (!panel) {
    return embed.replyError(message, 'Impossible d’afficher le suivi de l’unblacklist.');
  }

  try {
    db.removeBlacklist(target.id);
  } catch {
    const failure =
      `**Membre :** <@${target.id}> (\`${target.id}\`)\n\n` +
      `Impossible de retirer cette entrée de la blacklist globale.`;
    await panel.edit(_statusPayload(guildId, 'Unblacklist non effectué', failure)).catch(() => {});
    return;
  }

  let unbanned = 0;
  const failures = [];

  for (const guild of guilds) {
    try {
      await guild.bans.remove(target.id, 'Blacklist retirée');
      unbanned++;
    } catch (error) {
      failures.push(_unbanFailureReason(error));
    }
    await _wait(300);
  }

  const failureCounts = new Map();
  for (const reason of failures) {
    failureCounts.set(reason, (failureCounts.get(reason) ?? 0) + 1);
  }
  const failureSummary = [...failureCounts]
    .map(([reason, count]) => `• ${count} serveur(s) : ${reason}`)
    .join('\n') || 'Aucun.';
  const resultDescription =
    `**Membre :** <@${target.id}> (\`${target.id}\`)\n` +
    `**Débanni avec succès :** ${unbanned}/${guilds.length} serveur(s)\n` +
    `**Non débanni :** ${failures.length} serveur(s)\n\n` +
    `**Motifs :**\n${failureSummary}`;

  return panel.edit(_statusPayload(guildId, 'Unblacklist terminé', resultDescription))
    .catch(() => {});
};

function _statusPayload(guildId, title, description) {
  if (embed.shouldUseV2(guildId, module.exports.help.name)) {
    try {
      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n\n${description}`));
      return {
        embeds          : [],
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      };
    } catch {}
  }

  return {
    embeds          : [embed.build(guildId, description, { title, timestamp: false })],
    components      : [],
    allowedMentions : { parse: [] },
  };
}

function _unbanFailureReason(error) {
  const code = Number(error?.code ?? error?.rawError?.code);
  if (code === 10026) return 'membre déjà débanni ou absent de la liste des bans';
  if (code === 50013 || error?.status === 403) {
    return 'permissions insuffisantes ou hiérarchie des rôles du bot';
  }
  if (code === 50001) return 'le bot n’a pas accès au serveur';
  if (code) return `erreur Discord (${code})`;
  return 'erreur inattendue lors du débannissement';
}

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
