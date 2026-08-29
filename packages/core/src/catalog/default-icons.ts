import type {
  AssetAccess,
  AssetResolveRequest,
  AssetResolveResult,
  AssetResolver,
} from "../projection/assets.js";
import type { AssetDefinition } from "../document/model.js";

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
  { name: "cog", label: "歯車", body: '<path d="M11 10.27 7 3.34" /> <path d="m11 13.73-4 6.93" /> <path d="M12 22v-2" /> <path d="M12 2v2" /> <path d="M14 12h8" /> <path d="m17 20.66-1-1.73" /> <path d="m17 3.34-1 1.73" /> <path d="M2 12h2" /> <path d="m20.66 17-1.73-1" /> <path d="m20.66 7-1.73 1" /> <path d="m3.34 17 1.73-1" /> <path d="m3.34 7 1.73 1" /> <circle cx="12" cy="12" r="2" /> <circle cx="12" cy="12" r="8" />' },
  { name: "clipboard-check", label: "タスク", body: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /> <path d="m9 14 2 2 4-4" />' },
  { name: "circle-play", label: "開始", body: '<path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z" /> <circle cx="12" cy="12" r="10" />' },
  { name: "circle-stop", label: "停止", body: '<circle cx="12" cy="12" r="10" /> <rect x="9" y="9" width="6" height="6" rx="1" />' },
  { name: "git-branch", label: "分岐", body: '<path d="M15 6a9 9 0 0 0-9 9V3" /> <circle cx="18" cy="6" r="3" /> <circle cx="6" cy="18" r="3" />' },
  { name: "repeat-2", label: "再試行", body: '<path d="m2 9 3-3 3 3" /> <path d="M13 18H7a2 2 0 0 1-2-2V6" /> <path d="m22 15-3 3-3-3" /> <path d="M11 6h6a2 2 0 0 1 2 2v10" />' },
  { name: "clock-3", label: "期限", body: '<circle cx="12" cy="12" r="10" /> <path d="M12 6v6h4" />' },
  { name: "file-text", label: "文書", body: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />' },
  { name: "file-search", label: "文書検索", body: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" /> <circle cx="11.5" cy="14.5" r="2.5" /> <path d="M13.3 16.3 15 18" />' },
  { name: "folder", label: "フォルダー", body: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />' },
  { name: "cloud-upload", label: "クラウドアップロード", body: '<path d="M12 13v8" /> <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /> <path d="m8 17 4-4 4 4" />' },
  { name: "cloud-download", label: "クラウドダウンロード", body: '<path d="M12 13v8l-4-4" /> <path d="m12 21 4-4" /> <path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284" />' },
  { name: "container", label: "コンテナー", body: '<path d="M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z" /> <path d="M10 21.9V14L2.1 9.1" /> <path d="m10 14 11.9-6.9" /> <path d="M14 19.8v-8.1" /> <path d="M18 17.5V9.4" />' },
  { name: "boxes", label: "サービス群", body: '<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z" /> <path d="m7 16.5-4.74-2.85" /> <path d="m7 16.5 5-3" /> <path d="M7 16.5v5.17" /> <path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z" /> <path d="m17 16.5-5-3" /> <path d="m17 16.5 4.74-2.85" /> <path d="M17 16.5v5.17" /> <path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z" /> <path d="M12 8 7.26 5.15" /> <path d="m12 8 4.74-2.85" /> <path d="M12 13.5V8" />' },
  { name: "router", label: "ルーター", body: '<rect width="20" height="8" x="2" y="14" rx="2" /> <path d="M6.01 18H6" /> <path d="M10.01 18H10" /> <path d="M15 10v4" /> <path d="M17.84 7.17a4 4 0 0 0-5.66 0" /> <path d="M20.66 4.34a8 8 0 0 0-11.31 0" />' },
  { name: "wifi", label: "無線ネットワーク", body: '<path d="M12 20h.01" /> <path d="M2 8.82a15 15 0 0 1 20 0" /> <path d="M5 12.859a10 10 0 0 1 14 0" /> <path d="M8.5 16.429a5 5 0 0 1 7 0" />' },
  { name: "table-2", label: "データ表", body: '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />' },
  { name: "chart-no-axes-combined", label: "分析", body: '<path d="M12 16v5" /> <path d="M16 14.639V21" /> <path d="M20 10.656V21" /> <path d="m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15" /> <path d="M4 18.463V21" /> <path d="M8 14.656V21" />' },
  { name: "message-square", label: "メッセージ", body: '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />' },
  { name: "mail", label: "メール", body: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" /> <rect x="2" y="4" width="20" height="16" rx="2" />' },
  { name: "bell", label: "通知", body: '<path d="M10.268 21a2 2 0 0 0 3.464 0" /> <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />' },
  { name: "shield-check", label: "セキュリティ", body: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /> <path d="m9 12 2 2 4-4" />' },
  { name: "key", label: "アクセスキー", body: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" /> <path d="m21 2-9.6 9.6" /> <circle cx="7.5" cy="15.5" r="5.5" />' },
  { name: "lock-keyhole", label: "ロック", body: '<circle cx="12" cy="16" r="1" /> <rect x="3" y="10" width="18" height="12" rx="2" /> <path d="M7 10V7a5 5 0 0 1 10 0v3" />' },
  { name: "credit-card", label: "決済", body: '<rect width="20" height="14" x="2" y="5" rx="2" /> <line x1="2" x2="22" y1="10" y2="10" />' },
  { name: "package", label: "荷物", body: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /> <path d="M12 22V12" /> <polyline points="3.29 7 12 12 20.71 7" /> <path d="m7.5 4.27 9 5.15" />' },
  { name: "truck", label: "配送", body: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /> <path d="M15 18H9" /> <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" /> <circle cx="17" cy="18" r="2" /> <circle cx="7" cy="18" r="2" />' },
  { name: "map-pin", label: "場所", body: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /> <circle cx="12" cy="10" r="3" />' },
  { name: "badge-check", label: "承認", body: '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" /><path d="m9 12 2 2 4-4" />' },
  { name: "triangle-alert", label: "警告", body: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />' },
  { name: "users-round", label: "チーム", body: '<path d="M18 21a8 8 0 0 0-16 0" /> <circle cx="10" cy="8" r="5" /> <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />' },
  { name: "building-2", label: "組織", body: '<path d="M10 12h4" /> <path d="M10 8h4" /> <path d="M14 21v-3a2 2 0 0 0-4 0v3" /> <path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" /> <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />' },
  { name: "calendar-check-2", label: "予定", body: '<path d="M 19 3 L 5 3" /> <path d="M 21 13 L 21 5" /> <path d="M 21 5 A2 2 0 0 0 19 3" /> <path d="M 3 19 A2 2 0 0 0 5 21" /> <path d="M 3 5 L 3 19" /> <path d="M 5 3 A2 2 0 0 0 3 5" /> <path d="m16 19 2 2 4-4" /> <path d="M16 2v3" /> <path d="M3 9h18" /> <path d="M5 21 L12.5 21" /> <path d="M8 2v3" />' },
  { name: "briefcase-business", label: "業務", body: '<path d="M12 12h.01" /> <path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /> <path d="M22 13a18.15 18.15 0 0 1-20 0" /> <rect width="20" height="14" x="2" y="6" rx="2" />' },
  { name: "contact", label: "顧客", body: '<path d="M16 2v2" /> <path d="M7 21v-2a2 2 0 012-2h6a2 2 0 012 2v2" /> <path d="M8 2v2" /> <circle cx="12" cy="10" r="3" /> <rect x="3" y="3" width="18" height="18" rx="2" />' },
  { name: "handshake", label: "合意", body: '<path d="m11 17 2 2a1 1 0 1 0 3-3" /> <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" /> <path d="m21 3 1 11h-2" /> <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" /> <path d="M3 4h8" />' },
  { name: "stamp", label: "押印", body: '<path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13" /> <path d="M20 15.5a2.5 2.5 0 0 0-2.5-2.5h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z" /> <path d="M5 22h14" />' },
  { name: "circle-dollar-sign", label: "金額", body: '<circle cx="12" cy="12" r="10" /> <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /> <path d="M12 18V6" />' },
  { name: "cloud-cog", label: "クラウド設定", body: '<path d="m10.852 19.772-.383.924" /> <path d="m13.148 14.228.383-.923" /> <path d="M13.148 19.772a3 3 0 1 0-2.296-5.544l-.383-.923" /> <path d="m13.53 20.696-.382-.924a3 3 0 1 1-2.296-5.544" /> <path d="m14.772 15.852.923-.383" /> <path d="m14.772 18.148.923.383" /> <path d="M4.2 15.1a7 7 0 1 1 9.93-9.858A7 7 0 0 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.2" /> <path d="m9.228 15.852-.923-.383" /> <path d="m9.228 18.148-.923.383" />' },
  { name: "server-cog", label: "サーバー設定", body: '<path d="m10.852 14.772-.383.923" /> <path d="M13.148 14.772a3 3 0 1 0-2.296-5.544l-.383-.923" /> <path d="m13.148 9.228.383-.923" /> <path d="m13.53 15.696-.382-.924a3 3 0 1 1-2.296-5.544" /> <path d="m14.772 10.852.923-.383" /> <path d="m14.772 13.148.923.383" /> <path d="M4.5 10H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-.5" /> <path d="M4.5 14H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-.5" /> <path d="M6 18h.01" /> <path d="M6 6h.01" /> <path d="m9.228 10.852-.923-.383" /> <path d="m9.228 13.148-.923.383" />' },
  { name: "cpu", label: "コンピューティング", body: '<path d="M12 20v2" /> <path d="M12 2v2" /> <path d="M17 20v2" /> <path d="M17 2v2" /> <path d="M2 12h2" /> <path d="M2 17h2" /> <path d="M2 7h2" /> <path d="M20 12h2" /> <path d="M20 17h2" /> <path d="M20 7h2" /> <path d="M7 20v2" /> <path d="M7 2v2" /> <rect x="4" y="4" width="16" height="16" rx="2" /> <rect x="8" y="8" width="8" height="8" rx="1" />' },
  { name: "memory-stick", label: "メモリ", body: '<path d="M12 12v-2" /> <path d="M12 18v-2" /> <path d="M16 12v-2" /> <path d="M16 18v-2" /> <path d="M2 11h1.5" /> <path d="M20 18v-2" /> <path d="M20.5 11H22" /> <path d="M4 18v-2" /> <path d="M8 12v-2" /> <path d="M8 18v-2" /> <rect x="2" y="6" width="20" height="10" rx="2" />' },
  { name: "cable", label: "有線接続", body: '<path d="M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1z" /> <path d="M17 21v-2" /> <path d="M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10" /> <path d="M21 21v-2" /> <path d="M3 5V3" /> <path d="M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2z" /> <path d="M7 5V3" />' },
  { name: "globe", label: "インターネット", body: '<circle cx="12" cy="12" r="10" /> <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /> <path d="M2 12h20" />' },
  { name: "satellite-dish", label: "外部通信", body: '<path d="M4 10a7.31 7.31 0 0 0 10 10Z" /> <path d="m9 15 3-3" /> <path d="M17 13a6 6 0 0 0-6-6" /> <path d="M21 13A10 10 0 0 0 11 3" />' },
  { name: "webhook", label: "Webhook", body: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" /> <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" /> <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />' },
  { name: "file-spreadsheet", label: "表計算", body: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" /> <path d="M8 13h2" /> <path d="M14 13h2" /> <path d="M8 17h2" /> <path d="M14 17h2" />' },
  { name: "binary", label: "バイナリデータ", body: '<rect x="14" y="14" width="4" height="6" rx="2" /> <rect x="6" y="4" width="4" height="6" rx="2" /> <path d="M6 20h4" /> <path d="M14 10h4" /> <path d="M6 14h2v6" /> <path d="M14 4h2v6" />' },
  { name: "search", label: "検索", body: '<path d="m21 21-4.34-4.34" /> <circle cx="11" cy="11" r="8" />' },
  { name: "funnel", label: "絞り込み", body: '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />' },
  { name: "archive", label: "アーカイブ", body: '<rect width="20" height="5" x="2" y="3" rx="1" /> <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /> <path d="M10 12h4" />' },
  { name: "scan-search", label: "データ解析", body: '<path d="M3 7V5a2 2 0 0 1 2-2h2" /> <path d="M17 3h2a2 2 0 0 1 2 2v2" /> <path d="M21 17v2a2 2 0 0 1-2 2h-2" /> <path d="M7 21H5a2 2 0 0 1-2-2v-2" /> <circle cx="12" cy="12" r="3" /> <path d="m16 16-1.9-1.9" />' },
  { name: "shield-alert", label: "セキュリティ警告", body: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /> <path d="M12 8v4" /> <path d="M12 16h.01" />' },
  { name: "shield-user", label: "アクセス制御", body: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /> <path d="M6.376 18.91a6 6 0 0 1 11.249.003" /> <circle cx="12" cy="11" r="4" />' },
  { name: "key-round", label: "認証キー", body: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /> <circle cx="16.5" cy="7.5" r=".5" fill="#334155" />' },
  { name: "scan-face", label: "本人確認", body: '<path d="M3 7V5a2 2 0 0 1 2-2h2" /> <path d="M17 3h2a2 2 0 0 1 2 2v2" /> <path d="M21 17v2a2 2 0 0 1-2 2h-2" /> <path d="M7 21H5a2 2 0 0 1-2-2v-2" /> <path d="M8 14s1.5 2 4 2 4-2 4-2" /> <path d="M9 9h.01" /> <path d="M15 9h.01" />' },
  { name: "activity", label: "稼働状況", body: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />' },
  { name: "gauge", label: "メトリクス", body: '<path d="m12 14 4-4" /> <path d="M3.34 19a10 10 0 1 1 17.32 0" />' },
  { name: "logs", label: "ログ", body: '<path d="M3 5h1" /> <path d="M3 12h1" /> <path d="M3 19h1" /> <path d="M8 5h1" /> <path d="M8 12h1" /> <path d="M8 19h1" /> <path d="M13 5h8" /> <path d="M13 12h8" /> <path d="M13 19h8" />' },
  { name: "bug", label: "障害", body: '<path d="M12 20v-9" /> <path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" /> <path d="M14.12 3.88 16 2" /> <path d="M21 21a4 4 0 0 0-3.81-4" /> <path d="M21 5a4 4 0 0 1-3.55 3.97" /> <path d="M22 13h-4" /> <path d="M3 21a4 4 0 0 1 3.81-4" /> <path d="M3 5a4 4 0 0 0 3.55 3.97" /> <path d="M6 13H2" /> <path d="m8 2 1.88 1.88" /> <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />' },
  { name: "wrench", label: "保守", body: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" />' },
  { name: "siren", label: "インシデント", body: '<path d="M7 18v-6a5 5 0 1 1 10 0v6" /> <path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z" /> <path d="M21 12h1" /> <path d="M18.5 4.5 18 5" /> <path d="M2 12h1" /> <path d="M12 2v1" /> <path d="m4.929 4.929.707.707" /> <path d="M12 12v6" />' },
  { name: "monitor-check", label: "監視", body: '<path d="m9 10 2 2 4-4" /> <rect width="20" height="14" x="2" y="3" rx="2" /> <path d="M12 17v4" /> <path d="M8 21h8" />' },
  { name: "bot", label: "自動化", body: '<path d="M12 8V4H8" /> <rect width="16" height="12" x="4" y="8" rx="2" /> <path d="M2 14h2" /> <path d="M20 14h2" /> <path d="M15 13v2" /> <path d="M9 13v2" />' },
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

export function packageDefaultIconIntrinsicSize(assetRef: string): {
  width: 24;
  height: 24;
  aspectRatio: 1;
  source: "svg-view-box";
} | undefined {
  return sourceByRef.has(assetRef)
    ? { width: 24, height: 24, aspectRatio: 1, source: "svg-view-box" }
    : undefined;
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
          svgViewBox: "0 0 24 24",
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
