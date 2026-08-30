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
const OWL = "http://www.w3.org/2002/07/owl#";

export type StandardPredicateLocale = "en" | "ja";

export type StandardPredicateTermsOptions = Readonly<{
  /** A BCP 47 locale tag. Unknown or missing locales fall back to English. */
  locale?: string;
  /** Localized category names to include. All categories are included by default. */
  categories?: readonly string[];
}>;

type StandardPredicatePresentation = Readonly<{
  label: string;
  category: string;
  sentencePattern: string;
  description: string;
  example: string;
}>;

type StandardPredicateDefinition = Readonly<{
  iri: string;
  structural?: true;
  en: StandardPredicatePresentation;
  ja: StandardPredicatePresentation;
}>;

const standardPredicateDefinitions = Object.freeze([
  definition(
    `${RDFS}seeAlso`,
    ["See related information", "Reference", "A refers to B for related information", "Points to another resource that provides additional information.", "Link a process to its explanatory guide"],
    ["関連情報を参照", "参照", "AはBを関連情報として参照する", "追加情報として別のresourceを案内します。", "工程から説明資料を参照する"],
  ),
  definition(
    `${RDFS}isDefinedBy`,
    ["Defined by", "Reference", "A is defined by B", "Identifies the resource that defines this resource.", "Link a business term to its vocabulary definition"],
    ["定義元", "参照", "AはBによって定義される", "このresourceを定義するresourceを示します。", "業務用語から語彙定義を参照する"],
  ),
  definition(
    RDFS_SUBCLASS_OF,
    ["Broader class", "Classification", "A is a subclass of B", "Places a class below a more general class in a concept hierarchy.", "Make approval task a subclass of business item"],
    ["上位概念", "分類", "AはBの下位概念である", "より一般的なclassとの概念階層を示します。", "承認作業を業務項目の下位概念にする"],
  ),
  definition(
    RDFS_SUBPROPERTY_OF,
    ["Broader relationship", "Classification", "Property A is a subproperty of property B", "Places a property below a more general property in a relationship hierarchy.", "Make responsibility scope a subproperty of containment"],
    ["上位の関係", "分類", "AはBの下位の関係である", "より一般的なpredicateとの関係階層を示します。", "担当範囲を包含関係の下位にする"],
  ),
  definition(
    `${RDFS}domain`,
    ["Allowed subject type", "Vocabulary definition", "Property A has subjects of type B", "Identifies the class expected on the subject side of a property.", "Set assignee as the subject type of the approves property"],
    ["主語にできる種類", "語彙定義", "関係Aの主語はBの種類である", "predicateのsubject側で想定するclassを示します。", "承認する関係の主語を担当者にする"],
    true,
  ),
  definition(
    `${RDFS}range`,
    ["Allowed value type", "Vocabulary definition", "Property A has values of type B", "Identifies the class expected on the object side of a property.", "Set application as the value type of the approves property"],
    ["値にできる種類", "語彙定義", "関係Aの値はBの種類である", "predicateのobject側で想定するclassを示します。", "承認する関係の対象を申請にする"],
    true,
  ),
  definition(
    RDFS_MEMBER,
    ["Contains member", "Containment", "A contains B as a member", "Expresses membership in an unordered collection or region.", "Include the review step in the responsibility area"],
    ["領域に含む", "包含", "AはBを領域に含む", "順序を持たない集合・領域への所属を示します。", "担当領域に確認工程を含める"],
    true,
  ),

  definition(
    `${DCTERMS}relation`,
    ["Related to", "General relationship", "A is related to B", "Expresses a general relationship to another resource.", "Relate supporting material from the same case"],
    ["関連する", "一般関係", "AはBに関連する", "他のresourceとの一般的な関係を示します。", "同じ案件の補足資料を関連付ける"],
  ),
  definition(
    `${DCTERMS}references`,
    ["References", "Reference", "A references B", "References a resource used to understand the content.", "Reference a policy from an application"],
    ["参照する", "参照", "AはBを参照する", "内容の理解に使うresourceを参照します。", "申請から規程を参照する"],
  ),
  definition(
    `${DCTERMS}isReferencedBy`,
    ["Referenced by", "Reference", "A is referenced by B", "Identifies a resource that references this resource.", "Trace an application form that uses a policy"],
    ["参照される", "参照", "AはBから参照される", "このresourceを参照するresourceを示します。", "規程から利用中の申請様式を辿る"],
  ),
  definition(
    `${DCTERMS}requires`,
    ["Requires", "Dependency", "A requires B", "Indicates that another resource is needed for this resource to exist or operate.", "Require identity verification for an approval process"],
    ["必要とする", "依存", "AはBを必要とする", "成立や実行に別のresourceが必要であることを示します。", "承認処理が本人確認を必要とする"],
  ),
  definition(
    `${DCTERMS}isRequiredBy`,
    ["Required by", "Dependency", "A is required by B", "Indicates another resource that needs this resource.", "Show that identity verification is required by an approval process"],
    ["必要とされる", "依存", "AはBから必要とされる", "別のresourceから必要とされることを示します。", "本人確認が承認処理から必要とされる"],
  ),
  definition(
    `${DCTERMS}hasPart`,
    ["Has part", "Composition", "A has B as a part", "Identifies a component of this resource.", "Make a review step part of a procedure"],
    ["一部として持つ", "構成", "AはBを一部として持つ", "構成要素を示します。", "手続きが審査工程を一部として持つ"],
  ),
  definition(
    `${DCTERMS}isPartOf`,
    ["Part of", "Composition", "A is part of B", "Indicates that this resource is a component of a larger resource.", "Make a review step part of a procedure"],
    ["一部である", "構成", "AはBの一部である", "より大きなresourceの構成要素であることを示します。", "審査工程が手続きの一部である"],
  ),
  definition(
    `${DCTERMS}source`,
    ["Source", "Provenance", "A has B as its source", "Identifies a resource from which this resource is derived or supported.", "Show the source data for an aggregate result"],
    ["情報源", "由来", "AはBを情報源とする", "派生元または根拠となるresourceを示します。", "集計結果から元データを示す"],
  ),
  definition(
    `${DCTERMS}replaces`,
    ["Replaces", "Versioning", "A replaces B", "Indicates that this resource replaces another resource.", "Use a new policy to replace the old policy"],
    ["置き換える", "版管理", "AはBを置き換える", "別のresourceを置き換えたことを示します。", "新規程が旧規程を置き換える"],
  ),
  definition(
    `${DCTERMS}isReplacedBy`,
    ["Replaced by", "Versioning", "A is replaced by B", "Indicates another resource that replaces this resource.", "Show that the old policy is replaced by the new policy"],
    ["置き換えられる", "版管理", "AはBに置き換えられる", "別のresourceに置き換えられたことを示します。", "旧規程が新規程に置き換えられる"],
  ),

  definition(
    `${PROV}wasDerivedFrom`,
    ["Derived from", "Provenance", "A was derived from B", "Identifies the source from which information or an artifact was derived.", "Derive an approval result from application content"],
    ["派生元", "由来", "AはBから派生した", "情報や成果物の派生元を示します。", "承認結果が申請内容から派生する"],
  ),
  definition(
    `${PROV}wasGeneratedBy`,
    ["Generated by", "Provenance", "A was generated by B", "Identifies the activity that generated a resource.", "Generate a report through an aggregation activity"],
    ["生成元", "由来", "AはBによって生成された", "resourceを生成した活動を示します。", "報告書が集計処理によって生成される"],
  ),
  definition(
    `${PROV}used`,
    ["Used", "Usage", "A used B", "Identifies a resource used by an activity.", "Use an application document during review"],
    ["使用した", "利用", "AはBを使用した", "活動が使用したresourceを示します。", "審査が申請書を使用する"],
  ),
  definition(
    `${PROV}wasAssociatedWith`,
    ["Responsible person or organization", "Responsibility", "A was associated with B", "Identifies a person, organization, or other agent involved in an activity.", "Assign a legal reviewer to a review activity"],
    ["担当者・組織", "担当", "AはBと関連付けられた", "活動に関与した人・組織・agentを示します。", "審査の担当者として法務担当者を示す"],
  ),
  definition(
    `${PROV}wasAttributedTo`,
    ["Responsible party", "Responsibility", "A was attributed to B", "Identifies the agent responsible for or credited with a resource.", "Attribute an audit report to the audit team"],
    ["責任・帰属先", "担当", "AはBに帰属する", "resourceの責任・帰属先を示します。", "報告書の帰属先として監査チームを示す"],
  ),
  definition(
    `${PROV}wasInformedBy`,
    ["Informed by", "Dependency", "A was informed by B", "Indicates an activity that received information from a preceding activity.", "Inform an approval activity with a review result"],
    ["通知・結果を受けた", "依存", "AはBから通知または結果を受けた", "先行活動から情報を受けた活動を示します。", "承認が審査結果を受ける"],
  ),
  definition(
    `${PROV}actedOnBehalfOf`,
    ["Acts on behalf of", "Responsibility", "A acted on behalf of B", "Identifies another agent that an agent represented.", "Show the department on whose behalf an assignee acted"],
    ["代理元", "担当", "AはBを代理する", "agentが代理している別のagentを示します。", "担当者の代理元として部門を示す"],
  ),

  definition(
    `${SKOS_NAMESPACE}broader`,
    ["Broader concept", "Concept relationship", "A has broader concept B", "Identifies a concept with a broader meaning.", "Set travel as the broader concept of domestic travel"],
    ["上位の概念", "概念関係", "AはBより狭い概念である", "より広い意味を持つ概念を示します。", "国内出張の上位概念を出張にする"],
  ),
  definition(
    `${SKOS_NAMESPACE}narrower`,
    ["Narrower concept", "Concept relationship", "A has narrower concept B", "Identifies a concept with a narrower meaning.", "Set domestic travel as a narrower concept of travel"],
    ["下位の概念", "概念関係", "AはBより広い概念である", "より狭い意味を持つ概念を示します。", "出張の下位概念として国内出張を示す"],
  ),
  definition(
    `${SKOS_NAMESPACE}related`,
    ["Related concept", "Concept relationship", "A is conceptually related to B", "Identifies a related concept outside a hierarchy.", "Relate approval and audit as concepts"],
    ["関連する概念", "概念関係", "AはBに関連する概念である", "階層ではない関連概念を示します。", "承認と監査を関連概念にする"],
  ),
  definition(
    `${SKOS_NAMESPACE}exactMatch`,
    ["Exact concept match", "Concept mapping", "A is an exact conceptual match for B", "Maps concepts that can be treated as identical across concept schemes.", "Map an internal term to the identical term in a standard vocabulary"],
    ["同じ意味の概念", "概念対応", "AはBと同じ意味の概念である", "別の概念体系で同一とみなせる概念を示します。", "社内語彙と標準語彙の同一概念を対応させる"],
  ),
  definition(
    `${SKOS_NAMESPACE}closeMatch`,
    ["Close concept match", "Concept mapping", "A is a close conceptual match for B", "Maps concepts that are similar but not fully identical.", "Map similar business terms used by two departments"],
    ["近い意味の概念", "概念対応", "AはBと近い意味の概念である", "完全同一ではないが近い概念を示します。", "二つの部署で近い意味の業務用語を対応させる"],
  ),

  definition(
    `${OWL}sameAs`,
    ["Same as", "Identity", "A is the same resource as B", "States that two resources represent the same thing.", "State that an internal ID and an external ID identify the same customer"],
    ["同一である", "同一性", "AはBと同一である", "二つのresourceが同じ対象を表すことを示します。", "社内IDと外部IDが同じ取引先を表す"],
  ),
  definition(
    `${OWL}differentFrom`,
    ["Different from", "Identity", "A is different from B", "Explicitly states that two resources represent different things.", "Distinguish two organizations that have the same name"],
    ["異なる", "同一性", "AはBと異なる", "二つのresourceが異なる対象であることを明示します。", "同名の二つの部署が別組織であることを示す"],
  ),
  definition(
    `${OWL}equivalentClass`,
    ["Equivalent class", "Concept mapping", "Class A is equivalent to class B", "States that two classes describe the same set of things.", "Map an internal applicant class to an equivalent standard class"],
    ["同等の概念", "概念対応", "AはBと同等の概念である", "二つのclassが同じ範囲の対象を表すことを示します。", "社内の申請者classと標準語彙の申請者classを対応させる"],
  ),
  definition(
    `${OWL}equivalentProperty`,
    ["Equivalent relationship", "Relationship mapping", "Property A is equivalent to property B", "States that two properties express the same relationship.", "Map an internal responsibility property to an equivalent standard property"],
    ["同等の関係", "関係対応", "AはBと同等の関係である", "二つのpredicateが同じ関係を表すことを示します。", "社内の担当関係を標準語彙の担当関係に対応させる"],
  ),
  definition(
    `${OWL}inverseOf`,
    ["Inverse relationship", "Relationship mapping", "Property A is the inverse of property B", "Identifies a property that reverses the subject and object relationship.", "Define is approved by as the inverse of approves"],
    ["逆向きの関係", "関係対応", "AはBと逆向きの関係である", "subjectとobjectを入れ替えた関係になるpredicateを示します。", "承認するの逆向きを承認されるとして定義する"],
  ),
  definition(
    `${OWL}imports`,
    ["Imports vocabulary", "Vocabulary definition", "Ontology A imports ontology B", "States that one ontology imports another ontology.", "Import a shared organization vocabulary into a business vocabulary"],
    ["語彙を取り込む", "語彙定義", "AはBの語彙を取り込む", "ontologyが別のontologyを取り込むことを示します。", "業務語彙から共通組織語彙を取り込む"],
  ),
] satisfies readonly StandardPredicateDefinition[]);

