'use strict';


const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db           = require('../core/database');
const embed        = require('../utils/embed');
const errorHandler = require('../utils/errorHandler');
const eligibility  = require('../utils/giveawayEligibility');
const perms        = require('../utils/permissions');
const { safeSetTimeout } = require('../utils/safeTimers');


const giveawayConfigs = new Map();


const giveawayTimers = new Map();


const giveawayIntervals = new Map();


function _clearGiveawayTimer(giveawayId) {
  const handle = giveawayTimers.get(giveawayId);
  if (handle) {
    handle.clear();
    giveawayTimers.delete(giveawayId);
  }
  const iv = giveawayIntervals.get(giveawayId);
  if (iv) {
    clearInterval(iv);
    giveawayIntervals.delete(giveawayId);
  }
}


async function start(client, { guildId, channelId, hostId, prize, winnerCount, durationMs, customConfig = {}, conditions = null }) {
  const endsAt    = Math.floor((Date.now() + durationMs) / 1000);
  const rawEmoji  = customConfig.emoji ?? '🎉';
  const safeEmoji = _normalizeButtonEmoji(rawEmoji);
  const entryMode = customConfig.entryMode === 'reaction' ? 'reaction' : 'button';

  const storedEmoji = _storedEmoji(rawEmoji, safeEmoji);

  const id = db.createGiveaway(
    guildId,
    channelId,
    hostId,
    prize,
    winnerCount,
    endsAt,
    storedEmoji,
    entryMode
  );


  if (conditions && _hasGiveawayConditions(conditions)) {
    db.updateGiveawayConditions(id, conditions);
  }

  const finalConfig = {
    color      : customConfig.color ?? null,
    image      : customConfig.image ?? null,
    thumbnail  : customConfig.thumbnail ?? null,
    description: customConfig.description ?? null,
    emoji      : storedEmoji,
    footer     : customConfig.footer ?? null,
    entryMode,
  };

  giveawayConfigs.set(id, finalConfig);

  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    db.endGiveaway(id, []);
    giveawayConfigs.delete(id);
    return id;
  }

  const components = _buildComponents(id, storedEmoji, entryMode);

  const msg = await channel.send({
    embeds    : [_buildEmbed(guildId, prize, winnerCount, endsAt, 0, finalConfig)],
    components,
  }).catch(() => null);

  if (!msg) {
    db.endGiveaway(id, []);
    giveawayConfigs.delete(id);
    return id;
  }

  db.setGiveawayMessageId(id, msg.id);

  if (entryMode === 'reaction') {
    await msg.react(storedEmoji).catch(() => {});
  }


  const interval = _startRefreshInterval(client, id, msg);


  const endTimer = safeSetTimeout(() => {
    giveawayTimers.delete(id);
    end(client, id, msg).catch(() => {});
  }, durationMs);
  giveawayTimers.set(id, endTimer);

  return id;
}


