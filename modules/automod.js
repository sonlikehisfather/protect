'use strict';


const db             = require('../core/database');
const embed          = require('../utils/embed');
const logger         = require('../utils/logger');
const badwordRuntime = require('./badwordRuntime');
const punishSteps    = require('./punishSteps');
const perms          = require('../utils/permissions');
const errorHandler   = require('../utils/errorHandler');
const { applyMute }  = require('../utils/applyMute');

const DEBUG_ANTILINK = require('process').env.DEBUG_ANTILINK === 'true';

const spamMap = new Map();
const antispamLocks = new Set();
const postPunishBlacklist = new Map();
const everyoneMap = new Map();
const softLinkMap = new Map();
const softReminderMap = new Map();

const INVITE_REGEX   = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s]+/gi;
const ALL_LINK_REGEX = /https?:\/\/[^\s]+|(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s]+/gi;

const INVITE_CODE_REGEX =
  /(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]+)/gi;

const NON_INVITE_LINK_REGEX =
  /https?:\/\/(?!(?:discord\.gg|discord(?:app)?\.com\/invite|discordapp\.com\/invite))[^\s]+/gi;

const inviteGuildCache = new Map();


const _inviteCacheCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of inviteGuildCache) {
    if (entry.expiresAt <= now) inviteGuildCache.delete(key);
  }
}, 10 * 60 * 1000);
if (_inviteCacheCleanupTimer.unref) _inviteCacheCleanupTimer.unref();

function _extractDiscordInviteCodes(text) {
  const codes = [];
  let m;
  INVITE_CODE_REGEX.lastIndex = 0;
  while ((m = INVITE_CODE_REGEX.exec(text)) !== null) {
    codes.push(m[1]);
  }
  return codes;
}

async function _isOwnGuildInvite(client, guild, code) {
  const cleanCode = String(code || '').trim();
  if (!cleanCode || !guild) return false;

  const vanity = guild.vanityURLCode || null;
  if (vanity && cleanCode.toLowerCase() === vanity.toLowerCase()) {
    return true;
  }

  const cacheKey = cleanCode.toLowerCase();
  const cached   = inviteGuildCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.guildId === guild.id;
  }

  const invite  = await client.fetchInvite(cleanCode).catch(() => null);
  const gId     = invite?.guild?.id ?? null;

  inviteGuildCache.set(cacheKey, {
    guildId   : gId,
    expiresAt : Date.now() + 10 * 60 * 1000,
  });

  return gId === guild.id;
}


function _extractHostname(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function _isDomainWhitelisted(url, whitelist) {
  if (!whitelist.length) return false;
  const host = _extractHostname(url);
  if (!host) return false;

  return whitelist.some(domain => {
    const d = domain.toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  });
}

function _allLinksWhitelisted(content, whitelist) {
  if (!whitelist.length) return false;
  const urls = _extractAllUrls(content);
  if (!urls.length) return false;
  return urls.every(url => _isDomainWhitelisted(url, whitelist));
}

function _extractAllUrls(text) {
  const urls = [];
  const regex = /https?:\/\/[^\s]+|(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s]+/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    urls.push(m[0]);
  }
  return urls;
}


const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|mp4|mov|webm)(\?[^\s]*)?$/i;

const MEDIA_DOMAINS = [
  'cdn.discordapp.com',
  'media.discordapp.net',
  'images-ext-1.discordapp.net',
  'images-ext-2.discordapp.net',
  'images-ext-3.discordapp.net',
  'i.imgur.com',
  'tenor.com',
  'media.tenor.com',
  'c.tenor.com',
  'giphy.com',
  'media.giphy.com',
  'media0.giphy.com',
  'media1.giphy.com',
  'media2.giphy.com',
  'media3.giphy.com',
  'media4.giphy.com',
  'pbs.twimg.com',
  'i.redd.it',
  'preview.redd.it',
  'external-preview.redd.it',
  'i.pinimg.com',
  'prnt.sc',
  'image.prntscr.com',
];

