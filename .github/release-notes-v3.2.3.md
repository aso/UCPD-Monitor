## What's New in v3.2.3

### シリアルポート自動選択の改善

- 既知デバイス (STM32 STLINK) が **唯一 1 台** の場合のみ自動選択。複数ある場合はユーザーが手動で選択。
- ポートリストが **変動した瞬間にのみ** 自動選択ロジックを実行（2 秒ポーリングの毎ループでは発火しない）。
- 選択中のポートが抜去された場合: 直前リスト上のインデックスから**下方ロール探索**で次の既知デバイスへ移行。折り返しても候補がなければプレースホルダー表示。

| 状況 | 動作 |
|---|---|
| 選択中ポートが引き続き存在 | そのまま維持 |
| 既知デバイス 1 台のみ残存 | 自動選択 |
| 既知デバイス複数残存 | 下方ロール → 折り返し探索 |
| 既知デバイス全滅 | 「— select port —」プレースホルダー |
| ポート 0 件 | 「— no devices —」表示 |

### TypeScript 移行 (`pd_parser.ts`)

- `pd_parser.js` → `pd_parser.ts` へ git mv でリネーム（履歴保持）。
- `pd_types.ts` に USB PD データオブジェクト (`Pdo`, `Rdo`, `MessageHeader`, `PdFrame`, `ParsedCpdFile` 等) の完全な静的型定義を追加。
- `tsconfig.json` (`strict: true` + `noUncheckedIndexedAccess: true`) のもとで全エクスポート関数に戻り型注釈を付与。`tsc --noEmit` エラー 0 件を確認。

---
See [CHANGELOG.md](CHANGELOG.md) for full details.
