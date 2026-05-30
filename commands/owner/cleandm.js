'use strict';


const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const BATCH_SIZE    = 100;
const BATCH_DELAY   = 500;

exports.help = {
  name        : 'cleandm',
  description : 'Supprime les messages du bot en DM avec un ou tous les membres.',
  use         : 'cleandm <@membre|id|all>',
  usage       : 'cleandm <@membre|id|all>',
  category    : 'owner',
};

exports.run = async (client, message, args) => {

  if (!perms.isBuyer(message.author.id)) {
    return embed.replyError(message, 'Seul le buyer peut utiliser cette commande.', { timestamp: false });
  }

  const prefix = message.prefix || '+';

  if (!args[0]) {
    return embed.replyError(
      message,
      `Utilisation : \`${prefix}cleandm <@membre|id|all>\`\n` +
      `- \`${prefix}cleandm @membre\` → supprime les messages du bot dans le DM avec ce membre\n` +
      `- \`${prefix}cleandm all\` → supprime les messages du bot dans tous les DMs ouverts`,
      { timestamp: false }
    );
  }

  const sub = args[0].toLowerCase();

  if (sub === 'all') {
    return _cleanAll(client, message);
  }

  const user = await _resolveUser(client, message.guild, args[0]);

  if (!user) {
    return embed.replyError(message, 'Membre ou utilisateur introuvable.', { timestamp: false });
  }

  if (user.bot) {
    return embed.replyError(message, 'Impossible de nettoyer un DM avec un bot.', { timestamp: false });
  }

  return _cleanOne(client, message, user);
};


async function _cleanOne(client, message, user) {
  const status = await embed.reply(message, `Nettoyage du DM avec <@${user.id}>...`, { timestamp: false });

  try {
    const dm = await user.createDM().catch(() => null);
    if (!dm) {
      return embed.replyError(message, 'Impossible d\'ouvrir le DM avec cet utilisateur.', { timestamp: false });
    }

    const deleted = await _deleteMessagesInChannel(client, dm);

    await status?.edit({
      embeds: [embed.build(message.guild.id,
        `DM avec <@${user.id}> nettoyé ・ **${deleted}** message(s) supprimé(s).`,
        { color: '#57F287', timestamp: false }
      )],
    }).catch(() => {});

  } catch (err) {
    await status?.edit({
      embeds: [embed.build(message.guild.id,
        `Erreur lors du nettoyage : ${err.message}`,
        { color: '#ED4245', timestamp: false }
      )],
    }).catch(() => {});
  }
}


async function _cleanAll(client, message) {
  const dmChannels = client.channels.cache.filter(c => c.isDMBased?.() && !c.recipient?.bot);

  if (!dmChannels.size) {
    return embed.reply(message, 'Aucun DM ouvert en cache.', { timestamp: false });
  }

  const status = await embed.reply(
    message,
    `Nettoyage de **${dmChannels.size}** DM(s) en cours...`,
    { timestamp: false }
  );

  let totalDeleted  = 0;
  let channelsDone  = 0;

  for (const [, channel] of dmChannels) {
    try {
      const deleted = await _deleteMessagesInChannel(client, channel);
      totalDeleted += deleted;
    } catch {}
    channelsDone++;

    if (channelsDone % 5 === 0) {
      await status?.edit({
        embeds: [embed.build(message.guild.id,
          `Nettoyage en cours... ${channelsDone}/${dmChannels.size} DMs traités, **${totalDeleted}** message(s) supprimé(s).`,
          { timestamp: false }
        )],
      }).catch(() => {});
    }
  }

  await status?.edit({
    embeds: [embed.build(message.guild.id,
      `Nettoyage terminé ・ **${channelsDone}** DM(s) traités, **${totalDeleted}** message(s) supprimé(s).`,
      { color: '#57F287', timestamp: false }
    )],
  }).catch(() => {});
}


async function _deleteMessagesInChannel(client, channel) {
  let deleted = 0;
  let lastId  = null;

  while (true) {
    const options = { limit: BATCH_SIZE };
    if (lastId) options.before = lastId;

    const messages = await channel.messages.fetch(options).catch(() => null);
    if (!messages?.size) break;

    const botMessages = messages.filter(m => m.author.id === client.user.id);

    for (const [, msg] of botMessages) {
      await msg.delete().catch(() => {});
      deleted++;
      await _sleep(200);
    }

    lastId = messages.last()?.id;

    if (messages.size < BATCH_SIZE) break;

    await _sleep(BATCH_DELAY);
  }

  return deleted;
}


async function _resolveUser(client, guild, query) {
  const raw     = String(query || '').trim();
  const mention = raw.match(/^<@!?(\d{17,20})>$/);
  const id      = mention?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);

  if (id) {
    const member = guild?.members.cache.get(id)
      ?? await guild?.members.fetch(id).catch(() => null);
    if (member?.user) return member.user;
    return client.users.cache.get(id)
      ?? await client.users.fetch(id).catch(() => null);
  }

  const normalized = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const found = guild?.members.cache.find(m =>
    m.user.username.toLowerCase().includes(normalized) ||
    m.displayName.toLowerCase().includes(normalized)
  );

  return found?.user ?? null;
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
