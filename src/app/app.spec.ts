import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { AdoConnectionStore } from './services/ado-connection.store';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('creates the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the page heading', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('YAML file picker');
  });

  it('disables Browse until the connection is configured', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const browse = [...compiled.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Browse'),
    ) as HTMLButtonElement | undefined;
    expect(browse?.disabled).toBe(true);

    TestBed.inject(AdoConnectionStore).update({
      baseUrl: '/ado',
      collection: 'DefaultCollection',
      project: 'Demo',
      pat: 'token',
    });
    await fixture.whenStable();
    expect(browse?.disabled).toBe(false);
  });

  it('does not open the browser dialog while unconfigured', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('ado-yaml-browser')).toBeNull();
  });
});
