# Package配布とversion方針

## 公開package

IriographはESM packageとして次を同時にreleaseします。

| Package | 公開contract |
|---|---|
| `@iriograph/core` | model、schema、projection、validation、layout、semantic transaction |
| `@iriograph/semantic-access` | label-first index、revision alias、read API、Core semantic transaction bridge |
| `@iriograph/layout-elk` | ELK Layered layout adapter、bundled engine、host/Worker engine注入contract |
| `@iriograph/vue-editor` | Vue componentと`@iriograph/vue-editor/styles.css` |

Semantic access、Vue editor、ELK adapterは同じreleaseの`@iriograph/core`へexact versionで依存し、Vue 3はhostが提供する
peer dependencyとします。0.x期間は4 packageをlockstep versionでreleaseします。Packageは
Node.js 20.19以降でbuild・検証し、browser hostからESMとして利用します。

`@iriograph/layout-elk`は任意導入packageで、runtime dependencyのELK.jsは
`EPL-2.0 OR GPL-3.0-or-later`を宣言しています。配布bundleへ含めるhostはELK.jsの適用licenseを
release前に確認します。CoreとVue editorはELKへ依存しません。

現時点では著作権ライセンスが未決定のため、package metadataは`UNLICENSED`とします。
`publishConfig.access=public`はnpm上の可視性だけを定めるもので、利用許諾を意味しません。
実release前に権利者がlicenseを決定し、metadataとlicense本文を同時に更新します。

Release前には各packageを`npm pack`し、repository workspace外の一時consumerへtarballだけを
installします。そのconsumerでcore、semantic access、ELK adapter、Vue editorのimport、CSS subpath、型宣言、Vue peer、
production buildを検証します。Workspace symlinkや`development` conditionでpackage内sourceを
参照することは配布contractに含めません。Core、semantic access、ELK adapterの公開ESMは
Node.jsからbundlerなしでも直接importできることを検証し、配布JavaScript内の相対specifierは
`.js`拡張子を含めます。

Core tarballは`assets/icons/*.svg`と`THIRD_PARTY_NOTICES.md`を含み、
`@iriograph/core/icons/<name>.svg`から同梱SVGを参照できます。既定icon catalogのref、埋込みsource、
配布SVGはbyte-equivalent testで固定します。同梱Lucide iconはsource commit、個別icon名、ISC/MIT noticeを
配布物へ記録し、brand iconや再配布条件が不明なassetは同梱しません。追加iconはhost/catalogのasset IRIと
resolverを使い、package予約namespaceを上書きしません。

Private releaseはAWS CodeArtifactの`kuroxiom/kuroxiom-packages`へ`@iriograph` scopeで公開します。
`packages-v<version>` tag、明示workflow dispatch、またはmain上の
`.github/package-release-version` release marker pushをtriggerとします。公開workflow自身の変更も、main用OIDC境界のまま
同じexact versionを冪等に再検証するためtriggerに含めます。Markerの内容は4 packageのlockstep versionと一致しなければ
publish前に拒否し、その他の通常のmain pushやdocs変更ではpublishしません。
利用hostはregistry上の公開確認後にexact versionで依存します。Hostへpackage sourceを複製しません。

Publish jobはCodeArtifact login後に、そのrepositoryを`@iriograph` scopeのregistryとして明示設定します。
公開scriptはlockstep versionとexactなcore依存を最初に検証したうえで、core、semantic access、ELK adapter、
Vue editorの順に、各`name@version`を同じscope registryへ問い合わせます。Exact versionが既に存在すればskipし、
404で存在しない場合だけpublishします。認証失敗、network error、不正なregistry応答は未公開とはみなさず、
上書きや別registryへのfallbackを行わずに停止します。

Publish直前の別jobとの競合などでpublishが失敗した場合も、同じregistryでexact versionが確認できた場合だけ
既公開として後続packageへ進みます。このため4 packageの途中まで公開されたjobを再実行しても、既公開versionを
変更せず未公開packageだけを依存順に補完できます。Repositoryやscriptは認証tokenを保持・出力せず、認証情報は
CodeArtifact loginが生成するnpm設定だけに委ねます。

4 packageすべてのexact versionがCodeArtifactで確認できた後、監査jobは対象commitへ
`packages-published-v<version>` lightweight tagを作ります。このtagは公開完了の不変な監査標識であり、
GitHub Actionsの実行履歴を閲覧できない環境からも、repositoryのread権限があれば次のように確認できます。

```sh
git ls-remote --refs origin refs/tags/packages-published-v0.1.0
```

表示されたcommit IDがrelease対象commitと一致することを確認します。再実行時にtagが同じcommitを指していれば
成功済みとして何も変更せず、別commitを指していればpublish jobを失敗させます。tagのforce更新や付け替えは
行いません。各実行はさらに`packages-publish-success-<commit>`または
`packages-publish-failure-<commit>`と、verify/publish jobの結果だけを持つannotated
`packages-publish-diagnostic-<commit>`を残します。Diagnostic JSONの`failedStage`は固定語彙で、verifyでは
`verify.install`、`verify.version-check`、`verify.test-build`、各workspaceを示す`verify.test-*`、
`verify.typecheck`、`verify.build`、`verify.package-consumer`、publishでは`publish.install`、
`publish.version-check`、`publish.aws-auth`、`publish.codeartifact-login`、`publish.scope-config`、
`publish.publish`のいずれかです。成功時は`none`、jobがstep outcomeを残せなかった場合だけ
`verify.unknown`または`publish.unknown`、実行条件でskipされた場合は`verify.skipped`または
`publish.skipped`になります。いずれもcredential、registry token、失敗messageを含みません。失敗時は次で
段階を切り分けられます。

```sh
git ls-remote --refs origin "refs/tags/packages-publish-*-<commit>"
git fetch --no-tags origin "refs/tags/packages-publish-diagnostic-<commit>:refs/tags/packages-publish-diagnostic-<commit>"
git cat-file tag "refs/tags/packages-publish-diagnostic-<commit>"
```

verify内の各段階が失敗したときだけ、同じJSONの`verifyLogTailBase64`へANSI escapeを除去し、credential関連語を
含む行をredactした失敗出力末尾を最大1,200 bytesで記録します。`base64 -d`で復号してtest名やbudget値を
切り分けられます。他stage、成功時、logがない場合は空文字です。完全logや無加工出力はtagへ保存しません。

Repository全体とpublish jobの`contents`権限はread-onlyのまま保ち、tagを作る独立audit jobだけへ
`contents: write`を付与します。GitHub tokenやAWS・CodeArtifact credentialをscript引数、tag、logへ出力しません。

## SemVer 0.x

- 公開TypeScript API、runtime挙動、保存・読込境界、CSS contractのbreaking changeはminorを上げます。
- 後方互換な機能追加もminorを上げ、可能な場合はbreaking changeの前にdeprecation期間を設けます。
- 後方互換なbug fix、性能改善、文書修正はpatchを上げます。
- 1.0まではminor間の自動upgradeを前提にせず、hostは利用versionを明示的に固定します。

## 保存schema・catalog versionとの分離

Package SemVer、`.iriograph`の`schemaVersion`、projection catalogの`catalogVersion`は別の
version軸です。Package minorを上げても保存schemaを暗黙変更せず、schema変更には明示的な
schema versionとmigration方針を伴わせます。同じpackageが複数schema versionを読める場合も
あります。

Catalogは`catalogId@catalogVersion`でimmutableに参照します。Package patch/minorはcatalogの
identityを変更せず、ruleやtemplateの意味が変わる場合だけcatalogVersionを更新します。
