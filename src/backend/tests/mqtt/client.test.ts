import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('mqtt', () => ({
  default: { connect: vi.fn(() => ({ on: vi.fn(), publish: vi.fn(), end: vi.fn() })) },
}));

import mqtt from 'mqtt';
import { connect, disconnect, publish, getStatus } from '../../src/mqtt/client.js';

function fakeClientAt(callIndex: number) {
  return vi.mocked(mqtt.connect).mock.results[callIndex]!.value;
}

beforeEach(() => {
  vi.clearAllMocks();
  disconnect();
});

describe('mqtt client', () => {
  it('connects with the given host/port and sets status to connecting', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    expect(mqtt.connect).toHaveBeenCalledWith(
      'mqtt://broker.local:1883',
      expect.objectContaining({ username: undefined, password: undefined }),
    );
    expect(getStatus()).toBe('connecting');
  });

  it('passes username/password through when set', () => {
    connect({ host: 'broker.local', port: 1883, username: 'alice', password: 'secret' });
    expect(mqtt.connect).toHaveBeenCalledWith(
      'mqtt://broker.local:1883',
      expect.objectContaining({ username: 'alice', password: 'secret' }),
    );
  });

  it('updates status to connected when the client emits connect', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    const fakeClient = fakeClientAt(0);
    const connectHandler = fakeClient.on.mock.calls.find(([event]: [string]) => event === 'connect')![1];
    connectHandler();
    expect(getStatus()).toBe('connected');
  });

  it('updates status to error when the client emits error', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    const fakeClient = fakeClientAt(0);
    const errorHandler = fakeClient.on.mock.calls.find(([event]: [string]) => event === 'error')![1];
    errorHandler(new Error('boom'));
    expect(getStatus()).toBe('error');
  });

  it('publish() sends JSON with qos 0 by default and does nothing before connect', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    const fakeClient = fakeClientAt(0);
    disconnect();
    publish('weartrack/gloves/session_start', { event: 'session_start' });
    expect(fakeClient.publish).not.toHaveBeenCalled();

    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    const secondFakeClient = fakeClientAt(1);
    publish('weartrack/gloves/session_start', { event: 'session_start' });
    expect(secondFakeClient.publish).toHaveBeenCalledWith(
      'weartrack/gloves/session_start',
      JSON.stringify({ event: 'session_start' }),
      { qos: 0, retain: false },
    );
  });

  it('publish() honors the retain option', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    const fakeClient = fakeClientAt(0);
    publish('weartrack/gloves/state', { event: 'x' }, { retain: true });
    expect(fakeClient.publish).toHaveBeenCalledWith(
      'weartrack/gloves/state',
      JSON.stringify({ event: 'x' }),
      { qos: 0, retain: true },
    );
  });

  it('disconnect() ends the client and sets status to disconnected', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    const fakeClient = fakeClientAt(0);
    disconnect();
    expect(fakeClient.end).toHaveBeenCalledWith(true);
    expect(getStatus()).toBe('disconnected');
  });

  it('does not let a stale (superseded) client overwrite status set by the new active client', () => {
    // Client A starts connecting.
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    const clientA = fakeClientAt(0);

    // Before A finishes connecting, connect() is called again -> disconnect()s A and creates B.
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    const clientB = fakeClientAt(1);
    expect(getStatus()).toBe('connecting');

    // A's socket fires a delayed 'connect' event after being superseded.
    const staleConnectHandler = clientA.on.mock.calls.find(([event]: [string]) => event === 'connect')![1];
    staleConnectHandler();

    // B is still just 'connecting' (its own handler hasn't fired yet) and must not have
    // been clobbered by A's stale event.
    expect(getStatus()).toBe('connecting');

    // Sanity check: B's own handler still works correctly.
    const bConnectHandler = clientB.on.mock.calls.find(([event]: [string]) => event === 'connect')![1];
    bConnectHandler();
    expect(getStatus()).toBe('connected');
  });
});
