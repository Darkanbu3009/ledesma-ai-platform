import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/env.js';

const VALID = {
  DATABASE_URL: 'postgres://user:pass@host:5432/db',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef',
};

describe('parseEnv (worker)', () => {
  it('acepta una config minima valida y aplica defaults', () => {
    const env = parseEnv(VALID as NodeJS.ProcessEnv);
    expect(env.DATABASE_URL).toBe(VALID.DATABASE_URL);
    expect(env.WORKER_POLL_INTERVAL_MS).toBe(5000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.NODE_ENV).toBe('development');
    // Cortes del motor: mismos defaults que el backend.
    expect(env.RUN_TIMEOUT_SECONDS).toBe(600);
    expect(env.RUN_MAX_TOKENS).toBe(1_000_000);
  });

  it('coacciona WORKER_POLL_INTERVAL_MS desde string', () => {
    const env = parseEnv({ ...VALID, WORKER_POLL_INTERVAL_MS: '1500' } as NodeJS.ProcessEnv);
    expect(env.WORKER_POLL_INTERVAL_MS).toBe(1500);
  });

  it('coacciona RUN_TIMEOUT_SECONDS y RUN_MAX_TOKENS desde string', () => {
    const env = parseEnv({ ...VALID, RUN_TIMEOUT_SECONDS: '120', RUN_MAX_TOKENS: '50000' } as NodeJS.ProcessEnv);
    expect(env.RUN_TIMEOUT_SECONDS).toBe(120);
    expect(env.RUN_MAX_TOKENS).toBe(50_000);
  });

  it('rechaza si falta DATABASE_URL', () => {
    expect(() => parseEnv({ VAULT_SECRET: VALID.VAULT_SECRET } as NodeJS.ProcessEnv)).toThrow(
      /Environment validation failed/,
    );
  });

  it('rechaza un VAULT_SECRET demasiado corto', () => {
    expect(() => parseEnv({ ...VALID, VAULT_SECRET: 'corto' } as NodeJS.ProcessEnv)).toThrow(
      /Environment validation failed/,
    );
  });
});

describe('parseEnv (worker): presupuesto de la tarea web (TAREA_WEB_MAX_STEPS / TAREA_WEB_TIMEOUT_SECONDS)', () => {
  it('defaults: 120 pasos y 1500 segundos cuando faltan', () => {
    const env = parseEnv(VALID as NodeJS.ProcessEnv);
    expect(env.TAREA_WEB_MAX_STEPS).toBe(120);
    expect(env.TAREA_WEB_TIMEOUT_SECONDS).toBe(1500);
  });

  it('coacciona ambas desde string', () => {
    const env = parseEnv({
      ...VALID,
      TAREA_WEB_MAX_STEPS: '200',
      TAREA_WEB_TIMEOUT_SECONDS: '900',
    } as NodeJS.ProcessEnv);
    expect(env.TAREA_WEB_MAX_STEPS).toBe(200);
    expect(env.TAREA_WEB_TIMEOUT_SECONDS).toBe(900);
  });

  it('acepta los bordes del rango (10..300 pasos, 60..2580 segundos)', () => {
    const bajo = parseEnv({ ...VALID, TAREA_WEB_MAX_STEPS: '10', TAREA_WEB_TIMEOUT_SECONDS: '60' } as NodeJS.ProcessEnv);
    expect(bajo.TAREA_WEB_MAX_STEPS).toBe(10);
    expect(bajo.TAREA_WEB_TIMEOUT_SECONDS).toBe(60);
    const alto = parseEnv({ ...VALID, TAREA_WEB_MAX_STEPS: '300', TAREA_WEB_TIMEOUT_SECONDS: '2580' } as NodeJS.ProcessEnv);
    expect(alto.TAREA_WEB_MAX_STEPS).toBe(300);
    expect(alto.TAREA_WEB_TIMEOUT_SECONDS).toBe(2580);
  });

  it('RECHAZA valores fuera de rango: el arranque falla como con cualquier variable mal formada', () => {
    for (const maxSteps of ['9', '301', '0', '-5', 'abc']) {
      expect(() => parseEnv({ ...VALID, TAREA_WEB_MAX_STEPS: maxSteps } as NodeJS.ProcessEnv)).toThrow(
        /Environment validation failed/,
      );
    }
    // El techo (2580 s) es el timeout de la sesion de tarea en Browserbase (2700 s) menos 120 s de
    // margen: nunca se puede configurar un deadline que sobreviva a la sesion remota.
    for (const timeout of ['59', '2581', '0', '-1', 'abc']) {
      expect(() => parseEnv({ ...VALID, TAREA_WEB_TIMEOUT_SECONDS: timeout } as NodeJS.ProcessEnv)).toThrow(
        /Environment validation failed/,
      );
    }
  });
});

