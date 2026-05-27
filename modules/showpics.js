'use strict';


const embed        = require('../utils/embed');
const db           = require('../core/database');
const errorHandler = require('../utils/errorHandler');

const DEFAULT_INTERVAL_MINUTES = 60;
const MIN_INTERVAL_MINUTES     = 5;

let started = false;
let timer   = null;

const lastRuns = new Map();

function start(client) {
  if (started) return;

  started = true;


  client.on('guildDelete', (guild) => {
    lastRuns.delete(guild.id);
  });

  _tick(client).catch(err => {
    errorHandler.handle(err, { source: 'showpics.start' });
  });

  timer = setInterval(() => {
    _tick(client).catch(err => {
      errorHandler.handle(err, { source: 'showpics.tick' });
    });
  }, MIN_INTERVAL_MINUTES * 60 * 1000);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  lastRuns.clear();

  started = false;
}

async function _tick(client) {
  const now = Date.now();

  for (const guild of client.guilds.cache.values()) {
    try {
      const config = db.getGuildConfig(guild.id);

      if (!config?.showPicsChannel) continue;

      const intervalMinutes = Math.max(
        MIN_INTERVAL_MINUTES,
        Number(config.showPicsInterval || DEFAULT_INTERVAL_MINUTES)
      );

      if (!_shouldRun(guild.id, now, intervalMinutes)) continue;

      await _sendRandomAvatar(guild, config);

    } catch (err) {
      errorHandler.handle(err, {
        source  : 'showpics.guildTick',
        guildId : guild.id,
      });
    }
  }
}

function _shouldRun(guildId, now, intervalMinutes) {
  const last  = lastRuns.get(guildId) || 0;
  const delay = intervalMinutes * 60 * 1000;

  if (now - last < delay) return false;

  lastRuns.set(guildId, now);

  return true;
}

async function _sendRandomAvatar(guild, config) {
  const channel = guild.channels.cache.get(config.showPicsChannel);

  if (!channel || !channel.isTextBased()) return;

  const me = guild.members.me
    ?? await guild.members.fetchMe().catch(() => null);

  if (!me) return;

  const permissions = channel.permissionsFor(me);

  if (!permissions?.has('SendMessages')) return;
  if (!permissions?.has('EmbedLinks')) return;

  const member = await _pickRandomMember(guild);

  if (!member) return;

  const avatar = member.user.displayAvatarURL({
    size         : 1024,
    extension    : 'png',
    forceStatic  : false,
  });

  const username =
    member.user.displayName
    ?? member.user.username;

  await channel.send({
    embeds: [
      embed.build(
        guild.id,
        null,
        {
          title     : `Photo de profil de ${username}`,
          image     : avatar,
          footer    : `ID : ${member.id}`,
          timestamp : new Date(),
        }
      ),
    ],
    allowedMentions: { parse: [] },
  }).catch(err => {
    errorHandler.handle(err, {
      source  : 'showpics.send',
      guildId : guild.id,
      userId  : member.id,
    });
  });
}

async function _pickRandomMember(guild) {

  let members = guild.members.cache.filter(member =>
    !member.user.bot
  );


  if (members.size < 10) {
    await guild.members.fetch().catch(() => null);

    members = guild.members.cache.filter(member =>
      !member.user.bot
    );
  }

  if (!members.size) return null;

  const array = [...members.values()];

  return array[
    Math.floor(Math.random() * array.length)
  ] ?? null;
}

module.exports = {
  start,
  stop,
};
