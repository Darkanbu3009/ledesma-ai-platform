import { describe, it, expect } from 'vitest';
import { parseSseChunks } from '../src/lib/sse';

describe('parseSseChunks', () => {
  it('parsea un bloque completo de text_delta como evento', () => {
    const { messages, rest } = parseSseChunks('data: {"type":"text_delta","text":"hola"}\n\n');
    expect(messages).toEqual([{ kind: 'event', event: { type: 'text_delta', text: 'hola' } }]);
    expect(rest).toBe('');
  });

  it('parsea el evento done', () => {
    const { messages, rest } = parseSseChunks('event: done\ndata: {}\n\n');
    expect(messages).toEqual([{ kind: 'done' }]);
    expect(rest).toBe('');
  });

  it('parsea el evento error con su code', () => {
    const { messages } = parseSseChunks(
      'event: error\ndata: {"code":"AUTHENTICATION","message":"Bad key"}\n\n',
    );
    expect(messages).toEqual([{ kind: 'error', code: 'AUTHENTICATION', message: 'Bad key' }]);
  });

  it('acumula un chunk partido y completa el evento con el rest (streaming real)', () => {
    const full = 'data: {"type":"text_delta","text":"hola"}\n\n';
    const half = full.slice(0, 20);

    const first = parseSseChunks(half);
    expect(first.messages).toEqual([]);
    expect(first.rest).toBe(half);

    const second = parseSseChunks(first.rest + full.slice(20));
    expect(second.messages).toEqual([{ kind: 'event', event: { type: 'text_delta', text: 'hola' } }]);
    expect(second.rest).toBe('');
  });

  it('devuelve multiples bloques de un mismo chunk en orden', () => {
    const buffer =
      'data: {"type":"text_delta","text":"a"}\n\n' +
      'data: {"type":"tool_use","id":"t1","name":"clima","input":{}}\n\n' +
      'event: done\ndata: {}\n\n';
    const { messages, rest } = parseSseChunks(buffer);
    expect(messages).toEqual([
      { kind: 'event', event: { type: 'text_delta', text: 'a' } },
      { kind: 'event', event: { type: 'tool_use', id: 't1', name: 'clima', input: {} } },
      { kind: 'done' },
    ]);
    expect(rest).toBe('');
  });

  it('ignora un bloque con json corrupto sin lanzar', () => {
    const { messages, rest } = parseSseChunks('data: {esto no es json}\n\n');
    expect(messages).toEqual([]);
    expect(rest).toBe('');
  });
});
