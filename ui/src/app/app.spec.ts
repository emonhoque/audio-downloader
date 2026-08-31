import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { CookieService } from 'ngx-cookie-service';
import { Observable, Subject, of } from 'rxjs';
import { App } from './app';
import { Download, Status } from './interfaces';
import { AddDownloadPayload, DownloadsService } from './services/downloads.service';
import { ToastService } from './services/toast.service';

class DownloadsServiceStub {
  loading = false;
  queue = new Map<string, Download>();
  done = new Map<string, Download>();
  configuration: Record<string, unknown> = {
    CUSTOM_DIRS: true,
    CREATE_CUSTOM_DIRS: true,
    ALLOW_YTDL_OPTIONS_OVERRIDES: false,
  };
  customDirs = { download_dir: [], audio_download_dir: [] };
  queueChanged = new Subject<void>();
  doneChanged = new Subject<void>();
  configurationChanged = new Subject<Record<string, unknown>>();
  customDirsChanged = new Subject<Record<string, string[]>>();
  ytdlOptionsChanged = new Subject<Record<string, unknown>>();
  updated = new Subject<void>();
  retryCalls: string[] = [];
  reportProblemCalls = 0;
  cancelAddCalls = 0;
  addResponse: Observable<Status> = of({ status: 'ok' });
  addPayloads: AddDownloadPayload[] = [];

  getCookieStatus() {
    return of({ status: 'ok', has_cookies: false });
  }

  getPresets() {
    return of({ presets: ['Preset A'] });
  }

  add(payload: AddDownloadPayload) {
    this.addPayloads.push(payload);
    return this.addResponse;
  }

  retry(id: string) {
    this.retryCalls.push(id);
    return of({ status: 'ok' as const });
  }

  reportProblem() {
    this.reportProblemCalls++;
    return of({ status: 'ok' as const, msg: 'Notification sent.' });
  }

  cancelAdd() {
    this.cancelAddCalls++;
    return of({ status: 'ok' as const });
  }

  startById() {
    return of({ status: 'ok' as const });
  }

  delById() {
    return of({ status: 'ok' as const });
  }

  delByFilter() {
    return of({ status: 'ok' as const });
  }

