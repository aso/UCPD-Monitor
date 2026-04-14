# UCPD-Monitor

[English](README.md) | [日本語](README.ja.md)

STM32 UCPD ハードウェアが生成する USB Power Delivery (PD) 通信をリアルタイムで監視・解析するクロスプラットフォーム Electron デスクトップアプリケーションです。

STM32CubeMonitor-UCPD が出力する `.cpd` バイナリストリームをデコードし、ライブの Connection View・フルデコードされたメッセージテーブル・クリップボードエクスポートを提供します。STM32CubeMonitor-UCPD 本体がなくても動作します。

---

## 背景

STMicroelectronics の **STM32G071B-DISCO** は USB Power Delivery プロトコルの簡易アナライザ機能を内蔵しており、**SPY モード**で CC ラインを傍受できます。PC 側のアプリケーション **STM32CubeMonitor-UCPD** と USB-UART 接続することで、PD パケットのキャプチャと解析が可能です。

しかし、STM32CubeMonitor-UCPD のバージョン 1.4 時点では **PD 2.0 / PD 3.0** までしか対応しておらず、**USB PD Rev 3.2** で追加された EPR (Extended Power Range)・AVS (Adjustable Voltage Supply)・拡張メッセージ等を正しくデコードできません。また、アプリケーションの開発・更新は停止しています。

本プロジェクトはこの制限を解消するために開発されました。STM32CubeMonitor-UCPD が出力する `.cpd` バイナリストリームをそのまま受け取り、**USB PD Rev 3.2 準拠の独自デコーダ**でフルデコードします。

---

## 機能