/** English-default presentation metadata for broadly useful standard predicates. */
export const standardPredicateVocabularyEn = createVocabulary("en");

/** Backward-compatible Japanese presentation metadata. */
export const standardPredicateVocabularyJa = createVocabulary("ja");

/** The default standard predicate presentation catalog. */
export const standardPredicateVocabulary = standardPredicateVocabularyEn;

export function normalizeStandardPredicateLocale(locale?: string): StandardPredicateLocale {
  if (typeof locale !== "string") return "en";
  const primaryLanguage = locale.trim().replaceAll("_", "-").toLowerCase().split("-", 1)[0];
  return primaryLanguage === "ja" ? "ja" : "en";
}

export function standardPredicateVocabularyForLocale(
  locale?: string,
): readonly ResolvedAuthoringTerm[] {
  return normalizeStandardPredicateLocale(locale) === "ja"
    ? standardPredicateVocabularyJa
    : standardPredicateVocabularyEn;
}

export function standardPredicateTerms(
  options: StandardPredicateTermsOptions = {},
): ResolvedAuthoringTerm[] {
  const vocabulary = standardPredicateVocabularyForLocale(options.locale);
  const accepted = options.categories?.length ? new Set(options.categories) : undefined;
  return vocabulary
    .filter((term) => !accepted || accepted.has(term.category!))
    .map(cloneTerm);
}

