# 設計思想

## 目的

Iriographは「意味グラフを図として編集・検証・再利用する」ための基盤です。TurtleはLLMやsemantic toolが扱う意味の正本、display overlayは人がWYSIWYGで調整した表示の正本です。

図は意味グラフの単純な可視化に限定しません。catalogが意味語彙を`node`、`edge`、`container`、`annotation`などの少数の空間primitiveへ写すことで、BPMN風のlane・包含、一般の関係図、iconを含む見た目を同じ投影機構で扱います。

## Turtleとdisplay overlay

一つのportable JSON documentにTurtle文字列とview情報を持たせます。意味と表示を別ファイルにすると参照整合性や配布単位が複雑になり、display自体をtripleにすると座標変更がsemantic revisionへ混入します。JSON envelope内で分離すると、同じ配布単位のままtransaction境界を保てます。

display overlayが保持するのは、geometry、pin、edge routing、明示的なtemplate/icon overrideなど、catalogとlayoutから復元できない、またはユーザーが意図的に固定した情報です。色や既定iconなどの生成可能な情報はcatalogを正本にします。

## 意味を作るリッチ編集

リッチエディタでnode、属性、edge、包含を作る操作は、Sceneへの図形追加ではなくsemantic graphの編集です。Editorは操作をTurtleのgraph delta候補へ変換し、semantic transactionの検証に成功した場合だけ正本とSceneを更新します。Sceneに仮nodeを作り、後から意味を付けて保存する状態をdocumentには許容しません。

- node作成ではnamed IRIを決め、同じtransactionでそのresourceを含む少なくとも1つのtripleを作る。`rdf:type`、`rdfs:label`、domain property、既存resourceとの関係などが初期statementになる。
- 属性編集はpredicateとIRI/literal valueを持つtripleの追加、置換、削除として行う。
- edge作成ではpredicateを必須とし、直接IRI-object tripleまたはprojection capabilityが定義するgraph patchを作る。便宜的な`:relation`のような語彙を暗黙に生成しない。
- 包含編集では`rdf:Bag`resourceと`rdfs:member`等、選択したcapabilityの意味構造を書く。nodeをcontainer内へdragするだけの操作はpresentationであり、意味的所属を暗黙に追加しない。

一つのUI操作が「resourceを作成しこの位置に置く」と見える場合も、resource作成はsemantic transaction、ユーザー指定座標はpresentation transactionです。Editorは両者を一つのundo可能な操作として協調できますが、semantic transactionが失敗した場合はpresentation変更も確定しません。

semantic transaction成功後は、全viewをそれぞれのprofile、catalog、layoutで再投影します。存続するidentityのuser overlayは互換な範囲で維持し、新規要素は決定的layoutからgenerated provenanceの初期geometryを得ます。Catalogから再生成できるtemplate、style、iconはoverlayへ複製しません。このdisplay reconciliationはsemantic変更の結果を表示可能にする後処理であり、任意の見た目変更をsemantic transactionに混ぜることではありません。

## Mermaid、draw.ioとの違い

Mermaidは軽量な図記述と自動layoutに優れますが、意味のidentity、外部ontologyとの接続、複数view、WYSIWYG調整の永続化を主目的にした形式ではありません。IriographはTurtleを意味層、catalogを表示文法、overlayを人の調整として独立させます。Mermaid風DSLをもう一つの正本として増やさない方針です。

diagrams.net/draw.ioは自由な作図に優れますが、図形・接続・座標が中心で、意味推論に利用するtripleを正本にしません。Iriographは任意描画の自由度を制限する代わりに、意味変更後の再投影、規則検証、LLMとの往復を安定させます。

## Catalogによる拡張

rendererへ`if predicate == ...`を増やしません。業務class、predicate、relation resource、containment、template、assetはcatalogへ宣言します。未登録のIRI-object tripleは通常矢印として表示し、未知語彙でも最低限読める状態を保ちます。

primitiveを増やす基準は、新しい業務領域ではなく新しい空間文法が必要かどうかです。たとえば「経理タスク」は既存node templateで表現し、「領域による包含」はcontainerという空間文法として追加します。

## RDF/RDFSを基底にする理由

ベースプロファイルは、包含に`rdf:Bag`と`rdfs:member`、順序に`rdf:Seq`と`rdf:_n`、選択に`rdf:Alt`、参照に`rdfs:seeAlso`または`rdfs:isDefinedBy`を利用できるようにします。これらはspecial projectionへopt-inする共通構造であり、すべての業務graphに使用を強制しません。その他のdomain語彙はgeneric node/edgeとして成立します。

RDF/RDFSだけでBPMNの全概念を表すのではなく、RDF/RDFSの共通構造だけを制約付きで使う方針です。user taskとservice taskの違いなどdomain固有の意味が必要なら、既存のdomain ontologyまたは利用側が自己記述した語彙を追加catalogへ結びます。標準語彙がないために独自語彙を導入する場合も、Iriograph coreのnamespaceではなく利用domainのnamespaceに置きます。

この方針には二つの境界があります。

- RDF/RDFS標準の意味は変更しない。連番の欠番禁止や一意な表示parentなど、作図の決定性に必要な条件をIriograph application profileとして追加する。
- `rdfs:label`は表示名であり、分類規則ではない。「承認」「開始」などの文字列から構造やtemplateを推測しない。

具体的な語彙、制約、投影は[rdf-rdfs-profile.md](./rdf-rdfs-profile.md)を正本とします。

## Assetのidentityと取得

iconはIRIで参照します。IRIと取得URLは同一視せず、catalogまたはhostが注入するresolverで実URLへ解決します。これによりcore catalogを小さく保ち、組織固有asset、署名URL、CDN、offline bundleをhost側で選べます。

resolverは取得ポリシーの境界でもあります。許可scheme、origin、media type、サイズ、失敗時fallbackはhostが制御し、documentは認証情報や期限付きURLを正本として保持しません。

## LLMとの境界

LLMへ渡す主対象は`semantic.source`のTurtleです。これにauthoring profileから抽出した使用可能語彙と、必要なprojection capabilityだけを付与します。Rendererは未知語彙をgeneric node/edgeとして受け入れますが、LLMはprofile外のpredicate、class、namespaceを追加できません。

LLMが返したTurtleはparse・語彙差分・構造規則を一つのsemantic transactionとして検証し、成功時だけ正本へ反映します。その後、存続IRIのユーザーoverlayを維持し、新規IRIへ決定的なlayoutを補完し、消滅IRIのoverlayを除去します。

LLMに座標調整を求めません。人が調整したoverlayをプロンプトへ混ぜないことで、意味変更とレイアウト変更の競合を避けます。

Lane、順序、選択など意味構造を伴う表示要求では、view profileとcatalogから関連capabilityを抽出し、authoring profileの範囲内でTurtleを書き直すことができます。位置、色、routing、icon overrideだけの要求はpresentation transactionで扱い、表示都合だけでsemantic graphを変更しません。詳細は[authoring-profile.md](./authoring-profile.md)を正本とします。

## 安定性の判断基準

- identityはIRIを優先し、label、配列index、Turtle行番号に依存しない
- semantic transactionとpresentation transactionを分ける
- catalog ruleの競合を登録順で解決しない
- 同じ入力、catalog version、layout versionから同じSceneを得る
- 標準語彙で自然に表せる共通構造では標準語彙を優先する
- labelをsemantic classや構造ruleの代用にしない
- Rendererのunknown fallbackをLLMの語彙生成許可とみなさない
- host固有の保存、権限、asset取得をcoreへ入れない
- 保存schemaの変更はversionとmigration testを伴う
