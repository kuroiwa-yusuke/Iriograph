# @iriograph/profile-resolver

Host境界でversion固定されたauthoring profileとvocabulary importを解決し、
完全性、循環、opaque option IDの競合を検証して`ResolvedAuthoringContext`を組み立てます。
Network、tenant認証、registry cacheは注入する`AuthoringArtifactResolver`の責務です。

解決失敗は既存documentのreadを妨げません。Hostは返されたdiagnosticを表示し、
semantic writeだけをfail closedにしてください。
