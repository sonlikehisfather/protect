'use strict';

const COMMAND_PERMISSION_GROUPS = {
  bl  : ['bl', 'unbl', 'blinfo'],
  ban : ['ban', 'unban'],
  mute: ['mute', 'unmute'],
};

function getCommandPermissionGroup(commandName) {
  return COMMAND_PERMISSION_GROUPS[commandName] ?? [commandName];
}

module.exports = { getCommandPermissionGroup };
