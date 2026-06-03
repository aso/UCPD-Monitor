# client/src/data/knownDevices.js

## 役割
既知 USB デバイス（VID:PID）と表示名の対応辞書。

## 主な責務
- STLINK 系デバイスのフレンドリー名解決
- `SerialBar` の表示補助

## 主要エクスポート
- `KNOWN_DEVICES`
  - 例: `0483:374B -> STM32G071B-DISCO (STLINK-V3)`
- `knownLabel(port)`
  - `port.vendorId` / `port.productId` から表示名を返す

## 補足
- キーは大文字の `VID:PID` 形式で管理
