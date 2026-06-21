'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder, AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { checkCasinoChannel, checkCasinoLimits, setCooldown, sendCasinoLog } = require('./casino');
const { generateVolImage } = require('../../utils/volImage');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

exports.help = {
  name       : 'vol',
  description: 'Voler des coins et de l\'XP a un autre membre.',
  use        : 'vol <@user>',
  usage      : 'vol @user',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const userId  = message.author.id;

  const chErr = checkCasinoChannel(message);
  if (chErr) return embed.replyError(message, chErr);

  if (!db.isCasinoEnabled(guildId)) {
    return embed.replyError(message, 'Le casino n\'est pas actif.');
  }

  const limitErr = checkCasinoLimits(message, 'vol');
  if (limitErr) return embed.replyError(message, limitErr);

  const target = message.mentions.users.first()
    || message.guild.members.cache.get(args[0])?.user
    || await client.users.fetch(args[0]).catch(() => null);
  if (!target) {
    return embed.replyError(message, 'Utilisateur invalide. Mention ou ID requis.');
  }

  if (target.id === userId) {
    return embed.replyError(message, 'Tu ne peux pas te voler toi-meme.');
  }

  if (target.bot) {
    return embed.replyError(message, 'Tu ne peux pas voler un bot.');
  }

  const cfg = db.getCasinoConfig(guildId);
  const minPct = cfg.volMinPercent ?? 1;
  const maxPct = cfg.volMaxPercent ?? 5;
  const successRate = cfg.volSuccessRate ?? 60;
  const stealXp = cfg.volStealXp ?? 1;

  const targetUser = db.getCasinoUser(guildId, target.id);

  if (targetUser.coins < 100) {
    return embed.replyError(message, `<@${target.id}> n'a pas assez de coins a voler (minimum 100).`);
  }

  const thiefUser = db.getCasinoUser(guildId, userId);

  // Check if target has shields
  const targetShields = db.getShields(guildId, target.id);
  if (targetShields > 0) {
    db.consumeShield(guildId, target.id);
    setCooldown(guildId, userId, 'vol');
    sendCasinoLog(message.guild, cfg, 'logChannelGames', {
      icon  : '◊',
      title : 'Vol Bloque',
      color : 0x5865F2,
      user  : userId,
      lines : [
        `Cible : <@${target.id}>`,
        `Vol bloque par un bouclier (${targetShields - 1} restant(s))`,
      ],
    });

    let volImage = null;
    try {
      volImage = await generateVolImage({
        targetName: target.displayName || target.username, success: false, blocked: true, shieldsLeft: targetShields - 1,
      });
    } catch (e) {
      console.error('[VOL] Image error:', e?.message);
    }

    if (volImage) {
      if (V2_AVAILABLE) {
        const container = new ContainerBuilder().setAccentColor(0x5865F2);
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://vol_result.png')));
        return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(volImage, { name: 'vol_result.png' })], allowedMentions: { parse: [] } });
      }
      return embed.reply(message, `<@${target.id}> avait un bouclier ! Le vol a echoue. (${targetShields - 1} bouclier(s) restant(s))`, { title: 'Vol Bloque', color: '#5865F2', image: 'attachment://vol_result.png', files: [new AttachmentBuilder(volImage, { name: 'vol_result.png' })] });
    }

    if (V2_AVAILABLE) {
      const container = new ContainerBuilder().setAccentColor(0x5865F2);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## Vol Bloque\n\n` +
        `> <@${target.id}> avait un bouclier ! Le vol a echoue.\n` +
        `> Un bouclier a ete consomme (${targetShields - 1} restant(s)).`
      ));
      return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
    }
    return embed.reply(message, `<@${target.id}> avait un bouclier ! Le vol a echoue. (${targetShields - 1} bouclier(s) restant(s))`, { title: 'Vol Bloque', color: '#5865F2' });
  }

  // Success roll
  const success = Math.random() * 100 < successRate;

  if (!success) {
    setCooldown(guildId, userId, 'vol');
    const { sendCasinoLog: logFn } = require('./casino');
    logFn(message.guild, cfg, 'logChannelGames', {
      icon  : 'x',
      title : 'Vol Rate',
      color : 0xED4245,
      user  : userId,
      lines : [
        `Cible : <@${target.id}>`,
        `Echec du vol`,
      ],
    });

    let volImage = null;
    try {
      volImage = await generateVolImage({
        targetName: target.displayName || target.username, success: false, blocked: false,
      });
    } catch (e) {
      console.error('[VOL] Image error:', e?.message);
    }

    if (volImage) {
      if (V2_AVAILABLE) {
        const container = new ContainerBuilder().setAccentColor(0xED4245);
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://vol_result.png')));
        return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(volImage, { name: 'vol_result.png' })], allowedMentions: { parse: [] } });
      }
      return embed.reply(message, `Tu as tente de voler <@${target.id}> mais tu as echoue.`, { title: 'Vol Rate', color: '#ED4245', image: 'attachment://vol_result.png', files: [new AttachmentBuilder(volImage, { name: 'vol_result.png' })] });
    }

    if (V2_AVAILABLE) {
      const container = new ContainerBuilder().setAccentColor(0xED4245);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## Vol Rate\n\n` +
        `> Tu as tente de voler <@${target.id}> mais tu as echoue.\n` +
        `> Retente ta chance plus tard.`
      ));
      return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
    }
    return embed.reply(message, `Tu as tente de voler <@${target.id}> mais tu as echoue.`, { title: 'Vol Rate', color: '#ED4245' });
  }

  // Calculate stolen amount: random % between minPct and maxPct of target's coins
  const stealPercent = Math.random() * (maxPct - minPct) + minPct;
  const stolenCoins = Math.max(1, Math.floor(targetUser.coins * stealPercent / 100));

  // Steal coins
  db.removeCasinoCoins(guildId, target.id, stolenCoins);
  db.addCasinoCoins(guildId, userId, stolenCoins, 'win');

  // Steal XP if enabled
  let stolenXp = 0;
  if (stealXp) {
    const targetLevel = db.getLevel(guildId, target.id);
    if (targetLevel.xp > 0) {
      stolenXp = Math.max(1, Math.floor(targetLevel.xp * stealPercent / 100));
      db.removeXp(guildId, target.id, stolenXp);
      db.addXp(guildId, userId, stolenXp);
    }
  }

  setCooldown(guildId, userId, 'vol');

  const updatedThief = db.getCasinoUser(guildId, userId);

  // Log
  sendCasinoLog(message.guild, cfg, 'logChannelGames', {
    icon  : '◆',
    title : 'Vol Reussi',
    color : 0x57F287,
    user  : userId,
    lines : [
      `Cible : <@${target.id}>`,
      `+${embed.fmtCoins(stolenCoins)} coins (${stealPercent.toFixed(1)}%)`,
      stolenXp > 0 ? `+${embed.fmtCoins(stolenXp)} XP` : null,
      `Solde : ${embed.fmtCoins(updatedThief.coins)} coins`,
    ].filter(Boolean),
  });

  let volImage = null;
  try {
    volImage = await generateVolImage({
      targetName: target.displayName || target.username,
      success: true, blocked: false,
      stolenCoins, stolenXp, stealPercent,
      finalCoins: updatedThief.coins,
    });
  } catch (e) {
    console.error('[VOL] Image error:', e?.message);
  }

  if (volImage) {
    if (V2_AVAILABLE) {
      const container = new ContainerBuilder().setAccentColor(0x57F287);
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://vol_result.png')));
      return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(volImage, { name: 'vol_result.png' })], allowedMentions: { parse: [] } });
    }
    let desc = `+${embed.fmtCoins(stolenCoins)} coins (${stealPercent.toFixed(1)}%)`;
    if (stolenXp > 0) desc += `\n+${embed.fmtCoins(stolenXp)} XP`;
    desc += `\nSolde : ${embed.fmtCoins(updatedThief.coins)} coins`;
    return embed.reply(message, desc, { title: 'Vol', color: '#57F287', image: 'attachment://vol_result.png', files: [new AttachmentBuilder(volImage, { name: 'vol_result.png' })] });
  }

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().setAccentColor(0x57F287);
    let text = `## Vol Reussi\n\n` +
      `> Cible : <@${target.id}>\n` +
      `> ※ **+${embed.fmtCoins(stolenCoins)}** coins *(${stealPercent.toFixed(1)}% de sa fortune)*\n`;
    if (stolenXp > 0) text += `> ◆ **+${embed.fmtCoins(stolenXp)}** XP\n`;
    text += `\n> Solde : **${embed.fmtCoins(updatedThief.coins)}** coins`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  let text = `Vol reussi sur <@${target.id}> !\n+${embed.fmtCoins(stolenCoins)} coins (${stealPercent.toFixed(1)}%)`;
  if (stolenXp > 0) text += `\n+${embed.fmtCoins(stolenXp)} XP`;
  text += `\n\nSolde : ${embed.fmtCoins(updatedThief.coins)} coins`;
  return embed.reply(message, text, { title: 'Vol', color: '#57F287' });
};
