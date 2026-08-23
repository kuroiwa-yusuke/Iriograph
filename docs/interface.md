# 公開インターフェース

## Document

portable documentの最小形は次です。独自拡張子は`.iriograph`を使用します。

```json
{
  "schemaVersion": "1",
  "kind": "iriograph.document",
  "documentId": "purchase-approval",
  "semantic": {
    "format": "text/turtle",
    "baseIri": "urn:example:purchase:",
    "source": "@prefix : <urn:example:purchase:> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n:lane a rdf:Bag ; rdfs:label \"申請者\"@ja ; rdfs:member :submit ."
  },
  "imports": [
    { "catalogRef": "urn:iriograph:catalog:rdf-rdfs@1" }
  ],
  "views": [
    {
      "viewId": "main",
      "kind": "node-link",
      "profileRef": "urn:iriograph:profile:rdf-rdfs:1",
      "layoutRef": "urn:iriograph:layout:hierarchical-lr:1",
      "locale": "ja",
      "overlay": {}
    }
  ]
}
```

`semantic.source`は意味の正本です。`views[].overlay`のkeyはview内element ID、各entryの`semanticRef`はIRIまたはstatement identityです。

`views[].locale`はtarget contractの任意BCP 47 language tagで、label選択を決定的にします。省略時はlanguage tagのない`rdfs:label`を優先し、実行環境のlocaleで結果を変えません。現行TypeScript modelへの追加はP0-01で行います。

overlayには次を保持できます。

- `geometry`: x、y、width、height
- `pinned`と`placement`: 自動配置かユーザー固定か
- `appearance`: template、icon、style tokenの明示override
- `routing`: edge waypointとlabel offset

## Catalog

v1 target catalogは次の宣言を持ちます。

- `rules`: type、predicate、fallback patternから汎用projection operatorへの写像
- `templates`: primitive kind、shape、既定size、style、icon参照
- `assets`: asset IRIから取得定義への写像

標準catalogはRDF/RDFS IRIを`membership-container`、`ordinal-sequence`、`alternative`、`direct-edge`、`suppress`へbindします。未登録の直接IRI-object tripleはfallback edgeになります。rule schema、競合解決、標準bindingは[rdf-rdfs-profile.md](./rdf-rdfs-profile.md)を正本とします。

現行TypeScriptの`nodeRules`、`relationRules`、`containmentRules`はprototype contractであり、上記`rules`へ移行するまでstable APIとはしません。

## Scene

`projectIriographDocument(document, catalog)`は保存documentを変更せず、renderer向け`DiagramScene`を返します。Sceneはderived dataであり保存正本ではありません。

現在のprimitiveは`node`、`edge`、`container`です。`annotation`は型上予約されていますが未投影です。

## Semantic transaction

`applySemanticSource(document, source, catalog)`は、Turtleをparseしてから意味変更を適用します。

- 失敗: `accepted: false`とdiagnosticsを返し、元documentを維持
- 成功: `accepted: true`とreconcile済みdocumentを返す

reconcileは存続`semanticRef`のoverlayを維持し、新規表示要素へ初期geometryを補完し、消滅した要素を除去します。

## Vue editor

hostは`@iriograph/vue-editor`を編集領域へ埋め込みます。

```vue
<script setup lang="ts">
import { ref } from "vue";
import { IriographEditor } from "@iriograph/vue-editor";
import "@iriograph/vue-editor/styles.css";

const editor = ref<InstanceType<typeof IriographEditor>>();
</script>

<template>
  <IriographEditor
    ref="editor"
    v-model="document"
    :catalog="catalog"
    :dirty="dirty"
    :saving="saving"
    :resolve-asset-url="resolveAssetUrl"
    @save="saveToWorkspace"
  />
</template>
```

主なcontract:

- `modelValue` / `update:modelValue`: portable document正本
- `catalog`: hostが解決済みのprojection catalog
- `save`: packageは永続化せずhostへ保存要求を通知
- `validationChanged`: semantic/project diagnostics
- `resolveAssetUrl(assetRef, definition)`: IRIから表示URLへのhost注入境界
- `flushPendingEdits()`: Turtle textareaの未適用draftを検証し、保存前に正本へ反映

取込、書出、workspace tree、HTTP、revision conflict、認証・権限はhostの責務です。

## LLM adapter

LLMへは`document.semantic.source`を抽出して渡します。返却Turtleは`applySemanticSource`へ入力します。portable document全体やoverlayをLLMの自由編集対象にしません。
