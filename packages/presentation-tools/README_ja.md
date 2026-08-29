# @iriograph/presentation-tools

外部serviceまたはLLMがdisplay候補を作るためのengine非依存packageです。Revision-boundなread-only Scene index、compact target/capability、閉じたsparse patch validator、diff、host注入render/score port、telemetryを提供し、apply機能は持ちません。

## インストール

```sh
npm install --save-exact @iriograph/core @iriograph/presentation-tools
```

この境界はTurtle、semantic write、任意CSS/URL、解決済みasset URL、認証情報、asset/screenshot byteを表現できません。Template/icon/styleはrevision-bound opaque option IDで選択し、rendererはopaque screenshot IDと寸法だけを返します。

`PresentationSceneBridge`はIRIを含むScene IDを決定的opaque aliasへ変換し、承認済みpatchだけをtrusted Host内でsource overlay IDへ戻します。Requestは毎回document/context/view bindingを繰り返し、stale revision、未知field、未登録option、非finite座標、routing不正、件数・byte・時間・token budget超過を拒否します。

各model cycleはinput/cached/output/reasoning tokenの実測を渡し、sessionはcache分類、latency、request/response bytes、patch数、結果、screenshot IDまたはscore概要をbounded audit recordとして記録します。

詳細は[Agent・host連携](../../docs_ja/integration/agents.md)を参照してください。

## ライセンス

MIT Licenseです。
