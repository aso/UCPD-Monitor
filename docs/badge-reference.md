# バッジ解説リファレンス — STM32CubeMonitor-UCPD

トポロジービュー（`TopologyView.jsx`）に表示されるすべてのバッジの種別・色・表示条件をまとめた参照ドキュメントです。

---

## 画面レイアウト全体像

```
╔══════════════════════════════════════════════════════════════╗
║  SOURCE ノード                                                ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │  [SrcSpecBadge]                                      │   ║
║  │  ┌──────────────────────────────────────────────┐   │   ║
║  │  │ 🏷 Vendor Name  PID  ⚠ VID mismatch         │   │   ║
║  │  │ [EPR RDY] [Cap_Ext] [DRD] [Alt Mode] [VDM]  │   │   ║
║  │  │                                    45W       │   │   ║
║  │  └──────────────────────────────────────────────┘   │   ║
║  │                                                      │   ║
║  │  [CapList — PDO行]                                   │   ║
║  │  #1 [Fixed]   5.00V   3.00A                         │   ║
║  │  #2 [Battery] 5.0–20.0V   100W      ← capBadgeChip │   ║
║  │  #3 [PPS]     3.30–11.00V   5.00A                  │   ║
║  │  ──────────── RDO: #2  3.00A ─────────────────────  │   ║
║  └──────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════╝

╔═══════════════════════╗
║  CABLE ノード          ║
║  ┌───────────────┐    ║
║  │ eMarker       │    ║   ← PropTree（チップ形式ではなく
║  │ 5A / EPR: Yes │    ║     色付きテキストで表示）
║  └───────────────┘    ║
╚═══════════════════════╝

╔══════════════════════════════════════════════════════════════╗
║  SINK ノード                                                  ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │  [SinkSpecBadge]                                     │   ║
║  │  ┌──────────────────────────────────────────────┐   │   ║
║  │  │ 🏷 Vendor Name  PID  ⚠ VID mismatch         │   │   ║
║  │  │ [EPR RDY] [Cap_Ext] [DRD] [Alt Mode] [VDM]  │   │   ║
║  │  │                                    100W      │   │   ║
║  │  └──────────────────────────────────────────────┘   │   ║
║  │                                                      │   ║
║  │  左列: SNK CAP PDO行                右列: RDO + SRC CAP│   ║
║  └──────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════╝
```

---

## ① Spec Badge（SpecBadge）

SOURCE / SINK 各ノードの最上部に表示されるコンパクトなバッジ群。  
`SrcSpecBadge` / `SinkSpecBadge` コンポーネントが担当。

**バッジ全体が非表示になる条件:** 以下をすべて満たす場合は `null` を返す  
→ `scdb/skedb` が空 かつ `eprActive=false` かつ `vdmSeen=false` かつ `drd=false` かつ `altMode=false`

### ① - A　ベンダー行 (Vendor Row)

| 表示内容 | 色 | 表示条件 |
|---|---|---|
| **Vendor Name**（社名） | `#80deea` シアン | VID が既知ベンダー辞書にヒット |
| **PID**（Product ID） | `#3a6a3a` 暗緑 | VID ヒット時、PID 値が存在 |
| **VID のみ**（16進数） | `#3a6a3a` 暗緑 | VID 未知、または社名辞書にない場合 |
| **DFP** / **UFP** | `#3a6a3a` 暗緑 | VID 情報が全くない場合（SRC→DFP / SNK→UFP） |
| **⚠ VID mismatch** | `#ff9800` オレンジ | SCDB/SKEDB の VID と Discover Identity の VID が不一致 |

### ① - B　バッジ行 (Badge Row)

```
[EPR RDY] [Cap_Ext] [DRD] [Alt Mode] [VDM]  45W
```

| バッジ | テキスト色 | ボーダー色 | 背景 | CSS クラス | 表示条件 |
|---|---|---|---|---|---|
| **EPR RDY** | `#7ab07a` 緑 | `#3a6a3a` 暗緑 | — | `sinkSpecEpr` | `eprActive=true` または SCDB/SKEDB で EPR PDP > 0 |
| **Cap_Ext** | `#90caf9` 水色 | `#2a4a6a` 紺 | — | `sinkSpecCap` | SCDB（SRC）/ SKEDB（SNK）受信済み |
| **DRD** | `#ce93d8` 紫 | `#5a3a6a` 暗紫 | — | `sinkSpecDrd` | Fixed PDO #1 の Data Role Swap ビット (B25) = 1 |
| **Alt Mode** | `#ffcc80` 橙 | `#6a4a20` 茶 | — | `sinkSpecAlt` | ID Header VDO の Alt Mode Support ビット (B26) = 1 |
| **VDM** | `#90caf9` 水色 | `#2a4a6a` 紺 | — | `sinkSpecCap` | VDM トラフィックを受信 (`vdmSeen=true`) |
| **PDP 値** (例: `45W`) | `#a5d6a7` 薄緑 | — | — | `sinkSpecPdp` | SCDB/SKEDB に SPR PDP Rating または EPR PDP Rating が存在 |

> **EPR RDY と Cap_Ext の関係**  
> `Cap_Ext` は Source/Sink Capabilities Extended メッセージ（Extended Message）を実際に受信した場合のみ表示。  
> `EPR RDY` は上記受信前でも `eprActive=true`（EPR Contract 成立）であれば表示される。