export function standardPredicateTermsEn(
  categories?: readonly string[],
): ResolvedAuthoringTerm[] {
  return standardPredicateTerms({ locale: "en", categories });
}

/** Backward-compatible Japanese category selector. */
export function standardPredicateTermsJa(
  categories?: readonly string[],
): ResolvedAuthoringTerm[] {
  return standardPredicateTerms({ locale: "ja", categories });
}

function definition(
  iri: string,
  en: readonly [string, string, string, string, string],
  ja: readonly [string, string, string, string, string],
  structural = false,
): StandardPredicateDefinition {
  return {
    iri,
    ...(structural ? { structural: true } : {}),
    en: presentation(en),
    ja: presentation(ja),
  };
}

function presentation(
  values: readonly [string, string, string, string, string],
): StandardPredicatePresentation {
  const [label, category, sentencePattern, description, example] = values;
  return { label, category, sentencePattern, description, example };
}

function createVocabulary(
  locale: StandardPredicateLocale,
): readonly ResolvedAuthoringTerm[] {
  return Object.freeze(standardPredicateDefinitions.map((entry) => {
    const localized = entry[locale];
    return {
      iri: entry.iri,
      kind: "property",
      roles: ["predicate"],
      label: localized.label,
      description: localized.description,
      category: localized.category,
      sentencePattern: localized.sentencePattern,
      examples: [localized.example],
      objectKinds: ["iri"],
      ...(entry.structural ? { structural: true } : {}),
    } satisfies ResolvedAuthoringTerm;
  }));
}

function cloneTerm(term: ResolvedAuthoringTerm): ResolvedAuthoringTerm {
  return {
    ...term,
    roles: term.roles ? [...term.roles] : undefined,
    examples: term.examples ? [...term.examples] : undefined,
    objectKinds: term.objectKinds ? [...term.objectKinds] : undefined,
  };
}
