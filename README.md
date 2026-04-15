# UCPD-Monitor

[English](README.md) | [日本語](README.ja.md)

A cross-platform Electron desktop application for real-time monitoring and analysis of USB Power Delivery (PD) communication captured by STM32 UCPD hardware.

It reads `.cpd` binary streams produced by STM32CubeMonitor-UCPD and decodes them against the **USB PD Revision 3.2, Version 1.0 (2023-10)** specification — providing a live Connection View, a fully-decoded message table, and clipboard-ready export.

---

## Background

The **STM32G071B-DISCO** board from STMicroelectronics includes a UCPD SPY mode that passively captures USB PD packets on the CC line and streams them to a host PC via USB-UART as `.cpd` binary data, using the companion tool **STM32CubeMonitor-UCPD** (USB PD 2.0/3.0). UCPD-Monitor accepts the same `.cpd` stream and decodes it using a parser built from scratch against **USB PD Rev 3.2** — covering EPR, AVS, extended messages, and Source_Info — without requiring STM32CubeMonitor-UCPD.

> **Reference:** [STM32CubeMonitor-UCPD on st.com](https://www.st.com/en/development-tools/stm32cubemonucpd.html) · [RN0113 Release Note](https://www.st.com/resource/en/release_note/rn0113-stm32cubemonitorucpd-release-140-stmicroelectronics.pdf)

![Main screen](docs/main-screen.png)

---

## Features

- **Live Serial Monitoring** — Connect to any STM32 UCPD device via USB-UART and receive PD frames in real time
- **`.cpd` File Import** — Drag-and-drop or open `.cpd` binary files captured by STM32CubeMonitor-UCPD; server-side parsing eliminates ring-buffer mismatches. The current Live log is automatically cleared before import and import data is never duplicated into the session file.
- **USB PD Rev 3.2 Decoder** — Full decode of Control, Data, and Extended messages including EPR, PPS, AVS, and SPR-AVS
- **Connection View** — Visual topology of Source / Cable (eMarker) / Sink. SOURCE node shows confirmed output voltage and current/power after PS_RDY. SINK node shows **V.req** (requested voltage) and calculated power. PDO grids display `I.max` / `P.max` for Source PDOs and `I.op` / `P.op` for Sink PDOs, matching USB PD Rev 3.2 semantics.
- **Message Table** — High-performance virtual scroll ([@tanstack/react-virtual](https://tanstack.com/virtual)) handles 1 000 + rows smoothly. Expandable PDO/RDO child rows with O(n) RDO-to-source-PDO resolution. Column widths are user-resizable; the rightmost "Parsed" column auto-fills the remaining window width and is stable across tree-expand and window resize.
- **Row Selection & Clipboard Copy** — Click / Shift-click range selection; Ctrl+C or right-click to copy rows as TSV (with `DATA:HEX` raw suffix)
- **Auto-scroll with Jump-to-Latest** — Automatic scroll to newest message; floats a button to return after manual browsing
- **Session File Save** — Live frames are automatically written to a timestamped `.cpd` file for later replay. The serial port is cleanly disconnected and the session file flushed on application quit.
- **Unknown Packet Log** — Unrecognised frames are appended to `logs/unknown_packets.yaml` for diagnostics
- **Panel Toggles** — Show/hide Connection View and Console panels independently

---

## Technology Stack

| Component | Technology |
|---|---|
| Desktop shell | Electron 41 |
| UI | React 19 + Vite 8 |
| State management | Zustand |
| Virtual scroll | @tanstack/react-virtual |
| Backend | Express 4 + Node.js |
| Real-time transport | WebSocket (`ws`) |
| Serial communication | `serialport` 13 |
| Packaging | electron-builder |

---

## Getting Started

Download the latest installer from the [Releases](https://github.com/aso/UCPD-Monitor/releases) page and run it.

| Platform | File |
|---|---|
| Windows | NSIS installer (`.exe`) |
| Linux | AppImage |

After installation, launch **UCPD-Monitor**.

---

## Usage

### Connecting to a Device

1. Plug the STM32 UCPD device into a USB port.
2. Select the COM port from the dropdown in the title bar.
3. Click **Connect**. Live PD frames appear immediately.

### Importing a `.cpd` File

- Click the **.cpd Import** button in the title bar, or
- Drag and drop one or more `.cpd` files anywhere onto the window.

The entire file is parsed server-side and replayed as a `HISTORY` message — DETACHED/ATTACHED events are preserved and no ring-buffer truncation occurs.

### Copying Messages

1. Click a row to select it. Shift-click to extend the selection.
2. Press **Ctrl+C** or right-click and choose **Copy N rows**.

Each row is copied as a tab-separated line:

```
#id   Timestamp   Dir   SOP   Rev   MsgID   Type   #DO   Parsed Summary   DATA:HEXRAW
```

Rows without a parsed summary show the raw payload as `DATA:HEXRAW` directly in the summary column.

---

## Supported PD Messages

### Control Messages
GoodCRC, Accept, Reject, PS_RDY, Soft_Reset, Hard_Reset, DR_Swap, PR_Swap, VCONN_Swap, Wait, Not_Supported, Get_Source_Cap, Get_Sink_Cap, Get_Source_Cap_Extended, Get_Status, FR_Swap, Get_PPS_Status, Data_Reset, and EPR control messages.

### Data Messages
Source_Capabilities, Sink_Capabilities, Request, EPR_Request, BIST, Alert, Battery_Status, Get_Country_Info, Enter_USB, EPR_Mode, Source_Info, Revision, VDM (Structured).

### Extended Messages
Source_Capabilities_Extended (SCEDB), Status, PPS_Status, Battery_Capabilities, Manufacturer_Info, Sink_Capabilities_Extended, Country_Info, Country_Codes, Security_*, Firmware_Update_*, Extended_Control.

### PDO / RDO Types
Fixed, Variable, Battery, APDO (PPS), APDO (AVS), APDO (SPR-AVS) — all with full field decode.
- Source PDOs display **I.max** / **P.max**; Sink PDOs display **I.op** / **P.op** per USB PD Rev 3.2 terminology.
- Battery RDO carries power fields in 250 mW units (`opPower_mW` / `limPower_mW`).
- GiveBack flag dynamically switches Max/Min labels in RDO child rows.

---

## License

MIT

---

## Related

- [STM32CubeMonitor-UCPD](https://www.st.com/en/development-tools/stm32cubemonitor-ucpd.html) — Original monitoring tool by STMicroelectronics
- [USB Power Delivery Specification Rev 3.2](https://www.usb.org/document-library/usb-power-delivery)