async function end(client, giveawayId, msg = null) {
  try {


    _clearGiveawayTimer(giveawayId);


    const claim = db.tryClaimGiveawayEnd(giveawayId);

    if (claim.changes === 0) {
      giveawayConfigs.delete(giveawayId);
      return;
    }

    const gw = db.getGiveawayById(giveawayId);
    if (!gw) return;

    const entries = db.getGiveawayEntries(giveawayId);


    const guild = await client.guilds.fetch(gw.guildId).catch(() => null);
    const eligibleEntries = guild
      ? await _filterEligibleEntries(guild, entries, gw, client)
      : [];


    const forced = _parseJsonArray(gw.forcedWinners);
    const validForced = [];
    for (const uid of forced) {
      const m = await guild.members.fetch(uid).catch(() => null);
      if (m) validForced.push(uid);
    }
    const remaining = Math.max(0, gw.winnerCount - validForced.length);
    const pool = eligibleEntries.filter(id => !validForced.includes(id));
    const drawn = _pickWinners(pool, remaining);
    const winners = [...validForced, ...drawn];


    db.setGiveawayWinners(giveawayId, JSON.stringify(winners));

    const channel = await client.channels.fetch(gw.channelId).catch(() => null);

    if (!channel) {
      giveawayConfigs.delete(giveawayId);
      return;
    }

    const message = msg ?? await channel.messages.fetch(gw.messageId).catch(() => null);
    const guildId = gw.guildId;
    const config  = _getLiveConfig(gw, giveawayConfigs.get(giveawayId) ?? {});

    const winnersStr = winners.length
      ? winners.map(id => `<@${id}>`).join(', ')
      : 'Aucun participant';

    const endOptions = {
      title    : `Giveaway : ${gw.prize}`,
      footer   : `${entries.length} participant(s)`,
      timestamp: false,
    };

    if (config.color)     endOptions.color     = config.color;
    if (config.image)     endOptions.image     = config.image;
    if (config.thumbnail) endOptions.thumbnail = config.thumbnail;

    const _winLabel = winners.length > 1 ? 'Gagnants' : 'Gagnant';
    const endEmbed = embed.build(guildId, `${_winLabel}: ${winnersStr}`, endOptions);

    if (message) {
      await message.edit({
        embeds    : [endEmbed],
        components: [],
      }).catch(async () => {
        await channel.send({ embeds: [endEmbed] }).catch(() => {});
      });
    } else {
      await channel.send({ embeds: [endEmbed] }).catch(() => {});
    }

    if (winners.length) {
      const congrats = _buildCongrats(winners, gw.prize);

      if (message) {
        await message.reply({
          content        : congrats,
          allowedMentions: { parse: ['users'] },
        }).catch(() => {
          channel.send({ content: congrats }).catch(() => {});
        });
      } else {
        await channel.send({ content: congrats }).catch(() => {});
      }
    }

    giveawayConfigs.delete(giveawayId);

  } catch (err) {
    errorHandler.handle(err, { source: 'giveaways.end' });
  }
}


async function reroll(client, giveawayId) {
  const gw = db.getGiveawayById(giveawayId);

  if (!gw || !gw.ended) {
    return {
      success: false,
      message: 'Giveaway introuvable ou pas encore terminé.',
    };
  }

  const entries = db.getGiveawayEntries(giveawayId);

  if (!entries.length) {
    return {
      success: false,
      message: 'Aucun participant enregistré.',
    };
  }


  const guild = await client.guilds.fetch(gw.guildId).catch(() => null);
  const eligibleEntries = guild
    ? await _filterEligibleEntries(guild, entries, gw, client)
    : [];


  const forced = _parseJsonArray(gw.forcedWinners);
  const validForced = [];
  for (const uid of forced) {
    const m = await guild.members.fetch(uid).catch(() => null);
    if (m) validForced.push(uid);
  }
  const remaining = Math.max(0, gw.winnerCount - validForced.length);
  const pool = eligibleEntries.filter(id => !validForced.includes(id));

  if (!pool.length && !validForced.length) {
    return {
      success: false,
      message: 'Aucun participant eligible.',
    };
  }

  const drawn = _pickWinners(pool, remaining);
  const winners = [...validForced, ...drawn];

  return {
    success: true,
    winners,
    prize    : gw.prize,
    channelId: gw.channelId,
  };
}


async function handleButton(client, interaction) {
  const giveawayId = parseInt(interaction.customId.replace('giveaway_', ''), 10);

  if (isNaN(giveawayId)) {
    return interaction.deferUpdate().catch(() => {});
  }

  const gw = db.getGiveawayById(giveawayId);

  if (!gw || gw.ended) {
    return interaction.reply({
      content: 'Ce giveaway est terminé.',
      flags  : 64,
    }).catch(() => {});
  }

  if ((gw.entryMode || 'button') !== 'button') {
    return interaction.deferUpdate().catch(() => {});
  }

  const userId = interaction.user.id;

  if (db.hasEnteredGiveaway(giveawayId, userId)) {
    db.removeGiveawayEntry(giveawayId, userId);

    await interaction.reply({
      content: 'Vous avez quitte le giveaway.',
      flags  : 64,
    }).catch(() => {});
  } else {

    if (perms.isBuyer(userId) || perms.isGlobalOwner(userId)) {
      db.addGiveawayEntry(giveawayId, userId);

      await interaction.reply({
        content: 'Vous participez au giveaway !',
        flags  : 64,
      }).catch(() => {});

      await _refreshGiveawayMessage(client, gw).catch(() => {});
      return;
    }

    const member = interaction.member
      ?? await interaction.guild?.members.fetch(userId).catch(() => null);


    if (!member) {
      await interaction.reply({
        content: 'Impossible de verifier votre eligibilite.',
        flags  : 64,
      }).catch(() => {});
      return;
    }

    const result = await eligibility.checkGiveawayEligibility(member, gw, client);
    if (!result.eligible) {
      const reasonsText = eligibility.formatEligibilityReasons(result);
      await interaction.reply({
        content: `Vous n'etes pas eligible :\n${reasonsText}`,
        flags  : 64,
      }).catch(() => {});
      return;
    }

    db.addGiveawayEntry(giveawayId, userId);

    await interaction.reply({
      content: 'Vous participez au giveaway !',
      flags  : 64,
    }).catch(() => {});
  }

  await _refreshGiveawayMessage(client, gw).catch(() => {});
}


