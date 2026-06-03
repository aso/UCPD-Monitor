# USB PD テストレポート出力 — デザイン資料

**対象バージョン:** UCPD-Monitor v3.2.7+  
**参照規格:** USB Power Delivery Rev 3.2 V1.2 (USB-IF, 2023-10)  
**作成日:** 2026-04-19

---

## 1. USB.org 公式スタイルの分析

### 1.1 USB PD 規格書 (R3.2) の通信表現スタイル — 実物確認済み3形式

**参照元:** USB PD R3.2 V1.0, 2023-10  
- Chapter 8 §8.3.2.12.4.3, Figure 8-76 / Table 8.104 (p.703–705) — プロトコル詳細図  
- Appendix B "PD Message Sequence Examples", Table B-1 (pp.1063–1066) — 運用シナリオ表

USB PD 仕様書は通信シーケンスを **3つの独立した形式** で表現している。これらは同一の通信を異なる抽象度で描く補完的な関係にある。

---

#### (A) Chapter 8 スタイル: 縦型UMLシーケンス図 + 同伴ステップテーブル (規格本文の主形式)

**実物確認済み: Figure 8-76 "Source Gets Sink's Extended Capabilities" (p.703)**

Figure 8-76 は UML インタラクション図スタイルの縦型シーケンス図である。  
縦方向に時間が流れ、参加者が内部レイヤ (Policy Engine / Protocol / PHY) まで細分化されている。

```
【Figure 8-76 の構造 (テキスト再現)】

        Source Port                                    Sink Port
  :Policy Engine | :Protocol | :PHY    |    :PHY | :Protocol | :Policy Engine
        │               │         │    |    │         │              │
        │ 1:Send        │         │    |    │         │              │
        │ Get_Sink_     │         │    |    │         │              │
        │ Cap_Extended  │         │    |    │         │              │
        │──────────────>│         │    |    │         │              │
        │         2:Get_Sink_Cap_Extended   |    │         │              │
        │               │─────────────────────>│         │              │
        │         [Start CRCReceiveTimer]   |    │         │              │
        │               │         │    |    │ 4: fwd  │              │
        │               │         │    |    │─────────>│              │
        │               │         │    |    │         │ 5: CheckMsgID │
        │               │         │    |    │         │ StoreMsg      │
        │               │         │    |    │         │──────────────>│
        │               │         │    |    │  6:GoodCRC              │
        │               │         │<────────────────────              │
        │               │ 8:GoodCRC         |    │         │              │
        │<──────────────│         │    |    │         │              │
        │  [Check & Increment MsgIDCounter] |    │         │              │
        │  [Stop CRCReceiveTimer]           |    │         │              │
        │    9:Get_Sink_Cap_Extended sent   |    │         │              │
        │<──────────────│         │    |    │         │              │
        │ [Start SenderResponseTimer]       |    │         │              │
        …                                  |    …
        │               │         │    |    │         │ 10:Send       │
        │               │         │    |    │         │ Sink_Cap_Ext  │<─(DPM)
        …
        │  14: Sink_Cap_Ext received        |    │         │              │
        │<──────────────│         │    |    │         │              │
        │ [Stop SenderResponseTimer]        |    │         │              │
```

**Figure スタイルの特徴:**

1. **UML インタラクション図**: 縦方向が時間軸、参加者は横方向のライフライン
2. **内部レイヤ分割**: 各ポートを Policy Engine / Protocol / PHY の3レーンに分解  
   → プロトコル処理の内部動作 (MessageID検証、タイマー制御) が可視化される
3. **黄色ボックス**: 内部状態変化 (タイマー開始/停止、カウンタ操作) を黄色で強調
4. **番号付き矢印**: 各矢印に通し番号 (1, 2, 3 …) — Table 8.104 のステップ番号と対応
5. **同伴テーブル (Table 8.104)**: 図の各番号に対する詳細説明を「Sink Port | Source Port」2列で記述

**同伴ステップテーブル (Table 8.104) の構造:**