function _isImageOrMediaUrl(url, customDomains) {
  if (IMAGE_EXTENSIONS.test(url)) return true;
  const host = _extractHostname(url);
  if (!host) return false;
  if (MEDIA_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) return true;
  if (customDomains && customDomains.length > 0) {
    return customDomains.some(d => {
      const ld = d.toLowerCase();
      return host === ld || host.endsWith(`.${ld}`);
    });
  }
  return false;
}

function _allLinksAreMedia(content) {
  const urls = _extractAllUrls(content);
  if (!urls.length) return false;
  return urls.every(url => _isImageOrMediaUrl(url));
}

function _hasImageVideoAttachment(message) {
  if (!message.attachments?.size) return false;
  return message.attachments.some(a =>
    a.contentType?.startsWith('image/') ||
    a.contentType?.startsWith('video/') ||
    (a.width != null && a.height != null)
  );
}

const SOURCE_TO_TRIGGER = {
  antispam        : 'spam',
  antilink        : 'link',
  antimassmention : 'mention',
  antieveryone    : 'everyone',
};

function _computeStrikeWeight(member, guildId, trigger) {
  if (!trigger) return 1;

  try {
    const guildConfig    = db.getGuildConfig(guildId);
    const ancienDuration = Number(guildConfig?.ancienDuration ?? 604800);
    const ancienMs       = ancienDuration * 1000;

    const isAncien = Boolean(
      member?.joinedTimestamp &&
      Date.now() - member.joinedTimestamp >= ancienMs
    );

    const cfg = db.getStrikeTrigger(guildId, trigger);

    if (!cfg) return 1;

    const raw = isAncien ? cfg.ancienStr : cfg.strikes;
    const n   = Number(raw);

    if (!Number.isFinite(n) || n < 1) return 1;
    if (n > 20) return 20;

    return Math.floor(n);
  } catch {
    return 1;
  }
}

