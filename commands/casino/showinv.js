'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder, SeparatorBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

exports.help = {
  name       : 'showinv',
  description: 'Voir l\'inventaire casino d\'un membre.',
  use        : 'showinv <@user/ID>',
  usage      : 'showinv @user',
  aliases    : ['showinventory', 'invsee'],
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

  const inv = db.getInventory(guildId, target.id);
  const equipped = db.getEquippedItems(guildId, target.id);
  const user = db.getCasinoUser(guildId, target.id);
  const shields = db.getShields(guildId, target.id);

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().setAccentColor(0xFEE75C);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Inventaire de <@${target.id}>\n` +
      `> Solde : **${embed.fmtCoins((user.coins || 0))}** coins  •  Tirages : **${user?.draws || 0}**`
    ));
    container.addSeparatorComponents(new SeparatorBuilder());

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `### ◊ Boucliers\n` +
      `❃ **${shields}** bouclier${shields !== 1 ? 's' : ''} anti-vol`
    ));
    container.addSeparatorComponents(new SeparatorBuilder());

    if (!inv.length) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*Aucun item*'));
    } else {
      const byType = {};
      inv.forEach(item => {
        if (!byType[item.type]) byType[item.type] = [];
        byType[item.type].push(item);
      });
      for (const [type, items] of Object.entries(byType)) {
        let desc = `**${type.toUpperCase()}**\n`;
        items.forEach(item => {
          const eq = equipped[type] === item.itemId ? '◆ ' : '◇ ';
          desc += `${eq}${item.name} x${item.quantity}\n`;
        });
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(desc));
      }
    }

    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `-# Consulte par <@${authorId}>`
    ));

    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  let text = `**Inventaire de <@${target.id}>**\nSolde : **${embed.fmtCoins((user.coins || 0))}** coins • Tirages : **${user?.draws || 0}**\n\n`;
  text += `◊ Boucliers : **${shields}**\n\n`;
  if (!inv.length) {
    text += '*Aucun item*';
  } else {
    const byType = {};
    inv.forEach(item => {
      if (!byType[item.type]) byType[item.type] = [];
      byType[item.type].push(item);
    });
    for (const [type, items] of Object.entries(byType)) {
      text += `**${type.toUpperCase()}**\n`;
      items.forEach(item => {
        const eq = equipped[type] === item.itemId ? '◆ ' : '◇ ';
        text += `${eq}${item.name} x${item.quantity}\n`;
      });
      text += '\n';
    }
  }
  return embed.reply(message, text, { title: 'Show Inventory', color: '#FEE75C' });
};
