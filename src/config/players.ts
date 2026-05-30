import type { SquadPlayer, TeamMeta } from './types';

/**
 * National squads for the World Championship 2026 (hosted in the USA). Index
 * order matches `FORMATION`: 0 = GK, 1–2 = DEF, 3–4 = ATT. Attributes are 0–100
 * and feed speed, finishing, passing, tackling and decision-making across the AI.
 *
 * Players are fictional (no real likenesses) but flavoured per nation, and every
 * side is kept in a tight, competitive band so matches stay balanced — the
 * elite sides are a touch quicker and more clinical, the rest defend and graft.
 * Kits use each nation's signature colour; a clash is auto-resolved to a
 * contrasting away strip at kick-off (see Team.setKitColor / configureTeams).
 */

export const SQUADS: Record<string, SquadPlayer[]> = {
  BRAZIL: [
    { name: 'MOREIRA', num: 1, attr: { pace: 62, shooting: 40, passing: 74, tackling: 60, composure: 85 } },
    { name: 'TADEU', num: 4, attr: { pace: 78, shooting: 52, passing: 76, tackling: 84, composure: 80 } },
    { name: 'BRAGA', num: 3, attr: { pace: 80, shooting: 54, passing: 78, tackling: 82, composure: 79 } },
    { name: 'PEIXOTO', num: 10, attr: { pace: 90, shooting: 88, passing: 86, tackling: 48, composure: 88 } },
    { name: 'DJALMA', num: 11, attr: { pace: 95, shooting: 84, passing: 82, tackling: 46, composure: 83 } },
  ],
  ARGENTINA: [
    { name: 'OLMEDO', num: 1, attr: { pace: 61, shooting: 40, passing: 72, tackling: 60, composure: 86 } },
    { name: 'GODOY', num: 2, attr: { pace: 76, shooting: 52, passing: 74, tackling: 86, composure: 82 } },
    { name: 'SOSA', num: 6, attr: { pace: 74, shooting: 50, passing: 76, tackling: 88, composure: 84 } },
    { name: 'QUIROGA', num: 10, attr: { pace: 86, shooting: 87, passing: 90, tackling: 50, composure: 90 } },
    { name: 'BENITEZ', num: 9, attr: { pace: 90, shooting: 86, passing: 80, tackling: 48, composure: 84 } },
  ],
  FRANCE: [
    { name: 'GIRARD', num: 1, attr: { pace: 63, shooting: 40, passing: 72, tackling: 62, composure: 85 } },
    { name: 'MOREAU', num: 4, attr: { pace: 80, shooting: 54, passing: 74, tackling: 88, composure: 82 } },
    { name: 'LACROIX', num: 5, attr: { pace: 79, shooting: 52, passing: 74, tackling: 86, composure: 81 } },
    { name: 'LAURENT', num: 10, attr: { pace: 92, shooting: 86, passing: 84, tackling: 50, composure: 86 } },
    { name: 'DIALLO', num: 9, attr: { pace: 96, shooting: 85, passing: 78, tackling: 48, composure: 82 } },
  ],
  ENGLAND: [
    { name: 'WELLS', num: 1, attr: { pace: 62, shooting: 38, passing: 70, tackling: 60, composure: 84 } },
    { name: 'CARTER', num: 5, attr: { pace: 76, shooting: 50, passing: 72, tackling: 88, composure: 82 } },
    { name: 'HOLDEN', num: 6, attr: { pace: 75, shooting: 50, passing: 74, tackling: 86, composure: 80 } },
    { name: 'HAYES', num: 9, attr: { pace: 88, shooting: 87, passing: 80, tackling: 50, composure: 85 } },
    { name: 'PORTER', num: 11, attr: { pace: 91, shooting: 82, passing: 82, tackling: 48, composure: 81 } },
  ],
  SPAIN: [
    { name: 'CABALLERO', num: 1, attr: { pace: 61, shooting: 40, passing: 76, tackling: 58, composure: 86 } },
    { name: 'MOLINA', num: 2, attr: { pace: 78, shooting: 52, passing: 82, tackling: 82, composure: 84 } },
    { name: 'SOLER', num: 4, attr: { pace: 76, shooting: 50, passing: 84, tackling: 84, composure: 85 } },
    { name: 'GARRIDO', num: 10, attr: { pace: 84, shooting: 82, passing: 90, tackling: 52, composure: 88 } },
    { name: 'NIETO', num: 9, attr: { pace: 88, shooting: 84, passing: 84, tackling: 48, composure: 83 } },
  ],
  GERMANY: [
    { name: 'KELLER', num: 1, attr: { pace: 60, shooting: 38, passing: 74, tackling: 62, composure: 87 } },
    { name: 'BAUER', num: 4, attr: { pace: 74, shooting: 52, passing: 76, tackling: 90, composure: 85 } },
    { name: 'HORN', num: 5, attr: { pace: 73, shooting: 50, passing: 76, tackling: 88, composure: 84 } },
    { name: 'KAISER', num: 10, attr: { pace: 84, shooting: 85, passing: 86, tackling: 52, composure: 88 } },
    { name: 'VOGEL', num: 9, attr: { pace: 88, shooting: 84, passing: 80, tackling: 50, composure: 83 } },
  ],
  PORTUGAL: [
    { name: 'COSTA', num: 1, attr: { pace: 62, shooting: 40, passing: 74, tackling: 60, composure: 85 } },
    { name: 'FONSECA', num: 3, attr: { pace: 78, shooting: 52, passing: 76, tackling: 84, composure: 81 } },
    { name: 'SILVA', num: 4, attr: { pace: 77, shooting: 54, passing: 78, tackling: 82, composure: 82 } },
    { name: 'TAVARES', num: 7, attr: { pace: 90, shooting: 86, passing: 84, tackling: 50, composure: 86 } },
    { name: 'MENDES', num: 10, attr: { pace: 89, shooting: 83, passing: 82, tackling: 48, composure: 84 } },
  ],
  NETHERLANDS: [
    { name: 'VISSER', num: 1, attr: { pace: 63, shooting: 40, passing: 76, tackling: 60, composure: 84 } },
    { name: 'BAKKER', num: 4, attr: { pace: 78, shooting: 52, passing: 80, tackling: 84, composure: 83 } },
    { name: 'DEVRIES', num: 5, attr: { pace: 77, shooting: 52, passing: 80, tackling: 86, composure: 84 } },
    { name: 'JANSEN', num: 10, attr: { pace: 86, shooting: 84, passing: 86, tackling: 50, composure: 85 } },
    { name: 'VELDT', num: 9, attr: { pace: 90, shooting: 83, passing: 80, tackling: 48, composure: 82 } },
  ],
  ITALY: [
    { name: 'ROSSI', num: 1, attr: { pace: 60, shooting: 38, passing: 74, tackling: 62, composure: 88 } },
    { name: 'MARCHETTI', num: 3, attr: { pace: 74, shooting: 50, passing: 76, tackling: 90, composure: 86 } },
    { name: 'CONTI', num: 5, attr: { pace: 73, shooting: 50, passing: 76, tackling: 88, composure: 85 } },
    { name: 'GALLO', num: 9, attr: { pace: 84, shooting: 85, passing: 80, tackling: 52, composure: 85 } },
    { name: 'RIVA', num: 10, attr: { pace: 86, shooting: 83, passing: 82, tackling: 50, composure: 84 } },
  ],
  USA: [
    { name: 'MILLER', num: 1, attr: { pace: 64, shooting: 40, passing: 72, tackling: 60, composure: 82 } },
    { name: 'HAYWARD', num: 3, attr: { pace: 80, shooting: 52, passing: 72, tackling: 84, composure: 80 } },
    { name: 'DAWSON', num: 5, attr: { pace: 82, shooting: 54, passing: 74, tackling: 82, composure: 79 } },
    { name: 'CRUZ', num: 10, attr: { pace: 88, shooting: 82, passing: 80, tackling: 52, composure: 83 } },
    { name: 'BROOKS', num: 9, attr: { pace: 90, shooting: 80, passing: 76, tackling: 50, composure: 80 } },
  ],
  MEXICO: [
    { name: 'SANDOVAL', num: 1, attr: { pace: 62, shooting: 40, passing: 72, tackling: 58, composure: 83 } },
    { name: 'MORENO', num: 4, attr: { pace: 78, shooting: 52, passing: 74, tackling: 82, composure: 81 } },
    { name: 'VEGA', num: 3, attr: { pace: 80, shooting: 54, passing: 76, tackling: 80, composure: 80 } },
    { name: 'CASTILLO', num: 10, attr: { pace: 88, shooting: 82, passing: 82, tackling: 50, composure: 83 } },
    { name: 'RIVAS', num: 11, attr: { pace: 91, shooting: 80, passing: 78, tackling: 48, composure: 80 } },
  ],
  CROATIA: [
    { name: 'HORVAT', num: 1, attr: { pace: 61, shooting: 40, passing: 74, tackling: 60, composure: 85 } },
    { name: 'KOVAC', num: 5, attr: { pace: 75, shooting: 50, passing: 78, tackling: 86, composure: 83 } },
    { name: 'MARIC', num: 6, attr: { pace: 74, shooting: 50, passing: 80, tackling: 84, composure: 84 } },
    { name: 'NOVAK', num: 10, attr: { pace: 82, shooting: 82, passing: 88, tackling: 54, composure: 86 } },
    { name: 'BABIC', num: 9, attr: { pace: 87, shooting: 82, passing: 80, tackling: 50, composure: 82 } },
  ],
  NORWAY: [
    { name: 'HAUG', num: 1, attr: { pace: 63, shooting: 40, passing: 72, tackling: 60, composure: 83 } },
    { name: 'BERG', num: 4, attr: { pace: 78, shooting: 52, passing: 74, tackling: 84, composure: 81 } },
    { name: 'DAHL', num: 5, attr: { pace: 79, shooting: 54, passing: 74, tackling: 82, composure: 80 } },
    { name: 'SOLBERG', num: 9, attr: { pace: 92, shooting: 89, passing: 80, tackling: 52, composure: 86 } },
    { name: 'HALVORSEN', num: 10, attr: { pace: 88, shooting: 82, passing: 82, tackling: 50, composure: 82 } },
  ],
  JAPAN: [
    { name: 'KONO', num: 1, attr: { pace: 63, shooting: 40, passing: 74, tackling: 58, composure: 83 } },
    { name: 'TANAKA', num: 5, attr: { pace: 80, shooting: 52, passing: 78, tackling: 82, composure: 82 } },
    { name: 'SATO', num: 3, attr: { pace: 82, shooting: 52, passing: 80, tackling: 80, composure: 82 } },
    { name: 'ANDO', num: 10, attr: { pace: 88, shooting: 82, passing: 84, tackling: 52, composure: 84 } },
    { name: 'MORI', num: 11, attr: { pace: 90, shooting: 80, passing: 80, tackling: 50, composure: 81 } },
  ],
  MOROCCO: [
    { name: 'RACHIDI', num: 1, attr: { pace: 62, shooting: 40, passing: 72, tackling: 60, composure: 84 } },
    { name: 'BENALI', num: 4, attr: { pace: 79, shooting: 52, passing: 74, tackling: 86, composure: 83 } },
    { name: 'ZIANI', num: 5, attr: { pace: 78, shooting: 52, passing: 76, tackling: 84, composure: 82 } },
    { name: 'HADDAD', num: 10, attr: { pace: 89, shooting: 83, passing: 82, tackling: 52, composure: 84 } },
    { name: 'MANSOURI', num: 7, attr: { pace: 92, shooting: 81, passing: 80, tackling: 50, composure: 81 } },
  ],
  SENEGAL: [
    { name: 'NDIAYE', num: 1, attr: { pace: 64, shooting: 40, passing: 70, tackling: 60, composure: 82 } },
    { name: 'DIOP', num: 4, attr: { pace: 82, shooting: 52, passing: 72, tackling: 86, composure: 80 } },
    { name: 'SARR', num: 5, attr: { pace: 83, shooting: 54, passing: 72, tackling: 84, composure: 79 } },
    { name: 'FALL', num: 9, attr: { pace: 93, shooting: 85, passing: 78, tackling: 50, composure: 83 } },
    { name: 'GUEYE', num: 10, attr: { pace: 90, shooting: 81, passing: 80, tackling: 52, composure: 81 } },
  ],
};

