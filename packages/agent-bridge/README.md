# @iriograph/agent-bridge

Iriographのlabel-first索引とauthoring/presentation transactionを、HTTP/MCP等の
JSON transportへ接続するhost向けpackageです。認証、権限、tenant、rate limit、監査、
current revisionはHostが注入します。TransportはIRI、overlay、asset byte、署名URLを
通常DTOへ公開せず、revision-bound opaque IDだけを受け付けます。

自然言語の分類は権限判断ではありません。semanticとpresentationは別候補、別review、
別transactionとして適用します。
