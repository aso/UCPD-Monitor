# client/src/App.jsx

## 役割
クライアント UI 全体のレイアウトと各パネル表示を制御するルートコンポーネント。

## 主な責務
- WebSocket フックと import フックの初期化
- タイトルバー操作（`.cpd Open`, `.cpd Import`, `Memo`, パネルトグル）
- `TopologyView`, `MessageTable`, `Console`, `MeasurePanel` の表示切替
- Drag-and-drop による `.cpd` インポート

## 3.2.7 時点の要点
- `showConsole` と `showMeasure` は独立トグル
- ADC Stream 開閉時に Console を自動表示しない
- タイトルバーに `VITE_APP_VERSION` を表示
