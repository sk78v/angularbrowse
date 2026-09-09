import { Component, computed, inject, output, signal } from '@angular/core';
import { AdoService } from '../services/ado.service';
import { AdoConnectionStore } from '../services/ado-connection.store';
import {
  dirname,
  type AdoRepository,
  type BrowserEntry,
  type SelectedYamlFile,
} from '../models/ado.models';

/** One segment of the breadcrumb trail. */
interface Crumb {
  label: string;
  path: string;
}

/**
 * Modal "open file" dialog for picking a YAML file out of a git repository on
 * an on-prem Azure DevOps Server.
 *
 * The host renders this only while the dialog should be visible; it loads the
 * repository list on construction and emits either `picked` or `cancelled`.
 * Folder listings are cached per repo/branch/path so walking back up the tree
 * does not re-hit the server.
 */
@Component({
  selector: 'ado-yaml-browser',
  templateUrl: './yaml-browser.html',
  styleUrl: './yaml-browser.css',
  host: {
    '(document:keydown.escape)': 'cancel()',
  },
})
export class YamlBrowser {
  private readonly ado = inject(AdoService);
  private readonly store = inject(AdoConnectionStore);

  /** Emitted with the chosen file and its contents. */
  readonly picked = output<SelectedYamlFile>();
  /** Emitted when the user dismisses the dialog without choosing. */
  readonly cancelled = output<void>();

  protected readonly repositories = signal<AdoRepository[]>([]);
  protected readonly repositoryId = signal('');
  protected readonly branches = signal<string[]>([]);
  protected readonly branch = signal('');

  protected readonly currentPath = signal('/');
  protected readonly entries = signal<BrowserEntry[]>([]);
  protected readonly highlighted = signal<BrowserEntry | null>(null);

  protected readonly loading = signal(false);
  protected readonly confirming = signal(false);
  protected readonly error = signal('');

  protected readonly filterText = signal('');
  /** When false (the default) only folders and YAML files are listed. */
  protected readonly showAllFiles = signal(false);

  /** Folder listings keyed by `${repoId}@${branch}:${path}`. */
  private readonly cache = new Map<string, BrowserEntry[]>();

  protected readonly repository = computed(
    () => this.repositories().find((r) => r.id === this.repositoryId()) ?? null,
  );

  protected readonly isRoot = computed(() => this.currentPath() === '/');

  protected readonly crumbs = computed<Crumb[]>(() => {
    const trail: Crumb[] = [{ label: this.repository()?.name ?? 'Repository', path: '/' }];
    const path = this.currentPath();
    if (path === '/') return trail;

    let accumulated = '';
    for (const segment of path.split('/').filter(Boolean)) {
      accumulated += `/${segment}`;
      trail.push({ label: segment, path: accumulated });
    }
    return trail;
  });

  /** Entries after the YAML-only toggle and the name filter are applied. */
  protected readonly visibleEntries = computed(() => {
    const needle = this.filterText().trim().toLowerCase();
    return this.entries().filter((entry) => {
      if (!this.showAllFiles() && !entry.isFolder && !entry.isYaml) return false;
      return !needle || entry.name.toLowerCase().includes(needle);
    });
  });

  protected readonly canConfirm = computed(() => {
    const entry = this.highlighted();
    return !!entry && entry.isYaml && !this.confirming();
  });

  /** Set once the listing succeeded but nothing survived the filters. */
  protected readonly emptyMessage = computed(() => {
    if (this.loading() || this.error() || this.visibleEntries().length > 0) return '';
    if (this.entries().length === 0) return 'This folder is empty.';
    if (this.filterText().trim()) return 'No entries match the filter.';
    return 'No YAML files here. Turn on "Show all files" to see the rest.';
  });

  constructor() {
    void this.initialise();
  }

  // --- loading -------------------------------------------------------------

