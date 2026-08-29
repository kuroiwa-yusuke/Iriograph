# @iriograph/rdf-io

TurtleまたはJSON-LDをRDF datasetへ取り込み、新規document・merge候補のpreview、atomic apply、明示的namespace rebase、意味RDFだけのexportを提供するframework非依存packageです。

## インストール

```sh
npm install --save-exact @iriograph/rdf-io
```

Import候補はexpanded RDFJS quad、semantic diff、diagnostic、統計、local IRI collision、loss reportを返します。Literalのlexical value、language、datatypeを保持し、default localeを補完しません。Blank nodeは既存datasetと衝突しないscopeへ分離し、remote JSON-LD contextを暗黙取得しません。

同じexpanded local IRIは既定でcollisionとして拒否します。本当に同一resourceとしてmergeする場合だけ明示policyを指定します。External IRIをlocal namespaceへ暗黙変換しません。

Rebaseは独立APIとして対象namespaceの全IRI変換をpreviewし、衝突を拒否します。ExportはRDF datasetだけを入力にするため、geometry、routing、icon、色、viewport等のoverlay情報を出力へ混ぜません。

詳細は[RDF import/export](../../docs_ja/semantics/rdf-io.md)を参照してください。

## ライセンス

MIT Licenseです。第三者packageには`THIRD_PARTY_NOTICES.md`記載のライセンスが適用されます。
