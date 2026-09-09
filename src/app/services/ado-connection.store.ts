import { Injectable, computed, signal } from '@angular/core';
import type { AdoConnection } from '../models/ado.models';

const STORAGE_KEY = 'ado-yaml-browser.connection';

const DEFAULT_CONNECTION: AdoConnection = {
  baseUrl: '/ado',
  collection: 'DefaultCollection',
  project: '',
  apiVersion: '6.0',
  authMode: 'pat',
  pat: '',
};

/**
 * Holds the on-prem connection settings for the session.
 *
 * Everything except the PAT is persisted to localStorage so a page reload does
 * not mean retyping the server address. The PAT is deliberately kept in memory
 * only - a token sitting in localStorage is readable by any script on the
 * origin and survives long after the user has walked away from the machine.
 */
@Injectable({ providedIn: 'root' })
export class AdoConnectionStore {
  private readonly state = signal<AdoConnection>(this.restore());

  readonly connection = this.state.asReadonly();

  /** True when there is enough information to attempt a call. */
  readonly isConfigured = computed(() => {
    const c = this.state();
    const hasCredentials = c.authMode === 'windows' || c.pat.trim().length > 0;
    return (
      c.baseUrl.trim().length > 0 &&
      c.collection.trim().length > 0 &&
      c.project.trim().length > 0 &&
      hasCredentials
    );
  });

  update(patch: Partial<AdoConnection>): void {
    const next = { ...this.state(), ...patch };
    this.state.set(next);
    this.persist(next);
  }

  reset(): void {
    this.state.set({ ...DEFAULT_CONNECTION });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable (private mode, blocked cookies); ignore.
    }
  }

  private persist(connection: AdoConnection): void {
    try {
      const { pat: _pat, ...safe } = connection;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    } catch {
      // Non-fatal: the app works fine without persistence.
    }
  }

  private restore(): AdoConnection {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_CONNECTION };
      const parsed = JSON.parse(raw) as Partial<AdoConnection>;
      // PAT is never restored - it was never written.
      return { ...DEFAULT_CONNECTION, ...parsed, pat: '' };
    } catch {
      return { ...DEFAULT_CONNECTION };
    }
  }
}