function _mentionCount(message) {
  const content = message.content ?? '';

  const userMentions     = content.match(/<@!?\d{17,20}>/g) ?? [];
  const roleMentions     = content.match(/<@&\d{17,20}>/g) ?? [];
  const everyoneMentions = content.match(/@(everyone|here)/g) ?? [];

  return userMentions.length + roleMentions.length + everyoneMentions.length;
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function process(client, message) {
  const { guild, member, content } = message;

  if (!guild || !member || message.author?.bot) return false;

  const guildId = guild.id;

  if (perms.isProtected(member.id, guildId, member)) return false;

  let guildConfig;
  try { guildConfig = db.getGuildConfig(guildId); } catch { return false; }
  if (!guildConfig?.antiraidEnabled) return false;

  const blacklistKey  = `${guildId}_${member.id}`;
  const spamSessionAt = postPunishBlacklist.get(blacklistKey);

  if (spamSessionAt && message.createdTimestamp >= spamSessionAt) {
    await message.delete().catch(() => {});
    return true;
  } else if (spamSessionAt) {
    postPunishBlacklist.delete(blacklistKey);
  }

  let config;

  try {
    config = db.getAntiraidConfig(guildId);
  } catch {
    return false;
  }

  if (!config) return false;


  const channelId       = message.channel?.id ?? null;
  const antilinkOverride = channelId ? db.getAntilinkOverride(guildId, channelId) : null;
  const linkActive       =
    antilinkOverride === 'deny' ||
    (Number(config.antilinkEnabled) === 1 && antilinkOverride !== 'allow');

  if (linkActive) {
    const antilinkMode       = config.antilinkMode || 'invite';
    const linkRegex           = antilinkMode === 'all' ? ALL_LINK_REGEX : INVITE_REGEX;
    const customMediaDomains  = _parseJsonArraySafe(config.antilinkMediaDomains);
    const imageRoles          = _parseJsonArraySafe(config.antilinkImageRoles);
    const hasImageRole        = imageRoles.length > 0 &&
      imageRoles.some(roleId => member.roles.cache.has(roleId));

    if (DEBUG_ANTILINK) {
      console.log(`[DEBUG_ANTILINK] guild=${guildId} user=${member.id} mode=${antilinkMode} hasImageRole=${hasImageRole}`);
    }

    linkRegex.lastIndex = 0;

    if (linkRegex.test(content)) {
      const inviteCodes = _extractDiscordInviteCodes(content);
      let allOwn = false;

      if (inviteCodes.length > 0) {
        const results = await Promise.all(
          inviteCodes.map(code => _isOwnGuildInvite(client, guild, code))
        );
        allOwn = results.every(Boolean);

        if (allOwn) {
          NON_INVITE_LINK_REGEX.lastIndex = 0;
          const hasExternalLink = antilinkMode === 'all' && NON_INVITE_LINK_REGEX.test(content);
          if (!hasExternalLink) {

          } else {

          }
        } else {
          return await _punish(client, message, config.antilinkPunish, 'antilink', guildId);
        }
      }


      const whitelist = _parseJsonArraySafe(config.antilinkWhitelist);

      if (antilinkOverride !== 'deny' && whitelist.length > 0) {
        if (_allLinksWhitelisted(content, whitelist)) {

        } else {

        }
      }


      const allUrls       = _extractAllUrls(content);
      const ownInviteOk   = inviteCodes.length > 0 && allOwn;


      const unclearedUrls = [];
      for (const url of allUrls) {
        const codes = _extractDiscordInviteCodes(url);
        if (codes.length > 0) {

          if (ownInviteOk) continue;
          unclearedUrls.push(url);
          continue;
        }
        if (whitelist.length > 0 && _isDomainWhitelisted(url, whitelist)) continue;
        unclearedUrls.push(url);
      }

      if (DEBUG_ANTILINK) {
        console.log(`[DEBUG_ANTILINK] guild=${guildId} user=${member.id} unclearedUrls=[${unclearedUrls.join(', ')}]`);
      }

      if (unclearedUrls.length === 0) {

      } else {
        const allowedChannels    = _parseJsonArraySafe(config.antilinkAllowedChannels);
        const allowedCategories  = _parseJsonArraySafe(config.antilinkAllowedCategories);
        const parentId           = message.channel?.parentId ?? null;

        const isAllowedChannel =
          (channelId && allowedChannels.includes(channelId)) ||
          (parentId && allowedCategories.includes(parentId));

        if (isAllowedChannel) {
          const mediaWhitelist = _parseJsonArraySafe(config.antilinkMediaWhitelist);
          const allUnclearedOk = unclearedUrls.every(url =>
            _isImageOrMediaUrl(url, customMediaDomains) || _isDomainWhitelisted(url, mediaWhitelist)
          );
          if (allUnclearedOk) {

          } else {
            if (await _trySoftAntilink(message, config, guildId)) return true;
            return await _punish(client, message, config.antilinkPunish, 'antilink', guildId);
          }
        } else {
          if (hasImageRole) {
            const allUnclearedAreMedia = unclearedUrls.every(url => _isImageOrMediaUrl(url, customMediaDomains));

            if (allUnclearedAreMedia) {
              if (DEBUG_ANTILINK) {
                console.log(`[DEBUG_ANTILINK] guild=${guildId} user=${member.id} PASS image-role (all URLs media)`);
              }

            } else {
              if (DEBUG_ANTILINK) {
                for (const url of unclearedUrls) {
                  console.log(`[DEBUG_ANTILINK] guild=${guildId} user=${member.id} url=${url} host=${_extractHostname(url)} isMedia=false hasImageRole=true PUNISH`);
                }
              }
              if (await _trySoftAntilink(message, config, guildId)) return true;
              return await _punish(client, message, config.antilinkPunish, 'antilink', guildId);
            }
          } else {
            if (DEBUG_ANTILINK) {
              for (const url of unclearedUrls) {
                console.log(`[DEBUG_ANTILINK] guild=${guildId} user=${member.id} url=${url} host=${_extractHostname(url)} hasImageRole=false PUNISH`);
              }
            }
            if (await _trySoftAntilink(message, config, guildId)) return true;
            return await _punish(client, message, config.antilinkPunish, 'antilink', guildId);
          }
        }
      }
    } else if (DEBUG_ANTILINK) {
      console.log(`[DEBUG_ANTILINK] guild=${guildId} user=${member.id} linkRegex NO MATCH (mode=${antilinkMode})`);
    }
  }


  if (
    config.antiEveryoneEnabled &&
    (content.includes('@everyone') || content.includes('@here'))
  ) {
    const evThreshold = Number(config.antiEveryoneThreshold ?? 1);
    const evWindowMs  = Number(config.antiEveryoneWindow ?? 10) * 1000;

    if (evThreshold <= 1) {
      return await _punish(client, message, config.antiEveryonePunish, 'antieveryone', guildId);
    }

    const evKey   = `${guildId}_${member.id}_everyone`;
    const now     = Date.now();
    const evEntry = everyoneMap.get(evKey);

    if (!evEntry || now - evEntry.firstAt > evWindowMs) {
      everyoneMap.set(evKey, { count: 1, firstAt: now });

      setTimeout(() => {
        const cur = everyoneMap.get(evKey);
        if (cur && cur.firstAt === now) everyoneMap.delete(evKey);
      }, evWindowMs);
    } else {
      evEntry.count++;

      if (evEntry.count >= evThreshold) {
        everyoneMap.delete(evKey);
        return await _punish(client, message, config.antiEveryonePunish, 'antieveryone', guildId);
      }
    }


    await message.delete().catch(() => {});
    return true;
  }


  if (config.antimassmentionEnabled) {
    const mentionCount = _mentionCount(message);
    const threshold    = Number(config.antimassmentionThreshold ?? 5);

    if (mentionCount >= threshold) {
      const spamKey = `${guildId}_${member.id}`;

      spamMap.delete(spamKey);
      antispamLocks.delete(spamKey);
      postPunishBlacklist.delete(spamKey);

      return await _punish(
        client,
        message,
        config.antimassmentionPunish ?? 'warn',
        'antimassmention',
        guildId
      );
    }
  }


  if (
    config.antibadwordEnabled &&
    config.badwordList
  ) {
    const blocked = await badwordRuntime.check(client, message, config, guildId);
    if (blocked) return true;
  }


  const antispamOverride = channelId ? db.getAntispamOverride(guildId, channelId) : null;
  const spamActive       =
    antispamOverride === 'deny' ||
    (Number(config.antispamEnabled) === 1 && antispamOverride !== 'allow');

  if (spamActive) {
    const key       = `${guildId}_${member.id}`;
    const now       = Date.now();
    const windowMs  = Number(config.antispamWindow ?? 5) * 1000;
    const threshold = Number(config.antispamThreshold ?? 5);

    const maxTrackedMessages = Math.max(threshold * 3, 15);
    const entry = spamMap.get(key);

    if (!entry || now - entry.firstMsgAt > windowMs) {
      spamMap.set(key, {
        count      : 1,
        firstMsgAt : now,
        firstMsg   : message.createdTimestamp,
        messages   : [message.id],
      });

      setTimeout(() => {
        const current = spamMap.get(key);
        if (current && current.firstMsgAt === now) {
          spamMap.delete(key);
        }
      }, windowMs);

      return false;
    }

    entry.count++;
    entry.messages.push(message.id);

    if (entry.messages.length > maxTrackedMessages) {
      entry.messages.shift();
    }

    if (entry.count >= threshold) {
      const spamMessages = [...(entry.messages ?? [])];
      const spamFirstMsg = entry.firstMsg;

      spamMap.delete(key);

      if (antispamLocks.has(key)) {
        await message.delete().catch(() => {});
        return true;
      }

      antispamLocks.add(key);
      postPunishBlacklist.set(key, Date.now());

      return await _punish(
        client,
        message,
        config.antispamPunish,
        'antispam',
        guildId,
        spamMessages,
        spamFirstMsg,
        key
      );
    }
  }

  return false;
}

async function _punish(
  client,
  message,
  punishment,
  source,
  guildId,
  spamMessages = [],
  spamFirstMsg = 0,
  antispamKey = null
) {
  const { member, channel, guild } = message;

  let punishmentInfo = null;

  const triggerName = SOURCE_TO_TRIGGER[source] || null;
  const weight      = _computeStrikeWeight(member, guildId, triggerName);

  try {
    if (DEBUG_ANTILINK && source === 'antilink') {
      console.log(`[DEBUG_ANTILINK] _punish called: defaultPunish=${punishment} source=${source} weight=${weight}`);
    }

    punishmentInfo = punishSteps.getPunishmentInfo(
      guildId,
      member.id,
      punishment,
      source,
      weight
    );

    punishment = punishmentInfo.punishment;

    if (DEBUG_ANTILINK && source === 'antilink') {
      console.log(`[DEBUG_ANTILINK] getPunishmentInfo result: punishment=${punishment} count=${punishmentInfo.count} remaining=${punishmentInfo.remaining} next=${punishmentInfo.nextPunishment} duration=${punishmentInfo.duration}`);
    }

    punishSteps.decay(guildId, member.id, undefined, source);

    if (source === 'antispam') {
      const deleted = await _deleteRecentSpamMessages(message, member, spamMessages, spamFirstMsg);

      if (!deleted) {
        await message.delete().catch(() => {});
      }

      await _sleep(150);
      await _deleteRecentSpamMessages(message, member, spamMessages, spamFirstMsg);
    } else {
      await message.delete().catch(() => {});
    }

    switch (punishment) {
      case 'delete':
        break;

      case 'warn':
        db.addSanction(guildId, member.id, client.user.id, 'warn', `Automod - ${source}`);
        await _sendAutomodFeedback(channel, guildId, member.id, source, punishmentInfo);
        break;

      case 'mute': {
        const duration   = Number(punishmentInfo?.duration ?? 600);
        const isAdmin    = member.permissions.has('Administrator');
        const guildCfg   = db.getGuildConfig(guildId);
        const useTimeout = Boolean(guildCfg?.useTimeout);
        let savedRoles   = [];


        if (isAdmin && useTimeout) {
          const me = guild.members.me
            ?? await guild.members.fetchMe().catch(() => null);

          if (!me) {
            punishmentInfo.punishment = 'warn';
            db.addSanction(guildId, member.id, client.user.id, 'warn',
              `Automod - ${source} (me introuvable)`);
            await _sendAutomodFeedback(channel, guildId, member.id, source, punishmentInfo);
            break;
          }

          const removable = member.roles.cache.filter(r =>
            r.id !== guild.id &&
            r.managed === false &&
            me.roles.highest.comparePositionTo(r) > 0
          );

          savedRoles = removable.map(r => r.id);

          if (savedRoles.length > 0) {
            const restoreAt = Math.floor(Date.now() / 1000) + duration + 5;
            db.saveMuteRoles(guildId, member.id, savedRoles, restoreAt, `automod-${source}`);

            await member.roles.remove(savedRoles, `Automod mute - ${source} (derank temporaire)`)
              .catch(() => { savedRoles = []; });

            if (savedRoles.length === 0) {
              db.clearMuteRoles(guildId, member.id);
            }
          }
        }


        const result = await applyMute({
          guild,
          member,
          config    : guildCfg,
          durationMs: duration * 1000,
          reason    : `Automod - ${source}`,
          source    : `automod.${source}`,
        });

        if (!result.applied) {
          if (DEBUG_ANTILINK && source === 'antilink') {
            console.log(`[DEBUG_ANTILINK] MUTE FAILED: reason=${result.reason}`);
          }

          if (savedRoles.length > 0) {
            await member.roles.add(savedRoles, `Automod mute - ${source} (rollback)`)
              .catch(() => {});
            db.clearMuteRoles(guildId, member.id);
          }


          punishmentInfo.punishment  = 'mute';
          punishmentInfo._failed     = true;
          punishmentInfo._failReason = result.reason ?? 'inconnu';
          await _sendAutomodFeedback(channel, guildId, member.id, source, punishmentInfo);
          break;
        }


        if (savedRoles.length > 0) {
          setTimeout(async () => {
            const freshMember = await guild.members.fetch(member.id).catch(() => null);
            if (freshMember) {
              await freshMember.roles.add(savedRoles, `Automod mute - ${source} (re-rank post-mute)`)
                .catch(() => {});
            }
            db.clearMuteRoles(guildId, member.id);
          }, duration * 1000 + 2000);
        }

        db.addSanction(guildId, member.id, client.user.id, 'mute',
          `Automod - ${source}`, duration);
        await _sendAutomodFeedback(channel, guildId, member.id, source, punishmentInfo);
        break;
      }

      case 'kick':
        await _sendAutomodFeedback(channel, guildId, member.id, source, punishmentInfo);
        await member.kick(`Automod - ${source}`).catch(() => {});
        db.addSanction(guildId, member.id, client.user.id, 'kick', `Automod - ${source}`);
        break;

      case 'ban':
        await _sendAutomodFeedback(channel, guildId, member.id, source, punishmentInfo);
        await guild.members.ban(member.id, { reason: `Automod - ${source}` }).catch(() => {});
        db.addSanction(guildId, member.id, client.user.id, 'ban', `Automod - ${source}`);
        break;
    }

    const e = embed.log(
      guildId,
      `Automod - ${source}`,
      [
        {
          name   : 'Membre',
          value  : `<@${member.id}> (${member.user.tag}) \`${member.id}\``,
          inline : true,
        },
        {
          name   : 'Action',
          value  : punishment,
          inline : true,
        },
        {
          name   : 'Salon',
          value  : `<#${channel.id}>`,
          inline : true,
        },
      ]
    );

    await logger.send(client, guildId, 'raidlog', e);

  } catch (err) {
    errorHandler.handle(err, {
      source : `automod.${source}`,
      guildId,
    });
  } finally {
    if (source === 'antispam' && antispamKey) {
      setTimeout(() => {
        postPunishBlacklist.delete(antispamKey);
        antispamLocks.delete(antispamKey);
      }, 10_000);
    }
  }

  return true;
}

async function _sendAutomodFeedback(channel, guildId, userId, source, punishmentInfo) {
  const punishment = punishmentInfo?.punishment ?? 'warn';
  const remaining  = punishmentInfo?.remaining ?? 0;
  const next       = punishmentInfo?.nextPunishment ?? null;

  let content;

  if (punishmentInfo?._failed) {
    content =
      `<@${userId}> : la sanction **${punishment}** a echoue. (\`${source}\`)\n` +
      `Raison : ${punishmentInfo._failReason ?? 'inconnue'}.\n` +
      `Configurez le mute avec \`+muteconfig timeout on\` ou \`+muteconfig setup\`.`;
  } else if (punishment === 'warn' && next && remaining > 0) {
    content =
      `<@${userId}> a reçu un avertissement automatique. (\`${source}\`)\n` +
      `Il reste **${remaining}** infraction(s) avant **${next}**.`;
  } else {
    content =
      `<@${userId}> a été sanctionné automatiquement. (\`${source}\`)\n` +
      `Sanction appliquée : **${punishment}**.`;
  }

  const guildConfig = db.getGuildConfig(guildId);
  const delay       = guildConfig?.autoDeleteDelay ?? 6;

  await channel.send({
    embeds: [
      embed.build(guildId, content, { timestamp: false }),
    ],
    allowedMentions: { parse: [] },
  }).then(m =>
    embed.scheduleDelete(m, delay)
  ).catch(() => {});
}

async function _deleteRecentSpamMessages(message, member, spamMessages = [], spamFirstMsg = 0) {
  const channel = message.channel;
  let deletedSomething = false;

  if (spamMessages && spamMessages.length > 0) {
    const fetchedTracked = await channel.messages.fetch({
      messages: spamMessages
    }).catch(() => null);

    if (fetchedTracked && fetchedTracked.size > 0) {
      const trackedToDelete = fetchedTracked.filter(m =>
        m.author.id === member.id &&
        m.createdTimestamp >= spamFirstMsg &&
        m.deletable
      );

      if (trackedToDelete.size > 1) {
        await channel.bulkDelete(trackedToDelete, true).catch(() => {});
        deletedSomething = true;
      } else if (trackedToDelete.size === 1) {
        await trackedToDelete.first().delete().catch(() => {});
        deletedSomething = true;
      }
    }
  }

  if (deletedSomething) return true;

  const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);

  if (!fetched) return deletedSomething;

  const toDelete = fetched.filter(m =>
    m.author.id === member.id &&
    m.createdTimestamp >= spamFirstMsg &&
    m.deletable
  );

  if (toDelete.size > 1) {
    await channel.bulkDelete(toDelete, true).catch(() => {});
    return true;
  }

  if (toDelete.size === 1) {
    await toDelete.first().delete().catch(() => {});
    return true;
  }

  return deletedSomething;
}