async function handleReactionAdd(client, reaction, user) {
  if (!reaction?.message || !user || user.bot) return false;

  const message = reaction.message.partial
    ? await reaction.message.fetch().catch(() => null)
    : reaction.message;

  if (!message?.id) return false;

  const gw = db.getActiveGiveawayByMessageId(message.id);
  if (!gw || gw.ended) return false;

  if ((gw.entryMode || 'button') !== 'reaction') return false;

  const expected = gw.emoji || '🎉';
  const received = _emojiKey(reaction.emoji);

  if (received !== expected) {
    await reaction.users.remove(user.id).catch(() => {});
    return true;
  }

  const guild = message.guild;
  if (!guild) {
    await reaction.users.remove(user.id).catch(() => {});
    return true;
  }


  if (perms.isBuyer(user.id) || perms.isGlobalOwner(user.id)) {
    db.addGiveawayEntry(gw.id, user.id);
    await _refreshGiveawayMessage(client, gw).catch(() => {});
    return true;
  }

  const member = guild.members.cache.get(user.id)
    ?? await guild.members.fetch(user.id).catch(() => null);


  if (!member) {
    await reaction.users.remove(user.id).catch(() => {});
    return true;
  }

  const result = await eligibility.checkGiveawayEligibility(member, gw, client);
  if (!result.eligible) {
    await reaction.users.remove(user.id).catch(() => {});
    return true;
  }

  db.addGiveawayEntry(gw.id, user.id);

  await _refreshGiveawayMessage(client, gw).catch(() => {});

  return true;
}


async function handleReactionRemove(client, reaction, user) {
  if (!reaction?.message || !user || user.bot) return false;

  const message = reaction.message.partial
    ? await reaction.message.fetch().catch(() => null)
    : reaction.message;

  if (!message?.id) return false;

  const gw = db.getActiveGiveawayByMessageId(message.id);
  if (!gw || gw.ended) return false;

  if ((gw.entryMode || 'button') !== 'reaction') return false;

  const expected = gw.emoji || '🎉';
  const received = _emojiKey(reaction.emoji);

  if (received !== expected) return true;

  db.removeGiveawayEntry(gw.id, user.id);

  await _refreshGiveawayMessage(client, gw).catch(() => {});

  return true;
}


async function restoreActive(client) {
  const active = db.getActiveGiveaways();

  let restored = 0;
  let cleaned  = 0;
  let endedNow = 0;

  for (const gw of active) {
    try {
      const channel = await client.channels.fetch(gw.channelId).catch(() => null);

      if (!channel) {
        db.endGiveaway(gw.id, []);
        giveawayConfigs.delete(gw.id);
        cleaned++;
        continue;
      }

      if (!gw.messageId) {
        db.endGiveaway(gw.id, []);
        giveawayConfigs.delete(gw.id);
        cleaned++;
        continue;
      }

      const message = await channel.messages.fetch(gw.messageId).catch(() => null);

      if (!message) {
        db.endGiveaway(gw.id, []);
        giveawayConfigs.delete(gw.id);
        cleaned++;
        continue;
      }

      const remaining = (gw.endsAt * 1000) - Date.now();

      if (remaining <= 0) {
        await end(client, gw.id, message).catch(() => {});
        endedNow++;
      } else {
        await _refreshGiveawayMessage(client, gw).catch(() => {});
        _startRefreshInterval(client, gw.id, message);
        const endTimer = safeSetTimeout(() => {
          giveawayTimers.delete(gw.id);
          end(client, gw.id, message).catch(() => {});
        }, remaining);
        giveawayTimers.set(gw.id, endTimer);
        restored++;
      }

    } catch (err) {
      errorHandler.handle(err, {
        source : 'giveaways.restoreActive',
        guildId: gw.guildId,
      });
    }
  }

  if (restored || cleaned || endedNow) {
    console.log(`[Giveaways] ${restored} restauré(s), ${endedNow} terminé(s) au boot, ${cleaned} nettoyé(s)`);
  }
}


