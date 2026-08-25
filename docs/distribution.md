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
`.github/package-release-version`だけを変更するrelease marker pushをtriggerとします。Markerの内容は
4 packageのlockstep versionと一致しなければpublish前に拒否し、通常のmain pushやdocs変更ではpublishしません。
利用hostはregistry上の公開確認後にexact versionで依存します。Hostへpackage sourceを複製しません。

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
