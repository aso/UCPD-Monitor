// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
/**
 * PDO type metadata — single source of truth for type keys, badge labels,
 * lamp labels, and accent colours used across the application.
 *
 * Covers USB PD Rev 3.2 PDO types:
 *   Fixed, Battery, Variable, APDO_PPS, APDO_EPR_AVS, APDO_SPR_AVS, APDO_Unknown
 */

export interface PdoTypeMeta {
  /** pdoType string key (matches Pdo.pdoType in pd_types.ts) */
  readonly key: string;
  /** Badge chip label shown in MessageTable / TopologyView capability list */
  readonly badge: string;
  /**
   * Ultra-short label shown in the lamp strip in TopologyView.
   * `null` means this type should not appear in the lamp strip.
   */
  readonly lamp: string | null;
  /** Accent colour (hex) */
  readonly color: string;
}

/** Master PDO type table — ordered for display (lamp strip, legend). */
export const PDO_TYPE_META: readonly PdoTypeMeta[] = [
  { key: 'Fixed',        badge: 'Fixed',    lamp: 'FIX',   color: '#80deea' },
  { key: 'Battery',      badge: 'Battery',  lamp: 'BAT',   color: '#ffcc80' },
  { key: 'Variable',     badge: 'Variable', lamp: 'VAR',   color: '#b39ddb' },
  { key: 'APDO_PPS',     badge: 'PPS',      lamp: 'PPS',   color: '#a5d6a7' },
  { key: 'APDO_EPR_AVS', badge: 'EPR-AVS',  lamp: 'E-AVS', color: '#f48fb1' },
  { key: 'APDO_SPR_AVS', badge: 'SPR-AVS',  lamp: 'S-AVS', color: '#ce93d8' },
  { key: 'APDO_Unknown', badge: '?',         lamp: null,    color: '#aaa'    },
];

/**
 * key → accent colour lookup.
 * @example PDO_COLOR['APDO_PPS']  // '#a5d6a7'
 */
export const PDO_COLOR: Readonly<Record<string, string>> =
  Object.fromEntries(PDO_TYPE_META.map(m => [m.key, m.color]));

/**
 * key → badge label lookup.
 * @example PDO_BADGE['APDO_EPR_AVS']  // 'EPR-AVS'
 */
export const PDO_BADGE: Readonly<Record<string, string>> =
  Object.fromEntries(PDO_TYPE_META.map(m => [m.key, m.badge]));