describe('parseEnv (worker): blindaje de la tarea web (tool timeout y observador de pasos)', () => {
  it('defaults: 90 s por llamada de tool y observador APAGADO', () => {
    const env = parseEnv(VALID as NodeJS.ProcessEnv);
    expect(env.TAREA_WEB_TOOL_TIMEOUT_SECONDS).toBe(90);
    expect(env.TAREA_WEB_OBSERVADOR_PASOS).toBe(false);
  });

  it('acepta los bordes del rango del tool timeout (30..300 s)', () => {
    expect(
      parseEnv({ ...VALID, TAREA_WEB_TOOL_TIMEOUT_SECONDS: '30' } as NodeJS.ProcessEnv)
        .TAREA_WEB_TOOL_TIMEOUT_SECONDS,
    ).toBe(30);
    expect(
      parseEnv({ ...VALID, TAREA_WEB_TOOL_TIMEOUT_SECONDS: '300' } as NodeJS.ProcessEnv)
        .TAREA_WEB_TOOL_TIMEOUT_SECONDS,
    ).toBe(300);
  });

  it('RECHAZA un tool timeout fuera de rango o mal formado', () => {
    for (const valor of ['29', '301', '0', '-5', 'abc']) {
      expect(() =>
        parseEnv({ ...VALID, TAREA_WEB_TOOL_TIMEOUT_SECONDS: valor } as NodeJS.ProcessEnv),
      ).toThrow(/Environment validation failed/);
    }
  });

  it('el observador solo se enciende con "true"; cualquier otro valor falla al arrancar', () => {
    expect(
      parseEnv({ ...VALID, TAREA_WEB_OBSERVADOR_PASOS: 'true' } as NodeJS.ProcessEnv)
        .TAREA_WEB_OBSERVADOR_PASOS,
    ).toBe(true);
    expect(
      parseEnv({ ...VALID, TAREA_WEB_OBSERVADOR_PASOS: 'false' } as NodeJS.ProcessEnv)
        .TAREA_WEB_OBSERVADOR_PASOS,
    ).toBe(false);
    for (const valor of ['1', 'si', 'TRUE', '']) {
      expect(() =>
        parseEnv({ ...VALID, TAREA_WEB_OBSERVADOR_PASOS: valor } as NodeJS.ProcessEnv),
      ).toThrow(/Environment validation failed/);
    }
  });
});

describe('parseEnv (worker): TAREA_WEB_MODEL, 7.1d)', () => {
  it('default: Claude Sonnet en formato proveedor/modelo', () => {
    const env = parseEnv(VALID as NodeJS.ProcessEnv);
    expect(env.TAREA_WEB_MODEL).toBe('anthropic/claude-sonnet-4-6');
  });

  it('acepta otro modelo no-Haiku', () => {
    const env = parseEnv({ ...VALID, TAREA_WEB_MODEL: 'anthropic/claude-opus-4-8' } as NodeJS.ProcessEnv);
    expect(env.TAREA_WEB_MODEL).toBe('anthropic/claude-opus-4-8');
  });

  it('RECHAZA Haiku en cualquier casing (regla de plataforma: nunca Haiku para trabajo de agente)', () => {
    for (const model of ['anthropic/claude-haiku-4-5', 'anthropic/CLAUDE-HAIKU-4-5', 'haiku']) {
      expect(() => parseEnv({ ...VALID, TAREA_WEB_MODEL: model } as NodeJS.ProcessEnv)).toThrow(
        /Environment validation failed/,
      );
    }
  });
});
