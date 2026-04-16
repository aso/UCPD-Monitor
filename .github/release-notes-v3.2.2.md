## What's New in v3.2.2

### Spec Badges — DRD & Alt Mode

- **DRD** バッジ (紫): `Source_Capabilities` / `Sink_Capabilities` PDO#1 B25 (`dualRoleData`) = 1 の機器ボックスに表示
- **Alt Mode** バッジ (オレンジ): Discover Identity ACK の ID Header VDO B26 (`ModalOperation`) = 1 の機器ボックスに表示

### Discover SVIDs / Modes — 2段階ツリー展開

Discover Identity と同様の ▸/▾ クリック展開ツリーを全 VDM ACK に適用:

| メッセージ | セクションヘッダー | フィールド行 |
|---|---|---|
| Discover SVIDs | `SVID VDO[N]` | `SVID[upper]` / `SVID[lower]` (end-of-list 明示) |
| Discover Modes (DP) | `Mode 1: DP Capabilities VDO` | UFP_D / DFP_D / Receptacle / DP Signaling |
| Discover Modes (汎用) | `Mode N` | Raw |

`⚠ Spec violation` 警告行はセクション前の全幅行として表示。

### Fixed

- **Sink `Cap_Ext` バッジ誤点灯**: RDO の `unchunkedExt` ビットで誤判定 → `Sink_Capabilities_Extended` の実受信時のみ点灯するよう修正

---
See [CHANGELOG.md](CHANGELOG.md) for full details.
