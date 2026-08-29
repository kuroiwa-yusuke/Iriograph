# RDF dataset import / export

`@iriograph/rdf-io`はIriograph documentの意味正本だけをTurtleまたはJSON-LDと交換するpackageです。View overlayや画像上の位置から意味を生成しません。

## Import

Importは入力をRDF datasetへ正規化し、expanded IRI、blank node、literalのlanguage/datatype、base、重複statementを保持します。新規documentと既存graphへのmerge candidateを分け、いずれもsemantic diff、collision、loss reportを返します。Schemaまたはsemantic errorがあれば適用せず、HostはCore authoring transactionへ候補を渡してatomicに確定します。

Profileのdefault localeをimport済みliteralへ補完しません。外部expanded IRIをlocal namespaceへ暗黙変換しません。見た目の囲い、位置、線種からtypeやmembershipを推測しません。

## Mergeとrebase

Mergeは同一expanded IRIを同一resourceとして扱います。Local IRI衝突、異なるliteral、blank node scopeをreportし、衝突解決を利用者またはHost policyへ返します。

文書コピー等でnamespaceを変える場合だけ、明示rebase operationを使います。Rebaseは対象base、変換対象IRI集合、変換前後のmappingをpreviewし、外部vocabulary IRI、標準語彙、対象外absolute IRIを保持します。File renameだけではRDF IRIを書き換えません。

## Export

Exportはsemantic datasetだけをTurtleまたはJSON-LDへ変換します。Language/datatypeとexpanded identityをlosslessに保ち、overlay、viewport、icon URL、workspace pathを混ぜません。Turtleのcomment、空白、prefix順等の書式完全保持は保証せず、意味datasetを決定的にserializeします。

外部diagram形式はこのpackageへ列挙しません。BPMN XML等が必要な場合は、形式固有のloss mappingを持つ独立adapterとして追加します。
