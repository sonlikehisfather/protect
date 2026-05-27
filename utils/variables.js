'use strict';


const { getActiveSoutienStats } = require('./soutienSync');

function replaceVariables(text, context = {}) {
  if (!text || typeof text !== 'string') return text ?? '';

  const { user, member, guild, client, prefix, extras } = context;
  const now = new Date();

  const memberId     = member?.id ?? user?.id ?? '';
  const username     = user?.username ?? (memberId ? `Utilisateur inconnu (${memberId})` : '');
  const displayName  = member?.displayName ?? user?.username ?? (memberId ? `Utilisateur inconnu (${memberId})` : '');
  const avatarUrl    = user?.displayAvatarURL?.({ size: 1024 }) ?? '';
  const tag          = user
    ? (user.discriminator && user.discriminator !== '0'
      ? `${user.username}#${user.discriminator}`
      : user.username)
    : (memberId ? `Utilisateur inconnu (${memberId})` : '');
  const profileUrl   = memberId ? `https://discord.com/users/${memberId}` : '';

  const memberCount   = guild?.memberCount ?? 0;
  const boostCount    = guild?.premiumSubscriptionCount ?? 0;
  const boostLevel    = guild?.premiumTier ?? 0;
  const rolesCount    = guild?.roles?.cache?.size ?? 0;
  const channelsCount = guild?.channels?.cache?.size ?? 0;
  const vocalCount    = guild?.voiceStates?.cache?.filter(vs => vs.channelId)?.size ?? 0;
  const onlineCount   = guild?.presences?.cache?.filter(p => p.status !== 'offline')?.size ?? 0;
  const offlineCount  = memberCount - onlineCount;

  const serverIcon = guild?.iconURL?.({ size: 1024 }) ?? '';
  const clientPic  = client?.user?.displayAvatarURL?.({ size: 1024 }) ?? '';
  const botCommandsCount = client?.commands
    ? new Set(client.commands.values()).size
    : 0;

  const joinedTs  = member?.joinedTimestamp ?? Date.now();
  const createdTs = user?.createdTimestamp  ?? Date.now();


  const vars = {
    '{user}'                : memberId ? `<@${memberId}>` : '',
    '{mention}'             : memberId ? `<@${memberId}>` : '',
    '{username}'            : username,
    '{userid}'              : memberId,
    '{id}'                  : memberId,
    '{tag}'                 : tag,
    '{useravatar}'          : avatarUrl,
    '{displayname}'         : displayName,
    '{server}'              : guild?.name ?? '',
    '{serverid}'            : guild?.id   ?? '',
    '{membercount}'         : String(memberCount),
    '{count}'               : String(memberCount),
    '{servericon}'          : serverIcon,
    '{prefix}'              : prefix ?? '',
    '{date}'                : now.toLocaleDateString('fr-FR'),
    '{time}'                : now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    '{createdat}'           : `<t:${Math.floor(createdTs / 1000)}:R>`,
    '{membermention}'       : memberId ? `<@${memberId}>` : '',
    '{membername}'          : username,
    '{memberfullname}'      : tag || username,
    '{memberdisplayname}'   : displayName,
    '{memberjoinedat}'      : `<t:${Math.floor(joinedTs / 1000)}:R>`,
    '{membercreatedat}'     : `<t:${Math.floor(createdTs / 1000)}:R>`,
    '{memberid}'            : memberId,
    '{memberprofile}'       : profileUrl,
    '{memberpic}'           : avatarUrl,
    '{clientpic}'           : clientPic,
    '{botpic}'              : clientPic,
    '{serverboostscount}'   : String(boostCount),
    '{serverlevel}'         : String(boostLevel),
    '{servermemberscount}'  : String(memberCount),
    '{vocalmemberscount}'   : String(vocalCount),
    '{onlinememberscount}'  : String(onlineCount),
    '{offlinememberscount}' : String(offlineCount),
    '{serverrolescount}'    : String(rolesCount),
    '{serverchannelscount}' : String(channelsCount),
    '{botcommandscount}'    : String(botCommandsCount),
    '{boosts}'              : String(boostCount),
    '{boostcount}'          : String(boostCount),
    ..._soutienVars(guild),
  };


  if (extras && typeof extras === 'object') {
    for (const [k, v] of Object.entries(extras)) {
      const key = k.startsWith('{') ? k.toLowerCase() : `{${k.toLowerCase()}}`;
      vars[key] = String(v ?? '');
    }
  }


  let result = text;
  for (const [key, value] of Object.entries(vars)) {

    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex   = new RegExp(escaped, 'gi');
    result = result.replace(regex, value);
  }

  return result;
}

function _soutienVars(guild) {
  if (!guild) return {};
  const stats = getActiveSoutienStats(guild);
  return {
    '{tagsoutien}'    : String(stats.tag),
    '{statussoutien}' : String(stats.status),
    '{allsoutien}'    : String(stats.all),
  };
}

module.exports = { replaceVariables };
