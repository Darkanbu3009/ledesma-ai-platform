import { describe, it, expect } from 'vitest';
import { cutoffIso, DEFAULT_RETENTION_POLICY } from '../src/retention/retention-policy.js';

describe('retention-policy', () => {
  it('el default es conservador (agent_runs 365 dias, jobs terminales 90 dias)', () => {
    expect(DEFAULT_RETENTION_POLICY).toEqual({ agentRunsDays: 365, terminalJobsDays: 90 });
  });

  describe('cutoffIso', () => {
    it('devuelve now - dias en ISO', () => {
      const now = new Date('2026-07-01T00:00:00.000Z');
      expect(cutoffIso(1, now)).toBe('2026-06-30T00:00:00.000Z');
      expect(cutoffIso(90, now)).toBe('2026-04-02T00:00:00.000Z');
    });

    it('el corte SIEMPRE queda en el pasado respecto de now (nunca borra el futuro)', () => {
      const now = new Date('2026-07-01T00:00:00.000Z');
      expect(cutoffIso(365, now) < now.toISOString()).toBe(true);
    });
  });
});