| Step | Sink Port | Source Port |
|---|---|---|
| 1 | The Port has *Port Power Role* set to Source… Policy Engine directs Protocol Layer to send a *Get_Sink_Cap_Extended* Message. | The Port has *Port Power Role* set to Sink with R_d pull down… |
| 2 | Protocol Layer creates the Message and passes to Physical Layer. | |
| 3 | Physical Layer appends CRC and sends… Starts *CRCReceiveTimer*. | Physical Layer receives the message and checks CRC. |
| … | | |
| 14 | The Policy Engine stops the *SenderResponseTimer*. | |
| *結論行* | **The Sink has informed the Source of its extended capabilities.** | |

**Table 8.104 スタイルの特徴:**

- **列 = ポート (役割)**: Sink Port / Source Port の2列 (役割ベース、機器名ベースでない)
- **行 = 図の番号**: Figure の番号と1対1対応
- **内部処理の記述**: PHYレイヤのCRC付加/検証、MessageIDCounterの管理まで記述
- **タイマー名を italic 表記**: *CRCReceiveTimer*, *SenderResponseTimer*, *MessageIDCounter*
- **結論行**: テーブル末尾にティール背景で「このシーケンスで達成されたこと」を1行で要約

---

#### (B) Appendix B スタイル: 横型「ステップ×参加者」テーブル (運用シナリオの主形式)

**実物確認済み: Table B-1 "External power is supplied downstream" (pp.1064–1066)**

機器名ベースの参加者列 (Laptop / Display 1 / Display 2) を横に並べ、各ステップでの状態変化を記述するシナリオ表。Policy Engine の判断根拠 (DPM列) と累積電力 (Power(W)列) を含む。

---

**テーブル構造 (Table B-1 を抜粋):**

| Step | Laptop (Source) | Display 1 (Sink/Hub) | Display 2 | Device Policy Manager | Power (W) |
|---|---|---|---|---|---|
| 1 | Connected to wall supply | Detached | Detached | | 0 |
| 2 | Display 1 Attached, V_BUS powered. | Attached, drawing 5V@150mA. | Detached | | 0.75 |
| 3 | Set of Source Capabilities sent: 5V@3A, 9V@3A, 15V@3A, 20V@3A. | Source Capabilities received | Detached | Laptop determines capabilities based on wall supply presence. | 0.75 |
| 4 | Request received | Requests 15V@2A (30W) from laptop | Detached | Display 1 evaluates capabilities → 15V@2A available. | 0.75 |
| 5 | Sends Accept | Accept received | Detached | Waiting for PS_RDY before drawing additional power. | 0.75 |
| 6 | Sends PS_RDY | PS_RDY received. Starts drawing 15V@2A. Display 1 turns on. | Detached | Laptop evaluates request → can meet it → Accept. | 30 |
| *Display 2* | | | | | |
| 7 | Powering Display 1 | Detects Attach | Attached, no V_BUS | | 30 |
| 8 | Request received | Display 1 requests 20V@1.73A (34.6W) from Laptop. | Attached, no V_BUS | Display 1 detects Attach, requests additional 4.5W for USB 3.2 Port. | 30 |
| … | | | | | |
| 24 | Sends PS_RDY. Drawing 20V@3A from laptop. | PS_RDY received. Starts drawing 15V@2A, turns on. | Display 2 now has the power it needs and can start working. | | 60 |
| *USB Suspend* | | | | | |
| 25 | Laptop OS goes into suspend (S3), V_BUS remains on, USB bus suspended. | Draws 50mW to maintain PDUSB Hub functions. | Draws 25mW to maintain USB/PD functions. | No changes in Contract. Power reduction based on USB state. | 60 |
| 26 | Laptop OS wakes up. USB is woken up. | Returns to drawing 20V@3A. | Returns to drawing 15V@2A. | No changes in PD Contract. Purely USB bus state. | 60 |

**特徴・ルール (仕様書 Appendix B より確認):**

