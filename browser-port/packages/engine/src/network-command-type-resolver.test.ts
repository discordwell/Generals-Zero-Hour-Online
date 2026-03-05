import { describe, expect, it } from 'vitest';

import {
  NETCOMMANDTYPE_DISCONNECTEND,
  NETCOMMANDTYPE_DISCONNECTSTART,
  NETCOMMANDTYPE_DISCONNECTSCREENOFF,
  NETCOMMANDTYPE_FRAMEINFO,
  NETCOMMANDTYPE_MAX,
  NETCOMMANDTYPE_PACKETROUTERACK,
  NETCOMMANDTYPE_UNKNOWN,
} from './network-command-type.js';
import * as NetworkCommandTypes from './network-command-type.js';
import {
  getAsciiNetworkCommandType,
  normalizeNetworkCommandTypeName,
  resolveNetworkCommandType,
  resolveNetworkCommandTypeFromMessage,
  resolveNetworkCommandTypeName,
} from './network-command-type-resolver.js';

describe('network command type resolver', () => {
  it('normalizes source-style command names', () => {
    expect(normalizeNetworkCommandTypeName('NETCOMMANDTYPE_FRAMEINFO')).toBe('frameinfo');
    expect(normalizeNetworkCommandTypeName('NetCommandType_DisconnectScreenOff')).toBe('disconnectscreenoff');
    expect(normalizeNetworkCommandTypeName(' packet-router-ack ')).toBe('packetrouterack');
  });

  it('resolves source command names to IDs', () => {
    expect(resolveNetworkCommandTypeName('NETCOMMANDTYPE_FRAMEINFO')).toBe(NETCOMMANDTYPE_FRAMEINFO);
    expect(resolveNetworkCommandTypeName('frameinfo')).toBe(NETCOMMANDTYPE_FRAMEINFO);
    expect(resolveNetworkCommandTypeName('packetrouterack')).toBe(NETCOMMANDTYPE_PACKETROUTERACK);
    expect(resolveNetworkCommandTypeName('disconnectscreenoff')).toBe(NETCOMMANDTYPE_DISCONNECTSCREENOFF);
    expect(resolveNetworkCommandTypeName('doesnotexist')).toBeNull();
  });

  it('returns source ascii names for known command IDs', () => {
    expect(getAsciiNetworkCommandType(NETCOMMANDTYPE_FRAMEINFO)).toBe('NETCOMMANDTYPE_FRAMEINFO');
    expect(getAsciiNetworkCommandType(NETCOMMANDTYPE_PACKETROUTERACK)).toBe('NETCOMMANDTYPE_PACKETROUTERACK');
    expect(getAsciiNetworkCommandType(9999)).toBe('UNKNOWN');
  });

  it('round-trips all concrete source command ids through ascii-name resolution', () => {
    const commandEntries = Object.entries(NetworkCommandTypes)
      .filter(([name]) => name.startsWith('NETCOMMANDTYPE_'))
      .map(([, value]) => value)
      .filter((value): value is number => typeof value === 'number')
      .filter((value) => value !== NETCOMMANDTYPE_UNKNOWN)
      .filter((value) => value !== NETCOMMANDTYPE_DISCONNECTSTART)
      .filter((value) => value !== NETCOMMANDTYPE_DISCONNECTEND)
      .filter((value) => value !== NETCOMMANDTYPE_MAX);

    for (const commandType of commandEntries) {
      const asciiName = getAsciiNetworkCommandType(commandType);
      expect(asciiName).not.toBe('UNKNOWN');
      expect(resolveNetworkCommandTypeName(asciiName)).toBe(commandType);
      expect(resolveNetworkCommandType(asciiName)).toBe(commandType);
    }
  });

  it('resolves unknown/object command type tokens safely', () => {
    expect(resolveNetworkCommandType(NETCOMMANDTYPE_FRAMEINFO)).toBe(NETCOMMANDTYPE_FRAMEINFO);
    expect(resolveNetworkCommandType(' 3 ')).toBe(3);
    expect(resolveNetworkCommandType('NETCOMMANDTYPE_FRAMEINFO')).toBe(NETCOMMANDTYPE_FRAMEINFO);
    expect(resolveNetworkCommandType('unknown')).toBe(NETCOMMANDTYPE_UNKNOWN);
    expect(resolveNetworkCommandType('not-a-command')).toBeNull();
    expect(resolveNetworkCommandType({})).toBeNull();
  });

  it('resolves command type from network message-like object payloads', () => {
    expect(resolveNetworkCommandTypeFromMessage({ commandType: 'frameinfo' })).toBe(NETCOMMANDTYPE_FRAMEINFO);
    expect(resolveNetworkCommandTypeFromMessage({ netCommandType: 3 })).toBe(NETCOMMANDTYPE_FRAMEINFO);
    expect(resolveNetworkCommandTypeFromMessage({ type: 'NETCOMMANDTYPE_PACKETROUTERACK' })).toBe(NETCOMMANDTYPE_PACKETROUTERACK);
    expect(resolveNetworkCommandTypeFromMessage({
      getCommandType: () => 'netcommandtype_disconnectscreenoff',
    })).toBe(NETCOMMANDTYPE_DISCONNECTSCREENOFF);
    expect(resolveNetworkCommandTypeFromMessage({
      getCommandType: () => {
        throw new Error('broken getter');
      },
      kind: 'frameinfo',
    })).toBe(NETCOMMANDTYPE_FRAMEINFO);
    expect(resolveNetworkCommandTypeFromMessage({ commandType: 'not-a-command' })).toBeNull();
    expect(resolveNetworkCommandTypeFromMessage(null)).toBeNull();
  });
});
