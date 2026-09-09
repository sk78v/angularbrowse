/**
 * Types for the subset of the Azure DevOps Server (on-prem) REST API used by
 * the YAML file browser. Field names mirror the wire format exactly.
 */

/** How the app authenticates against the on-prem collection. */
export type AdoAuthMode = 'pat' | 'windows';

/** Everything needed to reach a repository on an on-prem ADO/TFS server. */
export interface AdoConnection {
  /**
   * Base address of the server, including the virtual directory.
   * Direct:  https://ado.contoso.com/tfs
   * Proxied: /ado   (see proxy.conf.json - avoids browser CORS in dev)
   */
  baseUrl: string;
  /** Collection name, e.g. DefaultCollection. */
  collection: string;
  /** Team project name or id. */
  project: string;
  /** api-version to send. 2019 -> 5.0, 2020 -> 6.0, 2022 -> 7.0. */
  apiVersion: string;
  authMode: AdoAuthMode;
  /** Personal access token. Only used when authMode is 'pat'. */
  pat: string;
}

export interface AdoRepository {
  id: string;
  name: string;
  defaultBranch?: string;
  project?: { id: string; name: string };
}

/** A row from the refs endpoint, e.g. { name: 'refs/heads/main' }. */
export interface AdoRef {
  name: string;
  objectId: string;
}

/** A file or folder as returned by the git items endpoint. */
export interface AdoItem {
  objectId: string;
  commitId?: string;
  gitObjectType?: 'blob' | 'tree' | string;
  path: string;
  isFolder?: boolean;
  size?: number;
  url?: string;
}

/** An item plus the presentation state the browser needs. */
export interface BrowserEntry {
  /** Full repo path, always leading-slash, e.g. /src/pipelines/build.yml */
  path: string;
  /** Trailing segment only, e.g. build.yml */
  name: string;
  isFolder: boolean;
  isYaml: boolean;
  size?: number;
  objectId: string;
}

/** What the browser hands back to the host when the user confirms. */
export interface SelectedYamlFile {
  path: string;
  name: string;
  repository: AdoRepository;
  branch: string;
  objectId: string;
  size?: number;
  /** Raw file text, fetched on confirm. */
  content: string;
}

export interface AdoListResponse<T> {
  count: number;
  value: T[];
}

/** Extensions the browser treats as selectable YAML. */
export const YAML_EXTENSIONS = ['.yml', '.yaml'] as const;

export function isYamlPath(path: string): boolean {
  const lower = path.toLowerCase();
  return YAML_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Trailing path segment, or '/' for the repository root. */
export function basename(path: string): string {
  if (!path || path === '/') return '/';
  const trimmed = path.replace(/\/+$/, '');
  if (!trimmed) return '/';
  const idx = trimmed.lastIndexOf('/');
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

/** Parent folder of a repo path. Root's parent is root. */
export function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx <= 0 ? '/' : trimmed.slice(0, idx);
}

/** 'refs/heads/main' -> 'main'; anything else is passed through. */
export function shortBranchName(refName: string): string {
  return refName.startsWith('refs/heads/') ? refName.slice('refs/heads/'.length) : refName;
}
