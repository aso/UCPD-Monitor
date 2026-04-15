## What's New in v3.2.1

### VDM Discover Identity — PD Rev 3.2 §6.4.4.3 完全デコード

全 VDO を仕様 Table 番号に準拠してフィールド単位でデコード:

| VDO | Table |
|-----|-------|
| ID Header VDO | 6.34 |
| Cert Stat VDO | 6.38 |
| Product VDO | 6.39 |
| UFP VDO | 6.40 |
| DFP VDO | 6.41 |
| Passive Cable VDO | 6.42 |
| Active Cable VDO1 | 6.43 |
| Active Cable VDO2 | 6.44 |
| VPD VDO | 6.45 |

- VID に Lenovo / Google / Apple / STMicro / Intel / HP 等のベンダー名を自動付与
- enum フィールドは `010b  PDUSB Peripheral` 形式 (2進表記 + 記述名) で表示

### Discover SVIDs / Modes デコード改善

- SVIDs ACK: `SVID VDO[1] — <name1>  <name2>` 形式 + end-of-list 明示
- Modes ACK: `Mode 1: 0x...` 形式で汎用デコード
- REQ/NAK/BUSY に VDO が含まれる場合に `⚠ Spec violation` を付与

### Message Log — VDM 2段階ツリー展開

- Discover Identity ACK 展開時、VDO ごとのセクションヘッダーを折り畳み行で表示
- ▸ / ▾ エキスパンダーで各セクションのフィールド行を個別に開閉
- 展開フィールド行は 24px インデントした `└` 記号付きで表示

---
See [CHANGELOG.md](CHANGELOG.md) for full details.
