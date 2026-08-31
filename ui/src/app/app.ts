import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  inject,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faCheck,
  faCheckCircle,
  faChevronDown,
  faChevronRight,
  faClock,
  faCopy,
  faDownload,
  faExternalLinkAlt,
  faFileExport,
  faFileImport,
  faMoon,
  faMusic,
  faRedoAlt,
  faShareNodes,
  faSun,
  faTimesCircle,
  faTrashAlt,
  faTriangleExclamation,
  faUpload,
} from '@fortawesome/free-solid-svg-icons';
import { NgbModule, NgbTypeahead } from '@ng-bootstrap/ng-bootstrap';
import { NgSelectModule } from '@ng-select/ng-select';
import { CookieService } from 'ngx-cookie-service';
import {
  Observable,
  OperatorFunction,
  Subject,
  Subscription,
  debounceTime,
  distinctUntilChanged,
  filter,
  finalize,
  from,
  map,
  merge,
  mergeMap,
  takeUntil,
  tap,
} from 'rxjs';
import {
  AUDIO_FORMATS,
  AudioFormatOption,
  Download,
  Option,
  Quality,
  State,
  Status,
  Theme,
} from './interfaces';
import { FileSizePipe, EtaPipe, SpeedPipe } from './pipes';
import { ToastContainerComponent } from './components/';
import { BatchUrlFilter, BatchUrlsService } from './services/batch-urls.service';
import { AddDownloadPayload, DownloadsService } from './services/downloads.service';
import { MeTubeSocket } from './services/metube-socket.service';
import { ToastService } from './services/toast.service';
import { Themes } from './theme';

type HistorySort = 'newest' | 'oldest' | 'name' | 'largest' | 'smallest';
type ReportConfirmPlacement = 'footer' | null;
type HistoryEntry = [string, Download, State];

interface UrlSource {
  host: string;
  name: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    DatePipe,
    DecimalPipe,
    FontAwesomeModule,
    NgbModule,
    NgSelectModule,
    EtaPipe,
    SpeedPipe,
    FileSizePipe,
    ToastContainerComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.sass',
})
export class App implements AfterViewInit, OnInit, OnDestroy {
  downloads = inject(DownloadsService);
  private toasts = inject(ToastService);
  private batchUrls = inject(BatchUrlsService);
  private socket = inject(MeTubeSocket);
  private cookieService = inject(CookieService);
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  addUrl = '';
  audioFormats: AudioFormatOption[] = AUDIO_FORMATS;
  qualities!: Quality[];
  quality: string;
  format: string;
  folder = '';
  customNamePrefix = '';
  autoStart = true;
  playlistItemLimit = 0;
  splitByChapters = false;
  sponsorblock = false;
  chapterTemplate = '';
  clipStart = '';
  clipEnd = '';
  ytdlOptionsPresets: string[] = [];
  ytdlOptionsOverrides = '';
  ytdlOptionPresetNames: string[] = [];
  addInProgress = false;
  cancelRequested = false;
  hasCookies = false;
  cookieUploadInProgress = false;
  reportProblemInProgress = false;
  reportConfirmPlacement: ReportConfirmPlacement = null;
  themes: Theme[] = Themes;
  activeTheme: Theme | undefined;
  readonly folderTypeahead = viewChild<NgbTypeahead>('folderTypeahead');
  folderFocus$ = new Subject<string>();
  folderClick$ = new Subject<string>();
  showBatchPanel = false;
  batchImportModalOpen = false;
  batchImportText = '';
  batchImportStatus = '';
  batchImportCount = 0;
  batchImportTotal = 0;
  batchImportFailures = 0;
  importInProgress = false;
  private batchImportCancel$ = new Subject<void>();
  private static readonly BATCH_IMPORT_CONCURRENCY = 4;
  ytDlpOptionsUpdateTime: string | null = null;
  ytDlpVersion: string | null = null;
  isAdvancedOpen = false;
  downloadingCollapsed = false;
  completedCollapsed = false;
  historySearch = '';
  historySort: HistorySort = 'newest';
  readonly historySortOptions: { id: HistorySort; text: string }[] = [
    { id: 'newest', text: 'Newest' },
    { id: 'oldest', text: 'Oldest' },
    { id: 'name', text: 'Name' },
    { id: 'largest', text: 'Largest' },
    { id: 'smallest', text: 'Smallest' },
  ];
  cachedSortedDone: [string, Download][] = [];
  cachedHistoryEntries: HistoryEntry[] = [];
  expandedHistory = new Set<string>();
  lastCopiedErrorId: string | null = null;
  pendingDeleteId: string | null = null;
  private addRequestSub?: Subscription;
  private addRequestTimeout?: ReturnType<typeof setTimeout>;
  private readonly addRequestTimeoutMs = 10_000;
  private liveCountdownTimer?: ReturnType<typeof setInterval>;
  private readonly settingsCookieExpiryDays = 3650;
  private static readonly DEFAULT_AUDIO_QUALITY = 'best';
  private static readonly QUALITY_DEFAULT_MIGRATION_COOKIE = 'metube_audio_quality_default_v1';
  private lastFocusedElement: HTMLElement | null = null;

  activeDownloads = 0;
  queuedDownloads = 0;
  completedDownloads = 0;
  failedDownloads = 0;
  totalSpeed = 0;

