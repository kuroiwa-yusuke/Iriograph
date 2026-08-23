import type { ResolvedAuthoringTerm } from "@iriograph/core";

import {
  RDFS_MEMBER,
  RDFS_SUBCLASS_OF,
  RDFS_SUBPROPERTY_OF,
  SKOS_NAMESPACE,
} from "./vocabulary.js";

const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const DCTERMS = "http://purl.org/dc/terms/";
const PROV = "http://www.w3.org/ns/prov#";

/**
 * A compact, reusable Japanese picker catalog for broadly useful standard
 * predicates. Hosts choose which categories to expose for each profile. The
 * labels aid discovery only; every command remains bound to the exact IRI.
 */
export const standardPredicateVocabularyJa = Object.freeze([
  property(`${RDFS}seeAlso`, "関連情報を参照", "参照", "追加情報として別のresourceを案内します。", "工程から説明資料を参照する"),
  property(`${RDFS}isDefinedBy`, "定義元", "参照", "このresourceを定義するresourceを示します。", "業務用語から語彙定義を参照する"),
  property(RDFS_SUBCLASS_OF, "上位概念", "分類", "より一般的なclassとの概念階層を示します。", "承認作業を業務項目の下位概念にする"),
  property(RDFS_SUBPROPERTY_OF, "上位の関係", "分類", "より一般的なpredicateとの関係階層を示します。", "担当範囲を包含関係の下位にする"),
  property(`${RDFS}domain`, "主語にできる種類", "語彙定義", "predicateのsubject側で想定するclassを示します。", "承認する関係の主語を担当者にする"),
  property(`${RDFS}range`, "値にできる種類", "語彙定義", "predicateのobject側で想定するclassを示します。", "承認する関係の対象を申請にする"),
  property(RDFS_MEMBER, "領域に含む", "包含", "順序を持たない集合・領域への所属を示します。", "担当領域に確認工程を含める", true),

  property(`${DCTERMS}relation`, "関連する", "一般関係", "他のresourceとの一般的な関係を示します。", "同じ案件の補足資料を関連付ける"),
  property(`${DCTERMS}references`, "参照する", "参照", "内容の理解に使うresourceを参照します。", "申請から規程を参照する"),
  property(`${DCTERMS}isReferencedBy`, "参照される", "参照", "このresourceを参照するresourceを示します。", "規程から利用中の申請様式を辿る"),
  property(`${DCTERMS}requires`, "必要とする", "依存", "成立や実行に別のresourceが必要であることを示します。", "承認処理が本人確認を必要とする"),
  property(`${DCTERMS}isRequiredBy`, "必要とされる", "依存", "別のresourceから必要とされることを示します。", "本人確認が承認処理から必要とされる"),
  property(`${DCTERMS}hasPart`, "一部として持つ", "構成", "構成要素を示します。", "手続きが審査工程を一部として持つ"),
  property(`${DCTERMS}isPartOf`, "一部である", "構成", "より大きなresourceの構成要素であることを示します。", "審査工程が手続きの一部である"),
  property(`${DCTERMS}source`, "情報源", "由来", "派生元または根拠となるresourceを示します。", "集計結果から元データを示す"),
  property(`${DCTERMS}replaces`, "置き換える", "版管理", "別のresourceを置き換えたことを示します。", "新規程が旧規程を置き換える"),
  property(`${DCTERMS}isReplacedBy`, "置き換えられる", "版管理", "別のresourceに置き換えられたことを示します。", "旧規程が新規程に置き換えられる"),

  property(`${PROV}wasDerivedFrom`, "～から派生した", "由来", "情報や成果物の派生元を示します。", "承認結果が申請内容から派生する"),
  property(`${PROV}wasGeneratedBy`, "～によって生成された", "由来", "resourceを生成した活動を示します。", "報告書が集計処理によって生成される"),
  property(`${PROV}used`, "使用した", "利用", "活動が使用したresourceを示します。", "審査が申請書を使用する"),
  property(`${PROV}wasAssociatedWith`, "担当者・組織", "担当", "活動に関与した人・組織・agentを示します。", "審査の担当者として法務担当者を示す"),
  property(`${PROV}wasAttributedTo`, "責任・帰属先", "担当", "resourceの責任・帰属先を示します。", "報告書の帰属先として監査チームを示す"),
  property(`${PROV}wasInformedBy`, "通知・結果を受けた", "依存", "先行活動から情報を受けた活動を示します。", "承認が審査結果を受ける"),
  property(`${PROV}actedOnBehalfOf`, "代理元", "担当", "agentが代理している別のagentを示します。", "担当者の代理元として部門を示す"),

  property(`${SKOS_NAMESPACE}broader`, "上位の概念", "概念関係", "より広い意味を持つ概念を示します。", "国内出張の上位概念を出張にする"),
  property(`${SKOS_NAMESPACE}narrower`, "下位の概念", "概念関係", "より狭い意味を持つ概念を示します。", "出張の下位概念として国内出張を示す"),
  property(`${SKOS_NAMESPACE}related`, "関連する概念", "概念関係", "階層ではない関連概念を示します。", "承認と監査を関連概念にする"),
  property(`${SKOS_NAMESPACE}exactMatch`, "同じ意味の概念", "概念対応", "別の概念体系で同一とみなせる概念を示します。", "社内語彙と標準語彙の同一概念を対応させる"),
  property(`${SKOS_NAMESPACE}closeMatch`, "近い意味の概念", "概念対応", "完全同一ではないが近い概念を示します。", "二つの部署で近い意味の業務用語を対応させる"),
] satisfies readonly ResolvedAuthoringTerm[]);

export function standardPredicateTermsJa(
  categories?: readonly string[],
): ResolvedAuthoringTerm[] {
  const accepted = categories?.length ? new Set(categories) : undefined;
  return standardPredicateVocabularyJa
    .filter((term) => !accepted || accepted.has(term.category!))
    .map((term) => ({ ...term, examples: term.examples ? [...term.examples] : undefined }));
}

function property(
  iri: string,
  label: string,
  category: string,
  description: string,
  example: string,
  structural = false,
): ResolvedAuthoringTerm {
  return {
    iri,
    kind: "property",
    roles: ["predicate"],
    label,
    description,
    category,
    examples: [example],
    objectKinds: ["iri"],
    ...(structural ? { structural: true } : {}),
  };
}
