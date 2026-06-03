# UCPD-Monitor v3.2.7 Release Notes

Release date: 2026-06-03

## Highlights

- PE_STATE decode was aligned with STM32 firmware/XML vocabulary.
- HEX/Parsed toggle now also applies to event payload rows while keeping Type column stable.
- ADC Stream meter semantics were updated:
  - Range labels now show scale endpoints (0 to scale max)
  - Observed min/max moved to FW Tick metadata line
  - Non-streaming state now dims meter card, bars, and value fonts
- ADC Stream panel and Console panel visibility are now independent.
- Trace labels were externalized to a dedicated resource module (`traceLabels.ts`).

## Documentation

- Updated `README.md`, `README.ja.md`, and `docs/SPEC.md` to match current behavior.
- Added/updated source-level docs under `docs/sources` (Japanese-first).

## Validation

- Frontend build: passed
- Tests: 154 passed (Vitest)
- Electron production build: installer generated (`UCPD-Monitor Setup 3.2.7.exe`)

## Artifacts

- `dist-electron/UCPD-Monitor Setup 3.2.7.exe`
- `dist-electron/UCPD-Monitor Setup 3.2.7.exe.blockmap`
- `dist-electron/latest.yml`