---

## ② PDO タイプチップ（capBadgeChip）

CapList 内の各 PDO 行の先頭に表示される PDO 種別チップ。  
`pdoBadge(pdo)` 関数でラベルを決定、`PDO_COLORS` で色を決定。

```
#1 [Fixed]    5.00V   3.00A
#2 [Battery]  5.0–20.0V   100W
#3 [Variable] 3.0–20.0V   3.00A
#4 [PPS]      3.30–11.00V   5.00A
#5 [AVS]      15.00–48.00V   140W
#6 [SPR-AVS]  3.30–20.00V
```

| PDO 種別 | 表示ラベル | テキスト色 | 意味 |
|---|---|---|---|
| `Fixed` | `Fixed` | `#80deea` シアン | 固定電圧 PDO (SPR) |
| `Battery` | `Battery` | `#ffcc80` オレンジ | バッテリー PDO（电力ベース） |
| `Variable` | `Variable` | `#b39ddb` ラベンダー | 可変電圧 PDO |
| `APDO_PPS` | `PPS` | `#a5d6a7` 薄緑 | Programmable Power Supply |
| `APDO_AVS` | `AVS` | `#f48fb1` ピンク | Adjustable Voltage Supply (EPR) |
| `APDO_SPR_AVS` | `SPR-AVS` | `#ce93d8` 薄紫 | SPR Adjustable Voltage Supply |

チップのスタイル: テキスト色・ボーダー=`PDO_COLORS[type]`、背景=`PDO_COLORS[type] + '22'`（22% 透過）

---

## ③ e-Marker / Cable バッジ（PropTree カラーテキスト）

CABLE ノードのプロパティツリー内に表示される。チップ形式ではなくカラーテキストで表示。

| プロパティ | 色 | 表示内容・条件 |
|---|---|---|
| `eMarker` | `#4caf50` 緑 | 検出時: `Detected` |
| `SOP Traffic` | `#4caf50` 緑 | 検出 SOP チャンネル: `SOP'` / `SOP''` |
| `Type` | デフォルト | `Active` または `Passive` |
| `Current Rating: 5A` | `#ffb74d` 橙 | `cableCurrentMa >= 5000` |
| `Current Rating: 3A` | `#a5d6a7` 薄緑 | `3000 <= cableCurrentMa < 5000` |
| `Current Rating: Default (< 3A)` | `#888` グレー | `cableCurrentMa` が未定義 |
| `EPR Capable: Yes` | `#ff9800` オレンジ | `eMarker.eprCapable === true` |
| `EPR Capable: No` | `#888` グレー | `eMarker.eprCapable === false` |
| `Max VBUS` | デフォルト | `eMarker.maxVbusV` が存在する場合 |

---

## ④ Mode バッジ（PropTree — SOURCE/SINK 共通）

パネル左側のプロパティツリーの `Mode` 行に表示される。チップではなくテキスト色のみ。

| 値 | 色 | 条件 |
|---|---|---|
| `EPR` | `#ff9800` オレンジ | `source.eprActive === true` |
| `SPR` | `#a5d6a7` 薄緑 | `source.contract` が存在かつ EPR でない |

---

## バッジ色サマリー（クイックリファレンス）

```
色見本     色コード    使われるバッジ
─────────  ─────────  ─────────────────────────────────────
■ シアン   #80deea    Fixed PDO、Vendor Name
■ 薄緑     #7ab07a    EPR RDY
■ 水色     #90caf9    Cap_Ext、VDM
■ 紫       #ce93d8    DRD、SPR-AVS PDO
■ 橙 (薄)  #ffcc80    Alt Mode、Battery PDO
■ ピンク   #f48fb1    AVS PDO
■ ラベンダー #b39ddb  Variable PDO
■ 薄緑     #a5d6a7    PDP値、PPS PDO、SPR Mode、3A Cable
■ オレンジ #ff9800    EPR Mode、EPR Capable、VID mismatch
■ 橙 (明)  #ffb74d    5A Cable
■ グレー   #888       EPR Capable: No、Default Cable
```

---

## ソースコード対応一覧

| バッジ | コンポーネント/関数 | CSS クラス |
|---|---|---|
| SrcSpecBadge 全体 | `SrcSpecBadge()` L.706 | `sinkSpecBadge` |
| SinkSpecBadge 全体 | `SinkSpecBadge()` L.762 | `sinkSpecBadge` |
| Vendor Name | — | `sinkSpecVendorName` |
| PID / VID 表示 | — | `sinkSpecPid` |
| ⚠ VID mismatch | — | `sinkSpecWarn` |
| EPR RDY | — | `sinkSpecEpr` |
| Cap_Ext / VDM | — | `sinkSpecCap` |
| DRD | — | `sinkSpecDrd` |
| Alt Mode | — | `sinkSpecAlt` |
| PDP 値 | — | `sinkSpecPdp` |
| PDO type chip | `pdoBadge()` L.102 + `PDO_COLORS` L.73 | `capBadgeChip` |
| e-Marker 各行 | `buildCableItems()` L.397 | PropTree（色テキスト） |
| Mode (EPR/SPR) | `buildSourceItems()` L.142 | PropTree（色テキスト） |
