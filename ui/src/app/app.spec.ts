import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Subject, of } from 'rxjs';
import { App } from './app';
import { DownloadsService } from './services/downloads.service';
import { CookieService } from 'ngx-cookie-service';
import { Download } from './interfaces';

class DownloadsServiceStub {
  loading = false;
  queue = new Map();
  done = new Map();
  configuration: Record<string, unknown> = { CUSTOM_DIRS: true, CREATE_CUSTOM_DIRS: true, ALLOW_YTDL_OPTIONS_OVERRIDES: false };
  customDirs = { download_dir: [], audio_download_dir: [] };
  queueChanged = new Subject<void>();
  doneChanged = new Subject<void>();
  configurationChanged = new Subject<Record<string, unknown>>();
  customDirsChanged = new Subject<Record<string, string[]>>();
  ytdlOptionsChanged = new Subject<Record<string, unknown>>();
  updated = new Subject<void>();
  retryCalls: string[] = [];
  reportProblemCalls = 0;

  getCookieStatus() {
    return of({ status: 'ok', has_cookies: false });
  }

  getPresets() {
    return of({ presets: ['Preset A'] });
  }

  add() {
    return of({ status: 'ok' as const });
  }

  retry(id: string) {
    this.retryCalls.push(id);
    return of({ status: 'ok' as const });
  }

  reportProblem() {
    this.reportProblemCalls++;
    return of({ status: 'ok' as const, msg: 'Problem report sent.' });
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

describe('App', () => {
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

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('defaults to MP3 at 320 kbps and exposes no media-type or codec selector', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const app = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;
    expect(app.format).toBe('mp3');
    expect(app.quality).toBe('320');
    expect(root.querySelector('select[name="format"]')).not.toBeNull();
    expect(root.querySelector('select[name="quality"]')).not.toBeNull();
    expect(root.querySelector('select[name="downloadType"]')).toBeNull();
    expect(root.querySelector('select[name="codec"]')).toBeNull();
    expect(root.querySelector('select[name="subtitleMode"]')).toBeNull();
  });

  it('uses Audio Downloader branding and exposes no subscription or GitHub UI', () => {
    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.isAdvancedOpen = true;
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const brand = root.querySelector('.navbar-brand');
    expect(brand?.textContent).toContain('Audio Downloader');
    expect(root.textContent).not.toContain('MeTube');
    expect(root.textContent).not.toContain('Subscriptions');
    expect(root.textContent).not.toContain('Subscribe');
    expect(root.querySelector('button[aria-label="Download or subscribe"]')).toBeNull();
    expect(root.querySelector('input[name="checkIntervalMinutes"]')).toBeNull();
    expect(root.querySelector('input[name="titleRegex"]')).toBeNull();
    expect(root.querySelector('input[name="skipSubscriberOnly"]')).toBeNull();
    expect(root.querySelector('.github-link')).toBeNull();
  });

  it('shows the private problem-report button and sends one report', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.problem-report-button') as HTMLButtonElement;
    expect(button.textContent).toContain("Something's broken");
    button.click();

    expect(downloads.reportProblemCalls).toBe(1);
    expect(fixture.componentInstance.reportProblemInProgress).toBe(false);
  });

  it('pre-fills the download folder from DEFAULT_FOLDER', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    downloads.configurationChanged.next({ DEFAULT_FOLDER: 'youtube' });

    expect(fixture.componentInstance.folder).toBe('youtube');
  });

