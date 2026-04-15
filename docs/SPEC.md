# UCPD-Monitor アプリケーション仕様書

バージョン: 1.4  
更新日: 2026-04-15

---

## 1. 概要

**UCPD-Monitor** は、STM32 UCPD ハードウェアが生成する `.cpd` バイナリストリームをリアルタイムで受信・解析し、USB Power Delivery (PD) プロトコルのメッセージをビジュアルに表示する Electron デスクトップアプリケーションである。

### 主な特徴

| 機能 | 説明 |
|---|---|
| ライブシリアル監視 | STM32 UCPD デバイスを USB シリアル経由で接続してリアルタイムモニタリング |
| .cpd ファイルインポート | STM32CubeMonitor-UCPD が保存した `.cpd` バイナリファイルの再生。インポート前に Live ログを自動フラッシュ。セッションファイルへの重複書き込みなし |
| USB PD メッセージ解析 | USB PD Rev 3.2 準拠のフルデコード (SPR/EPR/PPS/AVS/SPR-AVS) |
| Connection View | Source / Cable (eMarker) / Sink の接続状態と契約情報を可視化。Source PDO は I.max/P.max、Sink PDO は I.op/P.op を表示 |
| メッセージテーブル | 時系列メッセージリスト。仮想スクロール対応 (1000行超でも高速)。列幅ユーザリサイズ可。ツリー展開・ウィンドウリサイズで最終列が安定して右端まで表示 |
| Dir / Role 統合カラム | 方向 (SRC→SNK / SNK→SRC) と電力・データロール (Source/DFP 等) を 1 列に集約 |
| 拡張メッセージデコード | Source_Capabilities_Extended (SCEDB 25 バイト)・Status (SDB 7 バイト) を構造化キー・バリュー行でツリー展開。EPR_Source/Sink_Capabilities も PDO ツリー展開対応 |
| EPR_Mode カラーバッジ | Enter / Acknowledged / Succeeded / Failed / Exit の各アクションを色分け表示 |
| 行選択・クリップボードコピー | クリック/Shift+クリック範囲選択。Ctrl+C または右クリックで TSV コピー |
| セッション保存 | ライブデータを自動的にタイムスタンプ付き `.cpd` ファイルへ保存。アプリ終了時にシリアルポート自動切断・ファイルフラッシュ |
| 不明パケットログ | パース不能フレームを `logs/unknown_packets.yaml` へ記録 |

---

