import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  basename,
  isYamlPath,
  shortBranchName,
  type AdoConnection,
  type AdoItem,
  type AdoListResponse,
  type AdoRef,
  type AdoRepository,
  type BrowserEntry,
} from '../models/ado.models';

/** Request options shared by every call, derived from the auth mode. */
interface AuthOptions {
  headers: HttpHeaders;
  withCredentials: boolean;
}

/**
 * Thin client over the Azure DevOps Server (on-prem) git REST API.
 *
 * Only the handful of endpoints the file browser needs are implemented:
 * repositories, branch refs, a one-level item listing, and file content.
 */
@Injectable({ providedIn: 'root' })
export class AdoService {
  private readonly http = inject(HttpClient);

  /** GET {base}/{collection}/{project}/_apis/git/repositories */
  async listRepositories(conn: AdoConnection): Promise<AdoRepository[]> {
    const res = await this.get<AdoListResponse<AdoRepository>>(
      conn,
      this.projectApi(conn, 'git/repositories'),
      new HttpParams(),
    );
    return [...(res.value ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Branch names (already shortened from refs/heads/*) for a repository. */
  async listBranches(conn: AdoConnection, repositoryId: string): Promise<string[]> {
    const res = await this.get<AdoListResponse<AdoRef>>(
      conn,
      this.projectApi(conn, `git/repositories/${encodeURIComponent(repositoryId)}/refs`),
      new HttpParams().set('filter', 'heads'),
    );
    return (res.value ?? [])
      .map((ref) => shortBranchName(ref.name))
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * Immediate children of `folderPath` in the given branch.
   *
   * ADO returns the scoped folder itself alongside its children, so the entry
   * matching the requested path is dropped. Folders sort ahead of files.
   */
  async listFolder(
    conn: AdoConnection,
    repositoryId: string,
    branch: string,
    folderPath: string,
  ): Promise<BrowserEntry[]> {
    const scopePath = this.normalisePath(folderPath);
    let params = new HttpParams().set('scopePath', scopePath).set('recursionLevel', 'OneLevel');
    params = this.withVersion(params, branch);

    const res = await this.get<AdoListResponse<AdoItem>>(
      conn,
      this.projectApi(conn, `git/repositories/${encodeURIComponent(repositoryId)}/items`),
      params,
    );

    return (res.value ?? [])
      .filter((item) => this.normalisePath(item.path) !== scopePath)
      .map((item) => this.toEntry(item))
      .sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
  }

  /** Raw text of a single file at a branch tip. */
  async getFileContent(
    conn: AdoConnection,
    repositoryId: string,
    branch: string,
    filePath: string,
  ): Promise<string> {
    let params = new HttpParams()
      .set('path', this.normalisePath(filePath))
      .set('includeContent', 'true');
    params = this.withVersion(params, branch);

    const res = await this.get<AdoItem & { content?: string }>(
      conn,
      this.projectApi(conn, `git/repositories/${encodeURIComponent(repositoryId)}/items`),
      params,
    );
    return res.content ?? '';
  }

  /** Cheap round-trip used by the "Test connection" button. */
  async testConnection(conn: AdoConnection): Promise<number> {
    const repos = await this.listRepositories(conn);
    return repos.length;
  }

  // --- internals -----------------------------------------------------------

  private toEntry(item: AdoItem): BrowserEntry {
    const isFolder = item.isFolder === true || item.gitObjectType === 'tree';
    return {
      path: this.normalisePath(item.path),
      name: basename(item.path),
      isFolder,
      isYaml: !isFolder && isYamlPath(item.path),
      size: item.size,
      objectId: item.objectId,
    };
  }

  /** Pins the request to a branch rather than the repository default. */
  private withVersion(params: HttpParams, branch: string): HttpParams {
    if (!branch) return params;
    return params
      .set('versionDescriptor.version', branch)
      .set('versionDescriptor.versionType', 'branch');
  }

  /** Leading slash, no trailing slash, root stays as a bare slash. */
  private normalisePath(path: string): string {
    if (!path || path === '/') return '/';
    const withLead = path.startsWith('/') ? path : `/${path}`;
    return withLead.length > 1 ? withLead.replace(/\/+$/, '') : withLead;
  }

  /** {base}/{collection}/{project}/_apis/{resource} */
  private projectApi(conn: AdoConnection, resource: string): string {
    const base = conn.baseUrl.replace(/\/+$/, '');
    const collection = encodeURIComponent(conn.collection.trim());
    const project = encodeURIComponent(conn.project.trim());
    return `${base}/${collection}/${project}/_apis/${resource}`;
  }

  private authOptions(conn: AdoConnection): AuthOptions {
    let headers = new HttpHeaders().set('Accept', 'application/json');
    if (conn.authMode === 'pat') {
      // ADO expects an empty username and the PAT as the password.
      const token = btoa(`:${conn.pat.trim()}`);
      headers = headers.set('Authorization', `Basic ${token}`);
    }
    // Windows/NTLM auth relies on the browser negotiating with the server, so
    // the request carries credentials instead of an Authorization header.
    return { headers, withCredentials: conn.authMode === 'windows' };
  }

  private async get<T>(conn: AdoConnection, url: string, params: HttpParams): Promise<T> {
    const { headers, withCredentials } = this.authOptions(conn);
    const apiVersion = conn.apiVersion.trim() || '6.0';
    const withApi = params.set('api-version', apiVersion);
    try {
      return await firstValueFrom(
        this.http.get<T>(url, { headers, params: withApi, withCredentials }),
      );
    } catch (err) {
      throw new Error(this.describe(err, url, apiVersion));
    }
  }

  /**
   * Turns an HttpErrorResponse into something a user can act on. The status-0
   * case is by far the most common on-prem failure and is almost never the
   * server being down - it is CORS or an untrusted TLS certificate.
   */
  private describe(err: unknown, url: string, apiVersion: string): string {
    if (!(err instanceof HttpErrorResponse)) {
      return err instanceof Error ? err.message : 'Unexpected error.';
    }
    const serverMessage =
      typeof err.error === 'object' && err.error !== null && 'message' in err.error
        ? String((err.error as { message: unknown }).message)
        : '';

    switch (err.status) {
      case 0:
        return (
          `Could not reach ${url}. The browser blocked the request before it got a ` +
          `response - usually CORS, an untrusted TLS certificate, or an unreachable ` +
          `server. Point the base URL at the dev-server proxy (/ado) rather than at ` +
          `the ADO server address directly.`
        );
      case 401:
        return 'Unauthorized (401). The PAT is wrong, expired, or lacks the Code (Read) scope.';
      case 403:
        return `Forbidden (403). The credentials are valid but have no access to this resource. ${serverMessage}`.trim();
      case 404:
        return (
          `Not found (404). Check the collection, project, repository and branch names, ` +
          `and that this server supports api-version ${apiVersion}. ${serverMessage}`
        ).trim();
      default:
        return `Request failed (${err.status} ${err.statusText}). ${serverMessage}`.trim();
    }
  }
}
