import type { IriographDocument } from "@iriograph/core";

const DEMO = "urn:iriograph:demo:";

export const mockDocument: IriographDocument = {
  schemaVersion: "1",
  kind: "iriograph.document",
  documentId: "purchase-approval",
  semantic: {
    format: "text/turtle",
    baseIri: DEMO,
    source: `@prefix wf: <urn:iriograph:demo:> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

wf:requesterLane a wf:Lane ;
  rdfs:label "申請者" .

wf:operationsLane a wf:Lane ;
  rdfs:label "業務オペレーション" .

wf:start a wf:StartEvent ;
  rdfs:label "開始" ;
  wf:inLane wf:requesterLane .

wf:submit a wf:UserTask ;
  rdfs:label "申請を提出" ;
  wf:inLane wf:requesterLane .

wf:review a wf:UserTask ;
  rdfs:label "内容を審査" ;
  wf:inLane wf:operationsLane ;
  wf:uses wf:approvalPolicy .

wf:approvalPolicy a wf:Reference ;
  rdfs:label "承認ポリシー" ;
  wf:inLane wf:operationsLane .

wf:gateway a wf:ExclusiveGateway ;
  rdfs:label "承認？" ;
  wf:inLane wf:operationsLane .

wf:register a wf:ServiceTask ;
  rdfs:label "承認結果を登録" ;
  wf:inLane wf:operationsLane .

wf:rework a wf:UserTask ;
  rdfs:label "内容を修正" ;
  wf:inLane wf:operationsLane .

wf:end a wf:EndEvent ;
  rdfs:label "完了" ;
  wf:inLane wf:operationsLane .

wf:flow1 a wf:SequenceFlow ; wf:from wf:start ; wf:to wf:submit .
wf:flow2 a wf:SequenceFlow ; wf:from wf:submit ; wf:to wf:review .
wf:flow3 a wf:SequenceFlow ; wf:from wf:review ; wf:to wf:gateway .
wf:flow4 a wf:SequenceFlow ; wf:from wf:gateway ; wf:to wf:register ; rdfs:label "承認" .
wf:flow5 a wf:SequenceFlow ; wf:from wf:gateway ; wf:to wf:rework ; rdfs:label "差戻し" .
wf:flow6 a wf:SequenceFlow ; wf:from wf:rework ; wf:to wf:review .
wf:flow7 a wf:SequenceFlow ; wf:from wf:register ; wf:to wf:end .
`,
  },
  imports: [
    { catalogRef: "urn:iriograph:catalog:workflow-mock@1" },
  ],
  views: [
    {
      viewId: "main",
      kind: "node-link",
      profileRef: "urn:iriograph:profile:bpmn-like:1",
      layoutRef: "urn:iriograph:layout:hierarchical-lr:1",
      overlay: {
        "lane:requester": {
          semanticRef: `${DEMO}requesterLane`,
          geometry: { x: 42, y: 44, width: 1036, height: 196 },
          pinned: true,
          placement: "generated",
        },
        "lane:operations": {
          semanticRef: `${DEMO}operationsLane`,
          geometry: { x: 42, y: 258, width: 1036, height: 364 },
          pinned: true,
          placement: "generated",
        },
        "node:start": {
          semanticRef: `${DEMO}start`,
          geometry: { x: 92, y: 112, width: 58, height: 58 },
          pinned: false,
          placement: "generated",
        },
        "node:submit": {
          semanticRef: `${DEMO}submit`,
          geometry: { x: 220, y: 102, width: 170, height: 76 },
          pinned: false,
          placement: "generated",
        },
        "node:review": {
          semanticRef: `${DEMO}review`,
          geometry: { x: 220, y: 344, width: 170, height: 76 },
          pinned: false,
          placement: "generated",
        },
        "node:policy": {
          semanticRef: `${DEMO}approvalPolicy`,
          geometry: { x: 220, y: 486, width: 168, height: 72 },
          pinned: false,
          placement: "generated",
        },
        "node:gateway": {
          semanticRef: `${DEMO}gateway`,
          geometry: { x: 478, y: 340, width: 84, height: 84 },
          pinned: false,
          placement: "generated",
        },
        "node:register": {
          semanticRef: `${DEMO}register`,
          geometry: { x: 664, y: 318, width: 170, height: 76 },
          pinned: false,
          placement: "generated",
        },
        "node:rework": {
          semanticRef: `${DEMO}rework`,
          geometry: { x: 664, y: 472, width: 170, height: 76 },
          pinned: false,
          placement: "generated",
        },
        "node:end": {
          semanticRef: `${DEMO}end`,
          geometry: { x: 940, y: 326, width: 58, height: 58 },
          pinned: false,
          placement: "generated",
        }
      },
    },
  ],
};