/**
 * Selectable nations for the World Championship 2026 — display name, 3-letter
 * code and signature kit colour. The host (USA) and a Nordic outsider (Norway)
 * sit alongside the traditional powers.
 */
export const TEAMS: TeamMeta[] = [
  { key: 'USA', name: 'UNITED STATES', short: 'USA', color: '#2c3fd6' },
  { key: 'BRAZIL', name: 'BRAZIL', short: 'BRA', color: '#ffd400' },
  { key: 'ARGENTINA', name: 'ARGENTINA', short: 'ARG', color: '#75aadb' },
  { key: 'FRANCE', name: 'FRANCE', short: 'FRA', color: '#1e3a8a' },
  { key: 'ENGLAND', name: 'ENGLAND', short: 'ENG', color: '#e9eef5' },
  { key: 'SPAIN', name: 'SPAIN', short: 'ESP', color: '#d7182a' },
  { key: 'GERMANY', name: 'GERMANY', short: 'GER', color: '#9aa0a6' },
  { key: 'PORTUGAL', name: 'PORTUGAL', short: 'POR', color: '#1fa055' },
  { key: 'NETHERLANDS', name: 'NETHERLANDS', short: 'NED', color: '#ff6a00' },
  { key: 'ITALY', name: 'ITALY', short: 'ITA', color: '#2e86de' },
  { key: 'MEXICO', name: 'MEXICO', short: 'MEX', color: '#0b6e4f' },
  { key: 'CROATIA', name: 'CROATIA', short: 'CRO', color: '#e23e57' },
  { key: 'NORWAY', name: 'NORWAY', short: 'NOR', color: '#c8102e' },
  { key: 'JAPAN', name: 'JAPAN', short: 'JPN', color: '#5a4fcf' },
  { key: 'MOROCCO', name: 'MOROCCO', short: 'MAR', color: '#157347' },
  { key: 'SENEGAL', name: 'SENEGAL', short: 'SEN', color: '#11a658' },
];

/** The roster/identity used as a safe fallback (the host nation). */
export const DEFAULT_TEAM = 'USA';

/** Look up a nation's metadata by key (falls back to the host). */
export function teamMeta(key: string): TeamMeta {
  return TEAMS.find((t) => t.key === key) ?? TEAMS[0];
}

/** Normalises an attribute (0–100) to a multiplier centred on 1.0. */
export function attrMul(value: number, spread = 0.18): number {
  return 1 + ((value - 70) / 30) * spread;
}

/** Normalises an attribute (0–100) to a 0–1 fraction. */
export function attr01(value: number): number {
  return value < 0 ? 0 : value > 100 ? 1 : value / 100;
}