## 2. システム構成

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Shell                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │               React UI (client/)                    │   │
│  │   App.jsx                                           │   │
│  │   ├── TopologyView.jsx   (接続・契約可視化)          │   │
│  │   ├── MessageTable.jsx   (メッセージ一覧)            │   │
│  │   ├── Console.jsx        (ASCII ログ)                │   │
│  │   └── SerialBar.jsx      (接続操作)                  │   │
│  │                                                     │   │
│  │   Zustand Store (appStore.js)                       │   │
│  │   Hooks: useWebSocket.js / useCpdImport.js          │   │
│  │   Parser: pd_parser.js (Rev 3.2 PD デコーダ)        │   │
│  └──────────────────┬──────────────────────────────────┘   │
│                     │ WebSocket (ws://)                     │
│  ┌──────────────────▼──────────────────────────────────┐   │
│  │            Express サーバ (server/index.js)          │   │
│  │   SerialPort → CpdStreamParser → frame イベント     │   │
│  │   POST /api/import-cpd  (ファイルインポート)         │   │
│  │   GET  /api/ports       (シリアルポート一覧)         │   │
│  │   POST /api/connect     (ポート接続)                 │   │
│  │   POST /api/disconnect  (ポート切断)                 │   │
│  └──────────────────┬──────────────────────────────────┘   │
│                     │ SerialPort (USB-UART)                 │
└─────────────────────┼───────────────────────────────────────┘
                      │
              STM32 UCPD デバイス
```

### 技術スタック

| レイヤ | 技術 |
|---|---|
| デスクトップシェル | Electron 41 |
| UI フレームワーク | React 19 + Vite 8 |
| 状態管理 | Zustand |
| バックエンド | Express 4 + Node.js |
| リアルタイム通信 | WebSocket (ws) |
| シリアル通信 | serialport 13 |
| パッケージング | electron-builder |

---

## 3. .cpd バイナリフォーマット

STM32CubeMonitor-UCPD が出力するバイナリストリームの 1 フレーム構造:

```
Offset  Size  フィールド
------  ----  -----------------------------------
00-03    4    Sync:       FD FD FD FD (固定)
04-05    2    FixedField: 32 00 (固定)
06       1    Cat:        payloadLen + 9
07       1    Dir:        0x07=SRC→SNK / 0x08=SNK→SRC
                          0x06=ASCII_LOG / 0x03=EVENT
08-0B    4    Timestamp:  LE uint32 ミリ秒単位のフリーランタイマ (ms-since-boot)
0C       1    Pad0:       0x00
0D       1    SopQual:    0x00=SOP / 0x01=SOP' / 0x02=SOP''
0E       1    Pad1:       0x00
0F       1    PayloadLen: ペイロードバイト数 = Cat - 9
10+      N    Payload:    USB-PD メッセージバイト列 または ASCII 文字列
10+N+    4    Sentinel:   A5 A5 A5 A5
```

総フレーム長: 20 + PayloadLen バイト

### レコード種別

| Dir 値 | 種別 | 説明 |
|---|---|---|
| 0x07 / 0x08 | PD_MSG | USB-PD メッセージフレーム |
| 0x06 | ASCII_LOG | デバッグ ASCII 文字列 (VBUS/CC ピン情報含む) |
| 0x03 | EVENT | ケーブル抜挿イベント (SopQual=0x01:DETACHED / 0x02:ATTACHED) |

---

## 4. データフロー

### 4.1 ライブシリアル受信

```
STM32 UCPD
  → SerialPort (USB-UART, 115200 bps 等)
  → CpdStreamParser (Transform Stream)
      バイト蓄積 → FD FD FD FD 同期 → フレーム抽出 → 'frame' emit
  → server/index.js フレームハンドラ
      1. セッション .cpd ファイルへ書き込み
      2. recordHistory (リングバッファ, MAX=50000) へ push
      3. 全 WebSocket クライアントへ CPD_RECORD ブロードキャスト
  → クライアント useWebSocket.js
      → appStore.js applyFrameToTopo() でトポロジ更新
      → メッセージリストへ追加
```

### 4.2 ファイルインポート

```
ユーザー .cpd ファイル選択 (または D&D)
  → useCpdImport.js
  → POST /api/import-cpd (Content-Type: application/octet-stream)
      ← サーバ側:
          CpdStreamParser でバイト列をフル解析
          importedRecords = records[]  (リングバッファ不使用)
          broadcast({ type: 'HISTORY', records: importedRecords, filename: ... })
          ※ セッションファイルへの書き込みは行わない (重複防止)
  → クライアント HISTORY ハンドラ
      → filename が付いている場合、現在の Live ログをフラッシュ (clearMessages)
      → メッセージリスト全置換
      → トポロジ再構築 (全フレームを applyFrameToTopo で逐次適用)
```

**注:** インポート中は DETACHED/ATTACHED によるバッファフラッシュは発生しない。  
ライブシリアル接続時に `importedRecords = null` へリセットされライブモードに戻る。

### 4.3 ブラウザリロード時のリプレイ

WebSocket 接続確立直後に、サーバは `importedRecords ?? recordHistory` を HISTORY メッセージとして送信する。これにより、ブラウザリロード後もメッセージリストが復元される。

---

## 5. USB PD デコーダ仕様 (pd_parser.js)

USB PD Rev 3.2 に準拠したプライマリデコーダ。

### 対応メッセージタイプ

**コントロールメッセージ (NDO=0)**

GoodCRC, GotoMin, Accept, Reject, Ping, PS_RDY, Get_Source_Cap, Get_Sink_Cap, DR_Swap, PR_Swap, VCONN_Swap, Wait, Soft_Reset, Data_Reset, Not_Supported, Get_Source_Cap_Extended, Get_Status, FR_Swap, Get_PPS_Status, Get_Country_Codes, Get_Sink_Cap_Extended, Get_Source_Info, Get_Revision, および EPR 拡張コントロールメッセージ等

**データメッセージ**

| メッセージ | #DO | 説明 |
|---|---|---|
| Source_Capabilities | 1–8 | ソース PDO 一覧 (Fixed/Variable/Battery/APDO_PPS/APDO_AVS) |
| Request / EPR_Request | 1 | シンクからの RDO (Fixed/PPS/AVS レイアウト対応) |
| BIST | 1 | テストモード |
| Sink_Capabilities | 1–8 | シンク PDO 一覧 |
| Battery_Status | 1 | バッテリー残量・状態 (B31..16=容量10mWh単位, B3..0=状態フラグ) |
| Alert | 1 | 異常通知 (OCP/OTP/SrcInputChange/BatChange/OpCondChange フラグ) |
| Get_Country_Info | 1 | 国コード問い合わせ (B31..16=2文字 ASCII) |
| Enter_USB | 1 | USB4/USB3.2 モード遷移 (USB Mode, Cable Type, EPR/DRD/Host フラグ) |
| EPR_Mode | 1 | EPR モード制御 (Enter/Enter ACK/Succeeded/Failed/Exit) |
| Source_Info | 1 | ソース情報 (SIDO: Port Type, Max/Present/Reported PDP) |
| Revision | 1 | PD リビジョン (B31..24=Revision BCD, B15..8=Version BCD) |
| VDM | 1–7 | Vendor Defined Message (Structured: Discover Identity/SVIDs/Modes, DP Status) |

**拡張メッセージ**

Source_Capabilities_Extended (SCEDB), Status, Get_Battery_Cap, Get_Battery_Status, Battery_Capabilities, Get_Manufacturer_Info, Manufacturer_Info, Security_Request, Security_Response, Firmware_Update_Request, Firmware_Update_Response, PPS_Status, Country_Info, Country_Codes, Sink_Capabilities_Extended, Extended_Control など

### PDO 解析

PDO デコードは `isSink` フラグを保持し、Source/Sink どちらの能力を表すかを区別する。

| PDO 種別 | Source デコード内容 | Sink 固有差分 |
|---|---|---|
| Fixed | vMv, iMa, DRP/UCPwr/USB-Comm/DRD/EPR/HigherCap フラグ | HigherCap, FastRoleSwap フラグ追加 |
| Variable | vMinMv, vMaxMv, iMa | — |
| Battery | vMinMv, vMaxMv, wMax | — |
| APDO_PPS | vMinMv, vMaxMv, iMa, isSink | isSink=true で区別 |
| APDO_AVS | vMinMv, vMaxMv, pdpW, peakCurrent | Sink は peakCurrent フィールド省略 |
| APDO_SPR_AVS | vMinMv, vMaxMv, iMa_9_15, iMa_15_20 | Source 専用 (isSink=false) |

> **Connection View での表示ラベル**:  
> Source PDO グリッドでは電流・電力フィールドを **I.max / P.max** と表示し、Sink PDO グリッドでは USB PD Rev 3.2 Table 6-12 に準拠して **I.op / P.op** と表示する。ラベル切り替えは `isSink` prop を受け取った `CapList` コンポーネント内の `GRID_COLS_SRC` / `GRID_COLS_SNK` 定数で行う。

### RDO 解析

RDO デコードは参照先 PDO の種別 (srcPdoType) を引数に取り、正しいビットレイアウトを選択する。

| RDO 種別 (rdoType) | 対象 PDO | デコード内容 |
|---|---|---|
| Fixed/Variable | Fixed, Variable, APDO_SPR_AVS | objPos, opCurrent_mA, maxCurrent_mA (GiveBack時は minCurrent_mA), capMismatch, giveBack, eprMode |
| Battery | Battery | objPos, opPower_mW, limPower_mW (250mW単位), capMismatch, giveBack, eprMode |
| PPS | APDO_PPS | objPos, opVoltage_mV (20mV/LSB, 12bit), opCurrent_mA (50mA/LSB), capMismatch, eprMode |
| AVS | APDO_AVS, APDO_SPR_AVS | objPos, opVoltage_mV (25mV/LSB, 12bit), opCurrent_mA (50mA/LSB), capMismatch, eprMode |

---

## 6. サーバ API

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/ports` | 利用可能なシリアルポート一覧 (SerialPort.list()) |
| POST | `/api/connect` | シリアルポートへ接続 `{port, baudRate}` |
| POST | `/api/disconnect` | シリアルポートを切断 |
| POST | `/api/ping` | WebSocket keepalive |
| POST | `/api/import-cpd` | バイナリ .cpd データ受信・解析・HISTORY ブロードキャスト |

### WebSocket メッセージ型

**サーバ → クライアント**

| type | ペイロード | 説明 |
|---|---|---|
| `CPD_RECORD` | `{hex, ts}` | ライブフレーム (1 件) |
| `HISTORY` | `{records: [{hex,ts}], filename?: string}` | 全履歴リプレイ。インポート時は元ファイル名を含む。filename が付いている場合クライアントは Live ログをフラッシュしてから表示 |
| `SERIAL_STATUS` | `{connected, port, baudRate}` | 接続状態変化 |
| `PORT_LIST` | `{ports: [...]}` | ポート一覧変化 (ホットプラグ) |

**クライアント → サーバ**

| type | ペイロード | 説明 |
|---|---|---|
| `PING` | — | keepalive |

---

## 7. フロントエンドコンポーネント

### 7.1 App.jsx

アプリケーションルート。タイトルバーにパネルトグルボタン・インポートボタン・ステータスバッジを配置。

- `showTopology` / `showConsole` の useState で Connection View/コンソールの表示/非表示をトグル
- ドラッグ＆ドロップで `.cpd` ファイルをインポート可能
- `serialConnected` 時はインポートボタンを無効化

### 7.2 TopologyView.jsx (Connection View)

USB-PD 接続状態を Connection View として可視化。

**表示要素:**

- **Source ノード / ボックス**
  - PD リビジョン (Revision メッセージ受信時は BCD で上書き更新)
  - SPR / EPR モード
  - Capabilities: PDO 一覧 (展開可能)
  - Contract (PS_RDY 確認後): PDO 種別・範囲・Out Voltage・Op Current / Op Power
  - **ノードボックス副表示**: `{出力電圧} / {動作電流 or 電力}` をリアルタイム表示
    - Fixed PDO: pdo.vMv の固定電圧 + opCurrent_mA
    - PPS/AVS PDO: 交渉済み opVoltage_mV + opCurrent_mA
    - Battery PDO: 電圧範囲 + opPower_mW
- **eMarker ノード**: SOP'/SOP'' 検出、ケーブル定格電流・電圧、アクティブケーブル/EPR 対応
- **Sink ノード / ボックス**
  - PD リビジョン、Sink Capabilities (I.op/P.op ラベルで表示)、最終 Request (RDO 詳細展開)
  - **ノードボックス副表示**: `{V.req (要求電圧)} / {要求電力}` を表示
    - Fixed: srcPdo.vMv × opCurrent_mA → W 換算
    - PPS/AVS: opVoltage_mV × opCurrent_mA → W 換算
    - Battery: opPower_mW をそのまま W 表示
- **VBUS / CC ピン**: ASCII_LOG から抽出
  - **Source PDO グリッド列**: V.max / V.min / **I.max** / **P.max**
  - **Sink PDO グリッド列**: V.max / V.min / **I.op** / **P.op** (USB PD Rev 3.2 Table 6 に準拠したラベル)
  - ケーブル線表示位置はノードボックス上部寄りに固定 (SINKが最小高さでも接触しない)

### 7.3 MessageTable.jsx

時系列 USB-PD メッセージ一覧テーブル。

**カラム構成:**

| # | Timestamp | Dir / Role | SOP | Rev | MsgID | Type | #DO | Parsed/Summary |
|---|---|---|---|---|---|---|---|---|

**機能:**

- **仮想スクロール** (`@tanstack/react-virtual`): 画面内の行のみ DOM 描画 (overscan 20行)。1000行超でもスムーズ
- **列幅リサイズ**: 各列ヘッダ右端のドラッグハンドルで幅を変更可能。最小幅以下には縮不可。最終列 (Parsed) は常に残り幅いっぱいに自動拡張
- **テーブル幅安定性**: `width: 100%` + `table-layout: fixed` + `minWidth` の組み合わせにより、ツリー展開・ウィンドウリサイズ時もヘッダ幅が崩れない。子行 colSpan 合計が列数 (9) と一致することで暗黙列生成を防止
- **O(n) RDO 解決**: `reqToSrcPdo` Map による前向きスキャン。全メッセージを 1 パスで処理し、Request 行に参照元 PDO を関連付け
- **`memo(MessageRow)`**: 無関係な行追加時の再レンダリングを抑制
- 行クリックで展開: PDO/RDO 子行を表示
  - RDO 展開時: 参照先ソース PDO を直前の Source_Capabilities から逆引きして表示 (ResolvedPdoRow)、srcPdoType を渡して正確なビットレイアウトでデコード
  - Battery RDO: opPower_mW / limPower_mW を W 単位で表示
  - GiveBack フラグ: Max/Min ラベルを動的に切替
  - eprMode フィールドを PPS/AVS/Fixed 全パスで表示
- **行選択**: クリック=単一選択、Shift+クリック=範囲選択 (仮想スクロール外の行も展開状態を保持)
- **コピー**: Ctrl+C または右クリックメニュー → TSV クリップボード
  - コピー書式: `#id \t Timestamp \t Dir \t SOP \t Rev \t MsgID \t Type \t #DO \t Parsed \t DATA:HEXRAW`
  - パース済サマリがない場合、本文カラムは `DATA:HEX...` 形式で表示
- **スクロール**: ユーザーが手動スクロールすると自動スクロール停止。フローティング「最新へ」ボタンで再開
- **HEX ⇄ Parsed トグル**: 本文カラムをパース済テキスト/生 HEX で切替
- **拡張メッセージツリー**: `parsedPayload` システムにより、Source_Capabilities_Extended (SCEDB) と Status (SDB) はキー・バリュー行としてツリー展開。EPR_Source/Sink_Capabilities は通常 PDO ツリーと同様に展開
- **EPR_Mode アクションバッジ**: Enter=緑、Acknowledged=水色、Succeeded=青、Failed=赤、Exit=グレー で色分け

**メッセージ種別の色分け:**

| 種別 | 色 |
|---|---|
| Control メッセージ | 青系 |
| Data メッセージ | 緑系 |
| Extended メッセージ | 橙系 (amber) |
| ASCII_LOG | グレー |
| EVENT (ATTACHED/DETACHED) | オレンジ |

### 7.4 Console.jsx

ASCII_LOG フレームのコンソール表示。VBUS・CC ピン状態を含む。

### 7.5 SerialBar.jsx

シリアルポートのドロップダウン選択、ボーレート設定、接続/切断ボタン。ポートリストはホットプラグ対応 (2 秒ポーリング)。

---

## 8. 状態管理 (appStore.js)

Zustand により以下の状態を管理:

```
{
  wsStatus:     'connected' | 'connecting' | 'disconnected' | 'error',
  serialStatus: { connected, port, baudRate },
  messages:     ParsedFrame[],      // メッセージ全列
  topology:     TopologyState,      // トポロジ最新状態
  importStatus: { loading, done, total, warnings },
  portList:     SerialPortInfo[],
}
```

### applyFrameToTopo (純粋関数)

1 フレームをトポロジ状態に適用して次状態を返す純粋関数。ライブ受信とファイルインポートリプレイの両方で共通使用。

**主なトランジション:**

| イベント/メッセージ | トポロジ変化 |
|---|---|
| DETACHED | 完全リセット (INITIAL_TOPOLOGY) |
| ATTACHED | `cable.attached = true` |
| Hard_Reset | PD 状態のみリセット (ケーブル/VBUS 保持) |
| Soft_Reset | 契約情報のみリセット |
| Source_Capabilities | source.capabilities, source/sink.connected |
| Sink_Capabilities | sink.capabilities |
| Request/EPR_Request | sink.lastRequest (RDO デコード、PDO タイプ正確推定) |
| PS_RDY (SRC→SNK) | source.contract 確定 (rdoType/opVoltage_mV/opCurrent_mA/opPower_mW/limPower_mW/giveBack) |
| EPR_Mode | source/sink.eprActive フラグ更新 |
| Revision | 送信元の pdRevision を BCD デコード値で更新 |
| Status (拡張) | source/sink.status (StatusDB フィールド一覧) 更新 |
| SOP'/SOP'' VDM | eMarker 情報 (ケーブル定格等) 更新 |

---

## 9. セッションファイル管理

起動時・接続時・切断時・DETACHED イベント受信時に、`logs/session_YYYY-MM-DDTHH-MM-SS.cpd` を新規作成してローテーションする。ライブで受信したフレームはバイナリのまま書き込まれ、同一フォーマットで再インポート可能。

**インポート時の扱い**: `.cpd` ファイルのインポートで表示されるデータはセッションファイルへ書き込まない (元ファイルとの重複を防止)。

**アプリ終了時**: `app.on('before-quit')` フックで `shutdown()` を呼び出し、アクティブなシリアルポートを閉じた後にセッションファイルストリームをフラッシュ・クローズする。

---

## 10. 不明パケットログ

パース不能なフレームは `logs/unknown_packets.yaml` へ YAML ドキュメントブロック形式で追記される。外部 YAML ライブラリ不使用。

---

## 11. 起動方法

### 開発 (Electron)

```powershell
npm run electron:dev
# 内部処理: npm run build:client → electron .
```

### 開発 (Web ブラウザ)

```powershell
npm run dev:web
# concurrently でサーバ (port 3001) + Vite (port 5173) を起動
```

### プロダクションビルド

```powershell
npm run electron:build
# dist-electron/ に NSIS インストーラ (Windows) を生成
```

---

## 12. 開発者向けセットアップ

### 前提条件

- Node.js 18 以降
- npm 9 以降

### インストール

```bash
git clone https://github.com/aso/UCPD-Monitor.git
cd UCPD-Monitor
npm install
cd client && npm install && cd ..
```

### 開発起動（Electron）

```bash
npm run electron:dev
```

React クライアントをビルドし Electron ウィンドウを起動します。Express サーバは Electron プロセス内で自動起動します。

### 開発起動（ブラウザ）

```bash
npm run dev:web
```

Express サーバ（ポート 3001）と Vite 開発サーバ（ポート 5173）を同時起動します。ブラウザで `http://localhost:5173` を開いてください。

### 配布ビルド

```bash
npm run electron:build
```

プラットフォーム固有のインストーラを `dist-electron/` に生成します。

| プラットフォーム | 出力 |
|---|---|
| Windows | NSIS インストーラ (`.exe`) |
| macOS | DMG イメージ |
| Linux | AppImage |

---

## 13. ディレクトリ構成

```
/
├── electron/
│   └── main.js               # Electron メインプロセス
├── server/
│   ├── index.js              # Express + WebSocket + SerialPort サーバ
│   └── cpdStreamParser.js    # Node.js Transform Stream (CPD フレーム分離)
├── client/
│   └── src/
│       ├── App.jsx            # アプリルートコンポーネント
│       ├── App.module.css
│       ├── store/
│       │   └── appStore.js   # Zustand グローバルストア
│       ├── hooks/
│       │   ├── useWebSocket.js
│       │   └── useCpdImport.js
│       ├── parsers/
│       │   └── pd_parser.js  # USB PD Rev3.2 デコーダ
│       └── components/
│           ├── TopologyView.jsx / .module.css
│           ├── MessageTable.jsx / .module.css
│           ├── Console.jsx / .module.css
│           └── SerialBar.jsx
├── logs/                      # セッション .cpd + unknown_packets.yaml
├── docs/
│   └── SPEC.md               # 本仕様書
└── package.json
```
