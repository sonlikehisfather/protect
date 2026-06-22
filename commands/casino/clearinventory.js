'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

exports.help = {
  name       : 'clearinventory',
  description: 'Vider l\'inventaire casino d\'un membre.',
  use        : 'clearinventory <@user/ID>',
  usage      : 'clearinventory @user',
  aliases    : ['clearinv'],
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId  = message.guild.id;
  const authorId = message.author.id;

  if (
    !perms.isBuyer(authorId) &&
    !perms.isOwner(guildId, authorId) &&
    !db.isCasinoManager(guildId, authorId)
  ) {
    return embed.replyError(message, 'Tu dois etre gerant casino, owner ou buyer pour utiliser cette commande.');
  }

  const target = message.mentions.users.first()
    || message.guild.members.cache.get(args[0])?.user
    || await client.users.fetch(args[0]).catch(() => null);
  if (!target) {
    return embed.replyError(message, 'Utilisateur invalide. Mention ou ID requis.');
  }

  const cfg = db.getCasinoConfig(guildId);
  if (!cfg.enabled) {
    return embed.replyError(message, 'Le casino n\'est pas active.');
  }

  const inv = db.getInventory(guildId, target.id);
  const shields = db.getShields(guildId, target.id);
  if (!inv.length && shields <= 0) {
    return embed.replyError(message, `<@${target.id}> n'a aucun item ni bouclier dans son inventaire.`);
  }

  const itemCount = inv.reduce((sum, i) => sum + (i.quantity || 1), 0);
  db.clearInventory(guildId, target.id);
  db.addShields(guildId, target.id, -shields);

  const { sendCasinoLog } = require('./casino');
  sendCasinoLog(message.guild, cfg, 'logChannelGains', {
    icon  : 'x',
    title : 'Clear Inventory',

    lines : [
      `> Inventaire vidé pour <@${target.id}> (${itemCount} item(s) et ${shields} bouclier(s) supprime(s))`,
      `> par <@${authorId}>`,
    ],
  });

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Clear Inventory\n\n` +
      `> Inventaire de <@${target.id}> vidé avec succes\n` +
      `> **${itemCount}** item(s) et **${shields}** bouclier(s) supprime(s)\n\n` +
      `-# Action effectuee par <@${authorId}>`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  return embed.reply(message,
    `Inventaire de <@${target.id}> vidé (${itemCount} item(s) et ${shields} bouclier(s) supprime(s)).`,
    { title: 'Clear Inventory' }
  );
};
