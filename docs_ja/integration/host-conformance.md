# Host conformance

`@iriograph/host-conformance`は参照HostであるLocal Mockとproduct HostであるKuroxiom Cloudが、同じ公開packageを欠落なく統合したことを検証します。

Versioned manifestはpackage version、CSS entry、baseline catalog、共通fixture SHA-256、必須capability、対応するcomponent/E2E test IDを固定します。Hostはroot elementの`data-iriograph-package-version`とcapability属性を公開し、実Chromium gateがmanifestと照合します。

共通gateは少なくとも初期表示、grid、矩形選択、context menu、意味/ビュー編集、membership、型、focus/keyboard、左右sidebar、workspace assetを確認します。Cloud固有catalog、permission、workspace asset resolver、layout adapterは宣言済みextensionとして許容します。Package/CSS version不一致、stale cache、共通fixture差異、Host overrideによる機能欠落、container/focus/event統合不良、service health不良はdeploy failureです。

Release順は次です。

1. 全packageをpackし、workspace外consumerでimport/type/CSS/fixtureを検証する
2. npmjsへ10 packageのexact lockstep versionを依存順にpublic公開する
3. Registryで全exact versionを確認してrelease tagを作る
4. Cloudをそのexact versionへ更新し、build/test/local Chromium gateを通す
5. OIDC/SSM workflowでdeployし、実行commit、health、production Chromium、console/service log、volume使用率を確認する
