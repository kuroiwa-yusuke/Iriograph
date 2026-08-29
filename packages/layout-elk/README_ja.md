# @iriograph/layout-elk

`@iriograph/core`の非同期layout adapter契約へELK.js Layeredを接続する任意packageです。Portable documentには安定した`layoutRef`だけを保存し、ELK固有optionを混ぜません。

## インストール

```sh
npm install --save-exact @iriograph/core @iriograph/layout-elk
```

```ts
import { LayoutAdapterRegistry } from "@iriograph/core";
import {
  ELK_LAYOUT_REFS,
  ElkLayeredLayoutAdapter,
} from "@iriograph/layout-elk";

const layouts = new LayoutAdapterRegistry([
  new ElkLayeredLayoutAdapter(ELK_LAYOUT_REFS.layeredLr, "LR"),
  new ElkLayeredLayoutAdapter(ELK_LAYOUT_REFS.layeredTb, "TB"),
]);
```

既定engineはbundled ELKを遅延loadします。Browser Workerや別engineが必要なhostは`ElkLayoutEngine`契約を注入します。

ELK Layeredは任意の固定座標をhard constraintとして保証しないため、user placementやpinを含むrequestではCoreの決定的なconservative layoutへfallbackし、固定geometryを厳密に維持します。`fallbackPolicy: "none"`ならengine failureをdiagnosticとして返し、別engineを呼びません。

## ライセンス

Iriograph adapterはMIT Licenseです。依存するELK.jsは`EPL-2.0 OR GPL-3.0-or-later`です。
