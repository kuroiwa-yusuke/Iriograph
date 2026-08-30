# @iriograph/core

Iriographのportable document、RDF/RDFS projection catalog、runtime validation、
semantic transaction、決定的layoutを提供するframework非依存のESM packageです。

```sh
npm install --save-exact @iriograph/core
```

```ts
import {
  buildIriographView,
  applyAuthoringSource,
  createProjectionRuntimeContext,
  createStandardLayoutRegistry,
  previewAuthoringCommands,
  applyAuthoringPreview,
  applyViewCommand,
  standardRdfRdfsCatalog,
  statementIdentityForNamedStatement,
  validateIriographDocumentV1,
  packageDefaultIcons,
  previewPortableDocumentReplace,
  applyPortableDocumentReplace,
  previewDocumentRebase,
  applyDocumentRebasePreview,
  withPackageDefaultIconAccess,
} from "@iriograph/core";

const validation = validateIriographDocumentV1(document);
if (!validation.valid) throw new Error(validation.issues[0]?.message);

const context = createProjectionRuntimeContext([{
  profileRef: standardRdfRdfsCatalog.profileRef,
  sourceCatalogRefs: ["urn:iriograph:catalog:rdf-rdfs@1"],
  catalog: standardRdfRdfsCatalog,
  ruleOrigins: [],
}], createStandardLayoutRegistry());

const scene = await buildIriographView(
  validation.value,
  validation.value.views[0]!.viewId,
  context,
);

const viewUpdate = await applyViewCommand(validation.value, {
  command: "duplicate",
  sourceViewId: "main",
  viewId: "review",
}, context);
if (!viewUpdate.accepted) throw new Error(viewUpdate.diagnostics[0]?.message);

const preview = await previewAuthoringCommands(
  validation.value,
  [{
    type: "connect-resources",
    commandId: "connect-reviewer",
    subjectIri: "urn:example:request",
    predicateIri: "http://www.w3.org/2000/01/rdf-schema#seeAlso",
    objectIri: "urn:example:policy",
  }],
  resolvedAuthoringContext,
);
if (preview.valid) {
  const update = await applyAuthoringPreview(
    validation.value,
    preview,
    resolvedAuthoringContext,
    { confirmationId: preview.confirmationId },
  );
  if (!update.accepted) throw new Error(update.diagnostics[0]?.message);
}
```

`packageDefaultIcons`は正規英語labelと日本語labelを持つ小さな業務/cloud向けSVG catalogです。`packageDefaultIconLabel(icon, locales)`はrefを変えず表示名だけを選択します。安定refは
`urn:iriograph:icon:lucide:<name>:1`で、同じSVGを`@iriograph/core/icons/<name>.svg`にも配布します。
`withPackageDefaultIconAccess(assetAccess)`は同梱refをpackage内から解決しますが、hostから渡された
policyを変更しません。Workspaceや外部iconは従来どおりhost resolver/policyの対象です。出典とlicenseは
package内の`THIRD_PARTY_NOTICES.md`を参照してください。

`AssetLease.intrinsicSize`はhostがdecodeした`width`/`height`/`aspectRatio`を一時的に渡す契約です。
Coreはfinite値、dimension、aspect比に加えて`AssetPolicy.maxDecodedPixels`を検証します。面積上限超過はleaseを
即時releaseしてURLも採用せず、その他の不正なoptional metadataは寸法だけを採用しません。省略時のpixel上限は
64 Mi pixelです。resolverの`decode-failed`はiconなしへfail-closedします。Asset解決は
`maxConcurrentResolutions`でboundedに実行し、省略時4、hard上限32です。Batch abort後の未採用leaseは全て解放します。
SVGはleaseの`svgViewBox`から安全な寸法を復元できます。検証済み寸法と解決URLはSceneにだけ現れ、
URL、byte列、intrinsic metadataを`.iriograph`へ保存しません。Iconのview指定は`nodeIconScale`または
`nodeIconSize`のどちらか一方と`nodeIconFit: "contain" | "cover"`をsparseに保存します。

Coreはviewport visibilityやDOM decodeを扱いません。`loading="lazy"`、viewport優先解決、virtualizationは
Vue rendererまたはhostが担い、Coreの同時数制限はresolver全体のresource budgetだけを保証します。

`VisualStyle.labelFontSize`は8〜72のsparseな共通表示契約です。Node、Group Frame、edgeのlabel/caption/
commentが同じ値を参照し、省略時の既定値はdocumentへ補完しません。`measureTextContent`、
`resolveIconContentMetrics`、`measureNodeContent`はlayout engineから独立したDOM-freeのautogrow用APIです。

Auto layoutが選んだstraight/curve/polylineとcurve controlは`SceneEdge.derivedRouteChoice`へだけ構造コピーされます。
Rendererはcurveの場合このcubic controlを優先します。この選択結果はtransientで、`routing.routeMode`、waypoint、
その他のportable overlayへ逆書きしません。

Bag、class region、`rdf:Seq`、`rdf:Alt`はSceneの共通`groupFrame`として公開します。Seqの番号badgeと
muted order guide、Altのhub-to-member candidate guideは`groupGuides`というdisplay-only derived dataで、
predicate edgeでもoverlay routingでもありません。各membershipとAlt defaultは元の`rdf:_n` statement
provenanceを保持します。空/未完成のSeq/Altもframeとして表示し、補完方法付きwarningを返します。