function _parseJsonArraySafe(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function _trySoftAntilink(message, config, guildId) {
  if (Number(config.antilinkSoftEnabled ?? 1) !== 1) return false;

  const window    = (Number(config.antilinkSoftWindow) || 600) * 1000;
  const threshold = Number(config.antilinkSoftThreshold) || 3;
  const key       = `${guildId}:${message.author.id}`;
  const now       = Date.now();

  let entry = softLinkMap.get(key);
  if (!entry || (now - entry.firstAt) > window) {
    entry = { count: 0, firstAt: now, exhausted: false };
  }

  if (entry.exhausted) return false;

  entry.count++;
  softLinkMap.set(key, entry);

  const reminderKey = `${guildId}:${message.channel.id}:${message.author.id}`;

  if (entry.count >= threshold) {
    entry.exhausted = true;
    const r = softReminderMap.get(reminderKey);
    if (r) {
      clearTimeout(r.timer);
      r.msg.delete().catch(() => {});
      softReminderMap.delete(reminderKey);
    }
    return false;
  }

  await message.delete().catch(() => {});

  const remaining = threshold - entry.count;
  const plural    = remaining > 1 ? 'tentatives' : 'tentative';
  const punish    = config.antilinkPunish || 'warn';
  const label     = punish === 'warn' ? 'avertissement'
                  : punish === 'delete' ? 'suppression finale'
                  : 'sanction';

  const text = `Les liens ne sont pas autoris\u00e9s ici. Il te reste \`${remaining}\` ${plural} avant ${label}, <@${message.author.id}>.`;
  const newEmbed = embed.build(guildId, text, { timestamp: false });

  const existing = softReminderMap.get(reminderKey);
  let msg = null;

  if (existing) {
    clearTimeout(existing.timer);
    msg = await existing.msg.edit({ embeds: [newEmbed] }).catch(() => null);
  }

  if (!msg) {
    if (existing) existing.msg.delete().catch(() => {});
    msg = await message.channel.send({
      embeds: [newEmbed],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  if (msg) {
    const timer = setTimeout(() => {
      if (softReminderMap.get(reminderKey)?.msg === msg) softReminderMap.delete(reminderKey);
      msg.delete().catch(() => {});
    }, 7000);
    softReminderMap.set(reminderKey, { msg, timer });
  }

  if (DEBUG_ANTILINK) {
    console.log(`[DEBUG_ANTILINK] guild=${guildId} user=${message.author.id} SOFT ${entry.count}/${threshold} remaining=${remaining}`);
  }

  return true;
}

module.exports = { process };
