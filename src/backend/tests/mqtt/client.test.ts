import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeClient = {
  on: vi.fn(),
  publish: vi.fn(),
  end: vi.fn(),
};

vi.mock('mqtt', () => ({
  default: { connect: vi.fn(() => fakeClient) },
}));

import mqtt from 'mqtt';
import { connect, disconnect, publish, getStatus } from '../../src/mqtt/client.js';

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
    const connectHandler = fakeClient.on.mock.calls.find(([event]) => event === 'connect')![1];
    connectHandler();
    expect(getStatus()).toBe('connected');
  });

  it('updates status to error when the client emits error', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    const errorHandler = fakeClient.on.mock.calls.find(([event]) => event === 'error')![1];
    errorHandler(new Error('boom'));
    expect(getStatus()).toBe('error');
  });

  it('publish() sends JSON with qos 0 by default and does nothing before connect', () => {
    publish('weartrack/gloves/session_start', { event: 'session_start' });
    expect(fakeClient.publish).not.toHaveBeenCalled();

    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    publish('weartrack/gloves/session_start', { event: 'session_start' });
    expect(fakeClient.publish).toHaveBeenCalledWith(
      'weartrack/gloves/session_start',
      JSON.stringify({ event: 'session_start' }),
      { qos: 0, retain: false },
    );
  });

  it('publish() honors the retain option', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    publish('weartrack/gloves/state', { event: 'x' }, { retain: true });
    expect(fakeClient.publish).toHaveBeenCalledWith(
      'weartrack/gloves/state',
      JSON.stringify({ event: 'x' }),
      { qos: 0, retain: true },
    );
  });

  it('disconnect() ends the client and sets status to disconnected', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    disconnect();
    expect(fakeClient.end).toHaveBeenCalledWith(true);
    expect(getStatus()).toBe('disconnected');
  });
});
