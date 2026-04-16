# Changelog

All notable changes to UCPD-Monitor are documented here.

---

## [3.2.3] - 2026-04-16

### Added

#### シリアルポート自動選択の改善 (`SerialBar.jsx`)
- ポートリストに既知デバイス (STM32 STLINK) が **唯一** の場合のみ自動選択。複数ある場合は選択しない。
- ポートリストが **変動した場合にのみ** 自動選択ロジックを実行 (2秒ポーリングの毎ループでは発火しない)。
- 選択中のポートが抜去された場合: 拡張ロール探索で次候補を選択。
  - 直前リスト上の拡張インデックスから下方検索 → 折り返しでトップへ → 既知デバイスが 1 台なら即選択。
  - 既知デバイスが全滅した場合は空欄 ("— select port —" プレースホルダー)。
  - ポート自体が 0 件の場合は "— no devices —" を表示。

#### TypeScript 移行 (`pd_parser.ts`, `pd_types.ts`)
- `pd_parser.js` を `pd_parser.ts` へ改名 (git mv でヒストリ保持)。
- `pd_types.ts` を新規作成: `Pdo` / `Rdo` / `MessageHeader` / `PdFrame` / `ParsedCpdFile` 等の静的型定義。
- `tsconfig.json` (`strict: true`, `noUncheckedIndexedAccess: true`) で全エクスポート関数に戻り型注釈。`tsc --noEmit` エラー 0 件を確認。

---

## [3.2.2] - 2026-04-15

### Added

#### Spec Badge — DRD バッジ (`TopologyView.jsx`)
- `Source_Capabilities` / `Sink_Capabilities` PDO#1 B25 (`dualRoleData`) が `1` の機器ボックスに紫色の `DRD` バッジを表示。
- `appStore.js`: `INIT_SOURCE` / `INIT_SINK` に `drd: false` フィールドを追加。PR Swap ハンドラでも正しく引き継ぐ。

#### Spec Badge — Alt Mode バッジ (`TopologyView.jsx`)
- `SOP` フレームの Discover Identity ACK (cmd=`0x01`) 受信時、ID Header VDO B26 (`ModalOperation`) が `1` の機器ボックスにオレンジ色の `Alt Mode` バッジを表示。
- `appStore.js`: `INIT_SOURCE` / `INIT_SINK` に `altMode: false` フィールドを追加。

#### Discover SVIDs / Modes — 2段階ツリー表示 (`pd_parser.js`, `MessageTable.jsx`)
- Discover SVIDs ACK: VDO ワードごとに `SVID VDO[N]` セクションヘッダー + `SVID[upper]` / `SVID[lower]` フィールド行の2段階ツリーに移行。
- Discover Modes ACK (DP SVID=0xFF01): `Mode 1: DP Capabilities VDO` セクションヘッダー + UFP_D/DFP_D/Receptacle/Signaling フィールド行の2段階ツリーに移行。
- Discover Modes ACK (汎用 SVID): `Mode N` セクションヘッダー + `Raw` フィールド行の2段階ツリーに移行。
- `vdmGroups` がセクション前の `⚠ Spec violation` 警告行を hdr=null グループとして保持し、全幅行で描画。

### Fixed

- **Sink `Cap_Ext` バッジ誤点灯**: RDO の `unchunkedExt` ビットで判定していた → 実際に `Sink_Capabilities_Extended` (SKEDB) を受信したときのみ点灯するよう修正。

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

- Discover SVIDs ACK: VDO ワードごとに `SVID VDO[N]` セクションヘッダー + `SVID[upper]` / `SVID[lower]` フィールド行の2段階ツリーに移行。end-of-list / odd-count 終端を明示。
- Discover Modes ACK (DP SVID=0xFF01): `Mode 1: DP Capabilities VDO` セクションヘッダー + UFP_D/DFP_D/Receptacle/Signaling フィールド行の2段階ツリーに移行。
- Discover Modes ACK (汎用 SVID): `Mode N` セクションヘッダー + `Raw` フィールド行の2段階ツリーに移行。
- REQ / NAK / BUSY に VDO が含まれる場合に `⚠ Spec violation` を付与 (警告行はセクション前の全幅行として表示)。

#### Message Log — VDM 2段階ツリー展開 (`MessageTable.jsx`)

- Discover Identity / SVIDs / Modes ACK 展開時、VDO ごとのセクションヘッダーを折り畳み行として表示。
- ▸ / ▾ エキスパンダーをクリックして各セクションのフィールド行を個別に開閉可能。
- 展開フィールド行はセクションヘッダーより 24px インデントした `└` 記号付きで表示。
- セクションヘッダー前の flat 行 (`⚠ Spec violation` 等) はドロップせず全幅行として描画。

#### Spec Badge — DRD バッジ (`TopologyView.jsx`)

- `Source_Capabilities` / `Sink_Capabilities` PDO#1 の B25 (`dualRoleData`) が `1` の機器ボックスに紫色の `DRD` バッジを表示。
- `appStore.js`: `INIT_SOURCE` / `INIT_SINK` に `drd: false` フィールドを追加。PR Swap ハンドラでも正しく引き継ぐ。

#### Spec Badge — Alt Mode バッジ (`TopologyView.jsx`)

- `SOP` フレームの Discover Identity ACK (cmd=`0x01`) 受信時、ID Header VDO B26 (`ModalOperation`) が `1` の機器ボックスにオレンジ色の `Alt Mode` バッジを表示。
- `appStore.js`: `INIT_SOURCE` / `INIT_SINK` に `altMode: false` フィールドを追加。Vendor_Defined ハンドラ内で cmd=`0x01` ACK のみを対象に格納。

#### Message Log 最小高さ
- `.main` に `min-height: 120px` を追加し、メッセージログ領域が潰れないようにした。

#### PropPanel リサイズバー位置修正
- リサイズハンドルを PropPanel 内部の `position:absolute` から、外側の flex sibling `<div className={styles.panelSep}>` に移動。
- リストビューとリサイズバーが重なる問題を解消。

### Fixed

- **`useRef` インポート欠落** による画面真っ暗問題を修正。
- **Source `Cap_Ext` バッジ誤点灯**: PDO#1 の `unchunkedExtMsg` 宣言ビットで判定していた → 実際に SCDB を受信したときのみ (`!!scdb?.length`) 点灯するよう修正。
- **Sink `Cap_Ext` バッジ誤点灯**: RDO の `unchunkedExt` ビットで判定していた → 実際に SKEDB (`Sink_Capabilities_Extended`) を受信したときのみ (`!!skedb?.length`) 点灯するよう修正。
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