  faTrashAlt = faTrashAlt;
  faCheckCircle = faCheckCircle;
  faTimesCircle = faTimesCircle;
  faRedoAlt = faRedoAlt;
  faSun = faSun;
  faMoon = faMoon;
  faMusic = faMusic;
  faCheck = faCheck;
  faDownload = faDownload;
  faExternalLinkAlt = faExternalLinkAlt;
  faFileImport = faFileImport;
  faFileExport = faFileExport;
  faCopy = faCopy;
  faClock = faClock;
  faChevronRight = faChevronRight;
  faChevronDown = faChevronDown;
  faUpload = faUpload;
  faShareNodes = faShareNodes;
  faTriangleExclamation = faTriangleExclamation;

  historyFilenamePrefix(filename: string): string {
    const tailLength = 18;
    return filename.length > 56 ? filename.slice(0, -tailLength) : filename;
  }

  historyFilenameTail(filename: string): string {
    const tailLength = 18;
    return filename.length > 56 ? filename.slice(-tailLength) : '';
  }

  constructor() {
    this.format = this.cookieService.get('metube_format') || 'mp3';

    const storedQuality = this.cookieService.get('metube_quality');
    const qualityDefaultMigrated =
      this.cookieService.get(App.QUALITY_DEFAULT_MIGRATION_COOKIE) === '1';
    this.quality =
      qualityDefaultMigrated && storedQuality ? storedQuality : App.DEFAULT_AUDIO_QUALITY;
    if (!qualityDefaultMigrated) {
      this.cookieService.set(App.QUALITY_DEFAULT_MIGRATION_COOKIE, '1', {
        expires: this.settingsCookieExpiryDays,
      });
    }

    const storedSort = this.cookieService.get('metube_history_sort') as HistorySort;
    if (['newest', 'oldest', 'name', 'largest', 'smallest'].includes(storedSort)) {
      this.historySort = storedSort;
    }

    const allowedAudioFormats = new Set(this.audioFormats.map((audioFormat) => audioFormat.id));
    if (!allowedAudioFormats.has(this.format)) {
      this.format = 'mp3';
    }
    this.setQualities();
    this.cookieService.set('metube_format', this.format, {
      expires: this.settingsCookieExpiryDays,
    });
    this.cookieService.set('metube_quality', this.quality, {
      expires: this.settingsCookieExpiryDays,
    });
    this.downloadingCollapsed = this.cookieService.get('metube_downloading_collapsed') === 'true';
    this.completedCollapsed = this.cookieService.get('metube_completed_collapsed') === 'true';
    this.activeTheme = this.getPreferredTheme(this.cookieService);

    this.downloads.queueChanged.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.updateMetrics();
      this.syncLiveCountdownTimer();
      this.rebuildHistoryEntries();
      this.cdr.markForCheck();
    });
    this.downloads.doneChanged.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.updateMetrics();
      this.rebuildHistoryEntries();
      this.cdr.markForCheck();
    });
    this.downloads.updated.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.updateMetrics();
      this.syncLiveCountdownTimer();
      this.rebuildHistoryEntries();
      this.cdr.markForCheck();
    });
  }

  ngOnInit() {
    this.downloads.getCookieStatus().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((data) => {
      this.hasCookies = !!(
        data &&
        typeof data === 'object' &&
        'has_cookies' in data &&
        data.has_cookies
      );
      this.cdr.markForCheck();
    });
    this.getConfiguration();
    this.getYtdlOptionsUpdateTime();
    this.getYtdlOptionPresets();
    this.setTheme(this.activeTheme!);
    this.updateMetrics();
    this.rebuildHistoryEntries();
  }

  ngAfterViewInit() {
    this.fetchVersionInfo();
    this.socket
      .fromEvent('connect')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.fetchVersionInfo());
  }

  ngOnDestroy() {
    this.addRequestSub?.unsubscribe();
    if (this.addRequestTimeout) {
      clearTimeout(this.addRequestTimeout);
    }
    if (this.liveCountdownTimer) {
      clearInterval(this.liveCountdownTimer);
    }
  }

  qualityChanged() {
    this.cookieService.set('metube_quality', this.quality, {
      expires: this.settingsCookieExpiryDays,
    });
    this.downloads.customDirsChanged.next(this.downloads.customDirs);
  }

  selectedFormatText() {
    return this.audioFormats.find((audioFormat) => audioFormat.id === this.format)?.text ?? this.format.toUpperCase();
  }

  selectedQualityText() {
    return this.qualities.find((audioQuality) => audioQuality.id === this.quality)?.text ?? this.quality;
  }

  selectFormat(format: string) {
    this.format = format;
    this.formatChanged();
  }

  selectQuality(quality: string) {
    this.quality = quality;
    this.qualityChanged();
  }

  showAdvanced() {
    return this.downloads.configuration['CUSTOM_DIRS'];
  }

  allowYtdlOptionsOverrides() {
    return this.downloads.configuration['ALLOW_YTDL_OPTIONS_OVERRIDES'] === true;
  }

  searchFolder: OperatorFunction<string, readonly string[]> = (text$: Observable<string>) => {
    const debouncedText$ = text$.pipe(debounceTime(150), distinctUntilChanged());
    const clicksWithClosedPopup$ = this.folderClick$.pipe(
      filter(() => !this.folderTypeahead()?.isPopupOpen()),
    );
    return merge(debouncedText$, this.folderFocus$, clicksWithClosedPopup$).pipe(
      map((term) => {
        const dirs = this.downloads.customDirs?.['audio_download_dir'] ?? [];
        const t = (term ?? '').toLowerCase();
        return (t === '' ? dirs : dirs.filter((d) => d.toLowerCase().includes(t))).slice(0, 10);
      }),
    );
  };

  getYtdlOptionsUpdateTime() {
    this.downloads.ytdlOptionsChanged.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      next: (data: any) => {
        if (data['success']) {
          const date = new Date(data['update_time'] * 1000);
          this.ytDlpOptionsUpdateTime = date.toLocaleString();
        } else {
          this.toasts.error('Error reloading yt-dlp options: ' + data['msg']);
        }
        this.cdr.markForCheck();
      },
    });
  }

  getConfiguration() {
    this.downloads.configurationChanged.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        // The simplified primary workflow intentionally does not inherit hidden
        // folder, playlist-limit, chapter, clipping, or advanced-option defaults.
        this.cdr.markForCheck();
      },
    });
  }

  getYtdlOptionPresets() {
    this.downloads.getPresets().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.ytdlOptionPresetNames = Array.isArray(data?.presets)
          ? data.presets.filter((preset): preset is string => typeof preset === 'string')
          : [];
        if (this.ytdlOptionsPresets?.length) {
          const valid = new Set(this.ytdlOptionPresetNames);
          const filtered = this.ytdlOptionsPresets.filter((preset) => valid.has(preset));
          if (filtered.length !== this.ytdlOptionsPresets.length) {
            this.ytdlOptionsPresets = filtered;
            this.ytdlOptionsPresetsChanged();
          }
        }
        this.cdr.markForCheck();
      },
    });
  }

  private loadYtdlOptionsPresetsFromCookie(): string[] {
    const jsonCookie = this.cookieService.get('metube_ytdl_options_presets');
    if (jsonCookie) {
      try {
        const parsed = JSON.parse(jsonCookie) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (preset): preset is string => typeof preset === 'string' && preset.length > 0,
          );
        }
      } catch {
        // fall through to the legacy single-preset cookie
      }
    }
    const legacy = this.cookieService.get('metube_ytdl_options_preset')?.trim();
    return legacy ? [legacy] : [];
  }

  private validateYtdlOptionsOverrides(value: string): boolean {
    if (!this.allowYtdlOptionsOverrides()) {
      return true;
    }
    const trimmed = value?.trim() || '';
    if (!trimmed) {
      return true;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        this.toasts.error('Custom yt-dlp options must be a JSON object');
        return false;
      }
    } catch {
      this.toasts.error('Custom yt-dlp options must be valid JSON');
      return false;
    }
    return true;
  }

  private getStatusError(res: unknown): string | null {
    const status = res as { status?: string; msg?: string };
    return status?.status === 'error' ? status.msg || null : null;
  }

  private handleActionResult(res: unknown, fallbackMsg: string) {
    const error = this.getStatusError(res);
    if (error) {
      this.toasts.error(error || fallbackMsg);
    }
    this.cdr.markForCheck();
  }

  getPreferredTheme(cookieService: CookieService) {
    const storedTheme = cookieService.check('metube_theme')
      ? this.themes.find((item) => item.id === cookieService.get('metube_theme'))
      : undefined;
    if (storedTheme) {
      return storedTheme;
    }
    const preferredId = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return this.themes.find((item) => item.id === preferredId) ?? this.themes[0];
  }

  cycleTheme() {
    const nextId = this.activeTheme?.id === 'dark' ? 'light' : 'dark';
    const nextTheme = this.themes.find((item) => item.id === nextId);
    if (!nextTheme) {
      return;
    }
    this.cookieService.set('metube_theme', nextTheme.id, {
      expires: this.settingsCookieExpiryDays,
    });
    this.setTheme(nextTheme);
  }

  themeToggleLabel() {
    return this.activeTheme?.id === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }

  setTheme(theme: Theme) {
    this.activeTheme = theme;
    document.documentElement.setAttribute('data-bs-theme', theme.id);
  }

  formatChanged() {
    this.cookieService.set('metube_format', this.format, {
      expires: this.settingsCookieExpiryDays,
    });
    this.setQualities();
    this.downloads.customDirsChanged.next(this.downloads.customDirs);
  }

  autoStartChanged() {
    this.cookieService.set('metube_auto_start', this.autoStart ? 'true' : 'false', {
      expires: this.settingsCookieExpiryDays,
    });
  }

  sponsorblockChanged() {
    this.cookieService.set('metube_sponsorblock', this.sponsorblock ? 'true' : 'false', {
      expires: this.settingsCookieExpiryDays,
    });
  }

  splitByChaptersChanged() {
    this.cookieService.set('metube_split_chapters', this.splitByChapters ? 'true' : 'false', {
      expires: this.settingsCookieExpiryDays,
    });
  }

  chapterTemplateChanged() {
    if (!this.chapterTemplate?.trim()) {
      const configuredTemplate = this.downloads.configuration['OUTPUT_TEMPLATE_CHAPTER'];
      this.chapterTemplate = typeof configuredTemplate === 'string' ? configuredTemplate : '';
    }
    this.cookieService.set('metube_chapter_template', this.chapterTemplate, {
      expires: this.settingsCookieExpiryDays,
    });
  }

  clipStartChanged() {
    this.cookieService.set('metube_clip_start', this.clipStart, {
      expires: this.settingsCookieExpiryDays,
    });
  }

  clipEndChanged() {
    this.cookieService.set('metube_clip_end', this.clipEnd, {
      expires: this.settingsCookieExpiryDays,
    });
  }

  ytdlOptionsPresetsChanged() {
    this.cookieService.set(
      'metube_ytdl_options_presets',
      JSON.stringify(this.ytdlOptionsPresets ?? []),
      { expires: this.settingsCookieExpiryDays },
    );
  }

  ytdlOptionsOverridesChanged() {
    this.cookieService.set('metube_ytdl_options_overrides', this.ytdlOptionsOverrides, {
      expires: this.settingsCookieExpiryDays,
    });
  }

  formatQualityLabel(download: Download): string {
    const quality = download.quality;
    if (!quality) return '';
    if (/^\d+$/.test(quality)) return `${quality} kbps`;
    return quality.charAt(0).toUpperCase() + quality.slice(1);
  }

  formatLabel(download: Download): string {
    const format = (download.format || '').trim();
    if (!format) return '-';
    const options: Option[] = [...this.audioFormats];
    return options.find((option) => option.id === format)?.text ?? format.toUpperCase();
  }

  formatCodecLabel(download: Download): string {
    const format = (download.format || '').toUpperCase();
    return format || '-';
  }

  setQualities() {
    const selectedFormat = this.audioFormats.find((item) => item.id === this.format);
    this.qualities = selectedFormat ? selectedFormat.qualities : this.audioFormats[0].qualities;
    const exists = this.qualities.find((item) => item.id === this.quality);
    const defaultQuality =
      this.qualities.find((item) => item.id === App.DEFAULT_AUDIO_QUALITY)?.id ?? this.qualities[0].id;
    this.quality = exists ? this.quality : defaultQuality;
    this.cookieService.set('metube_quality', this.quality, {
      expires: this.settingsCookieExpiryDays,
    });
  }

  private buildAddPayload(overrides: Partial<AddDownloadPayload> = {}): AddDownloadPayload {
    const rawUrl = overrides.url ?? this.addUrl;
    return {
      url: this.canonicalDownloadUrl(rawUrl) ?? rawUrl.trim(),
      quality: overrides.quality ?? this.quality,
      format: overrides.format ?? this.format,
    };
  }

  async pasteFromClipboard() {
    if (this.addInProgress || this.downloads.loading) {
      return;
    }

    const focusUrlInput = () => {
      const input = document.querySelector<HTMLInputElement>('.url-input');
      input?.focus();
      if (input && input.value) {
        input.setSelectionRange(0, input.value.length);
      }
    };

    const isTouchDevice =
      navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;

    if (!window.isSecureContext || !navigator.clipboard?.readText) {
      focusUrlInput();
      this.toasts.info(
        isTouchDevice
          ? 'Tap and hold the link field, then choose Paste.'
          : 'Paste is blocked by the browser. Use Ctrl+V instead.',
      );
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      const value = text.trim();
      if (value) {
        this.addUrl = value;
        this.cdr.markForCheck();
      }
    } catch {
      focusUrlInput();
      this.toasts.info(
        isTouchDevice
          ? 'Tap and hold the link field, then choose Paste.'
          : 'Paste is blocked by the browser. Use Ctrl+V instead.',
      );
    }
  }

  addDownload(overrides: Partial<AddDownloadPayload> = {}) {
    const payload = this.buildAddPayload(overrides);
    const validatedUrl = this.canonicalDownloadUrl(payload.url);
    if (!validatedUrl) {
      this.toasts.error('Enter a valid http(s) URL.');
      return;
    }
    payload.url = validatedUrl;
    this.addInProgress = true;
    this.cancelRequested = false;
    this.addRequestSub?.unsubscribe();
    this.addRequestTimeout = setTimeout(() => this.timeoutAdding(), this.addRequestTimeoutMs);
    this.addRequestSub = this.downloads.add(payload).subscribe((status: Status) => {
      if (status.status === 'error' && !this.cancelRequested) {
        this.toasts.error(`Error adding URL: ${status.msg}`);
      } else if (status.status !== 'error') {
        const normalizedMessage = status.msg?.trim().toLowerCase();
        if (
          status.msg &&
          normalizedMessage !== 'added to the download queue.' &&
          normalizedMessage !== 'added to the download queue'
        ) {
          this.toasts.info(status.msg);
        }
        this.addUrl = '';
      }
      this.resetAddState();
    });
  }

  private timeoutAdding() {
    if (!this.addInProgress) {
      return;
    }
    this.addRequestSub?.unsubscribe();
    this.downloads
      .cancelAdd()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
    this.toasts.error('Adding this link timed out after 10 seconds. Please try again.');
    this.resetAddState();
  }

  cancelAdding() {
    this.cancelRequested = true;
    this.downloads.cancelAdd().subscribe({
      next: () => {
        this.addRequestSub?.unsubscribe();
        this.resetAddState();
      },
      error: (err) => {
        this.cancelRequested = false;
        console.error('Failed to cancel adding:', err?.message || err);
      },
    });
  }

  private resetAddState() {
    if (this.addRequestTimeout) {
      clearTimeout(this.addRequestTimeout);
      this.addRequestTimeout = undefined;
    }
    this.addRequestSub = undefined;
    this.addInProgress = false;
    this.cancelRequested = false;
    this.cdr.markForCheck();
  }

  downloadItemByKey(id: string) {
    this.downloads
      .startById([id])
      .subscribe((res) => this.handleActionResult(res, 'Start download failed'));
  }

  isIndeterminate(download: Download): boolean {
    return download.status === 'preparing' || download.status === 'postprocessing';
  }

  liveCountdownSeconds(download: Download): number | null {
    const ts = download.live_release_timestamp;
    if (ts == null || download.status !== 'scheduled') {
      return null;
    }
    return Math.max(0, ts - Date.now() / 1000);
  }

  private syncLiveCountdownTimer() {
    const hasScheduled = Array.from(this.downloads.queue.values()).some(
      (download) => download.status === 'scheduled',
    );
    if (hasScheduled && !this.liveCountdownTimer) {
      this.liveCountdownTimer = setInterval(() => this.cdr.markForCheck(), 1000);
    } else if (!hasScheduled && this.liveCountdownTimer) {
      clearInterval(this.liveCountdownTimer);
      this.liveCountdownTimer = undefined;
    }
  }

  retryDownload(key: string, download: Download) {
    this.downloads
      .retry(key)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status: Status) => {
        if (status.status === 'error') {
          this.toasts.error(`Error retrying ${download.title}: ${status.msg}`);
          this.cdr.markForCheck();
          return;
        }
        this.downloads.delById('done', [key]).subscribe();
      });
  }

  openReportConfirmation(placement: Exclude<ReportConfirmPlacement, null>) {
    if (this.reportProblemInProgress) {
      return;
    }
    this.reportConfirmPlacement = this.reportConfirmPlacement === placement ? null : placement;
    this.cdr.markForCheck();
  }

  cancelReportConfirmation() {
    this.reportConfirmPlacement = null;
    this.cdr.markForCheck();
  }

  reportProblem() {
    if (this.reportProblemInProgress) {
      return;
    }

    this.reportConfirmPlacement = null;
    this.reportProblemInProgress = true;
    this.cdr.markForCheck();
    this.downloads
      .reportProblem()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.reportProblemInProgress = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe((status: Status) => {
        if (status.status === 'error') {
          this.toasts.error(status.msg || 'Could not send the notification.');
          return;
        }
        this.toasts.success(status.msg || 'Notification sent.');
      });
  }

  requestDelete(id: string) {
    this.pendingDeleteId = id;
    this.cdr.markForCheck();
  }

  cancelDelete() {
    this.pendingDeleteId = null;
    this.cdr.markForCheck();
  }

  confirmDelete(where: State, id: string) {
    if (this.pendingDeleteId !== id) {
      return;
    }
    this.pendingDeleteId = null;
    this.delDownload(where, id);
  }

  delDownload(where: State, id: string) {
    this.downloads
      .delById(where, [id])
      .subscribe((res) => this.handleActionResult(res, 'Delete failed'));
  }

  startSelectedDownloads(where: State) {
    this.downloads
      .startByFilter(where, (download) => !!download.checked)
      .subscribe((res) => this.handleActionResult(res, 'Start download failed'));
  }

  delSelectedDownloads(where: State) {
    this.downloads
      .delByFilter(where, (download) => !!download.checked)
      .subscribe((res) => this.handleActionResult(res, 'Delete failed'));
  }

  clearCompletedDownloads() {
    this.downloads
      .delByFilter('done', (download) => download.status === 'finished')
      .subscribe((res) => this.handleActionResult(res, 'Clear completed failed'));
  }

  clearFailedDownloads() {
    this.downloads
      .delByFilter('done', (download) => download.status === 'error')
      .subscribe((res) => this.handleActionResult(res, 'Clear failed downloads failed'));
  }

  retryFailedDownloads() {
    this.downloads.done.forEach((download, key) => {
      if (download.status === 'error') {
        this.retryDownload(key, download);
      }
    });
  }

  private static readonly DOWNLOAD_BATCH_SIZE = 10;
  private static readonly DOWNLOAD_BATCH_DELAY_MS = 1000;

  async downloadSelectedFiles() {
    const selected: Download[] = [];
    this.downloads.done.forEach((download) => {
      if (download.status === 'finished' && download.checked) {
        selected.push(download);
      }
    });

    for (let i = 0; i < selected.length; i++) {
      const download = selected[i];
      const link = document.createElement('a');
      link.href = this.buildDownloadLink(download);
      link.setAttribute('download', download.filename);
      link.setAttribute('target', '_self');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (
        (i + 1) % App.DOWNLOAD_BATCH_SIZE === 0 &&
        i + 1 < selected.length
      ) {
        await new Promise((resolve) => setTimeout(resolve, App.DOWNLOAD_BATCH_DELAY_MS));
      }
    }
  }

  buildDownloadLink(download: Download) {
    let baseDir = this.downloads.configuration['PUBLIC_HOST_URL'];
    if (download.download_type === 'audio') {
      baseDir = this.downloads.configuration['PUBLIC_HOST_AUDIO_URL'];
    }
    if (typeof baseDir !== 'string') {
      baseDir = '';
    }
    if (download.folder) {
      baseDir += this.encodeFolderPath(download.folder);
    }
    return baseDir + encodeURIComponent(download.filename);
  }

  canShareDownloads(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function'
    );
  }

  private static readonly SHARE_SIZE_WARN_BYTES = 80 * 1024 * 1024;

  async shareDownload(download: Download): Promise<void> {
    if (!this.canShareDownloads()) {
      return;
    }
    if (download.size && download.size > App.SHARE_SIZE_WARN_BYTES) {
      const sizeMb = Math.round(download.size / 1024 / 1024);
      const proceed = await this.toasts.confirm(
        `This file is ${sizeMb} MB. iOS' share sheet often refuses files ` +
          `larger than ~100 MB and the share will silently fail. ` +
          `Try anyway? (Use the download button instead if it fails.)`,
        'Try anyway',
        'Cancel',
      );
      if (!proceed) return;
    }
    try {
      const response = await fetch(this.buildDownloadLink(download));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching file for share`);
      }
      const blob = await response.blob();
      const file = new File([blob], download.filename, {
        type: blob.type || 'application/octet-stream',
      });
      const payload: ShareData = { files: [file], title: download.title };
      if (!navigator.canShare(payload)) {
        console.warn('navigator.canShare rejected payload for', download.filename);
        this.toasts.error(
          `Your device's share sheet doesn't accept this file ` +
            `(most likely because it's too large). ` +
            `Please use the download button instead.`,
        );
        return;
      }
      await navigator.share(payload);
    } catch (err) {
      const error = err as { name?: string; message?: string };
      if (error.name === 'AbortError') return;
      console.error('Share failed:', err);
      this.toasts.error(
        `Share failed: ${error.message || 'unknown error'}. Please use the download button instead.`,
      );
    }
  }

  buildResultItemTooltip(download: Download) {
    const parts = [];
    if (download.msg) parts.push(download.msg);
    if (download.error) parts.push(download.error);
    return parts.join(' | ');
  }

  buildChapterDownloadLink(download: Download, chapterFilename: string) {
    let baseDir = this.downloads.configuration['PUBLIC_HOST_URL'];
    if (download.download_type === 'audio') {
      baseDir = this.downloads.configuration['PUBLIC_HOST_AUDIO_URL'];
    }
    if (typeof baseDir !== 'string') {
      baseDir = '';
    }
    if (download.folder) {
      baseDir += this.encodeFolderPath(download.folder);
    }
    return baseDir + encodeURIComponent(chapterFilename);
  }

  private encodeFolderPath(folder: string): string {
    return (
      folder
        .split('/')
        .filter((segment) => segment.length > 0)
        .map((segment) => encodeURIComponent(segment))
        .join('/') + '/'
    );
  }

  getChapterFileName(filepath: string) {
    const parts = filepath.split('/');
    return parts[parts.length - 1];
  }

  isNumber(event: KeyboardEvent) {
    const allowedControlKeys = [
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'Tab',
      'Home',
      'End',
    ];
    if (allowedControlKeys.includes(event.key)) {
      return;
    }
    if (!/^[0-9]$/.test(event.key)) {
      event.preventDefault();
    }
  }

  toggleBatchPanel(): void {
    this.showBatchPanel = !this.showBatchPanel;
  }

  openBatchImportModal(): void {
    this.lastFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.batchImportModalOpen = true;
    this.batchImportText = '';
    this.batchImportStatus = '';
    this.batchImportCount = 0;
    this.batchImportTotal = 0;
    this.batchImportFailures = 0;
    this.importInProgress = false;
    setTimeout(() => {
      const textarea = document.getElementById('batch-import-textarea');
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus();
      }
    }, 0);
  }

  closeBatchImportModal(): void {
    this.batchImportModalOpen = false;
    this.lastFocusedElement?.focus();
  }

  startBatchImport(): void {
    const urls = this.batchImportText
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter((url) => url.length > 0);
    if (urls.length === 0) {
      this.toasts.error('No valid URLs found.');
      return;
    }
    this.importInProgress = true;
    this.batchImportCount = 0;
    this.batchImportFailures = 0;
    this.batchImportTotal = urls.length;
    this.updateBatchImportStatus();

    from(urls)
      .pipe(
        mergeMap(
          (url) =>
            this.downloads.add(this.buildAddPayload({ url })).pipe(
              tap((status: Status) => {
                if (status.status === 'error') {
                  this.batchImportFailures++;
                  console.error(`Error adding URL ${url}: ${status.msg}`);
                }
                this.batchImportCount++;
                this.updateBatchImportStatus();
                this.cdr.markForCheck();
              }),
            ),
          App.BATCH_IMPORT_CONCURRENCY,
        ),
        takeUntil(this.batchImportCancel$),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.importInProgress = false;
          this.updateBatchImportStatus(true);
          this.cdr.markForCheck();
        }),
      )
      .subscribe();
  }

  private updateBatchImportStatus(done = false): void {
    const parts: string[] = [];
    if (done) {
      const processed = this.batchImportCount;
      if (processed < this.batchImportTotal) {
        parts.push(`Import cancelled after ${processed} of ${this.batchImportTotal} URLs.`);
      } else {
        parts.push(`Finished importing ${this.batchImportTotal} URLs.`);
      }
    } else {
      parts.push(`Importing ${this.batchImportCount} of ${this.batchImportTotal} URLs...`);
    }
    if (this.batchImportFailures > 0) {
      parts.push(`${this.batchImportFailures} failed.`);
    }
    this.batchImportStatus = parts.join(' ');
  }

  cancelBatchImport(): void {
    if (this.importInProgress) {
      this.batchImportCancel$.next();
    }
  }

  exportBatchUrls(filter: BatchUrlFilter): void {
    this.batchUrls.export(filter);
  }

  copyBatchUrls(filter: BatchUrlFilter): void {
    this.batchUrls.copy(filter);
  }

  fetchVersionInfo(): void {
    // eslint-disable-next-line no-useless-escape
    const baseUrl = `${window.location.origin}${window.location.pathname.replace(/\/[^\/]*$/, '/')}`;
    this.http.get<{ 'yt-dlp': string }>(`${baseUrl}version`).subscribe({
      next: (data) => {
        this.ytDlpVersion = data['yt-dlp'];
        this.cdr.markForCheck();
      },
      error: () => {
        this.ytDlpVersion = null;
        this.cdr.markForCheck();
      },
    });
  }

  toggleAdvanced() {
    this.isAdvancedOpen = !this.isAdvancedOpen;
  }

  toggleDownloadingCollapsed() {
    this.downloadingCollapsed = !this.downloadingCollapsed;
    this.cookieService.set(
      'metube_downloading_collapsed',
      this.downloadingCollapsed ? 'true' : 'false',
      { expires: this.settingsCookieExpiryDays },
    );
  }

  toggleCompletedCollapsed() {
    this.completedCollapsed = !this.completedCollapsed;
    this.cookieService.set(
      'metube_completed_collapsed',
      this.completedCollapsed ? 'true' : 'false',
      { expires: this.settingsCookieExpiryDays },
    );
  }

  historySearchChanged() {
    this.rebuildHistoryEntries();
  }

  clearHistorySearch(input?: HTMLInputElement) {
    this.historySearch = '';
    this.historySearchChanged();
    input?.focus();
  }

  historySortChanged() {
    this.cookieService.set('metube_history_sort', this.historySort, {
      expires: this.settingsCookieExpiryDays,
    });
    this.rebuildHistoryEntries();
  }

  selectedHistorySortText() {
    return this.historySortOptions.find((option) => option.id === this.historySort)?.text ?? 'Newest';
  }

  selectHistorySort(sort: HistorySort) {
    this.historySort = sort;
    this.historySortChanged();
  }

  toggleSortOrder() {
    this.historySort = this.historySort === 'oldest' ? 'newest' : 'oldest';
    this.historySortChanged();
  }

  private rebuildHistoryEntries() {
    const query = this.historySearch.trim().toLowerCase();
    const activeIds = new Set(this.downloads.queue.keys());
    let completed = Array.from(this.downloads.done.entries()).filter(([id]) => !activeIds.has(id));

    if (query) {
      completed = completed.filter(([, download]) => this.historySearchText(download).includes(query));
    }

    completed.sort((left, right) => {
      const a = left[1];
      const b = right[1];
      switch (this.historySort) {
        case 'oldest':
          return (a.timestamp ?? 0) - (b.timestamp ?? 0);
        case 'name':
          return (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
        case 'largest':
          return (b.size ?? 0) - (a.size ?? 0);
        case 'smallest':
          return (a.size ?? 0) - (b.size ?? 0);
        case 'newest':
        default:
          return (b.timestamp ?? 0) - (a.timestamp ?? 0);
      }
    });

    this.cachedSortedDone = completed;

    const active: HistoryEntry[] = Array.from(this.downloads.queue.entries())
      .reverse()
      .map(([id, download]) => [id, download, 'queue']);
    const done: HistoryEntry[] = completed.map(([id, download]) => [id, download, 'done']);
    this.cachedHistoryEntries = [...active, ...done];
    this.cdr.markForCheck();
  }

  private historySearchText(download: Download): string {
    const source = this.sourceForUrl(download.url);
    return [
      download.title,
      download.artist,
      source?.name,
      source?.host,
      download.format,
      download.quality,
      download.filename,
      download.status,
      download.url,
      download.msg,
      download.error,
    ]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ')
      .toLowerCase();
  }

  toggleHistoryDetail(id: string) {
    if (this.expandedHistory.has(id)) {
      this.expandedHistory.delete(id);
    } else {
      this.expandedHistory.add(id);
    }
    this.cdr.markForCheck();
  }

  isHistoryExpanded(id: string): boolean {
    return this.expandedHistory.has(id);
  }

  showInHistory(download: Download) {
    this.historySearch = download.title || download.url;
    this.rebuildHistoryEntries();
    setTimeout(() => document.getElementById('history')?.scrollIntoView({ behavior: 'smooth' }), 0);
  }

  downloadAgain(download: Download) {
    this.addUrl = download.url;
    this.addDownload({
      url: download.url,
      quality: download.quality,
      format: download.format,
    });
  }

  existingDownloadForUrl(): [string, Download] | null {
    const normalized = this.normalizeUrl(this.addUrl);
    if (!normalized) {
      return null;
    }
    for (const entry of this.downloads.done.entries()) {
      if (this.normalizeUrl(entry[1].url) === normalized && entry[1].status === 'finished') {
        return entry;
      }
    }
    return null;
  }

  private canonicalDownloadUrl(value: string | undefined | null): string | null {
    const raw = value?.trim();
    if (!raw) return null;
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;

      const bareHost = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const isYouTube =
        bareHost === 'youtube.com' ||
        bareHost === 'youtu.be' ||
        bareHost.endsWith('.youtube.com');

      if (isYouTube) {
        for (const key of ['t', 'start', 'time_continue', 'end']) {
          parsed.searchParams.delete(key);
        }
        parsed.hash = '';
      }

      return parsed.toString();
    } catch {
      return null;
    }
  }

  private normalizeUrl(value: string | undefined | null): string | null {
    const canonical = this.canonicalDownloadUrl(value);
    if (!canonical) return null;
    try {
      const parsed = new URL(canonical);
      parsed.hash = '';
      if (parsed.pathname.length > 1) {
        parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      }
      return parsed.toString();
    } catch {
      return null;
    }
  }

  sourceForUrl(value: string | undefined | null): UrlSource | null {
    const raw = value?.trim();
    if (!raw) return null;
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
        return null;
      }
      const host = parsed.hostname.toLowerCase();
      const bareHost = host.replace(/^www\./, '');
      let name = bareHost;
      if (bareHost === 'youtube.com' || bareHost === 'youtu.be' || bareHost.endsWith('.youtube.com')) {
        name = 'YouTube';
      } else if (bareHost === 'soundcloud.com' || bareHost.endsWith('.soundcloud.com')) {
        name = 'SoundCloud';
      } else if (bareHost === 'vimeo.com' || bareHost.endsWith('.vimeo.com')) {
        name = 'Vimeo';
      } else if (bareHost === 'bandcamp.com' || bareHost.endsWith('.bandcamp.com')) {
        name = 'Bandcamp';
      } else if (bareHost === 'twitch.tv' || bareHost.endsWith('.twitch.tv')) {
        name = 'Twitch';
      }
      return {
        host: bareHost,
        name,
        icon: `https://${host}/favicon.ico`,
      };
    } catch {
      return null;
    }
  }

  hideBrokenImage(event: Event) {
    const image = event.target;
    if (image instanceof HTMLImageElement) {
      image.style.display = 'none';
    }
  }

  activityStatusLabel(download: Download): string {
    switch (download.status) {
      case 'preparing':
        return 'Preparing';
      case 'postprocessing':
        return 'Post-processing';
      case 'scheduled':
        return 'Scheduled';
      case 'pending':
        return 'Queued';
      case 'downloading':
        return 'Downloading';
      default:
        return download.status || 'Working';
    }
  }

  copyErrorMessage(id: string, download: Download) {
    const parts: string[] = [];
    if (download.title) parts.push(`Title: ${download.title}`);
    if (download.url) parts.push(`URL: ${download.url}`);
    if (download.msg) parts.push(`Message: ${download.msg}`);
    if (download.error) parts.push(`Error: ${download.error}`);
    const text = parts.join('\n');
    if (!text.trim()) return;

    const done = () => {
      this.lastCopiedErrorId = id;
      this.cdr.markForCheck();
      setTimeout(() => {
        this.lastCopiedErrorId = null;
        this.cdr.markForCheck();
      }, 1500);
    };
    const fail = (err?: unknown) => {
      console.error('Clipboard write failed:', err);
      this.toasts.error('Failed to copy to clipboard. Your browser may require HTTPS for clipboard access.');
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fail);
    } else {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        done();
      } catch (error) {
        fail(error);
      }
    }
  }

  onCookieFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.cookieUploadInProgress = true;
    this.downloads.uploadCookies(input.files[0]).subscribe({
      next: (response) => {
        if (response?.status === 'ok') {
          this.hasCookies = true;
        } else {
          this.refreshCookieStatus();
          this.toasts.error(`Error uploading cookies: ${this.formatErrorMessage(response?.msg)}`);
        }
        this.cookieUploadInProgress = false;
        input.value = '';
        this.cdr.markForCheck();
      },
      error: () => {
        this.refreshCookieStatus();
        this.cookieUploadInProgress = false;
        input.value = '';
        this.toasts.error('Error uploading cookies.');
        this.cdr.markForCheck();
      },
    });
  }

  private formatErrorMessage(error: unknown): string {
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object') {
      const obj = error as Record<string, unknown>;
      for (const key of ['msg', 'reason', 'error', 'detail']) {
        const value = obj[key];
        if (typeof value === 'string' && value.trim()) {
          return value;
        }
      }
      try {
        return JSON.stringify(error);
      } catch {
        return 'Unknown error';
      }
    }
    return 'Unknown error';
  }

  deleteCookies() {
    this.downloads.deleteCookies().subscribe({
      next: (response) => {
        if (response?.status === 'ok') {
          this.refreshCookieStatus();
          return;
        }
        this.refreshCookieStatus();
        this.toasts.error(`Error deleting cookies: ${this.formatErrorMessage(response?.msg)}`);
      },
      error: () => {
        this.refreshCookieStatus();
        this.toasts.error('Error deleting cookies.');
      },
    });
  }

  private refreshCookieStatus() {
    this.downloads.getCookieStatus().subscribe((data) => {
      this.hasCookies = !!(
        data &&
        typeof data === 'object' &&
        'has_cookies' in data &&
        data.has_cookies
      );
      this.cdr.markForCheck();
    });
  }

  private updateMetrics() {
    let active = 0;
    let queued = 0;
    let completed = 0;
    let failed = 0;
    let speed = 0;

    this.downloads.queue.forEach((download) => {
      if (download.status === 'downloading') {
        active++;
        speed += download.speed || 0;
      } else if (download.status === 'preparing' || download.status === 'postprocessing') {
        active++;
      } else if (download.status === 'pending' || download.status === 'scheduled') {
        queued++;
      }
    });

    this.downloads.done.forEach((download) => {
      if (download.status === 'finished') {
        completed++;
      } else if (download.status === 'error') {
        failed++;
      }
    });

    this.activeDownloads = active;
    this.queuedDownloads = queued;
    this.completedDownloads = completed;
    this.failedDownloads = failed;
    this.totalSpeed = speed;
  }
}
