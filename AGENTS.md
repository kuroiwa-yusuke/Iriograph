# Repository Instructions

Iriographは、Turtleで保持する意味グラフをcatalog規則で表示Sceneへ投影し、
最小のview overlayをWYSIWYG編集するpackageです。

## 責務境界

- `semantic.source`は意味情報の正本とする。座標、色、icon、viewportを混ぜない。
- ベースsemantic profileは`docs/rdf-rdfs-profile.md`を正本とし、包含、順序、選択、参照には定義済みのRDF/RDFS語彙を優先する。
- Semantic write policyは`docs/authoring-profile.md`を正本とし、rendererのunknown fallbackとLLMのterm生成許可を分ける。
- Catalogは意味から構造的な表示primitiveへの宣言的な写像を持つ。
- Sceneの構造名は`node`、`edge`、`container`、`annotation`など表示・編集上の性質で付ける。
- View overlayはgeometry、pin、manual routeなど、catalogから復元できない表示情報だけを持つ。
- Vue、DOM、workspace、HTTP、権限をcoreへ入れない。
- Semantic projection、layout、rendererを分離する。Coreは非同期layout adapter契約と標準の軽量layoutを持ち、hostが同じ契約で高機能layoutへ差し替えられるようにする。
- Asset URIは識別子であり、取得URLと同一視しない。取得は注入resolverへ委譲する。
- ResourceのidentityにlabelやTurtleの行番号を使わない。IRIを優先する。
- 人間とLLMの発見・理解ではlabel/commentを主表示にする。通常のpresentation DTO/DOMはopaque option IDとlabel/commentだけを持ち、生のIRIをtooltipやAdvanced情報へ渡さない。完全IRIはeditableなTurtle/Document sourceと、Host/Core内部transaction・監査logのexact identityとして保持する。
- LLMへはsemantic Turtleまたはそこから索引化した関連subgraph、許可語彙、関連projection capabilityだけを公開し、view overlayを編集対象にしない。

## 拡張規則

- 業務classやpredicateごとの分岐をrendererやprojection処理へ直書きしない。
- 標準語彙で自然に表せる共通構造では標準語彙を優先するが、その他のdomain語彙はgeneric node/edgeとして受け入れる。
- domain固有語彙が必要な場合は利用domainのnamespaceで自己記述し、template、icon、projection bindingをcatalog正本へ追加する。
- `rdfs:label`の文字列をclass、構造、rule matchingに使わない。
- 未登録のIRI-object tripleは、core fallbackで通常矢印として表示できる状態を保つ。
- Catalog ruleの競合を登録順で解決しない。priorityとspecificityを決定的に検証する。
- 新しい領域ではなく新しい空間文法が必要な場合だけScene primitiveまたはView kindを拡張する。

## 編集規則