Structured authoringは内部でpreviewを作り、同じ利用者操作の中でatomicにapplyします。標準UIの
非削除操作に別の確認画面は要求しません。`confirmationId`はpreview改変を検出する整合性tokenであり、
利用者の明示確認を意味しません。Apply時にはcommand、document/context revision、exact graph patchを
再計算し、staleまたは改変されたpreviewを拒否します。明示確認は選択外へ波及する削除、または
外部・LLM・host policyがreviewを要求する境界に限定します。
`ResolvedAuthoringContext.defaultLocale`を指定すると、structured commandが新規生成する
language未指定の`rdfs:label`/`rdfs:comment`だけへそのBCP 47 tagを補います。既存literal、明示language、
human/LLM Turtle sourceは書き換えません。

通常UI向けには`structuredAuthoringPresentation(context)`と
`previewStructuredAuthoringRequest(document, request, context)`を利用できます。UIは既存要素を
`viewId + elementId`、node roleを`roleId`、predicateを`predicateId`で選び、完全IRIを組み立てません。
Facadeはnode/group作成、一始点から複数targetへのdirect relation、既存Group Frameへのmember追加、
Seq/Altのfinal order、inline新規nodeを既存のatomic `AuthoringCommand[]`へcompileします。
`ResolvedAuthoringContext.structuredAuthoring`はnode roleと未分類許可、分類group mint許可をprofileから
解決したmetadataとして持ち、predicate catalogとは分離します。
複数direct relationはrequest内または既存graphとのS/P/O重複が一件でもあれば全件rejectします。
Altの`defaultMemberIndex`は選択した出現位置をordinal 1へ移し、残りの相対順を維持します。
既存node roleは`set-node-roles`で完全選択し、分類region複数選択は
`structuredNodeRoleSeedFromCanvasSelections`でopaque role IDへseedできます。
`structuredLocalizedTextPresentation`と`update-localized-text`はopaque value IDで一翻訳だけを更新し、
他language/datatype値を同じatomic property replacement内で保持します。
`structuredPredicateHierarchyPresentation`はhostが解決したexact predicate hierarchyを、predicate catalogと
同じopaque ID規則のlabel-only DTOへ変換します。未知・構造predicateをtop-level候補にせず、全path、
cycle/truncation、query/validation policyを生のIRIなしで返します。

完全なDocument JSONの置換には`previewPortableDocumentReplace` / `applyPortableDocumentReplace`を
使います。JSON Schema、Turtle、domain、profile、全view projection/layoutを一つのrevision-boundな
transactionとして再検証し、失敗時は元Documentを返します。schema診断は`jsonPointer`を持ちます。
この境界の`confirmationId`もintegrity tokenであり、通常のDocument適用一回へ別modalを要求しません。
Asserted region membershipの外に固定されたmember等のspatial invariant違反は、通常layoutのwarning表示とは
別にportable write境界でblocking errorへ昇格し、該当view overlayの`jsonPointer`を返します。
`previewDocumentRebase` / `applyDocumentRebasePreview`は、parsed RDFの旧local namespaceだけを
現在と異なる新baseへ写し、S/P/O、local class/property、membership/Seq、derived overlay semanticRefを同時に更新します。
`documentId`はhost内で一意なopaque IDとしCoreはUUID等の形式を固定しません。
外部・標準・catalog/asset IRIとliteral lexical valueは変更せず、IRI/overlay衝突をapply前に拒否します。
Nested namespaceを含む衝突判定は全term、overlay key/semanticRef、statement identityを同時に写した
最終集合で行い、異なるsource identityが同じ結果へ集約されるmany-to-oneだけを拒否します。

個々のdirect relationへ意味上の説明を付ける場合は、predicate resourceの説明やview captionではなく
`set-statement-comments`を使います。Coreはasserted S/P/Oを残し、RDF 1.1標準reificationの
`rdfs:comment`として保存します。

```ts
const statement = {
  subjectIri: "urn:example:request",
  predicateIri: "urn:example:approvedBy",
  objectIri: "urn:example:manager",
};
const command = {
  type: "set-statement-comments" as const,
  commandId: "describe-approval",
  statementRef: statementIdentityForNamedStatement(statement),
  ...statement,
  comments: [{ kind: "literal" as const, value: "金額条件を満たす場合", language: "ja" }],
};
```

直接Turtleをcontrolled writeとして適用する場合はactorを必須指定します。

```ts
const humanUpdate = await applyAuthoringSource(
  validation.value,
  editedTurtle,
  resolvedAuthoringContext,
  { actor: "human" },
);
const llmUpdate = await applyAuthoringSource(
  validation.value,
  llmEditedTurtle,
  resolvedAuthoringContext,
  { actor: "llm" },
);
```

Human textarea入力は妥当な原文を保持し、LLM sourceとstructured commandはversioned serializerで決定的に再生成します。どちらも同じ語彙・namespace・構造・全view検証を通り、不明actorは拒否されます。

Domain constraintは`ResolvedSemanticValidationContext`の非同期portとして注入できます。
Direct Turtle、structured dataset、LLM sourceは同じportを通り、engine固有のStoreやSHACL型を
public contractへ公開しません。Warningの明示確認、stable diagnostic identity、abort、cache keyの
契約は[Semantic validation](../../docs/semantics/validation.md)を参照してください。

保存documentの`schemaVersion`とcatalogのversionはpackage versionとは独立した契約です。
詳細はrepositoryの設計文書を参照してください。