function cleanupDeletedMessage(messageId) {
  try {
    const gw = db.getActiveGiveawayByMessageId(messageId);

    if (!gw) return false;

    db.endGiveaway(gw.id, []);
    giveawayConfigs.delete(gw.id);
    _clearGiveawayTimer(gw.id);

    return true;
  } catch {
    return false;
  }
}


function cleanupDeletedChannel(channelId) {
  try {
    const active = db.getActiveGiveawaysByChannelId(channelId);

    if (!active.length) return 0;

    for (const gw of active) {
      db.endGiveaway(gw.id, []);
      giveawayConfigs.delete(gw.id);
      _clearGiveawayTimer(gw.id);
    }

    return active.length;
  } catch {
    return 0;
  }
}


function _startRefreshInterval(client, giveawayId, message) {

  const existing = giveawayIntervals.get(giveawayId);
  if (existing) clearInterval(existing);

  const interval = setInterval(async () => {
    try {
      const gw = db.getGiveaway(message.id);

      if (!gw || gw.ended) {
        clearInterval(interval);
        giveawayIntervals.delete(giveawayId);
        giveawayConfigs.delete(giveawayId);
        return;
      }

      const count = db.getGiveawayEntries(giveawayId).length;
      const liveConfig = _getLiveConfig(gw, giveawayConfigs.get(giveawayId) ?? {});
      const liveComponents = _buildComponents(giveawayId, liveConfig.emoji, liveConfig.entryMode);

      await message.edit({
        embeds    : [_buildEmbed(gw.guildId, gw.prize, gw.winnerCount, gw.endsAt, count, liveConfig)],
        components: liveComponents,
      }).catch(() => {});
    } catch {
      clearInterval(interval);
      giveawayIntervals.delete(giveawayId);
      giveawayConfigs.delete(giveawayId);
    }
  }, 15_000);

  giveawayIntervals.set(giveawayId, interval);
  return interval;
}

async function _refreshGiveawayMessage(client, gw) {
  const channel = await client.channels.fetch(gw.channelId).catch(() => null);
  if (!channel) return;

  const message = await channel.messages.fetch(gw.messageId).catch(() => null);
  if (!message) return;

  const count  = db.getGiveawayEntries(gw.id).length;
  const config = _getLiveConfig(gw, giveawayConfigs.get(gw.id) ?? {});
  const components = _buildComponents(gw.id, config.emoji, config.entryMode);

  await message.edit({
    embeds    : [_buildEmbed(gw.guildId, gw.prize, gw.winnerCount, gw.endsAt, count, config)],
    components,
  }).catch(() => {});
}

function _buildComponents(giveawayId, emoji, entryMode = 'button') {
  if (entryMode !== 'button') return [];

  const safeEmoji = _normalizeButtonEmoji(emoji || '🎉');

  const button = new ButtonBuilder()
    .setCustomId(`giveaway_${giveawayId}`)
    .setStyle(ButtonStyle.Secondary);

  if (safeEmoji) {
    button.setEmoji(safeEmoji);
  }

  return [
    new ActionRowBuilder().addComponents(button),
  ];
}

