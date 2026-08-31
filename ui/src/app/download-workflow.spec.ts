import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { CookieService } from 'ngx-cookie-service';
import { App } from './app';
import { Download } from './interfaces';
import { DownloadsService } from './services/downloads.service';

class DownloadsServiceStub {
  loading = false;
  queue = new Map<string, Download>();
  done = new Map<string, Download>();
  configuration: Record<string, unknown> = {
    CUSTOM_DIRS: true,
    CREATE_CUSTOM_DIRS: true,
    ALLOW_YTDL_OPTIONS_OVERRIDES: false,
    PUBLIC_HOST_URL: 'download/',
    PUBLIC_HOST_AUDIO_URL: 'audio_download/',
  };
  customDirs = { download_dir: [], audio_download_dir: [] };
  queueChanged = new Subject<void>();
  doneChanged = new Subject<void>();
  configurationChanged = new Subject<Record<string, unknown>>();
  customDirsChanged = new Subject<Record<string, string[]>>();
  ytdlOptionsChanged = new Subject<Record<string, unknown>>();
  updated = new Subject<void>();

  getCookieStatus() {
    return of({ status: 'ok', has_cookies: false });
  }

  getPresets() {
    return of({ presets: [] });
  }

  add() {
    return of({ status: 'ok' as const });
  }

  retry() {
    return of({ status: 'ok' as const });
  }

  reportProblem() {
    return of({ status: 'ok' as const });
  }

  cancelAdd() {
    return of({ status: 'ok' as const });
  }

  startById() {
    return of({});
  }

  delById() {
    return of({});
  }

  delByFilter() {
    return of({});
  }

  startByFilter() {
    return of({});
  }

  uploadCookies() {
    return of({ status: 'ok' });
  }

  deleteCookies() {
    return of({ status: 'ok' });
  }
}

class CookieServiceStub {
  private cookies = new Map<string, string>();

  get(name: string) {
    return this.cookies.get(name) ?? '';
  }

  set(name: string, value: string) {
    this.cookies.set(name, value);
  }

  check(name: string) {
    return this.cookies.has(name);
  }
}

const makeDownload = (status: string, filename = ''): Download => ({
  id: 'audio1',
  title: 'Test Audio',
  url: 'https://example.com/audio',
  download_type: 'audio',
  quality: '320',
  format: 'mp3',
  folder: '',
  custom_name_prefix: '',
  playlist_item_limit: 0,
  status,
  msg: '',
  percent: status === 'finished' ? 100 : 50,
  speed: 0,
  eta: 0,
  filename,
  checked: false,
} as Download);

describe('compact download workflow', () => {
  let downloads: DownloadsServiceStub;

  beforeEach(async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      enumerable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    downloads = new DownloadsServiceStub();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: DownloadsService, useValue: downloads },
        { provide: CookieService, useClass: CookieServiceStub },
        {
          provide: HttpClient,
          useValue: {
            get: vi.fn().mockReturnValue(of({ 'yt-dlp': 'test', version: 'test' })),
          },
        },
      ],
    }).compileComponents();
  });

  it('shows queue work inside History instead of a separate downloading section', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const root = () => fixture.nativeElement as HTMLElement;
    expect(root().querySelector('.active-download-section')).toBeNull();
    expect(root().querySelector('.active-history-entry')).toBeNull();

    downloads.queue.set('audio1', makeDownload('postprocessing'));
    downloads.queueChanged.next();
    fixture.detectChanges();

    const activeRow = root().querySelector('.active-history-entry');
    expect(root().querySelector('.active-download-section')).toBeNull();
    expect(activeRow).not.toBeNull();
    expect(activeRow?.textContent).toContain('Post-processing');
    expect(activeRow?.querySelector('.history-live-progress')).not.toBeNull();

    downloads.queue.clear();
    downloads.queueChanged.next();
    fixture.detectChanges();

    expect(root().querySelector('.active-history-entry')).toBeNull();
  });

  it('makes file download primary and moves secondary row actions behind overflow', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    downloads.done.set('audio1', makeDownload('finished', 'test.mp3'));
    downloads.doneChanged.next();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const actions = root.querySelector('.completed-row-actions');
    const primary = actions?.querySelector('.completed-download-primary');
    const more = actions?.querySelector('.completed-more-button');

    expect(primary).not.toBeNull();
    expect(primary?.textContent).toContain('Download');
    expect(more).not.toBeNull();
    expect(actions?.querySelector('a.btn-link')).toBeNull();
    expect(actions?.querySelector('button.btn-link')).toBeNull();
  });
});
