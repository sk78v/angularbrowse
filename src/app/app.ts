import { Component, computed, inject, signal } from '@angular/core';
import { YamlBrowser } from './yaml-browser/yaml-browser';
import { AdoService } from './services/ado.service';
import { AdoConnectionStore } from './services/ado-connection.store';
import type { AdoAuthMode, AdoConnection, SelectedYamlFile } from './models/ado.models';

/** Outcome of the "Test connection" button. */
interface TestResult {
  ok: boolean;
  message: string;
}

@Component({
  selector: 'app-root',
  imports: [YamlBrowser],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly ado = inject(AdoService);
  private readonly store = inject(AdoConnectionStore);

  protected readonly connection = this.store.connection;
  protected readonly isConfigured = this.store.isConfigured;

  protected readonly settingsOpen = signal(true);
  protected readonly browserOpen = signal(false);
  protected readonly selected = signal<SelectedYamlFile | null>(null);

  protected readonly testing = signal(false);
  protected readonly testResult = signal<TestResult | null>(null);

  /** File body split for the numbered preview. */
  protected readonly previewLines = computed(() => {
    const file = this.selected();
    if (!file) return [];
    return file.content.replace(/\r\n/g, '\n').split('\n');
  });

  protected update<K extends keyof AdoConnection>(key: K, value: AdoConnection[K]): void {
    this.store.update({ [key]: value } as Partial<AdoConnection>);
    this.testResult.set(null);
  }

  protected onAuthModeChange(value: string): void {
    this.update('authMode', value as AdoAuthMode);
  }

  protected openBrowser(): void {
    if (!this.isConfigured()) return;
    this.browserOpen.set(true);
  }

  protected onPicked(file: SelectedYamlFile): void {
    this.selected.set(file);
    this.browserOpen.set(false);
    this.settingsOpen.set(false);
  }

  protected onCancelled(): void {
    this.browserOpen.set(false);
  }

  protected clearSelection(): void {
    this.selected.set(null);
  }

  protected async testConnection(): Promise<void> {
    this.testing.set(true);
    this.testResult.set(null);
    try {
      const count = await this.ado.testConnection(this.connection());
      this.testResult.set({
        ok: true,
        message: `Connected. Found ${count} repositor${count === 1 ? 'y' : 'ies'} in this project.`,
      });
    } catch (err) {
      this.testResult.set({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.testing.set(false);
    }
  }

  protected resetConnection(): void {
    this.store.reset();
    this.testResult.set(null);
    this.selected.set(null);
  }
}