- Semantic transactionとPresentation transactionを分ける。
- LLM semantic transactionはresolved authoring profileなしで実行せず、unknown termの新規利用やterm mintingを黙認しない。
- 表示要求が位置、size、routing、色、icon overrideだけならTurtleを書き換えない。意味構造を伴う場合だけprofile-guided rewriteを行う。
- Drag、resize、waypoint変更はTurtleを変更しない。
- 複数membershipを意味graphとして許容し、単一parentの階層container表示と、重なり可能なregion表示を別の空間文法として扱う。Geometryからmembershipを推論しない。
- Rich editorのnode、edge、属性、包含作成はsemantic transactionとする。表示だけの仮nodeをdocumentへ保存せず、node作成時はnamed IRIと少なくとも1つのtripleを同時に確定する。
- Edge作成はpredicateまたはprofile由来capabilityを必須にし、空欄を補うgeneric predicateを暗黙生成しない。Containerへのplain dragからmembership tripleを推測しない。
- Human structured command、Turtle直接編集、LLM返却Turtleはcandidate graph以降のvalidation、全view projection、display reconciliationを共有する。
- Rich editorの意味InspectorはCanvas選択中心とし、初期blur状態には「新しい要素を作る」「関係を作る」「要素を変更する」「関係を変更する」の4入口だけを表示する。入口の後は一段に一つの判断を順次表示し、Canvas事前選択をroleへ明示的にseedする。新規nodeはhost allocatorが発行するopaque IRI、名前、resolved profileで選んだnode-roleを、新規groupは名前と包含・順序付き・候補等の業務group kindを一つのatomic transactionで作る。通常profileでは`rdfs:Class`をGroup Frameとして新規作成せず、型の作成・階層編集・一括付与・削除を独立した`型一覧`へ集約する。図上には最もspecific、profileの高い表示優先度、IRI順で決めた直接型一件だけをtag表示し、残る直接型・継承型は型一覧へ置く。既存の明示的な`classification-region` documentは読込・編集互換を保つが、標準profileへ暗黙移行しない。関係作成はdirect/membershipをicon familyで先に選び、family切替時にdraftを相互変換しない。非削除の意味操作は、利用者の実行一回の中でcandidate graph validationとatomic semantic transactionを続けて行い、別のPreview/Apply確認画面を挟まない。Canvasの右クリック、Context Menu key、Shift+F10は対象別context menuを開き、node、direct edge、derived guide、各group、空白に応じた意味・ビュー各入口を示すが、menu選択だけではmutationせず該当Inspector/actionへfocusする。未実行のform、inline新規member chip、ghost node/edgeはephemeral UI stateに留め、documentへ保存しない。
- 通常の意味編集UIではIRI、`rdf:type`、`rdfs:label`、`rdfs:comment`という語を露出せず、それぞれ種類、名前、説明として扱う。関係候補はcatalog/profileを正本としてsubjectをA、objectをBとした日本語例文でcategory別に表示し、opaque option IDでexact termへ解決する。生のIRIは通常UI、tooltip、Advanced DOMへ渡さず、A/Bは候補説明だけに使い確定edgeへ保存しない。
- 一件の要素への型付与・解除はCanvasで選択したまま意味Inspectorから行える。`型一覧`とInspectorは別の保存機構を持たず、同じlabel-first候補とsemantic transactionを使う。図上の代表直接型は一件のcompact tagだけにする。
- Direct edgeの意味上の始点・終点変更は意味tabでwritableなedgeを選択した場合に許可し、Canvas上の端子を別の有効nodeへdropした時点で、元statement削除、新statement追加、個別statement comment移送をcandidate validation後の一つのsemantic transactionとして直接確定する。空白や領域へのdropでは元の接続を維持し、未接続状態をsemantic graphにもview overlayにも保存しない。ビューtabの同じ端子操作はnode周囲の接続位置だけを変更し、S/P/Oを変えない。
- Predicate resource全体の説明と個別statementの説明を分ける。個別説明はexact S/P/OをRDF標準reificationで指し、その`rdfs:comment`としてTurtleへ保存する。View-only captionへ意味説明を代入しない。
- Structured commandとLLM editの成功時は、同じdataset serializerでTurtleを決定的に再生成する。Turtle sourceの直接編集は適用された原文を保持するが、後の再serialize時にcomment、空白、triple記述順などの書式が保持されることを保証しない。
- Delete/Backspaceと右Inspectorの削除は現在の選択集合をcandidate validation後のatomic semantic transactionとして扱う。選択外のincident edge、membership、Seq/Alt membershipへ削除が波及する場合だけ、label付き影響一覧modalとCanvas上のsession-only previewを出し、明示的cascade確認を要求する。影響する表示objectをすべて選択済みならmodalなしで直接確定する。Seq/Altのordinal変更は一つのatomic patchで再採番する。
- Semantic変更後は、存続IRIのoverlayを維持してdisplay reconciliationを行う。
- 自動再投影と全体layoutはsemantic sourceの確定変更時だけ実行する。Overlay-only変更では他要素を再配置せず、変更要素とincident edgeのderived routeだけを更新する。
- `auto`の表示経路は、安全な直線、水平線と垂直線を一回ずつ接続する一直角・最大一中間点の直交線、内角90度以上のbounded Bezierの順に選ぶ。障害物探索の任意角度pivotは内部corridorに留め、自動polylineとして表示しない。利用者が明示した`manual` routeと既存fixed routeはこの自動選択へ混ぜない。
- 通常の自動再配置は`placement: "generated"`の要素だけを対象とし、user配置をlayout更新で移動しない。
- 生成可能なstyleやicon定義をdocumentへ複製しない。
- 既定appearanceはcatalogを正本とし、利用者の色・透明度・線幅等の個別調整だけを安全なsparse overlayとして保持する。任意CSSは保存しない。
- 右Inspector内のinlineビュー編集は別のPreview/Apply確認を要求しない。Checkbox、select、preset、resetは操作時に直接一つのpresentation transactionへ確定し、color/range/numberは`input`中だけsession previewして`change`で一つのhistory itemへ確定する。
- Canvasのgrid表示とsnap間隔はeditor sessionだけに保持し、Turtle、portable document、view overlay、history、dirty stateへ保存しない。GridはCanvas座標へ追従する非interactiveな背景layerとし、標準snap間隔と同じ既定8 unitを使う。
- Canvasの完全な空白をprimary clickした場合だけ選択を解除し、sidebar、toolbar、Inspector等のCanvas外操作では選択を維持する。空白dragはsessionの範囲選択／移動modeに従うが、選択済みGroup Frameの空内部dragはmodeにかかわらずそのFrameを含むgeometry選択集合の移動を優先する。前面node、edge、handleとFrame同士の永続z順を越えて背面Frameを掴まない。
- 保存schema変更にはversion方針とtestを伴わせる。

