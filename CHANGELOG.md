# Changelog

All notable changes to UCPD-Monitor are documented here.

---

## [3.2.1] - 2026-04-15

### Added

#### Source DeviceBox — Spec Badge (`SrcSpecBadge`)
- SOURCE ノードボックス上部に `SrcSpecBadge` コンポーネントを追加。
- SCDB (Source_Capabilities_Extended) 受信時にベンダー名 / PID / EPR RDY / Cap_Ext / VDM / PDP を表示。
- `SourceContent` ラッパーコンポーネントを追加し、バッジとキャップリストを一体化。

#### Sink Spec Badge 拡張 (`SinkSpecBadge`)
- Cap_Ext バッジ: RDO の `unchunkedExt` ビットが立っている場合に点灯。
- VDM バッジ: Structured VDM ACK + VDO を送信した機器側のデバイスボックスに点灯。

#### Source SCDB PropPanel ツリーノード
- Source PropPanel に SCDB ノードを追加 (SPR PDP / EPR PDP サマリー表示)。

#### VDM メッセージパーサー改善 (`pd_parser.js`)
- **Structured VDM ヘッダー** 完全デコード:
  - VDM Version Major (B14:13) / Minor (B12:11) → `v2.x` 形式で表示。
  - Object Position: `ExitAll` / `Rsvd` / `Obj#N` を正確に表示。
  - SVID Specific Commands (cmd 16–31) → `SVID_Cmd_0x__` として表示。
- **Unstructured VDM ヘッダー**: B14:0 `VendorData` フィールドを `VendorData:0x____` 形式で表示。
- **`pdoSummary` for Vendor_Defined**: メッセージテーブルの要約行に VDM 概要を追加。
  - Structured: `SVID  cmdName [cmdTypeName]`
  - Unstructured: `SVID [Unstructured] VendorData:0x____`

#### USB VID ベンダーマップ拡張 (`TopologyView.jsx`)
- **Shared / Sub-licensed VIDs** セクションを追加:
  - `0x1209` — pid.codes (オープン PID レジストリ)
  - `0x16C0` — V-USB Shared (Van Ooijen Tech. / V-USB 共有 VID)
  - `0x16D0` — MCS Electronics (MCS 共有 VID プログラム)
  - `0x1D50` — Openmoko (オープン VID/PID レジストリ)
  - `0x1FC9` — NXP Semiconductors (NXP サブライセンスプログラム)
  - `0x2E8A` — Raspberry Pi
  - `0xF055` — f055.io (非公式自称 VID)

#### VDM Discover Identity 完全デコード — PD Rev 3.2 §6.4.4.3.1 対応 (`pd_parser.js`)

全 VDO を Table 番号に準拠してフィールド単位でデコード:

| VDO | Table | フィールド例 |
|-----|-------|-------------|
| ID Header VDO | 6.34 | VID (ベンダー名付き), USBHostCapable, USBDeviceCapable, ProductTypeUFP/DFP, ModalOperation, ConnectorType |
| Cert Stat VDO | 6.38 | TID (32bit 全ビット) |
| Product VDO | 6.39 | bcdDevice, PID |
| UFP VDO | Table 6.40 | UFPVDOVersion, DeviceCapability, AlternateModes, USBSpeed |
| DFP VDO | Table 6.41 | DFPVDOVersion, HostCapability, AlternateModes, USBSpeed |
| Passive Cable VDO | Table 6.42 | CableVDOVersion, MaxVBusCurrent, MaxVBusVoltage, CableHousingType 他 |
| Active Cable VDO1 | Table 6.43 | CableVDOVersion, MaxVBusCurrent, SBUType, SBUImpedance, SSRx/SSTx 他 |
| Active Cable VDO2 | Table 6.44 | USB4PHY, USB3Support, USB2Support, USB2BidirectionalPower 他 |
| VPD VDO | Table 6.45 | VPDVDOVersion, MaxVBusCurrent, ChargeThroughSupport, GroundImpedance 他 |

- enum フィールドは `010b  PDUSB Peripheral` 形式 (2進表記 + 記述名) で表示。
- VID に対して Lenovo / Google / Apple / STMicro / Intel / HP 等のベンダー名を自動付与。

#### Discover SVIDs / Modes デコード改善 (`pd_parser.js`)

- Discover SVIDs ACK: `SVID VDO[1] — <name1>  <name2>` 形式 + end-of-list 明示表示。
- Discover Modes ACK: `Mode 1: 0x...` 形式で汎用デコード。
- REQ / NAK / BUSY に VDO が含まれる場合に `⚠ Spec violation` を付与。

#### Message Log — VDM 2段階ツリー展開 (`MessageTable.jsx`)

- Discover Identity ACK 展開時、VDO ごとのセクションヘッダー (`ID HEADER`, `CERT STAT`, `PRODUCT`, `UFP VDO` …) を折り畳み行として表示。
- ▸ / ▾ エキスパンダーをクリックして各セクションのフィールド行を個別に開閉可能。
- 展開フィールド行はセクションヘッダーより 24px インデントした `└` 記号付きで表示。

#### Message Log 最小高さ
- `.main` に `min-height: 120px` を追加し、メッセージログ領域が潰れないようにした。

#### PropPanel リサイズバー位置修正
- リサイズハンドルを PropPanel 内部の `position:absolute` から、外側の flex sibling `<div className={styles.panelSep}>` に移動。
- リストビューとリサイズバーが重なる問題を解消。

### Fixed

- **`useRef` インポート欠落** による画面真っ暗問題を修正。
- **Source `Cap_Ext` バッジ誤点灯**: PDO#1 の `unchunkedExtMsg` 宣言ビットで判定していた → 実際に SCDB を受信したときのみ (`!!scdb?.length`) 点灯するよう修正。
- **VDM バッジ消灯バグ**: `snkCapList` useMemo の依存配列に `sink.vdmSeen` が含まれていなかった → 依存配列を `[sink]` に変更。
- **PR Swap 後に `scdb` / `skedb` / `vdmSeen` がリセットされない問題**: PR Swap ハンドラのリテラルオブジェクトにフィールドを明示追加。

### Changed

- `snkCapList` useMemo の依存配列を `[sink.connected, sink.capabilities, sink.lastRequest, sink.srcCaps]` → `[sink]` に変更 (VDM バッジ消灯バグ修正の副産物)。

---

## [3.2.0] - 2026-04-14

### Added

- **SKEDB (Sink_Capabilities_Extended) 対応**: アプリストアに `skedb` フィールドを追加し、パーサーと PropPanel に反映。
- **Sink Spec Badge (`SinkSpecBadge`)**: SINK ノードボックス上部にベンダー名 / PID / EPR RDY / PDP を表示するバッジを追加。
- **SOURCE / SINK PropPanel 横幅リサイズ**: ドラッグによるリサイズ機能を追加。
- **Connection View 縦高さリサイズ**: 下端ドラッグによる高さ変更機能を追加。
- **eMarker VDM SOP'/SOP'' 検出表示**: ケーブルボックスに SOP'/SOP'' 点灯ランプを追加。

---

## [3.1.x] 以前

- 詳細は Git ログを参照。