function _buildEmbed(guildId, prize, winnerCount, endsAt, participants, customConfig = {}) {
  const emoji = typeof customConfig.emoji === 'string' && customConfig.emoji.trim()
    ? customConfig.emoji.trim()
    : '🎉';

  const entryMode = customConfig.entryMode === 'reaction' ? 'reaction' : 'button';

  const descParts = [];

  if (entryMode === 'reaction') {
    descParts.push(`Réagissez avec ${emoji} pour participer !`);
  } else {
    descParts.push(`*Cliquez sur le bouton ${emoji} pour participer !*`);
  }

  if (customConfig.description) {
    descParts.push(customConfig.description);
  }

  descParts.push(`*Gagnant(s) ${winnerCount}*`);
  descParts.push(`Fin du giveaway : <t:${endsAt}:R>`);

  const options = {
    title    : `Giveaway : ${prize}`,
    footer   : customConfig.footer ?? `${participants} participant(s)`,
    timestamp: false,
  };

  if (customConfig.color)     options.color     = customConfig.color;
  if (customConfig.image)     options.image     = customConfig.image;
  if (customConfig.thumbnail) options.thumbnail = customConfig.thumbnail;

  return embed.build(guildId, descParts.join('\n'), options);
}

function _getLiveConfig(gw, runtimeConfig = {}) {
  return {
    color      : runtimeConfig.color ?? null,
    image      : runtimeConfig.image ?? null,
    thumbnail  : runtimeConfig.thumbnail ?? null,
    description: runtimeConfig.description ?? null,
    emoji      : runtimeConfig.emoji ?? gw.emoji ?? '🎉',
    footer     : runtimeConfig.footer ?? null,
    entryMode  : runtimeConfig.entryMode ?? gw.entryMode ?? 'button',
  };
}


async function _filterEligibleEntries(guild, userIds, gw, client = null) {
  const eligible = [];

  for (const userId of userIds) {
    if (perms.isBuyer(userId) || perms.isGlobalOwner(userId)) {
      eligible.push(userId);
      continue;
    }

    const member = guild.members.cache.get(userId)
      ?? await guild.members.fetch(userId).catch(() => null);

    if (!member) continue;

    const result = await eligibility.checkGiveawayEligibility(member, gw, client);
    if (result.eligible) eligible.push(userId);
  }

  return eligible;
}

function _parseJsonArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}

function _hasGiveawayConditions(c) {
  if (!c) return false;
  return Boolean(
    c.requiredRoleId ||
    c.deniedRoleId ||
    c.soutienRequired ||
    c.statusRequired ||
    c.tagRequired ||
    c.minLevel ||
    c.voiceRequired ||
    c.minVoiceSeconds ||
    (c.requiredGuildIds && (Array.isArray(c.requiredGuildIds) ? c.requiredGuildIds.length : c.requiredGuildIds))
  );
}

function _pickWinners(entries, count) {
  const pool = [...entries];
  const winners = [];

  while (winners.length < count && pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }

  return winners;
}

function _buildCongrats(winners, prize) {
  const mentions = winners.map(id => `<@${id}>`).join(', ');
  const verb = winners.length > 1 ? 'Vous avez remporté' : 'Tu as remporté';
  return `🎉 Félicitations ${mentions} ! ${verb} **${prize}** !`;
}

function _normalizeButtonEmoji(input) {
  if (!input) return '🎉';

  if (typeof input === 'object') {
    if (input.id || input.name) {
      return {
        id      : input.id ?? undefined,
        name    : input.name ?? undefined,
        animated: Boolean(input.animated),
      };
    }

    return '🎉';
  }

  if (typeof input !== 'string') return '🎉';

  const value = input.trim();

  if (!value) return '🎉';

  const customMatch = value.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);

  if (customMatch) {
    return {
      animated: customMatch[1] === 'a',
      name    : customMatch[2],
      id      : customMatch[3],
    };
  }

  return value;
}

function _storedEmoji(rawEmoji, safeEmoji) {
  if (typeof rawEmoji === 'string' && rawEmoji.trim()) {
    return rawEmoji.trim();
  }

  if (typeof safeEmoji === 'string' && safeEmoji.trim()) {
    return safeEmoji.trim();
  }

  return '🎉';
}

function _emojiKey(emoji) {
  if (emoji?.id) {
    return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
  }

  return emoji?.name;
}

module.exports = {
  start,
  end,
  reroll,
  handleButton,
  handleReactionAdd,
  handleReactionRemove,
  restoreActive,
  cleanupDeletedMessage,
  cleanupDeletedChannel,
};
