# client/src/components/MessageTable.jsx

## 役割
USB-PD メッセージとトレースイベントを時系列で表示する仮想化テーブル。

## 主な責務
- `@tanstack/react-virtual` による大量行表示の高速化
- PDO/RDO/VDM のツリー展開表示（親行と子行）
- `tsAnchor` を使った Tick 時刻の壁時計変換
- 方向/SOP/種別に応じた視覚的色分け

## 3.2.7 時点の要点
- **HEX/Parsed 切替の適用範囲**:
    - PD メッセージ行だけでなく、`PE_STATE` / `NOTIF` / `TCPM` / `PRL` / `CAD_EVENT` のイベント本文にも適用
- **Type 列固定**:
    - HEX/Parsed を切り替えても Type 列はイベント種別名の表示を維持
- **方向表示の分離**:
    - 表示は `SRC→SNK` / `SNK→SRC` を使用
    - 低レイヤの `IN/OUT` は parser 側で処理し、UI 側は表示語彙を利用
- **RDO 逆引き**:
    - Request 展開時に直前 Source Capabilities から参照元 PDO を逆引きし、詳細を子行表示
- **VDM 2段階展開**:
    - セクションヘッダ（ID HEADER 等）とフィールド行を分けて開閉可能

## 補足
- 行選択（単一/Shift 範囲）と TSV コピーに対応
- GoodCRC MsgID 不一致や parse violation は警告表示

