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

これらの操作はサイドバーで編集draftとして組み立てます。Canvas上で空き位置をclickする、node間を接続する、containerを指定するといったgestureはdraftの初期値を作るだけで、意味を確定しません。Editorはdraftから追加・削除予定のtripleまたは構造graph patchをpreviewし、validation結果とともに提示し、ユーザーの明示適用で初めてsemantic transactionをcommitします。適用前に表示するghost node、edge、containerはephemeral UI stateであり、Scene、overlay、undo対象documentへ保存しません。

Resource削除は、他resourceからの参照や構造membershipが残る場合には既定で拒否します。Editorが影響するtripleを列挙してpreviewし、ユーザーがcascade削除を明示した場合だけ一括削除できます。`rdf:Seq`または`rdf:Alt`のmemberを削除する場合は、残るordinal predicateを一つのgraph patchで再採番し、欠番のある途中状態を正本にしません。Altの最低member数など、再構成後の制約を満たせなければtransaction全体を拒否します。

一つのUI操作が「resourceを作成しこの位置に置く」と見える場合も、resource作成はsemantic transaction、ユーザー指定座標はpresentation transactionです。Editorは両者を一つのundo可能な操作として協調できますが、semantic transactionが失敗した場合はpresentation変更も確定しません。

semantic transaction成功後は、全viewをそれぞれのprofile、catalog、layoutで再投影します。存続するidentityのuser overlayは互換な範囲で維持し、新規要素は決定的layoutからgenerated provenanceの初期geometryを得ます。Catalogから再生成できるtemplate、style、iconはoverlayへ複製しません。このdisplay reconciliationはsemantic変更の結果を表示可能にする後処理であり、任意の見た目変更をsemantic transactionに混ぜることではありません。

通常の再投影・layout更新で再配置するのは`placement: "generated"`の要素だけです。`placement: "user"`のgeometryは固定制約としてlayoutへ渡し、互換なidentityが存続する限り自動的に移動しません。

## Turtleの再serialize

Turtle sourceを直接編集してsemantic transactionを適用した場合は、ユーザーが入力した妥当な原文をそのまま`semantic.source`へ保持します。一方、structured commandとLLM editはRDF datasetへのgraph patchとして検証した後、共通serializerでTurtleを決定的に再生成します。同じdataset、保持したprefix/base context、serializer versionからは同じsourceを得るものとし、prefixとbase IRIは有効な範囲で再利用します。

Comment、空白、改行位置、property listのまとめ方、triple記述順などはRDF graphの意味ではありません。直接編集直後には残りますが、structured commandまたはLLM editによる再serializeを一度でも通した後の保持は保証しません。Source reviewは文字列diffだけに依存せず、RDF term単位のsemantic diffも利用します。

## Projection、layout、renderer

意味graphからScene primitiveとedit provenanceを作るprojection、Scene elementのgeometryとroutingを決めるlayout、SceneをDOM/SVG等へ描画するrendererを分離します。Coreは非同期layout adapter契約と、小規模・中規模graph向けの決定的な標準軽量layoutを提供します。Hostは同じ契約を実装するELK等の高機能adapterへ`layoutRef`単位で差し替えられます。

この分離により、layout engineの依存サイズやworker利用をportable documentとprojection規則へ混ぜません。Rendererはlayout algorithmを知る必要がなく、layout adapterは業務IRIを知る必要がありません。

## 複数view

一つのsemantic graphには複数のnamed viewを持てます。ユーザーは保存済みのviewを選択し、各viewのprofile、layout、locale、overlayを独立して利用します。どのsemantic構造をcontainer、sequence、alternative等として表示するかはview profileが決めます。

v1はSPARQL queryや汎用filter editorをview定義へ持ちません。編集作業中に要素を一時的に隠す操作はeditor session stateであり、semantic graphやportable documentを変更しません。永続的に異なる意味範囲を切り出す仕組みは、named viewとprofileの実利用を確認してから拡張します。

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