1. **列 = 参加者**: 左から Source, Sink(中継Hub含む), 下流Sink, DPM説明列, 累積Power(W)
2. **行 = ステップ**: 同一行 = 因果関係のある一連のアクション (送受信の対)
3. **グループ見出し行**: フェーズ区切り ("Display 1", "Display 2", "USB Suspend") を  
   スパン行でカラー強調 — 仕様書では青/ティール背景
4. **DPM列 (Device Policy Manager)**: 「なぜそのメッセージを送るか」のポリシー判断根拠を記述。  
   プロトコルフレームではなく実装意図を説明する列
5. **Power(W)列**: 累積消費電力を定量的に追跡 (0.75 → 30 → 34.6 → 60)
6. **電圧@電流表記**: `15V@2A (30W)` 形式 — 仕様書全体で統一
7. **変化セルのみ記述**: 前ステップから変化のない参加者のセルは空白で省略
8. **V_BUS 表記**: 規格書は添字 (V_BUS); テキストでは `VBUS` または `V_BUS` で代替

**注記**: Appendix B は non-normative (実装例)。同文書冒頭に「Normative requirements は含まない」と明記。

---

#### (C) 参照形式: Protocol Analyzer テーブル (実装ツール標準)

Teledyne LeCroy QuadraView / Ellisys Explorer 等の業界標準ツールが出力する低レイヤ記録形式。
UCPD-Monitor の MessageTable が対応するのはこの層。

| # | Timestamp | SOP | Dir | Type | Header (hex) | Payload Summary |
|---|-----------|-----|-----|------|-------------|-----------------|
| 1 | 14:32:01.000 | SOP | SRC→SNK | Source_Capabilities | 0x61A1 | PDO#1:5V/3A PDO#2:9V/3A PDO#3:15V/3A PDO#4:20V/3A |
| 2 | 14:32:01.003 | SOP | SNK→SRC | GoodCRC | 0x0141 | MessageID=0 |
| 3 | 14:32:01.005 | SOP | SNK→SRC | Request | 0x0161 | PDO#3 Op:2.000A Max:3.000A (15V@2A) |
| 4 | 14:32:01.008 | SOP | SRC→SNK | GoodCRC | 0x0121 | MessageID=0 |
| 5 | 14:32:01.010 | SOP | SRC→SNK | Accept | 0x0161 | |
| 6 | 14:32:01.456 | SOP | SRC→SNK | PS_RDY | 0x01A1 | |

**色分け規則 (業界標準):**

| カテゴリ | 背景色 | 対象 |
|---|---|---|
| Source Data | #FFE8E8 (薄赤) | Source_Capabilities, PS_RDY (SRC→SNK) |
| Sink Data | #E8E8FF (薄紫) | Request, Sink_Capabilities |
| Control | #E8F4F8 (薄青) | GoodCRC, Accept, Reject, Not_Supported |
| SOP' Cable | #FFF3CD (薄黄) | SOP'/SOP'' フレーム (eMarker通信) |
| Violation | #FFD0D0 (赤) | parseViolations[] を持つフレーム |
| Note/Event | #F0F0F0 (灰) | ユーザーメモ (NOTE:)、ATTACHEDイベント |

---

#### (D) 三層構造の統合方針

公式仕様書の3形式は抽象度が異なる補完的な関係にある。UCPD-Monitor のレポートはこの三層を統合する:

```
[Layer 1 — プロトコル詳細層]  ← Chapter 8 Figure 8-76 / Table 8.104 スタイル
  • タイマー・MessageID・GoodCRC まで含む完全なプロトコル動作
  • UCPD-Monitor では MessageTable (既存) がこの層に相当
  • レポートには「Message Log」セクションとして出力

[Layer 2 — シナリオ/ポリシー層]  ← Appendix B Table B-1 スタイル
  • ポリシーレベルのシナリオ記述 (コントラクト変化を Step 表で追跡)
  • 電圧@電流@電力 形式 (15V@2A (30W))
  • Phase 見出し (Initial Attach / Re-negotiation / VDM)
  • DPM相当の解釈コメント (parsedPayload から自動生成)
  • レポートには「Contract History」セクションとして出力

[Layer 3 — アナライザ出力層]  ← Protocol Analyzer スタイル
  • タイムスタンプ付き全フレームの色分けテーブル
  • parseViolations[] 付き
  • レポートには「Message Log」セクションとして出力 (Layer 1 と統合)
```

