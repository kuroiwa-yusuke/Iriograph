# 設計思想

## 目的

Iriographは「意味グラフを図として編集・検証・再利用する」ための基盤です。TurtleはLLMやsemantic toolが扱う意味の正本、display overlayは人がWYSIWYGで調整した表示の正本です。

図は意味グラフの単純な可視化に限定しません。catalogが意味語彙を`node`、`edge`、`container`、`annotation`などの少数の空間primitiveへ写すことで、BPMN風のlane・包含、一般の関係図、iconを含む見た目を同じ投影機構で扱います。

## Turtleとdisplay overlay

一つのportable JSON documentにTurtle文字列とview情報を持たせます。意味と表示を別ファイルにすると参照整合性や配布単位が複雑になり、display自体をtripleにすると座標変更がsemantic revisionへ混入します。JSON envelope内で分離すると、同じ配布単位のままtransaction境界を保てます。

display overlayが保持するのは、geometry、pin、edge routing、明示的なtemplate/icon overrideなど、catalogとlayoutから復元できない、またはユーザーが意図的に固定した情報です。色や既定iconなどの生成可能な情報はcatalogを正本にします。

## Mermaid、draw.ioとの違い

Mermaidは軽量な図記述と自動layoutに優れますが、意味のidentity、外部ontologyとの接続、複数view、WYSIWYG調整の永続化を主目的にした形式ではありません。IriographはTurtleを意味層、catalogを表示文法、overlayを人の調整として独立させます。Mermaid風DSLをもう一つの正本として増やさない方針です。

diagrams.net/draw.ioは自由な作図に優れますが、図形・接続・座標が中心で、意味推論に利用するtripleを正本にしません。Iriographは任意描画の自由度を制限する代わりに、意味変更後の再投影、規則検証、LLMとの往復を安定させます。

## Catalogによる拡張

rendererへ`if predicate == ...`を増やしません。業務class、predicate、relation resource、containment、template、assetはcatalogへ宣言します。未登録のIRI-object tripleは通常矢印として表示し、未知語彙でも最低限読める状態を保ちます。

primitiveを増やす基準は、新しい業務領域ではなく新しい空間文法が必要かどうかです。たとえば「経理タスク」は既存node templateで表現し、「領域による包含」はcontainerという空間文法として追加します。

## RDF/RDFSを基底にする理由

ベースプロファイルは、包含に`rdf:Bag`と`rdfs:member`、順序に`rdf:Seq`と`rdf:_n`、選択に`rdf:Alt`、参照に`rdfs:seeAlso`または`rdfs:isDefinedBy`を使います。Iriograph固有の`Lane`、`SequenceFlow`、`from`、`to`を意味層の必須語彙にはしません。

RDF/RDFSだけでBPMNの全概念を表すのではなく、RDF/RDFSの共通構造だけを制約付きで使う方針です。user taskとservice taskの違いなどdomain固有の意味が必要なら、既存のdomain ontologyまたは利用側が自己記述した語彙を追加catalogへ結びます。標準語彙がないために独自語彙を導入する場合も、Iriograph coreのnamespaceではなく利用domainのnamespaceに置きます。

この方針には二つの境界があります。

- RDF/RDFS標準の意味は変更しない。連番の欠番禁止や一意な表示parentなど、作図の決定性に必要な条件をIriograph application profileとして追加する。
- `rdfs:label`は表示名であり、分類規則ではない。「承認」「開始」などの文字列から構造やtemplateを推測しない。

具体的な語彙、制約、投影は[rdf-rdfs-profile.md](./rdf-rdfs-profile.md)を正本とします。

## Assetのidentityと取得

iconはIRIで参照します。IRIと取得URLは同一視せず、catalogまたはhostが注入するresolverで実URLへ解決します。これによりcore catalogを小さく保ち、組織固有asset、署名URL、CDN、offline bundleをhost側で選べます。

resolverは取得ポリシーの境界でもあります。許可scheme、origin、media type、サイズ、失敗時fallbackはhostが制御し、documentは認証情報や期限付きURLを正本として保持しません。

## LLMとの境界

LLMへ渡す主対象は`semantic.source`のTurtleです。LLMが返したTurtleはparse・規則検証を一つのsemantic transactionとして通し、成功時だけ正本へ反映します。その後、存続IRIのユーザーoverlayを維持し、新規IRIへ決定的なlayoutを補完し、消滅IRIのoverlayを除去します。

LLMに座標調整を求めません。人が調整したoverlayをプロンプトへ混ぜないことで、意味変更とレイアウト変更の競合を避けます。

## 安定性の判断基準

- identityはIRIを優先し、label、配列index、Turtle行番号に依存しない
- semantic transactionとpresentation transactionを分ける
- catalog ruleの競合を登録順で解決しない
- 同じ入力、catalog version、layout versionから同じSceneを得る
- 標準語彙で表せる意味にIriograph固有のsemantic語彙を作らない
- labelをsemantic classや構造ruleの代用にしない
- host固有の保存、権限、asset取得をcoreへ入れない
- 保存schemaの変更はversionとmigration testを伴う