  private async initialise(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const repos = await this.ado.listRepositories(this.store.connection());
      this.repositories.set(repos);
      if (repos.length === 0) {
        this.error.set('The project contains no git repositories.');
        return;
      }
      await this.selectRepository(repos[0]);
    } catch (err) {
      this.error.set(this.messageOf(err));
    } finally {
      this.loading.set(false);
    }
  }

  private async selectRepository(repo: AdoRepository): Promise<void> {
    this.repositoryId.set(repo.id);
    this.branches.set([]);
    this.branch.set('');

    const branches = await this.ado.listBranches(this.store.connection(), repo.id);
    this.branches.set(branches);

    // Prefer the repository's own default branch, then the usual suspects.
    const preferred = repo.defaultBranch?.replace('refs/heads/', '') ?? '';
    const chosen =
      branches.find((b) => b === preferred) ??
      branches.find((b) => b === 'main') ??
      branches.find((b) => b === 'master') ??
      branches[0] ??
      '';
    this.branch.set(chosen);
    await this.navigateTo('/');
  }

  /** Loads a folder, serving from cache when it has been visited before. */
  private async navigateTo(path: string): Promise<void> {
    const repoId = this.repositoryId();
    const branch = this.branch();
    if (!repoId || !branch) return;

    this.currentPath.set(path);
    this.highlighted.set(null);
    this.error.set('');

    const key = `${repoId}@${branch}:${path}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.entries.set(cached);
      return;
    }

    this.loading.set(true);
    this.entries.set([]);
    try {
      const items = await this.ado.listFolder(this.store.connection(), repoId, branch, path);
      this.cache.set(key, items);
      this.entries.set(items);
    } catch (err) {
      this.error.set(this.messageOf(err));
    } finally {
      this.loading.set(false);
    }
  }

  // --- template actions ----------------------------------------------------

  protected async onRepositoryChange(id: string): Promise<void> {
    const repo = this.repositories().find((r) => r.id === id);
    if (!repo) return;
    this.loading.set(true);
    this.error.set('');
    try {
      await this.selectRepository(repo);
    } catch (err) {
      this.error.set(this.messageOf(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async onBranchChange(branch: string): Promise<void> {
    this.branch.set(branch);
    await this.navigateTo('/');
  }

  protected onEntryClick(entry: BrowserEntry): void {
    // Folders are navigation targets; only YAML files can be highlighted.
    if (entry.isFolder) {
      void this.navigateTo(entry.path);
      return;
    }
    this.highlighted.set(entry.isYaml ? entry : null);
  }

  protected onEntryDoubleClick(entry: BrowserEntry): void {
    if (entry.isFolder) return; // The single click already navigated.
    if (entry.isYaml) {
      this.highlighted.set(entry);
      void this.confirm();
    }
  }

  protected goUp(): void {
    if (this.isRoot()) return;
    void this.navigateTo(dirname(this.currentPath()));
  }

  protected goToCrumb(crumb: Crumb): void {
    if (crumb.path !== this.currentPath()) void this.navigateTo(crumb.path);
  }

  protected refresh(): void {
    this.cache.delete(`${this.repositoryId()}@${this.branch()}:${this.currentPath()}`);
    void this.navigateTo(this.currentPath());
  }

  /** Fetches the file body, then hands the result to the host. */
  protected async confirm(): Promise<void> {
    const entry = this.highlighted();
    const repo = this.repository();
    if (!entry || !repo || !entry.isYaml) return;

    this.confirming.set(true);
    this.error.set('');
    try {
      const content = await this.ado.getFileContent(
        this.store.connection(),
        repo.id,
        this.branch(),
        entry.path,
      );
      this.picked.emit({
        path: entry.path,
        name: entry.name,
        repository: repo,
        branch: this.branch(),
        objectId: entry.objectId,
        size: entry.size,
        content,
      });
    } catch (err) {
      this.error.set(this.messageOf(err));
    } finally {
      this.confirming.set(false);
    }
  }

  protected cancel(): void {
    this.cancelled.emit();
  }

  // --- presentation helpers ------------------------------------------------

  protected iconFor(entry: BrowserEntry): string {
    if (entry.isFolder) return '\u{1F4C1}';
    return entry.isYaml ? '\u{1F4DC}' : '\u{1F4C4}';
  }

  protected formatSize(bytes: number | undefined): string {
    if (bytes === undefined) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