**実装優先度**: Layer 2 (Contract History テーブル) → Layer 3 (Message Log テーブル) → Layer 1 (Figure相当のSVGシーケンス図)

### 1.2 USB-IF Compliance Test Report の構成 (QuadraMAX 準拠)

```
1. Cover Page
   ├── Test Date / Time (tsAnchor.wallMs → ISO 8601)
   ├── DUT 情報 (Discover Identity から自動抽出)
   │   ├── VID / PID / XID / bcdDevice
   │   └── Cable Type (Passive / Active / eMarker)
   ├── Memo / DUT Description (replayNote)
   └── Session File (.cpd ファイル名)

2. Device Information
   ├── Source PDO Table  (5V@3A, 9V@3A … 形式)
   ├── Sink PDO Table
   └── Negotiated Contract (PDO#N → V@A = W, EPR/FRS フラグ)

3. Contract History  ← Appendix B スタイル (Layer 2)
   Step × Participant × DPM × Power(W) テーブル
   コントラクト変化ステップを messages[] から自動検出して生成

3a. [オプション] Sequence Diagram  ← Chapter 8 Figure スタイル (Layer 1)
    SRC / SNK / Cable ライフライン + 番号付き矢印のSVG図
    GoodCRC 省略、コントラクトシーケンスのみ表示

4. Message Log  ← Protocol Analyzer スタイル (Layer 3)
   全フレームのタイムスタンプ付きテーブル

5. Compliance Findings
   ├── 自動チェック Pass/Fail リスト
   └── parseViolations[] 詳細

6. Raw Data
   └── .cpd セッションファイル名 + サイズ
```

---

## 2. UCPD-Monitor データと Appendix B スタイルの対応

### 2.1 「ステップ表」自動生成マッピング

| Appendix B 列 | 生成元データ | 具体例 |
|---|---|---|
| Step 番号 | コントラクト変化イベントの連番 | 1, 2, 3 … |
| Source 列 | SRC→SNK メッセージの typeName + pdoSummary | "Source_Capabilities: 5V@3A, 9V@3A, 15V@3A" |
| Sink 列 | SNK→SRC メッセージの typeName + pdoSummary | "Request: 15V@2A (30W)" |
| DPM 列 | RDO.label + resolvedPdo + violation | "PDO#3 selected. Op:2.00A Max:3.00A" |
| Power (W) | resolvedPdo.vMv × rdo.opCurrent_mA / 1e6 | 30.0 |
| Phase 見出し | ATTACHED EVENT / コントラクト確立 / VDM開始 | "Initial Contract" / "Re-negotiation" |

**コントラクト変化シーケンスの検出:**

```
Source_Capabilities → Request → Accept → PS_RDY
  を1コントラクトシーケンスとして認識。
VDM Discover Identity ACK が存在する場合:
  → "Device Discovery" フェーズ見出し行を挿入。
ATTACHED EVENT が存在する場合:
  → "Connection" フェーズ見出し行を挿入。
```

### 2.2 プロトコルレイヤ対応表

各 `PdMessage` オブジェクトから以下フィールドをレポートに変換:

| レポートフィールド | ソースフィールド | 変換ロジック |
|---|---|---|
| Timestamp | `msg.ts` + `tsAnchor` | `formatTs(ts, anchor)` → `HH:MM:SS.mmm` |
| SOP | `msg.cpd.sopQualName` | `"SOP"` / `"SOP'"` / `"SOP''"` |
| Dir | `msg.cpd.dirName` | `"SRC→SNK"` / `"SNK→SRC"` |
| Type | `msg.header.typeName` | `"Source_Capabilities"` 等 |
| Header (hex) | `msg.raw` | 先頭4バイト → `0xXXXX` |
| Payload Summary | `msg.pdoSummary` | `"PDO#1:5V/3A PDO#2:9V/3A …"` |
| Violation | `msg.parseViolations[]` | `"⚠ …"` 文字列配列 |
| Power (W) | resolvedPdo + rdo | `(vMv * opMa / 1e6).toFixed(1)` |
| V@A 表記 | resolvedPdo + rdo | `"15V@2.00A (30.0W)"` |

