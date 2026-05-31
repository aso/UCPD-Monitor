// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO

/**
 * Known USB devices: key = "VID:PID" (uppercase), value = friendly label.
 * Used for auto-selection priority and display badge.
 */
export const KNOWN_DEVICES = {
  '0483:374B': 'STM32G071B-DISCO (STLINK-V3)',
  '0483:374E': 'STLINK-V3E',
  '0483:374F': 'STLINK-V3MODS',
  '0483:3748': 'STLINK-V2-1',
};

/** Return the friendly label for a port entry, or null. */
export function knownLabel(port) {
  const vid = (port.vendorId  ?? '').toUpperCase();
  const pid = (port.productId ?? '').toUpperCase();
  return KNOWN_DEVICES[`${vid}:${pid}`] ?? null;
}
