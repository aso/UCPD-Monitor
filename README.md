# UCPD-Monitor

[English](README.md) | [日本語](README.ja.md)

A cross-platform Electron desktop application for real-time monitoring and analysis of USB Power Delivery (PD) communication captured by STM32 UCPD hardware.

It decodes `.cpd` binary streams produced by STM32CubeMonitor-UCPD, providing a live Connection View, a fully-decoded message table, and clipboard-ready export — all without requiring the original STM32CubeMonitor-UCPD software.

---

## Background

The **STM32G071B-DISCO** board from STMicroelectronics includes a USB Power Delivery protocol analyser with a **SPY mode** that passively monitors the CC line. When connected to the PC application **STM32CubeMonitor-UCPD** via USB-UART, it captures live PD packets.

However, STM32CubeMonitor-UCPD v1.4 only supports **PD 2.0 / PD 3.0**, and cannot correctly decode messages introduced in **USB PD Rev 3.2** — including EPR (Extended Power Range), AVS (Adjustable Voltage Supply), and new extended message types. Development of the application has since been discontinued.

This project was created to fill that gap. It accepts the same `.cpd` binary stream that STM32CubeMonitor-UCPD produces and decodes it using a fully **USB PD Rev 3.2 compliant** parser built from scratch.

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

## `.cpd` Binary Format

Each record in a `.cpd` stream has the following layout:

```
Offset  Size  Field
------  ----  -------------------------------------------
00-03    4    SOF:        FD FD FD FD (always)
04       1    Tag:        ((PortNum+1) << 5) | 0x12
                          Port 0 → 0x32 / Port 1 → 0x52
05-06    2    Length:     BE uint16 = PayloadLen + 9
07       1    Type:       0x07=SRC→SNK / 0x08=SNK→SRC
                          0x06=ASCII_LOG / 0x03=EVENT
08-0B    4    Timestamp:  LE uint32 (milliseconds since boot)
0C       1    PortNum:    0x00=Port 0 / 0x01=Port 1
0D       1    SopQual:    0x00=SOP / 0x01=SOP' / 0x02=SOP''
0E-0F    2    Size:       BE uint16 = PayloadLen
10+      N    Payload:    USB-PD message bytes or ASCII string
10+N+    4    EOF:        A5 A5 A5 A5
```

Total frame length: **20 + PayloadLen** bytes.

---

## Project Structure

```
/
├── electron/
│   └── main.js               # Electron main process
├── server/
│   ├── index.js              # Express + WebSocket + SerialPort server
│   └── cpdStreamParser.js    # Transform stream — CPD frame de-multiplexer
├── client/
│   └── src/
│       ├── App.jsx            # Root component
│       ├── store/appStore.js  # Zustand global store + connection state machine
│       ├── hooks/
│       │   ├── useWebSocket.js
│       │   └── useCpdImport.js
│       ├── parsers/pd_parser.js  # USB PD Rev 3.2 decoder
│       └── components/
│           ├── TopologyView.jsx
│           ├── MessageTable.jsx
│           ├── Console.jsx
│           └── SerialBar.jsx
├── logs/                      # Session .cpd files + unknown_packets.yaml
├── docs/
│   └── SPEC.md               # Detailed specification (Japanese)
└── package.json
```

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