### 2.3 DUT情報の自動抽出 (Discover Identity より)

```
Source DUT:
  VID       = topology.source.discId.vid       (0x0483 → "STMicro")
  PID       = topology.source.discId.pid
  XID       = topology.source.discId.xid
  bcdDevice = topology.source.discId.bcdDevice

Sink DUT:
  VID       = topology.sink.discId.vid
  (同様)

Cable (eMarker, SOP'):
  Type      = "Passive" / "Active"
  VBUSCurr  = "3A" / "5A"
  USBSpeed  = "USB3.2 Gen2"
  Latency   = "<10ns (~1m)"
  EPRCap    = Yes / No
```

---

## 3. レポートHTML設計

### 3.1 ページ構成イメージ

```
┌────────────────────────────────────────────────────────┐
│  [Cover]                                               │
│  UCPD Monitor — USB PD Session Report                  │
│  Session: 2026-04-19 14:32:01 JST                      │
│  Memo: "EUT: Laptop ABC FW v1.2 / Charger XYZ"        │
│  File: session_2026-04-19T14-32-01.cpd                 │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  [Section 1] Device Information                        │
│  Source: VID:0x0483 (STMicro) | PID:0x0002            │
│  Sink:   VID:0x04E8 (Samsung) | PID:0x1234            │
│  Cable:  Passive 5A, USB3.2Gen2, Latency<10ns          │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  [Section 2] Power Contract Summary                    │
│  Source Capabilities:                                  │
│    PDO#1: Fixed   5.00V  3.00A  15.0W  [UCPwr USB-Comm]│
│    PDO#2: Fixed   9.00V  3.00A  27.0W                  │
│    PDO#3: Fixed  15.00V  3.00A  45.0W                  │
│    PDO#4: Fixed  20.00V  5.00A 100.0W  [EPR]           │
│    PDO#5: APDO_PPS  3.3–11.0V  5.00A                   │
│  ★ Negotiated: PDO#3 → 15V@2.00A = 30.0W              │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  [Section 3] Contract History  ← Appendix B スタイル  │
│                                                        │
│  Step │ Source (SRC)           │ Sink (SNK) │ Power   │
│  ─────┼────────────────────────┼────────────┼──────── │
│  ■ Initial Attach              │            │         │
│    1  │ ATTACHED               │ Detected   │   0.75W │
│    2  │ Source_Caps:           │            │   0.75W │
│       │ 5V@3A/9V@3A/15V@3A    │            │         │
│    3  │                        │ Request:   │   0.75W │
│       │                        │ 15V@2A(30W)│         │
│    4  │ Accept                 │            │   0.75W │
│    5  │ PS_RDY ──────────────→│ 15V@2A     │  30.0W  │
│  ■ Re-negotiation             │            │         │
│    6  │                        │ Request:   │  30.0W  │
│       │                        │ 20V@3A(60W)│         │
│    7  │ Accept                 │            │  30.0W  │
│    8  │ PS_RDY ──────────────→│ 20V@3A     │  60.0W  │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  [Section 4] Message Log  ← Protocol Analyzer スタイル│
│                                                        │
│   # │ Timestamp    │ SOP  │ Dir     │ Type            │
│  ───┼──────────────┼──────┼─────────┼──────────────── │
│   1 │ 14:32:01.000 │ SOP  │ SRC→SNK │ Source_Cap      │
│   2 │ 14:32:01.003 │ SOP  │ SNK→SRC │ GoodCRC         │
│   3 │ 14:32:01.005 │ SOP  │ SNK→SRC │ Request         │
│  …                                                     │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  [Section 5] Compliance Findings                       │
│  ✅ vSafe5V PDO#1 present (R3.2 §6.4.1)               │
│  ✅ RDO Object Position in range 1–N                   │
│  ✅ Op Current ≤ PDO Max Current                       │
│  ⚠  EPR_Source_Cap not found (5A cable detected)      │
└────────────────────────────────────────────────────────┘
```