## 文書

- `docs/theory.md`: 設計思想と判断基準。
- `docs/rdf-rdfs-profile.md`: semantic base vocabulary、構造制約、catalog bindingの規範仕様。
- `docs/authoring-profile.md`: actor別の語彙統制とprofile-guided semantic rewriteの規範仕様。
- `docs/semantic-validation.md`: domain validation port、diagnostic identity、warning確認、cache identityの規範仕様。
- `docs/view-management.md`: named view command、active view、view別session、一時hideの規範仕様。
- `docs/interface.md`: document、catalog、Sceneの公開契約。
- `docs/implementation.md`: package境界と投影処理。
- `docs/semantic-notation.md`: 意味Turtleと表示notation、canonical serializerの境界。
- `docs/layout-optimization.md`: 自動配置pipeline、layout adapter、性能・品質基準。
- `docs/accessibility.md`: Canvas keyboard、focus、ARIAの規範仕様。
- `docs/editor-interactions.md`: context menu、details dialog、appearance、意味操作の人間向けinteraction仕様。
- `docs/spatial-membership.md`: 階層containerと多対多region membershipの空間文法。
- `docs/semantic-access.md`: label-first索引、revision alias、LLM read/write wrapperの仕様。
- `docs/distribution.md`: package配布、lockstep version、依存licenseの方針。
- `docs/backlog.md`: 未実装事項、優先度、依存、完了条件。

バックログを完了ログにせず、細かな試行錯誤は設計文書へ残さない。

## 開発・完了手順

修正は次の順序で進める。途中のtest成功だけで完了扱いにせず、local起動とremoteへのpushまでを一連の完了条件とする。

### 作成とレビューの分担

