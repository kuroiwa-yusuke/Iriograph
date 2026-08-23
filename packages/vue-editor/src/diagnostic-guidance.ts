import type { ProjectionDiagnostic } from "@iriograph/core";

export type DiagnosticGuidance = {
  title: string;
  action: string;
  detail: string;
};

const GUIDANCE: Readonly<Record<string, Omit<DiagnosticGuidance, "detail">>> = {
  "term-minting-denied": {
    title: "この図では新しい種類を作成できません",
    action: "基本の要素を選ぶか、利用できる種類を管理者に追加してもらってください。",
  },
  "authoring-structure-config-unresolved": {
    title: "包含方法と領域の組み合わせを利用できません",
    action: "包含方法を選び直し、領域として表示されている要素を選択してください。",
  },
  "resource-namespace-denied": {
    title: "この場所には新しい要素を保存できません",
    action: "IRIを空欄にして自動採番するか、このworkspaceで許可されたIRIを指定してください。",
  },
  "resource-iri-collision": {
    title: "同じ識別子の要素が既にあります",
    action: "IRIを空欄にして自動採番するか、別のIRIを指定してください。",
  },
  "unknown-term-introduced": {
    title: "この図に未登録の種類または関係が含まれます",
    action: "定義済み候補から選ぶか、警告内容を確認してから適用してください。",
  },
  "authoring-term-role-invalid": {
    title: "選んだ種類をこの項目には設定できません",
    action: "分類には概念クラス、関係には関係候補を選んでください。候補一覧にない場合は図の管理者へ追加を依頼してください。",
  },
  "structural-predicate-property-edit-denied": {
    title: "この関係は属性欄から変更できません",
    action: "包含は「領域・包含」、並び順は「並び順を編集」、分岐は「分岐を編集」から変更してください。",
  },
  "structural-predicate-edge-edit-denied": {
    title: "この関係は通常の線として作成できません",
    action: "包含・並び順・分岐に対応した専用操作を選んでください。",
  },
  "create-resource-initial-statement-required": {
    title: "要素の意味がまだ設定されていません",
    action: "名前、分類、既存要素との関係、所属領域のいずれかを設定してください。",
  },
  "edge-predicate-required": {
    title: "関係の種類が選ばれていません",
    action: "始点と終点の間に作る関係を、名前と説明を確認して選んでください。",
  },
  "authoring-iri-invalid": {
    title: "識別子の書式が正しくありません",
    action: "AdvancedのIRIを空欄にして自動採番するか、完全IRIを入力してください。",
  },
  "ordinal-prefix-invalid": {
    title: "並び順の定義を利用できません",
    action: "表示されている並び方または分岐方法を選び直してください。",
  },
  "alternative-too-few-members": {
    title: "分岐には2件以上の選択肢が必要です",
    action: "選択肢をもう1件以上追加してください。",
  },
  "alternative-default-ordinal-invalid": {
    title: "既定の選択肢が範囲外です",
    action: "表示されている選択肢から既定値を選び直してください。",
  },
  "sequence-empty": {
    title: "並び順には1件以上の要素が必要です",
    action: "候補から要素を追加してください。",
  },
  "resource-delete-referenced": {
    title: "ほかの要素から参照されているため削除できません",
    action: "影響する関係を確認し、必要な場合だけまとめて削除を選択してください。",
  },
  "authoring-noop": {
    title: "変更内容がありません",
    action: "現在と異なる値を指定してください。",
  },
};

export function diagnosticGuidance(diagnostic: ProjectionDiagnostic): DiagnosticGuidance {
  const known = GUIDANCE[diagnostic.code];
  if (known) return { ...known, detail: diagnostic.message };
  if (diagnostic.category === "syntax") {
    return {
      title: "Turtleの書式を読み取れません",
      action: "Sourceへ移動し、示された位置の記号や引用符を確認してください。",
      detail: diagnostic.message,
    };
  }
  if (diagnostic.category === "layout") {
    return {
      title: "配置を完了できません",
      action: "固定位置を解除するか、領域や要素の重なりを調整してください。",
      detail: diagnostic.message,
    };
  }
  return {
    title: diagnostic.severity === "warning" ? "確認が必要です" : "変更を適用できません",
    action: "対象と入力内容を確認してください。解決しない場合は詳細コードを管理者へ伝えてください。",
    detail: diagnostic.message,
  };
}