### 3.2 Contract History テーブルの自動生成ロジック

```
function buildContractHistory(messages) {
  const steps = [];
  let phase = 'Connection';

  // 1. ATTACHED イベントを起点とした Phase 分割
  // 2. Source_Cap → Request → Accept → PS_RDY を1シーケンスとして抽出
  // 3. VDM Discover Identity ACK → "Device Discovery" フェーズ挿入
  // 4. 各シーケンスから:
  //      source列 = typeName + 最初の3PDO を "V@A" 形式で列挙
  //      sink列   = "Request: " + rdo.label  (例: "15V@2.00A (30.0W)")
  //      power列  = resolvedPdo.vMv * rdo.opCurrent_mA / 1e6
  //      dpm列    = "PDO#N selected." + capMismatch警告など

  return steps; // { phase, stepNum, source, sink, dpm, powerW }[]
}
```

---

## 4. 規格適合チェックリスト設計

### 4.1 必須チェック項目 (USB PD R3.2 準拠)

| ID | 条文 | 確認内容 | 判定ロジック |
|---|---|---|---|
| C01 | §6.4.1 | Source_Cap PDO#1 は 5V 固定PDO | `srcCaps[0].vMv === 5000 && pdoType === 'Fixed'` |
| C02 | §6.4.2 | RDO Object Position が 1～N | `rdo.objPos >= 1 && rdo.objPos <= srcCaps.length` |
| C03 | §6.4.2 | 要求電流 ≤ PDO 最大電流 | `rdo.opCurrent_mA <= resolvedPdo.iMa` |
| C04 | §8.3.2 | tSenderResponse < 26ms | `acceptTs - requestTs < 26` |
| C05 | §8.3.2 | tPSTransition < 550ms | `psRdyTs - acceptTs < 550` |
| C06 | §6.4.1 | 5Aケーブル検出時はEPR_Source_Cap存在 | `eMarker.vbusCurr >= 5A → hasEprCap` |
| C07 | §6.4.4.3 | Disc.Identity ACK の VDO 数が最低3個 | `vdos.length >= 3` |
| C08 | §6.4.1 | PDO#1 の NoUsbSuspend/UsbCommsCapable | `pdo1.usbSuspend === false` |

**注意:** STM32CubeMonitor-UCPDは通常GoodCRCを捕捉しないため、タイムアウト計測 (C04/C05) はベストエフォート。

---

## 5. 実装計画

### フェーズ1: HTMLレポートエクスポート (推奨着手点)

**新規ファイル:** `client/src/report/generateReport.js`

```
入力:
  topology   ← useAppStore.topology
  messages   ← useAppStore.messages (PdFrame[])
  tsAnchor   ← useAppStore.tsAnchor
  replayNote ← useAppStore.replayNote

出力:
  単体HTMLファイル (CSS埋め込み) → Blob → <a download> 発火
  ファイル名: ucpd-report-YYYY-MM-DD.html
```

**UIトリガー:** トップバー右端に `📄 Export` ボタン追加

### フェーズ2: SVGシーケンス図 (オプション)

Section 3 内に埋め込む簡易MSC。コントラクトシーケンスのみ (GoodCRC省略)。

**新規ファイル:** `client/src/report/sequenceSvg.js`

### フェーズ3: 規格適合チェック

**新規ファイル:** `client/src/report/complianceCheck.js`

---

## 6. 参考資料

- **USB PD R3.2** Revision 3.2 V1.0 (2023-10), USB-IF  
  Appendix B "PD Message Sequence Examples" pp.1063–1066 — 本資料の直接参照元  
  `https://www.usb.org/document-library/usb-power-delivery`
- **USB Type-C R2.2** USB Type-C Cable and Connector Specification Release 2.2 (2022-10), USB-IF
- **QuadraMAX** Non-PPS Test Manual, USB-IF  
  `https://www.usb.org/document-library/quadramax-manual`
