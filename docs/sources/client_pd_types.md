# client/src/parsers/pd_types.ts

## 役割
USB-PD 解析結果を型安全に扱うための共通 TypeScript 型定義。

## 主な責務
- PDO/RDO の構造型定義
- MessageHeader / ExtendedMessageHeader の定義
- CPD エンベロープ型とレコード判別型の提供
- `PdMessage`, `PdFrame`, `ParsedPayloadRow`, `TreeRow` の共通化

## 主要型
- `Pdo`, `Rdo`
- `MessageHeader`, `ExtendedMessageHeader`
- `CpdEnvelope`
- `PdMessage`, `PdFrame`
- `TreeRow`（MessageTable 子行表示の統一型）

## 3.2.7 時点の要点
- SOP/SOP'/SOP'' に伴う header 意味差を型で明示
- parse violation フィールドや parsed payload ツリーを型レベルで表現
