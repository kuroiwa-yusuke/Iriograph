# Package配布とversion方針

## 公開package

IriographはESM packageとして次を同時にreleaseします。

| Package | 公開contract |
|---|---|
| `@iriograph/core` | model、schema、projection、validation、layout、semantic transaction |
| `@iriograph/vue-editor` | Vue componentと`@iriograph/vue-editor/styles.css` |

Vue editorは同じreleaseの`@iriograph/core`へexact versionで依存し、Vue 3はhostが提供する
peer dependencyとします。0.x期間はcoreとeditorをlockstep versionでreleaseします。Packageは
Node.js 20.19以降でbuild・検証し、browser hostからESMとして利用します。

現時点では著作権ライセンスが未決定のため、package metadataは`UNLICENSED`とします。
`publishConfig.access=public`はnpm上の可視性だけを定めるもので、利用許諾を意味しません。
実release前に権利者がlicenseを決定し、metadataとlicense本文を同時に更新します。

Release前には各packageを`npm pack`し、repository workspace外の一時consumerへtarballだけを
installします。そのconsumerでcoreとVue editorのimport、CSS subpath、型宣言、Vue peer、
production buildを検証します。Workspace symlinkや`development` conditionでpackage内sourceを
参照することは配布contractに含めません。

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