- **ライブシリアル監視** — STM32 UCPD デバイスを USB-UART で接続してリアルタイムに PD フレームを受信
- **`.cpd` ファイルインポート** — STM32CubeMonitor-UCPD が保存した `.cpd` バイナリファイルをドラッグ＆ドロップまたはファイル選択で再生。サーバサイド解析によりリングバッファの不整合なし
- **USB PD Rev 3.2 デコーダ** — コントロール・データ・拡張メッセージを完全デコード。EPR / PPS / AVS に対応
- **Connection View** — Source / Cable (eMarker) / Sink の接続状態・PDO 能力・電力契約をビジュアル表示。PS_RDY 確定後は SOURCE ノードに出力電圧・電流／電力を、SINK ノードに要求電圧・計算電力をリアルタイム表示
- **メッセージテーブル** — [@tanstack/react-virtual](https://tanstack.com/virtual) による高性能仮想スクロールは 1,000 行超でもスムーズ。PDO/RDO 子行展開・ O(n) RDO → Source PDO 逆引き
- **行選択＆クリップボードコピー** — クリック/Shift+クリックで範囲選択、Ctrl+C または右クリックで TSV コピー（`DATA:HEX` RAW データ付き）
- **自動スクロール＆最新へジャンプ** — 最新メッセージへ自動追従。手動スクロール後はフローティングボタンで復帰
- **セッションファイル自動保存** — ライブデータをタイムスタンプ付き `.cpd` ファイルへ自動保存。後でそのまま再インポート可能
- **不明パケットログ** — パース不能なフレームを `logs/unknown_packets.yaml` へ記録
- **パネルトグル** — Connection View/コンソールパネルを個別に表示/非表示

---

## 技術スタック

| コンポーネント | 技術 |
|---|---|
| デスクトップシェル | Electron 41 |
| UI フレームワーク | React 19 + Vite 8 |
| 状態管理 | Zustand |
| 仮想スクロール | @tanstack/react-virtual |
| バックエンド | Express 4 + Node.js |
| リアルタイム通信 | WebSocket (`ws`) |
| シリアル通信 | `serialport` 13 |
| パッケージング | electron-builder |

---

## セットアップ

[Releases](https://github.com/aso/UCPD-Monitor/releases) ページから最新のインストーラをダウンロードして実行してください。

| プラットフォーム | ファイル |
|---|---|
| Windows | NSIS インストーラ (`.exe`) |
| macOS | DMG イメージ |
| Linux | AppImage |

インストール完了後、**UCPD-Monitor** を起動してください。

---

## 使い方

### デバイスへの接続

1. STM32 UCPD デバイスを USB ポートに接続する
2. タイトルバーのドロップダウンから COM ポートを選択する
3. **Connect** をクリックする → リアルタイムで PD フレームが表示される

### `.cpd` ファイルのインポート

- タイトルバーの **.cpd Import** ボタンをクリック、または
- ウィンドウ上に `.cpd` ファイルをドラッグ＆ドロップする

ファイル全体がサーバサイドで解析され `HISTORY` メッセージとして再生されます。DETACHED/ATTACHED イベントはそのまま保持され、リングバッファによる切り捨ては発生しません。

### メッセージのコピー

1. 行をクリックして選択。Shift+クリックで範囲選択。
2. **Ctrl+C** を押すか、右クリックして **Copy N rows** を選ぶ。

各行はタブ区切り（TSV）でコピーされます:

```
#id   Timestamp   Dir   SOP   Rev   MsgID   Type   #DO   Parsed Summary   DATA:HEXRAW
```

パース済サマリがない行は、サマリカラムに `DATA:HEXRAW` 形式で生データを表示します。

---

## `.cpd` バイナリフォーマット

`.cpd` ストリームの 1 レコードのレイアウト:

```
オフセット  サイズ  フィールド
--------   ------  -------------------------------------------
00-03        4     SOF:        FD FD FD FD (固定)
04           1     Tag:        ((PortNum+1) << 5) | 0x12
                               Port 0 → 0x32 / Port 1 → 0x52
05-06        2     Length:     BE uint16 = PayloadLen + 9
07           1     Type:       0x07=SRC→SNK / 0x08=SNK→SRC
                               0x06=ASCII_LOG / 0x03=EVENT
08-0B        4     Timestamp:  LE uint32 (起動からの経過時間ミリ秒, ms-since-boot)
0C           1     PortNum:    0x00=Port 0 / 0x01=Port 1
0D           1     SopQual:    0x00=SOP / 0x01=SOP' / 0x02=SOP''
0E-0F        2     Size:       BE uint16 = PayloadLen (ペイロードバイト数)
10+          N     Payload:    USB-PD メッセージバイト列 または ASCII 文字列
10+N+        4     EOF:        A5 A5 A5 A5
```

1 フレームの総バイト数: **20 + PayloadLen** バイト

---

## プロジェクト構成

```
/
├── electron/
│   └── main.js               # Electron メインプロセス
├── server/
│   ├── index.js              # Express + WebSocket + SerialPort サーバ
│   └── cpdStreamParser.js    # CPD フレーム分離 Transform Stream
├── client/
│   └── src/
│       ├── App.jsx            # アプリルートコンポーネント
│       ├── store/appStore.js  # Zustand グローバルストア + 接続状態機械
│       ├── hooks/
│       │   ├── useWebSocket.js
│       │   └── useCpdImport.js
│       ├── parsers/pd_parser.js  # USB PD Rev 3.2 デコーダ
│       └── components/
│           ├── TopologyView.jsx
│           ├── MessageTable.jsx
│           ├── Console.jsx
│           └── SerialBar.jsx
├── logs/                      # セッション .cpd + unknown_packets.yaml
├── docs/
│   └── SPEC.md               # 詳細仕様書（日本語）
└── package.json
```

---

## 対応 PD メッセージ

### コントロールメッセージ
GoodCRC, Accept, Reject, PS_RDY, Soft_Reset, Hard_Reset, DR_Swap, PR_Swap, VCONN_Swap, Wait, Not_Supported, Get_Source_Cap, Get_Sink_Cap, Get_Source_Cap_Extended, Get_Status, FR_Swap, Get_PPS_Status, Data_Reset、および EPR 拡張コントロールメッセージ等

### データメッセージ
Source_Capabilities, Sink_Capabilities, Request, EPR_Request, BIST, Alert, Battery_Status, Get_Country_Info, Enter_USB, EPR_Mode, Source_Info, Revision, VDM (Structured)

### 拡張メッセージ
Source_Capabilities_Extended (SCEDB), Status, PPS_Status, Battery_Capabilities, Manufacturer_Info, Sink_Capabilities_Extended, Country_Info, Country_Codes, Security_*, Firmware_Update_*, Extended_Control

### PDO / RDO 種別
Fixed, Variable, Battery, APDO (PPS), APDO (AVS/SPR), APDO (SPR-AVS) — 全フィールド完全デコード。Battery RDO は 250 mW 単位の電力フィールド (opPower_mW / limPower_mW) を保持。

---

## ドキュメント

詳細なシステム設計・API・データフロー・状態機械の仕様については [docs/SPEC.md](docs/SPEC.md) を参照してください。

---

## ライセンス

MIT — 詳細は [LICENSE](LICENSE) を参照してください。

---

## 関連リンク

- [STM32CubeMonitor-UCPD](https://www.st.com/en/development-tools/stm32cubemonitor-ucpd.html) — STMicroelectronics 公式モニタリングツール
- [USB Power Delivery Specification Rev 3.2](https://www.usb.org/document-library/usb-power-delivery)