- サブエージェントが利用可能な場合、境界の明確な実装とtestは責務と変更範囲を明示して委譲する。設計判断、backlog、`AGENTS.md`、既存設計文書の同期は主エージェントが直接担当する。利用できない場合は主エージェントが同じ作成・レビュー観点を自己適用する。
- サブエージェントは、独立して並行実行する価値がある境界の明確な実装・testだけへ使う。`AGENTS.md`、backlog、既存設計文書の同期や軽微な文書修正だけの作業は主エージェントがレビュー結果に基づいて直接行い、委譲のためのcontextを増やさない。
- 委譲時は会話履歴全体を渡さず、必要最小限のturnだけをforkするかcontextなしで開始し、対象repository、必読`AGENTS.md`、変更可能file、守る不変条件、受入test、禁止事項を短いtask文として渡す。既知の調査結果や具体的な行動だけを共有し、同じrepository探索や仕様読解を複数agentへ重複させない。
- 続きの作業は可能なら同じサブエージェントへ差分だけを追記して依頼する。報告は変更file、判断、test結果、未解決事項に絞り、長いsource全文や一般説明を再掲させない。
- 主エージェントは統括責任を持ち、責務境界、設計文書間と実装間の整合性、既存規則への適合、diff、testをレビューする。問題があれば主エージェントが必要な修正を行うか、具体的な指摘を添えてサブエージェントへ再依頼する。
- 委譲前に`git status`と対象範囲を確認する。複数のサブエージェントへ同じファイルを同時に編集させず、ユーザーの未commit変更や他エージェントの作業を上書き・混入させない。
- サブエージェントの完了報告だけで変更を承認しない。主エージェントが実ファイルとdiffを確認し、最終的な`npm run verify`、local mockの起動確認、commit、push、ユーザーへの結果報告を行う。
- ユーザーが独立利用者テストと計測を求めた場合は、実装担当とは別のサブエージェントへ完成済みURLと受入操作だけを最小限に渡す。主エージェントは初期指示、追加指示回数、model/effort、model cycle、tool/browser操作、wall time、input/cached/output/reasoning tokenを取得可能な範囲で記録し、取得不能な値を推測しない。発見した不具合は主エージェントが修正・再検証し、計測だけで完了扱いにしない。

1. 変更対象の責務と正本を確認し、必要なら関連する設計文書とバックログを先に読む。
2. 実装と、それに対応するtest・設計文書・バックログを更新する。
3. `npm run verify`でtest、typecheck、core/editor/mockのbuildをすべて通す。
   hostにNode.jsがない場合は、repositoryをmountしたNode.js Docker imageで同じcommandを実行する。
4. `docker compose up -d --build`で最新sourceからlocal mockを実際に起動し、HTTP応答を確認する。
   UIまたは操作を変更した場合は、対象画面をbrowserで開き、変更操作と隣接操作、console errorを確認する。
   Editor UIまたはtransactionを変更した場合は`docs/testing.md`に従って`npm run verify:e2e`も実行する。local browserを用意できない場合は`Dockerfile.e2e`の固定Playwright imageを使う。
5. `git status`とdiffを確認し、今回の変更だけをcommitする。ユーザーの未commit変更や無関係な変更を混ぜない。
6. 通常のpushを現在のbranchへ行い、remoteへ反映されたこととworktreeの状態を確認する。

Package公開と利用hostへの反映まで依頼された場合は、上記に続けて次を行う。

7. 公開packageをlockstep versionへ更新し、tarball consumer検証後にprivate registryへpublishする。CodeArtifact login後は`@iriograph` scope registryを明示し、core、semantic access、ELK adapter、Vue editorの順にexact versionを確認する。既公開versionは変更せずskipし、未公開packageだけをpublishする。認証・network・不正応答を未公開扱いにせず、上書きや別registryへのfallbackを行わない。
8. 利用hostは公開済みexact versionへ更新し、package sourceを複製しない。Host自身のtest/build/local起動を通してcommit/pushする。
9. Deploy手順が依頼範囲なら、対象環境へdeployし、実行中commit、service health、公開画面の対象操作、browser consoleとservice logを確認する。

- force push、履歴改変、破壊的なgit操作は行わない。
- 起動、検証、commit、pushのいずれかに失敗した場合は完了と報告せず、原因を修正して再実行する。
- 外部要因でpushできない場合は、未pushのcommitと阻害要因を明示する。
- local mockは次の開発確認に使えるよう、特段の理由がなければ起動状態で引き渡す。