  startByFilter() {
    return of({ status: 'ok' as const });
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

class ToastServiceStub {
  confirmResult = true;
  confirmCalls = 0;
  toasts = () => [];
  respond = vi.fn();
  dismiss = vi.fn();
  info = vi.fn();
  success = vi.fn();
  error = vi.fn();

  confirm() {
    this.confirmCalls++;
    return Promise.resolve(this.confirmResult);
  }
}

function makeDownload(overrides: Partial<Download> = {}): Download {
  return {
    id: 'item-1',
    title: 'Test Audio',
    url: 'https://www.youtube.com/watch?v=test',
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
    filename: 'test-audio.mp3',
    checked: false,
    timestamp: 1_000_000,
    size: 1024,
    ...overrides,
  };
}

describe('App', () => {
  let downloads: DownloadsServiceStub;
  let toasts: ToastServiceStub;

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
    toasts = new ToastServiceStub();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: DownloadsService, useValue: downloads },
        { provide: CookieService, useClass: CookieServiceStub },
        { provide: ToastService, useValue: toasts },
        {
          provide: HttpClient,
          useValue: {
            get: vi.fn().mockReturnValue(of({ 'yt-dlp': 'test', version: 'test' })),
          },
        },
      ],
    }).compileComponents();
  });

  it('creates the app with audio-only defaults', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const app = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;

    expect(app).toBeTruthy();
    expect(app.format).toBe('mp3');
    expect(app.quality).toBe('best');
    expect(root.querySelector('[aria-label="Choose audio format"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="Choose audio quality"]')).not.toBeNull();
    expect(root.querySelector('select[name="downloadType"]')).toBeNull();
    expect(root.querySelector('select[name="codec"]')).toBeNull();
  });

  it('migrates an old numeric quality cookie to Best once, then preserves new choices', () => {
    const cookies = TestBed.inject(CookieService);
    cookies.set('metube_quality', '320');

    const first = TestBed.createComponent(App);
    expect(first.componentInstance.quality).toBe('best');
    expect(cookies.get('metube_audio_quality_default_v1')).toBe('1');

    first.componentInstance.selectQuality('192');
    expect(cookies.get('metube_quality')).toBe('192');

    const second = TestBed.createComponent(App);
    expect(second.componentInstance.quality).toBe('192');
  });

  it('keeps retired hidden settings out of a normal Start download payload', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.addUrl = 'https://example.com/audio';
    app.playlistItemLimit = 20;
    app.autoStart = false;
    app.splitByChapters = true;
    app.sponsorblock = true;
    app.clipStart = '1';
    app.clipEnd = '10';
    app.folder = 'hidden-folder';
    app.ytdlOptionsPresets = ['Hidden preset'];
    app.ytdlOptionsOverrides = '{"quiet":true}';

    app.addDownload();

    expect(downloads.addPayloads).toEqual([
      { url: 'https://example.com/audio', quality: 'best', format: 'mp3' },
    ]);
  });

  it('rejects malformed input before sending a download request', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.addUrl = 'aaa';

    app.addDownload();

    expect(downloads.addPayloads).toEqual([]);
    expect(app.addInProgress).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('Enter a valid http(s) URL.');
  });

  it('stops adding and cancels the backend request after 10 seconds', () => {
    vi.useFakeTimers();
    const pendingAdd = new Subject<Status>();
    downloads.addResponse = pendingAdd;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.addUrl = 'https://example.com/audio';

    app.addDownload();
    expect(app.addInProgress).toBe(true);

    vi.advanceTimersByTime(10_000);

    expect(app.addInProgress).toBe(false);
    expect(downloads.cancelAddCalls).toBe(1);
    expect(toasts.error).toHaveBeenCalledWith(
      'Adding this link timed out after 10 seconds. Please try again.',
    );
    vi.useRealTimers();
  });

  it('uses Audio Downloader branding and History without format filter tabs', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.navbar-brand')?.textContent).toContain('Audio Downloader');
    expect(root.textContent).toContain('History');
    expect(root.querySelector('.filter-group')).toBeNull();
    expect(root.textContent).not.toContain('Subscriptions');
  });

  it('uses a stable audio icon instead of remote History thumbnails or title initials', () => {
    downloads.done.set('one', makeDownload({
      title: 'HP Odd Initials',
      thumbnail: 'https://example.com/should-not-load.jpg',
    }));
    const fixture = TestBed.createComponent(App);
    downloads.doneChanged.next();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const thumb = root.querySelector('.history-thumb') as HTMLElement;

    expect(thumb).not.toBeNull();
    expect(thumb.querySelector('.history-audio-icon')).not.toBeNull();
    expect(thumb.querySelector('img')).toBeNull();
    expect(thumb.textContent?.trim()).toBe('');
    expect(root.innerHTML).not.toContain('should-not-load.jpg');
  });

  it('opens history details from the overflow button without immediately closing them', () => {
    downloads.done.set('one', makeDownload());
    const fixture = TestBed.createComponent(App);
    downloads.doneChanged.next();
    fixture.detectChanges();

    const overflowButton = fixture.nativeElement.querySelector(
      '.history-more-button',
    ) as HTMLButtonElement;
    overflowButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.history-details')).not.toBeNull();
  });

  it('keeps Advanced Options out of the primary UI', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.advanced-toggle')).toBeNull();
    expect(root.querySelector('#advancedOptions')).toBeNull();
    expect(root.querySelector('#batch-import-modal-title')).toBeNull();
  });

  it('keeps Report in the footer only', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const footerButton = root.querySelector('.footer-report-button') as HTMLButtonElement;

    expect(root.querySelector('.header-report-button')).toBeNull();
    expect(footerButton.textContent?.trim()).toContain('Report');
  });

  it('opens an inline report confirmation before sending', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const footerButton = fixture.nativeElement.querySelector('.footer-report-button') as HTMLButtonElement;
    footerButton.click();
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('.footer-report-confirmation') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('Report an issue?');
    expect(downloads.reportProblemCalls).toBe(0);

    const sendButton = panel.querySelector('.report-confirm-submit') as HTMLButtonElement;
    sendButton.click();
    fixture.detectChanges();

    expect(downloads.reportProblemCalls).toBe(1);
    expect(fixture.componentInstance.reportConfirmPlacement).toBeNull();
  });

  it('cancels the footer report confirmation without sending', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const footerButton = fixture.nativeElement.querySelector('.footer-report-button') as HTMLButtonElement;
    footerButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.footer-report-confirmation')).not.toBeNull();

    const cancelButton = fixture.nativeElement.querySelector(
      '.footer-report-confirmation .report-confirm-cancel',
    ) as HTMLButtonElement;
    cancelButton.click();
    fixture.detectChanges();

    expect(downloads.reportProblemCalls).toBe(0);
    expect(fixture.nativeElement.querySelector('.footer-report-confirmation')).toBeNull();
  });

  it('cycles directly between light and dark themes without Auto', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    const button = fixture.nativeElement.querySelector('.theme-cycle-button') as HTMLButtonElement;
    const cookies = TestBed.inject(CookieService);

    expect(app.themes.map((theme) => theme.id)).toEqual(['light', 'dark']);
    expect(app.activeTheme?.id).toBe('light');
    expect(button.getAttribute('aria-label')).toBe('Switch to dark mode');

    button.click();
    fixture.detectChanges();
    expect(app.activeTheme?.id).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    expect(cookies.get('metube_theme')).toBe('dark');

    button.click();
    fixture.detectChanges();
    expect(app.activeTheme?.id).toBe('light');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
  });

  it('keeps Idle and History in the footer instead of the header', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const footerStatus = root.querySelector('.footer-status-group') as HTMLElement;
    expect(footerStatus.textContent).toContain('Idle');
    expect(footerStatus.textContent).toContain('0');
    expect(footerStatus.textContent).toContain('history');
    expect(root.querySelector('.header-status')?.textContent ?? '').not.toContain('Idle');
    expect(root.querySelector('.header-status')?.textContent ?? '').not.toContain('history');
  });

  it('does not inherit hidden server folder or playlist-limit defaults', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    downloads.configurationChanged.next({
      DEFAULT_FOLDER: 'youtube',
      DEFAULT_OPTION_PLAYLIST_ITEM_LIMIT: 20,
      OUTPUT_TEMPLATE_CHAPTER: 'hidden-template',
    });

    expect(fixture.componentInstance.folder).toBe('');
    expect(fixture.componentInstance.playlistItemLimit).toBe(0);
    expect(fixture.componentInstance.chapterTemplate).toBe('');
  });

  it('keeps collapse cookie compatibility for existing installations', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    const cookies = TestBed.inject(CookieService);

    expect(app.downloadingCollapsed).toBe(false);
    expect(app.completedCollapsed).toBe(false);

    app.toggleCompletedCollapsed();
    expect(app.completedCollapsed).toBe(true);
    expect(cookies.get('metube_completed_collapsed')).toBe('true');
  });


  it('pins active downloads at the top of History and removes the separate activity panel', () => {
    downloads.done.set('finished', makeDownload({ title: 'Finished Audio', timestamp: 2_000_000 }));
    downloads.queue.set(
      'https://example.com/audio',
      makeDownload({
        title: 'Active Audio',
        url: 'https://example.com/audio',
        status: 'downloading',
        format: 'flac',
        quality: 'best',
        percent: 42,
        speed: 2048,
        eta: 30,
        filename: '',
      }),
    );

    const fixture = TestBed.createComponent(App);
    downloads.doneChanged.next();
    downloads.queueChanged.next();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const rows = Array.from(root.querySelectorAll('.history-entry')) as HTMLElement[];

    expect(root.querySelector('.activity-panel')).toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows[0].classList.contains('active-history-entry')).toBe(true);
    expect(rows[0].textContent).toContain('Active Audio');
    expect(rows[0].textContent).toContain('Downloading');
    expect(rows[0].textContent).toContain('42%');
    expect(rows[0].querySelector('.history-live-progress')).not.toBeNull();
    expect(rows[0].querySelector('.history-cancel-action')).not.toBeNull();
    expect(rows[1].textContent).toContain('Finished Audio');
  });

  it('shows one evolving row when the same URL exists in queue and completed History', () => {
    const sharedId = 'https://example.com/same-audio';
    downloads.done.set(sharedId, makeDownload({
      url: sharedId,
      title: 'Older completed copy',
      status: 'finished',
      filename: 'older.mp3',
    }));
    downloads.queue.set(sharedId, makeDownload({
      url: sharedId,
      title: 'Current download',
      status: 'downloading',
      filename: '',
      percent: 55,
    }));

    const fixture = TestBed.createComponent(App);
    downloads.doneChanged.next();
    downloads.queueChanged.next();
    fixture.detectChanges();

    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.history-entry'),
    ) as HTMLElement[];
    expect(rows).toHaveLength(1);
    expect(rows[0].classList.contains('active-history-entry')).toBe(true);
    expect(rows[0].textContent).toContain('Current download');
    expect(rows[0].textContent).not.toContain('Older completed copy');
  });

  it('keeps active work visible even when completed History is filtered', () => {
    downloads.done.set('finished', makeDownload({ title: 'Finished Audio' }));
    downloads.queue.set(
      'active',
      makeDownload({ title: 'Active Audio', status: 'postprocessing', filename: '' }),
    );

    const fixture = TestBed.createComponent(App);
    downloads.doneChanged.next();
    downloads.queueChanged.next();
    const app = fixture.componentInstance;

    app.historySearch = 'no completed item matches this';
    app.historySearchChanged();
    fixture.detectChanges();

    expect(app.cachedSortedDone).toHaveLength(0);
    expect(app.cachedHistoryEntries).toHaveLength(1);
    expect(app.cachedHistoryEntries[0][1].title).toBe('Active Audio');
    expect(app.cachedHistoryEntries[0][2]).toBe('queue');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Post-processing');
  });

  it('labels post-processing in the History row and counts it as active work', () => {
    const fixture = TestBed.createComponent(App);
    downloads.queue.set(
      'https://example.com/audio',
      makeDownload({
        url: 'https://example.com/audio',
        status: 'postprocessing',
        filename: '',
      }),
    );
    downloads.queueChanged.next();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.activeDownloads).toBe(1);
    expect(root.querySelector('.activity-panel')).toBeNull();
    expect(root.querySelector('.active-history-entry')).not.toBeNull();
    expect(root.textContent).toContain('Post-processing');
    expect(root.querySelector('.history-live-progress')).not.toBeNull();
  });

  it('searches History by title, source, format and artist' , () => {
    downloads.done.set(
      'youtube',
      makeDownload({
        title: 'Morning Mix',
        url: 'https://www.youtube.com/watch?v=morning',
        format: 'mp3',
        artist: 'Example Artist',
        timestamp: 2_000_000,
      }),
    );
    downloads.done.set(
      'soundcloud',
      makeDownload({
        title: 'Night Set',
        url: 'https://soundcloud.com/example/night',
        format: 'm4a',
        artist: 'Night Artist',
        timestamp: 1_000_000,
      }),
    );

    const fixture = TestBed.createComponent(App);
    downloads.doneChanged.next();
    fixture.detectChanges();

    const app = fixture.componentInstance;
    expect(app.cachedSortedDone.map(([, item]) => item.title)).toEqual(['Morning Mix', 'Night Set']);

    app.historySearch = 'soundcloud';
    app.historySearchChanged();
    expect(app.cachedSortedDone.map(([, item]) => item.title)).toEqual(['Night Set']);

    app.historySearch = 'example artist';
    app.historySearchChanged();
    expect(app.cachedSortedDone.map(([, item]) => item.title)).toEqual(['Morning Mix']);
  });

  it('shows a clear button for History search text and restores the full list', () => {
    downloads.done.set('one', makeDownload({ title: 'First result' }));
    downloads.done.set('two', makeDownload({ title: 'Second result' }));
    const fixture = TestBed.createComponent(App);
    downloads.doneChanged.next();
    const app = fixture.componentInstance;
    app.historySearch = 'First';
    app.historySearchChanged();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('.history-search input') as HTMLInputElement;
    const clearButton = root.querySelector('.history-search-clear') as HTMLButtonElement;
    expect(clearButton).not.toBeNull();
    expect(app.cachedSortedDone).toHaveLength(1);

    clearButton.click();
    fixture.detectChanges();

    expect(app.historySearch).toBe('');
    expect(app.cachedSortedDone).toHaveLength(2);
    expect(root.querySelector('.history-search-clear')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('sorts History by newest, oldest, name and size', () => {
    downloads.done.set('one', makeDownload({ title: 'Bravo', timestamp: 2_000_000, size: 20 }));
    downloads.done.set('two', makeDownload({ title: 'Alpha', timestamp: 1_000_000, size: 100 }));

    const fixture = TestBed.createComponent(App);
    downloads.doneChanged.next();
    const app = fixture.componentInstance;

    app.historySort = 'newest';
    app.historySortChanged();
    expect(app.cachedSortedDone[0][1].title).toBe('Bravo');

    app.historySort = 'oldest';
    app.historySortChanged();
    expect(app.cachedSortedDone[0][1].title).toBe('Alpha');

    app.historySort = 'name';
    app.historySortChanged();
    expect(app.cachedSortedDone[0][1].title).toBe('Alpha');

    app.historySort = 'largest';
    app.historySortChanged();
    expect(app.cachedSortedDone[0][1].title).toBe('Alpha');
  });

  it('derives a direct site favicon and source label from the download URL', () => {
    const app = TestBed.createComponent(App).componentInstance;

    expect(app.sourceForUrl('https://www.youtube.com/watch?v=x')).toEqual({
      host: 'youtube.com',
      name: 'YouTube',
      icon: 'https://www.youtube.com/favicon.ico',
    });
    expect(app.sourceForUrl('https://soundcloud.com/test/audio')?.name).toBe('SoundCloud');
    expect(app.sourceForUrl('not a url')).toBeNull();
  });

  it('detects an already-downloaded URL', () => {
    const item = makeDownload({ url: 'https://www.youtube.com/watch?v=known' });
    downloads.done.set(item.url, item);

    const fixture = TestBed.createComponent(App);
    downloads.doneChanged.next();
    const app = fixture.componentInstance;
    app.addUrl = item.url;

    expect(app.existingDownloadForUrl()?.[1].title).toBe('Test Audio');
  });

  it('treats YouTube playback timestamps as the same download and strips them from requests', () => {
    const item = makeDownload({ url: 'https://www.youtube.com/watch?v=known' });
    downloads.done.set(item.url, item);

    const fixture = TestBed.createComponent(App);
    downloads.doneChanged.next();
    const app = fixture.componentInstance;
    app.addUrl = 'https://www.youtube.com/watch?v=known&t=1s';

    expect(app.existingDownloadForUrl()?.[1].title).toBe('Test Audio');

    app.addDownload();

    expect(downloads.addPayloads.at(-1)?.url).toBe('https://www.youtube.com/watch?v=known');
  });

  it('retries a failed download by its queue id', () => {
    const fixture = TestBed.createComponent(App);
    const item = makeDownload({
      url: 'https://example.com/failed',
      status: 'error',
      filename: '',
      msg: 'temporary failure',
    });

    fixture.componentInstance.retryDownload(item.url, item);
    expect(downloads.retryCalls).toEqual([item.url]);
  });

  it('builds audio links from the audio download base', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    downloads.configuration['PUBLIC_HOST_URL'] = 'download/';
    downloads.configuration['PUBLIC_HOST_AUDIO_URL'] = 'audio_download/';

    expect(app.buildDownloadLink(makeDownload())).toBe('audio_download/test-audio.mp3');
    expect(
      app.buildDownloadLink(makeDownload({ download_type: 'video', filename: 'legacy.mp3' })),
    ).toBe('download/legacy.mp3');
  });
});