  it('does not overwrite a folder the user already typed', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    fixture.componentInstance.folder = 'music';

    downloads.configurationChanged.next({ DEFAULT_FOLDER: 'youtube' });

    expect(fixture.componentInstance.folder).toBe('music');
  });

  it('collapses each section independently and remembers it (#1070)', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    const cookies = TestBed.inject(CookieService);

    expect(app.downloadingCollapsed).toBe(false);
    expect(app.completedCollapsed).toBe(false);

    app.toggleCompletedCollapsed();

    expect(app.completedCollapsed).toBe(true);
    expect(app.downloadingCollapsed).toBe(false);
    expect(cookies.get('metube_completed_collapsed')).toBe('true');

    // A fresh component picks the state back up from the cookie.
    const restored = TestBed.createComponent(App);
    restored.detectChanges();
    expect(restored.componentInstance.completedCollapsed).toBe(true);
    expect(restored.componentInstance.downloadingCollapsed).toBe(false);
  });

  it('asIsOrder returns a stable comparator value (insertion order preserved)', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app.asIsOrder()).toBe(0);
  });

  it('hides manual override input when disabled', () => {
    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.isAdvancedOpen = true;
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('input[name="ytdlOptionsOverrides"]')).toBeNull();

    const presetWrapper = root.querySelector('ng-select[name="ytdlOptionsPresets"]')?.closest('.col-12');
    expect(presetWrapper?.classList.contains('col-md-6')).toBe(false);

    const presetRow = root.querySelector('ng-select[name="ytdlOptionsPresets"]')?.closest('.row');
    expect(presetRow?.querySelector('input[name="checkIntervalMinutes"]')).toBeNull();
  });

  it('shows manual override input when enabled', () => {
    downloads.configuration['ALLOW_YTDL_OPTIONS_OVERRIDES'] = true;

    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.isAdvancedOpen = true;
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('input[name="ytdlOptionsOverrides"]')).not.toBeNull();

    const presetWrapper = root.querySelector('ng-select[name="ytdlOptionsPresets"]')?.closest('.col-12');
    expect(presetWrapper?.classList.contains('col-md-6')).toBe(true);

    const presetRow = root.querySelector('ng-select[name="ytdlOptionsPresets"]')?.closest('.row');
    expect(presetRow?.querySelector('input[name="checkIntervalMinutes"]')).toBeNull();
    expect(presetRow?.querySelector('input[name="ytdlOptionsOverrides"]')).not.toBeNull();
  });

  it('does not submit manual overrides when disabled', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.ytdlOptionsOverrides = '{"exec":"echo hi"}';

    const payload = app['buildAddPayload']();

    expect(payload.ytdlOptionsOverrides).toBe('');
  });

  it('shows waiting badge for scheduled live stream', () => {
    downloads.queue.set('https://example.com/live', {
      id: 'live1',
      title: 'Upcoming Stream',
      url: 'https://example.com/live',
      download_type: 'audio',
      quality: '320',
      format: 'mp3',
      folder: '',
      custom_name_prefix: '',
      playlist_item_limit: 0,
      status: 'scheduled',
      live_status: 'is_upcoming',
      live_release_timestamp: Date.now() / 1000 + 3600,
      msg: '',
      percent: 0,
      speed: 0,
      eta: 0,
      filename: '',
      checked: false,
    });
    downloads.queueChanged.next();

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Waiting for stream');
    expect(root.textContent).toContain('starts in');
  });

  it('shows the queued format in the Downloading table', () => {
    downloads.queue.set('https://example.com/v', {
      id: 'v1',
      title: 'Some Audio',
      url: 'https://example.com/v',
      download_type: 'audio',
      quality: 'best',
      format: 'flac',
      folder: '',
      custom_name_prefix: '',
      playlist_item_limit: 0,
      status: 'downloading',
      msg: '',
      percent: 10,
      speed: 0,
      eta: 0,
      filename: '',
      checked: false,
    });
    downloads.queueChanged.next();

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const row = (fixture.nativeElement as HTMLElement).querySelector('tbody tr');
    expect(row?.textContent).toContain('FLAC');
    expect(row?.classList.contains('mobile-card-row')).toBe(true);
    expect(row?.querySelector('[data-label="Format"]')?.textContent).toContain('FLAC');
    expect(row?.querySelector('[data-label="Speed"]')).not.toBeNull();
    expect(row?.querySelector('[data-label="ETA"]')).not.toBeNull();
  });

  it('labels formats the way the form does, and copes with an unknown one', () => {
    const app = TestBed.createComponent(App).componentInstance;
    const base = { format: '' } as Download;

    expect(app.formatLabel({ ...base, format: 'mp3' })).toBe('MP3');
    expect(app.formatLabel({ ...base, format: 'opus' })).toBe('Opus');
    expect(app.formatLabel({ ...base, format: 'any' })).toBe('ANY');
    // A format from a record older than the option list still reads sensibly.
    expect(app.formatLabel({ ...base, format: 'mkv' })).toBe('MKV');
    expect(app.formatLabel(base)).toBe('-');
  });

  it('buildAddPayload includes clip times', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.clipStart = '0:10';
    app.clipEnd = '1:20';
    const payload = app['buildAddPayload']();
    expect(payload.clipStart).toBe('0:10');
    expect(payload.clipEnd).toBe('1:20');
  });

  it('retries a failed download by its server-side queue id', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const download = {
      id: 'vid1',
      title: 'Test Audio',
      url: 'https://example.com/v',
      download_type: 'audio',
      quality: '320',
      format: 'mp3',
      folder: '',
      custom_name_prefix: '',
      playlist_item_limit: 0,
      status: 'error',
      msg: 'temporary failure',
      percent: 0,
      speed: 0,
      eta: 0,
      filename: '',
      checked: false,
    };

    app.retryDownload(download.url, download);

    expect(downloads.retryCalls).toEqual([download.url]);
  });

  // Issue #533: the server picks AUDIO_DOWNLOAD_DIR on download_type alone
  // (ytdl.py), so the UI's choice of URL base has to use the same rule. It used
  // to also treat any .mp3 as audio, which pointed the link at audio_download/
  // for files the server had written to DOWNLOAD_DIR.
  describe('download links follow the server directory rule (#533)', () => {
    const makeDownload = (over: Partial<Download>): Download => ({
      id: 'vid1',
      title: 'Test',
      url: 'https://example.com/v',
      download_type: 'audio',
      quality: '320',
      format: 'mp3',
      folder: '',
      custom_name_prefix: '',
      playlist_item_limit: 0,
      status: 'finished',
      msg: '',
      percent: 100,
      speed: 0,
      eta: 0,
      filename: 'song.mp3',
      checked: false,
      ...over,
    } as Download);

    const appWithDirs = () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance;
      const downloads = TestBed.inject(DownloadsService) as unknown as DownloadsServiceStub;
      downloads.configuration['PUBLIC_HOST_URL'] = 'download/';
      downloads.configuration['PUBLIC_HOST_AUDIO_URL'] = 'audio_download/';
      return app;
    };

    it('uses the audio base for an audio download', () => {
      const app = appWithDirs();
      const link = app.buildDownloadLink(makeDownload({ download_type: 'audio', filename: 'song.mp3' }));
      expect(link).toBe('audio_download/song.mp3');
    });

    it('uses the legacy media base for an old video-typed MP3 record', () => {
      const app = appWithDirs();
      const link = app.buildDownloadLink(makeDownload({ download_type: 'video', filename: 'song.mp3' }));
      expect(link).toBe('download/song.mp3');
    });

    it('keeps historical video records linked from the legacy media base', () => {
      const app = appWithDirs();
      const link = app.buildDownloadLink(
        makeDownload({ download_type: 'video', filename: 'clip.mp4' }),
      );
      expect(link).toBe('download/clip.mp4');
    });

    it('applies the same rule to chapter links', () => {
      const app = appWithDirs();
      const dl = makeDownload({ download_type: 'video' });
      expect(app.buildChapterDownloadLink(dl, 'ch1.mp3')).toBe('download/ch1.mp3');
      const audio = makeDownload({ download_type: 'audio' });
      expect(app.buildChapterDownloadLink(audio, 'ch1.mp3')).toBe('audio_download/ch1.mp3');
    });
  });

  // Issue #424: ffmpeg work after the bytes land (merge, re-encode, split) used
  // to leave the row on a full, frozen bar with the item counted as neither
  // active nor queued.
  describe('post-processing is visible (#424)', () => {
    const queueEntry = (status: string): Download => ({
      id: 'vid1',
      title: 'Test',
      url: 'https://example.com/v',
      download_type: 'audio',
      quality: '320',
      format: 'mp3',
      folder: '',
      custom_name_prefix: '',
      playlist_item_limit: 0,
      status,
      msg: '',
      percent: 100,
      speed: 0,
      eta: 0,
      filename: '',
      checked: false,
    } as Download);

    it('runs the bar indeterminate while preparing or post-processing', () => {
      const app = TestBed.createComponent(App).componentInstance;
      expect(app.isIndeterminate(queueEntry('preparing'))).toBe(true);
      expect(app.isIndeterminate(queueEntry('postprocessing'))).toBe(true);
      expect(app.isIndeterminate(queueEntry('downloading'))).toBe(false);
      expect(app.isIndeterminate(queueEntry('pending'))).toBe(false);
    });

    it('labels the bar and counts the item as active', () => {
      // The component subscribes to queueChanged on construction, so the entry
      // has to be announced after it exists or updateMetrics never runs.
      const fixture = TestBed.createComponent(App);
      downloads.queue.set('https://example.com/v', queueEntry('postprocessing'));
      downloads.queueChanged.next();
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Post-processing');
      expect(fixture.componentInstance.activeDownloads).toBe(1);
      expect(fixture.componentInstance.queuedDownloads).toBe(0);
    });
  });

});
