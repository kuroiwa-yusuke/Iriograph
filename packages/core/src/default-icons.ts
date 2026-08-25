import type {
  AssetAccess,
  AssetResolveRequest,
  AssetResolveResult,
  AssetResolver,
} from "./assets.js";
import type { AssetDefinition } from "./model.js";

const LUCIDE_COMMIT = "23f9abc4ed0146cffededd3d7f94c1018bfdf693";
const LUCIDE_BASE = `https://github.com/lucide-icons/lucide/blob/${LUCIDE_COMMIT}/icons`;
/** Reserved for immutable icons shipped by this package release. */
export const PACKAGE_DEFAULT_ICON_NAMESPACE = "urn:iriograph:icon:lucide:";
const META = "https://iriograph.dev/ns/package-icon#";

type IconSpec = {
  name: string;
  label: string;
  body: string;
  license?: "MIT";
};

const iconSpecs: readonly IconSpec[] = [
  { name: "cloud", label: "クラウド", body: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />' },
  { name: "server", label: "サーバー", license: "MIT", body: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2" /><rect width="20" height="8" x="2" y="14" rx="2" ry="2" /><line x1="6" x2="6.01" y1="6" y2="6" /><line x1="6" x2="6.01" y1="18" y2="18" />' },
  { name: "database", label: "データベース", license: "MIT", body: '<ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" />' },
  { name: "hard-drive", label: "ストレージ", body: '<path d="M10 16h.01" /><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /><path d="M21.946 12.013H2.054" /><path d="M6 16h.01" />' },
  { name: "braces", label: "API", body: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" /><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />' },
  { name: "square-function", label: "関数", body: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><path d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3" /><path d="M9 11.2h5.7" />' },
  { name: "workflow", label: "フロー", body: '<rect width="8" height="8" x="3" y="3" rx="2" /><path d="M7 11v4a2 2 0 0 0 2 2h4" /><rect width="8" height="8" x="13" y="13" rx="2" />' },
  { name: "list-tree", label: "キュー", body: '<path d="M8 5h13" /><path d="M13 12h8" /><path d="M13 19h8" /><path d="M3 10a2 2 0 0 0 2 2h3" /><path d="M3 5v12a2 2 0 0 0 2 2h3" />' },
  { name: "network", label: "ネットワーク", body: '<rect x="16" y="16" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="9" y="2" width="6" height="6" rx="1" /><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /><path d="M12 12V8" />' },
  { name: "user-round", label: "ユーザー", body: '<circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" />' },
  { name: "file-text", label: "文書", body: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />' },
  { name: "badge-check", label: "承認", body: '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" /><path d="m9 12 2 2 4-4" />' },
  { name: "triangle-alert", label: "警告", body: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />' },
];

export type PackageDefaultIcon = {
  assetRef: string;
  name: string;
  label: string;
  mediaType: "image/svg+xml";
  sourceUrl: string;
  license: "ISC" | "MIT";
  svg: string;
};

export const packageDefaultIcons: readonly PackageDefaultIcon[] = Object.freeze(iconSpecs.map((spec) => Object.freeze({
  assetRef: `${PACKAGE_DEFAULT_ICON_NAMESPACE}${spec.name}:1`,
  name: spec.name,
  label: spec.label,
  mediaType: "image/svg+xml" as const,
  sourceUrl: `${LUCIDE_BASE}/${spec.name}.svg`,
  license: spec.license ?? "ISC",
  svg: svgDocument(spec.body),
})));

export const packageDefaultIconAssets: Readonly<Record<string, AssetDefinition>> = Object.freeze(
  Object.fromEntries(packageDefaultIcons.map((icon) => [icon.assetRef, Object.freeze({
    assetRef: icon.assetRef,
    mediaType: icon.mediaType,
    url: `iriograph-package:icons/${icon.name}.svg`,
    extensions: {
      [`${META}label`]: icon.label,
      [`${META}source`]: icon.sourceUrl,
      [`${META}license`]: icon.license,
    },
  })])),
);

const sourceByRef = new Map(packageDefaultIcons.map((icon) => [icon.assetRef, icon.svg]));

export function packageDefaultIconDataUrl(assetRef: string): string | undefined {
  const source = sourceByRef.get(assetRef);
  return source ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}` : undefined;
}

/** Resolves bundled icons before an optional host workspace resolver. */
export function createPackageDefaultIconResolver(fallback?: AssetResolver): AssetResolver {
  return {
    async resolve(request: AssetResolveRequest): Promise<AssetResolveResult> {
      const source = sourceByRef.get(request.assetRef);
      if (!source) {
        return fallback?.resolve(request) ?? { status: "unresolved", reason: "not-found" };
      }
      return {
        status: "resolved",
        lease: {
          url: packageDefaultIconDataUrl(request.assetRef)!,
          mediaType: "image/svg+xml",
          byteLength: new TextEncoder().encode(source).byteLength,
          release() {},
        },
      };
    },
  };
}

/** Adds package icon policy/resolution without weakening the host's other asset policy. */
export function withPackageDefaultIconAccess(access?: AssetAccess): AssetAccess {
  if (access) {
    return {
      resolver: createPackageDefaultIconResolver(access.resolver),
      revision: `iriograph-package-icons@${LUCIDE_COMMIT}:${access.revision}`,
      policy: access.policy,
    };
  }
  return {
    resolver: createPackageDefaultIconResolver(),
    revision: `iriograph-package-icons@${LUCIDE_COMMIT}:standalone`,
    policy: {
      allowedMediaTypes: ["image/svg+xml"],
      maxBytes: 64 * 1024,
      allowedSchemes: ["data:"],
      allowedOrigins: ["null"],
    },
  };
}

function svgDocument(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
