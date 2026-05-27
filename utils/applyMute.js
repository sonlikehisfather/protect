'use strict';


const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;


async function applyMute(opts) {
  const {
    guild,
    member,
    config,
    durationMs,
    reason,
    allowRoleMute = true,
    allowTimeout  = true,
  } = opts || {};

  if (!guild || !member) {
    return _fail('Membre ou guild manquant.');
  }

  const useTimeout = Boolean(config?.useTimeout);

  if (useTimeout) {
    if (!allowTimeout) {
      return _fail('Mode timeout désactivé par l\u2019appelant.');
    }
    return _applyTimeout({ guild, member, durationMs, reason });
  }

  if (!allowRoleMute) {
    return _fail('Mode rôle désactivé par l\u2019appelant.');
  }

  const muteRoleId = config?.muteRoleId ?? null;

  if (muteRoleId) {
    return _applyRoleMute({ guild, member, config, reason });
  }


  if (allowTimeout) {
    const me = guild.members.me;
    if (me?.permissions.has('ModerateMembers') && member.moderatable) {
      return _applyTimeout({ guild, member, durationMs, reason });
    }
  }

  return _fail('Aucun systeme de mute configure. Utilisez +muteconfig timeout on ou +muteconfig setup.');
}


async function _applyTimeout({ guild, member, durationMs, reason }) {
  const me = guild.members.me;

  if (!me?.permissions.has('ModerateMembers')) {
    return _fail('Je n\u2019ai pas la permission Timeout.');
  }

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return _fail('Durée invalide pour un timeout.');
  }

  if (durationMs > MAX_TIMEOUT_MS) {
    return _fail('La durée maximale d\u2019un timeout Discord est de 28 jours.');
  }


  if (!member.moderatable) {
    return _fail('Je ne peux pas timeout ce membre (hiérarchie ou owner).');
  }

  const ok = await member.timeout(durationMs, reason)
    .then(() => true)
    .catch(() => false);

  if (!ok) {
    return _fail('Échec de l\u2019appel API timeout.');
  }

  return {
    applied : true,
    method  : 'timeout',
    reason  : null,
    warning : member.permissions.has('Administrator')
      ? 'Ce membre possède la permission Administrator : le mute peut être contourné.'
      : null,
    muteRole: null,
  };
}


async function _applyRoleMute({ guild, member, config, reason }) {
  const muteRoleId = config?.muteRoleId ?? null;

  if (!muteRoleId) {
    return _fail('Aucun rôle mute configuré.');
  }

  const muteRole = guild.roles.cache.get(muteRoleId);

  if (!muteRole) {
    return _fail('Le rôle mute configuré est introuvable.');
  }

  const me = guild.members.me;

  if (!me?.permissions.has('ManageRoles')) {
    return { ..._fail('Je n\u2019ai pas la permission de gérer les rôles.'), muteRole };
  }

  if (me.roles.highest.comparePositionTo(muteRole) <= 0) {
    return { ..._fail('Le rôle mute est au-dessus de mon rôle le plus haut.'), muteRole };
  }

  const ok = await member.roles.add(muteRole, reason)
    .then(() => true)
    .catch(() => false);

  if (!ok) {
    return { ..._fail('Échec de l\u2019ajout du rôle mute.'), muteRole };
  }

  return {
    applied : true,
    method  : 'role',
    reason  : null,
    warning : member.permissions.has('Administrator')
      ? 'Ce membre possède la permission Administrator : le rôle mute peut être inopérant.'
      : null,
    muteRole,
  };
}


function _fail(reason) {
  return {
    applied : false,
    method  : null,
    reason,
    warning : null,
    muteRole: null,
  };
}

module.exports = { applyMute };
