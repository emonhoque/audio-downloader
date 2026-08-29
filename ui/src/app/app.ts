import { DatePipe, KeyValuePipe, NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, viewChild, inject, OnDestroy, OnInit } from '@angular/core';
import { Observable, OperatorFunction, Subject, Subscription, from, map, merge, debounceTime, distinctUntilChanged, filter, finalize, mergeMap, takeUntil, tap } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { NgbModule, NgbTypeahead } from '@ng-bootstrap/ng-bootstrap';
import { NgSelectModule } from '@ng-select/ng-select';
import { faTrashAlt, faCheckCircle, faTimesCircle, faRedoAlt, faSun, faMoon, faCheck, faCircleHalfStroke, faDownload, faExternalLinkAlt, faFileImport, faFileExport, faCopy, faClock, faTachometerAlt, faSortAmountDown, faSortAmountUp, faChevronRight, faChevronDown, faUpload, faShareNodes, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { CookieService } from 'ngx-cookie-service';
import { AddDownloadPayload, DownloadsService } from './services/downloads.service';
import { MeTubeSocket } from './services/metube-socket.service';
import { ToastService } from './services/toast.service';
import { BatchUrlsService, BatchUrlFilter } from './services/batch-urls.service';
import { Themes } from './theme';
import {
  Download,
  Status,
  Theme,
  Quality,
  Option,
  AudioFormatOption,
  AUDIO_FORMATS,
  State,
} from './interfaces';
import { EtaPipe, SpeedPipe, FileSizePipe } from './pipes';
import { SelectAllCheckboxComponent, ItemCheckboxComponent, ToastContainerComponent } from './components/';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
        FormsModule,
        NgTemplateOutlet,
        KeyValuePipe,
        DatePipe,
        FontAwesomeModule,
        NgbModule,
        NgSelectModule,
        EtaPipe,
        SpeedPipe,
        FileSizePipe,
        SelectAllCheckboxComponent,
        ItemCheckboxComponent,
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

  addUrl!: string;
  audioFormats: AudioFormatOption[] = AUDIO_FORMATS;
  qualities!: Quality[];
  quality: string;
  format: string;
  folder!: string;
  customNamePrefix!: string;
  autoStart: boolean;
  playlistItemLimit!: number;
  splitByChapters: boolean;
  sponsorblock: boolean;
  chapterTemplate: string;
  clipStart = '';
  clipEnd = '';
  ytdlOptionsPresets: string[] = [];
  ytdlOptionsOverrides: string;
  ytdlOptionPresetNames: string[] = [];
  addInProgress = false;
  cancelRequested = false;
  hasCookies = false;
  cookieUploadInProgress = false;
  reportProblemInProgress = false;
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
  // Maximum number of /add requests to have in-flight at once during a batch
  // import. Keeps the server from being hit with hundreds of simultaneous
  // yt-dlp metadata extractions when a user pastes a huge URL list.
  private static readonly BATCH_IMPORT_CONCURRENCY = 4;
  ytDlpOptionsUpdateTime: string | null = null;
  ytDlpVersion: string | null = null;
  isAdvancedOpen = false;
  sortAscending = false;
  downloadingCollapsed = false;
  completedCollapsed = false;
  expandedErrors: Set<string> = new Set<string>();
  cachedSortedDone: [string, Download][] = [];
  // The done ids in rendered order, so a shift-click range follows the sort
  // the user is looking at rather than the map's insertion order.
  cachedSortedDoneIds: string[] = [];
  lastCopiedErrorId: string | null = null;
  private addRequestSub?: Subscription;
  private liveCountdownTimer?: ReturnType<typeof setInterval>;
  private readonly settingsCookieExpiryDays = 3650;
  private lastFocusedElement: HTMLElement | null = null;
  private colorSchemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  private onColorSchemeChanged = () => {
    if (this.activeTheme && this.activeTheme.id === 'auto') {
      this.setTheme(this.activeTheme);
    }
  };

  // Download metrics
  activeDownloads = 0;
  queuedDownloads = 0;
  completedDownloads = 0;
  failedDownloads = 0;
  totalSpeed = 0;
  hasCompletedDone = false;
  hasFailedDone = false;

  readonly queueMasterCheckbox = viewChild<SelectAllCheckboxComponent>('queueMasterCheckboxRef');
  readonly queueDelSelected = viewChild.required<ElementRef>('queueDelSelected');
  readonly queueDownloadSelected = viewChild.required<ElementRef>('queueDownloadSelected');
  readonly doneMasterCheckbox = viewChild<SelectAllCheckboxComponent>('doneMasterCheckboxRef');
  readonly doneDelSelected = viewChild.required<ElementRef>('doneDelSelected');
  readonly doneDownloadSelected = viewChild.required<ElementRef>('doneDownloadSelected');

  faTrashAlt = faTrashAlt;
  faCheckCircle = faCheckCircle;
  faTimesCircle = faTimesCircle;
  faRedoAlt = faRedoAlt;
  faSun = faSun;
  faMoon = faMoon;
  faCheck = faCheck;
  faCircleHalfStroke = faCircleHalfStroke;
  faDownload = faDownload;
  faExternalLinkAlt = faExternalLinkAlt;
  faFileImport = faFileImport;
  faFileExport = faFileExport;
  faCopy = faCopy;
  faClock = faClock;
  faTachometerAlt = faTachometerAlt;
  faSortAmountDown = faSortAmountDown;
  faSortAmountUp = faSortAmountUp;
  faChevronRight = faChevronRight;
  faChevronDown = faChevronDown;
  faUpload = faUpload;
  faShareNodes = faShareNodes;
  faTriangleExclamation = faTriangleExclamation;
  constructor() {
    this.format = this.cookieService.get('metube_format') || 'mp3';
    this.quality = this.cookieService.get('metube_quality') || '320';
    this.autoStart = this.cookieService.get('metube_auto_start') !== 'false';
    this.splitByChapters = this.cookieService.get('metube_split_chapters') === 'true';
    this.sponsorblock = this.cookieService.get('metube_sponsorblock') === 'true';
    // Will be set from backend configuration, use empty string as placeholder
    this.chapterTemplate = this.cookieService.get('metube_chapter_template') || '';
    this.clipStart = this.cookieService.get('metube_clip_start') || '';
    this.clipEnd = this.cookieService.get('metube_clip_end') || '';
    this.ytdlOptionsPresets = this.loadYtdlOptionsPresetsFromCookie();
    this.ytdlOptionsOverrides = this.cookieService.get('metube_ytdl_options_overrides') || '';
    const allowedAudioFormats = new Set(this.audioFormats.map((audioFormat) => audioFormat.id));
    if (!allowedAudioFormats.has(this.format)) {
      this.format = 'mp3';
    }
    this.setQualities();
    this.cookieService.set('metube_format', this.format, { expires: this.settingsCookieExpiryDays });
    this.cookieService.set('metube_quality', this.quality, { expires: this.settingsCookieExpiryDays });
    this.sortAscending = this.cookieService.get('metube_sort_ascending') === 'true';
    this.downloadingCollapsed = this.cookieService.get('metube_downloading_collapsed') === 'true';
    this.completedCollapsed = this.cookieService.get('metube_completed_collapsed') === 'true';
    this.activeTheme = this.getPreferredTheme(this.cookieService);

    // Subscribe to download updates
    this.downloads.queueChanged.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.updateMetrics();
      this.syncLiveCountdownTimer();
      this.cdr.markForCheck();
    });
    this.downloads.doneChanged.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.updateMetrics();
      this.rebuildSortedDone();
      this.cdr.markForCheck();
    });
    // Subscribe to real-time updates
    this.downloads.updated.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.updateMetrics();
      this.syncLiveCountdownTimer();
      this.cdr.markForCheck();
    });
  }

  ngOnInit() {
    this.downloads.getCookieStatus().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(data => {
      this.hasCookies = !!(data && typeof data === 'object' && 'has_cookies' in data && data.has_cookies);
      this.cdr.markForCheck();
    });
    this.getConfiguration();
    this.getYtdlOptionsUpdateTime();
    this.getYtdlOptionPresets();
    this.setTheme(this.activeTheme!);

    this.colorSchemeMediaQuery.addEventListener('change', this.onColorSchemeChanged);
  }

  ngAfterViewInit() {
    this.downloads.queueChanged.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.queueMasterCheckbox()?.selectionChanged();
      this.cdr.markForCheck();
    });
    this.downloads.doneChanged.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.doneMasterCheckbox()?.selectionChanged();
      this.updateDoneActionButtons();
      this.cdr.markForCheck();
    });
    // Initialize action button states for already-loaded entries.
    this.updateDoneActionButtons();
    this.fetchVersionInfo();
    this.socket.fromEvent('connect')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.fetchVersionInfo());
  }

  ngOnDestroy() {
    this.addRequestSub?.unsubscribe();
    if (this.liveCountdownTimer) {
      clearInterval(this.liveCountdownTimer);
    }
    this.colorSchemeMediaQuery.removeEventListener('change', this.onColorSchemeChanged);
  }

  // keyvalue comparator that preserves insertion order (Angular's keyvalue
  // pipe sorts by key by default): https://github.com/angular/angular/issues/31420
  asIsOrder() {
    return 0;
  }

  qualityChanged() {
    this.cookieService.set('metube_quality', this.quality, { expires: this.settingsCookieExpiryDays });
    // Re-trigger custom directory change
    this.downloads.customDirsChanged.next(this.downloads.customDirs);
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
      map(term => {
        const dirs = this.downloads.customDirs?.['audio_download_dir'] ?? [];
        const t = (term ?? '').toLowerCase();
        return (t === '' ? dirs : dirs.filter(d => d.toLowerCase().includes(t))).slice(0, 10);
      }),
    );
  };

  getYtdlOptionsUpdateTime() {
    this.downloads.ytdlOptionsChanged.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
       // eslint-disable-next-line @typescript-eslint/no-explicit-any
      next: (data:any) => {
        if (data['success']){
          const date = new Date(data['update_time'] * 1000);
          this.ytDlpOptionsUpdateTime=date.toLocaleString();
        }else{
          this.toasts.error("Error reloading yt-dlp options: " + data['msg']);
        }
        this.cdr.markForCheck();
      }
    });
  }
  getConfiguration() {
    this.downloads.configurationChanged.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
       // eslint-disable-next-line @typescript-eslint/no-explicit-any
      next: (config: any) => {
        const playlistItemLimit = parseInt(String(config['DEFAULT_OPTION_PLAYLIST_ITEM_LIMIT'] ?? '0'), 10);
        if (!Number.isNaN(playlistItemLimit) && playlistItemLimit > 0) {
          this.playlistItemLimit = playlistItemLimit;
        }
        // Pre-fill the download folder, unless the user has already typed one
        // this session. The server drops DEFAULT_FOLDER when CUSTOM_DIRS is
        // off, so there is nothing to guard against here.
        if (!this.folder) {
          this.folder = String(config['DEFAULT_FOLDER'] ?? '');
        }
        // Set chapter template from backend config if not already set by cookie
        if (!this.chapterTemplate) {
          this.chapterTemplate = config['OUTPUT_TEMPLATE_CHAPTER'];
        }
        this.cdr.markForCheck();
      }
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
          const filtered = this.ytdlOptionsPresets.filter((p) => valid.has(p));
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
          return parsed.filter((p): p is string => typeof p === 'string' && p.length > 0);
        }
      } catch {
        // fall through to legacy cookie
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
    let theme = 'auto';
    if (cookieService.check('metube_theme')) {
      theme = cookieService.get('metube_theme');
    }

    return this.themes.find(x => x.id === theme) ?? this.themes.find(x => x.id === 'auto');
  }

  themeChanged(theme: Theme) {
    this.cookieService.set('metube_theme', theme.id, { expires: this.settingsCookieExpiryDays });
    this.setTheme(theme);
  }

  setTheme(theme: Theme) {
    this.activeTheme = theme;
    if (theme.id === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-bs-theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-bs-theme', theme.id);
    }
  }

  formatChanged() {
    this.cookieService.set('metube_format', this.format, { expires: this.settingsCookieExpiryDays });
    this.setQualities();
    // Re-trigger custom directory change
    this.downloads.customDirsChanged.next(this.downloads.customDirs);
  }

  autoStartChanged() {
    this.cookieService.set('metube_auto_start', this.autoStart ? 'true' : 'false', { expires: this.settingsCookieExpiryDays });
  }

  sponsorblockChanged() {
    this.cookieService.set('metube_sponsorblock', this.sponsorblock ? 'true' : 'false', { expires: this.settingsCookieExpiryDays });
  }

  splitByChaptersChanged() {
    this.cookieService.set('metube_split_chapters', this.splitByChapters ? 'true' : 'false', { expires: this.settingsCookieExpiryDays });
  }

  chapterTemplateChanged() {
    // Restore default if template is cleared - get from configuration
    if (!this.chapterTemplate || this.chapterTemplate.trim() === '') {
      const configuredTemplate = this.downloads.configuration['OUTPUT_TEMPLATE_CHAPTER'];
      this.chapterTemplate = typeof configuredTemplate === 'string' ? configuredTemplate : '';
    }
    this.cookieService.set('metube_chapter_template', this.chapterTemplate, { expires: this.settingsCookieExpiryDays });
  }

  clipStartChanged() {
    this.cookieService.set('metube_clip_start', this.clipStart, { expires: this.settingsCookieExpiryDays });
  }

  clipEndChanged() {
    this.cookieService.set('metube_clip_end', this.clipEnd, { expires: this.settingsCookieExpiryDays });
  }

  ytdlOptionsPresetsChanged() {
    this.cookieService.set(
      'metube_ytdl_options_presets',
      JSON.stringify(this.ytdlOptionsPresets ?? []),
      { expires: this.settingsCookieExpiryDays },
    );
  }

  ytdlOptionsOverridesChanged() {
    this.cookieService.set('metube_ytdl_options_overrides', this.ytdlOptionsOverrides, { expires: this.settingsCookieExpiryDays });
  }

  formatQualityLabel(download: Download): string {
    const q = download.quality;
    if (!q) return '';
    if (/^\d+$/.test(q)) return `${q} kbps`;
    return q.charAt(0).toUpperCase() + q.slice(1);
  }

  // The format the download was queued with, labelled the way the form labels
  // it, so a queued item can be told apart while it is still downloading.
  formatLabel(download: Download): string {
    const format = (download.format || '').trim();
    if (!format) {
      return '-';
    }
    const options: Option[] = [...this.audioFormats];
    return options.find(o => o.id === format)?.text ?? format.toUpperCase();
  }

  formatCodecLabel(download: Download): string {
    const format = (download.format || '').toUpperCase();
    return format || '-';
  }

  queueSelectionChanged(checked: number) {
    this.queueDelSelected().nativeElement.disabled = checked === 0;
    this.queueDownloadSelected().nativeElement.disabled = checked === 0;
  }

  doneSelectionChanged(checked: number) {
    this.doneDelSelected().nativeElement.disabled = checked === 0;
    this.doneDownloadSelected().nativeElement.disabled = checked === 0;
  }

  private updateDoneActionButtons() {
    let completed = 0;
    let failed = 0;
    this.downloads.done.forEach((download) => {
      const isFailed = download.status === 'error';
      const isCompleted = !isFailed && (
        download.status === 'finished' ||
        download.status === 'completed' ||
        Boolean(download.filename)
      );
      if (isCompleted) {
        completed++;
      } else if (isFailed) {
        failed++;
      }
    });
    this.hasCompletedDone = completed > 0;
    this.hasFailedDone = failed > 0;
  }

  setQualities() {
    const selectedFormat = this.audioFormats.find(el => el.id === this.format);
    this.qualities = selectedFormat ? selectedFormat.qualities : this.audioFormats[0].qualities;
    const exists = this.qualities.find(el => el.id === this.quality);
    this.quality = exists ? this.quality : this.qualities[0].id;
    this.cookieService.set('metube_quality', this.quality, {
      expires: this.settingsCookieExpiryDays,
    });
  }

  private buildAddPayload(overrides: Partial<AddDownloadPayload> = {}): AddDownloadPayload {
    const allowYtdlOptionsOverrides = this.allowYtdlOptionsOverrides();
    return {
      url: overrides.url ?? this.addUrl,
      quality: overrides.quality ?? this.quality,
      format: overrides.format ?? this.format,
      folder: overrides.folder ?? this.folder,
      customNamePrefix: overrides.customNamePrefix ?? this.customNamePrefix,
      playlistItemLimit: overrides.playlistItemLimit ?? this.playlistItemLimit,
      autoStart: overrides.autoStart ?? this.autoStart,
      splitByChapters: overrides.splitByChapters ?? this.splitByChapters,
      sponsorblock: overrides.sponsorblock ?? this.sponsorblock,
      chapterTemplate: overrides.chapterTemplate ?? this.chapterTemplate,
      ytdlOptionsPresets: overrides.ytdlOptionsPresets ?? [...this.ytdlOptionsPresets],
      ytdlOptionsOverrides: allowYtdlOptionsOverrides
        ? (overrides.ytdlOptionsOverrides ?? this.ytdlOptionsOverrides)
        : '',
      clipStart: overrides.clipStart ?? this.clipStart,
      clipEnd: overrides.clipEnd ?? this.clipEnd,
    };
  }

  addDownload(overrides: Partial<AddDownloadPayload> = {}) {
    const payload = this.buildAddPayload(overrides);

    // Validate chapter template if chapter splitting is enabled
    if (payload.splitByChapters && !payload.chapterTemplate.includes('%(section_number)')) {
      this.toasts.error('Chapter template must include %(section_number)');
      return;
    }
    if (!this.validateYtdlOptionsOverrides(payload.ytdlOptionsOverrides)) {
      return;
    }

    this.addInProgress = true;
    this.cancelRequested = false;
    this.addRequestSub?.unsubscribe();
    this.addRequestSub = this.downloads.add(payload).subscribe((status: Status) => {
      if (status.status === 'error' && !this.cancelRequested) {
        this.toasts.error(`Error adding URL: ${status.msg}`);
      } else if (status.status !== 'error') {
        // e.g. "Already in queue: ..." when the backend skipped a duplicate.
        if (status.msg) {
          this.toasts.info(status.msg);
        }
        this.addUrl = '';
      }
      this.resetAddState();
    });
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
      }
    });
  }

  private resetAddState() {
    this.addRequestSub = undefined;
    this.addInProgress = false;
    this.cancelRequested = false;
    this.cdr.markForCheck();
  }

  downloadItemByKey(id: string) {
    this.downloads.startById([id]).subscribe((res) => this.handleActionResult(res, 'Start download failed'));
  }

  // 'preparing' (yt-dlp starting up) and 'postprocessing' (ffmpeg merging,
  // re-encoding or splitting once the bytes have landed) both have real work in
  // flight with no percentage to report, so the bar runs animated at full width
  // instead of showing a number that cannot move.
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
    // Only remove the done-list record once the retry is confirmed queued —
    // deleting it eagerly would silently lose history if the re-add fails.
    this.downloads.retry(key)
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

  reportProblem() {
    if (this.reportProblemInProgress) {
      return;
    }

    this.reportProblemInProgress = true;
    this.cdr.markForCheck();
    this.downloads.reportProblem()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.reportProblemInProgress = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe((status: Status) => {
        if (status.status === 'error') {
          this.toasts.error(status.msg || 'Could not send the problem report.');
          return;
        }
        this.toasts.success(status.msg || 'Problem report sent.');
      });
  }

  delDownload(where: State, id: string) {
    this.downloads.delById(where, [id]).subscribe((res) => this.handleActionResult(res, 'Delete failed'));
  }

  startSelectedDownloads(where: State){
    this.downloads.startByFilter(where, dl => !!dl.checked).subscribe((res) => this.handleActionResult(res, 'Start download failed'));
  }

  delSelectedDownloads(where: State) {
    this.downloads.delByFilter(where, dl => !!dl.checked).subscribe((res) => this.handleActionResult(res, 'Delete failed'));
  }

  clearCompletedDownloads() {
    this.downloads.delByFilter('done', dl => dl.status === 'finished').subscribe((res) => this.handleActionResult(res, 'Clear completed failed'));
  }

  clearFailedDownloads() {
    this.downloads.delByFilter('done', dl => dl.status === 'error').subscribe((res) => this.handleActionResult(res, 'Clear failed downloads failed'));
  }

  retryFailedDownloads() {
    this.downloads.done.forEach((dl, key) => {
      if (dl.status === 'error') {
        this.retryDownload(key, dl);
      }
    });
  }

  // Chromium-based browsers silently drop programmatic downloads beyond ~10 when
  // triggered in a tight loop. Trigger in batches with a short pause in between so
  // large selections download cleanly. See issue #1008.
  private static readonly DOWNLOAD_BATCH_SIZE = 10;
  private static readonly DOWNLOAD_BATCH_DELAY_MS = 1000;

  async downloadSelectedFiles() {
    const selected: Download[] = [];
    this.downloads.done.forEach((dl) => {
      if (dl.status === 'finished' && dl.checked) {
        selected.push(dl);
      }
    });

    for (let i = 0; i < selected.length; i++) {
      const dl = selected[i];
      const link = document.createElement('a');
      link.href = this.buildDownloadLink(dl);
      link.setAttribute('download', dl.filename);
      link.setAttribute('target', '_self');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (
        (i + 1) % App.DOWNLOAD_BATCH_SIZE === 0 &&
        i + 1 < selected.length
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, App.DOWNLOAD_BATCH_DELAY_MS),
        );
      }
    }
  }

  buildDownloadLink(download: Download) {
    let baseDir = this.downloads.configuration["PUBLIC_HOST_URL"];
    // Must match the server's directory rule exactly: ytdl.py writes to
    // AUDIO_DOWNLOAD_DIR on download_type alone. Treating any .mp3 as audio
    // sent the link to audio_download/ for MP3s produced under a legacy type
    // download (a postprocessor, a preset, or a legacy record), which the
    // server had written to DOWNLOAD_DIR -- a 404 whenever the two differ.
    if (download.download_type === 'audio') {
      baseDir = this.downloads.configuration["PUBLIC_HOST_AUDIO_URL"];
    }

    if (download.folder) {
      baseDir += this.encodeFolderPath(download.folder);
    }

    return baseDir + encodeURIComponent(download.filename);
  }

  // Web Share API support — primarily for iOS Safari / Chrome, lets the user
  // hand the downloaded file off to the platform share sheet (Photos.app,
  // Files, third-party apps, AirDrop). Falls back silently to the standard
  // download flow on platforms without navigator.share / canShare.
  canShareDownloads(): boolean {
    // navigator.share alone is not enough — Desktop Safari implements
    // navigator.share but not canShare with files. We explicitly require
    // both, since we always intend to share a file (not a URL).
    return typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function';
  }

  // Conservative warning threshold for the share sheet — iOS' actual
  // refusal limit varies between ~50 MB (older versions) and ~150 MB
  // (recent ones). 80 MB warns the user before the time-wasting fetch+
  // copy of a too-large file that the platform will then reject.
  private static readonly SHARE_SIZE_WARN_BYTES = 80 * 1024 * 1024;

  async shareDownload(download: Download): Promise<void> {
    if (!this.canShareDownloads()) {
      return;
    }
    // Pre-flight size check: warn the user about the iOS share-sheet
    // soft-fail on large files, before we spend time fetching the whole
    // file into memory only to have navigator.canShare reject it.
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
        // The platform refused the payload — most commonly because the
        // file is too large for the iOS share sheet, or the MIME type
        // isn't accepted. Tell the user so they can fall back to the
        // download button right next to this one instead of staring at
        // a button that quietly did nothing.
        console.warn('navigator.canShare rejected payload for', download.filename);
        this.toasts.error(
          `Your device's share sheet doesn't accept this file ` +
          `(most likely because it's too large). ` +
          `Please use the download button instead.`
        );
        return;
      }
      await navigator.share(payload);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      // AbortError = user dismissed the share sheet → silent no-op.
      if (e.name === 'AbortError') return;
      console.error('Share failed:', err);
      this.toasts.error(
        `Share failed: ${e.message || 'unknown error'}. ` +
        `Please use the download button instead.`
      );
    }
  }

  buildResultItemTooltip(download: Download) {
    const parts = [];
    if (download.msg) {
      parts.push(download.msg);
    }
    if (download.error) {
      parts.push(download.error);
    }
    return parts.join(' | ');
  }

  buildChapterDownloadLink(download: Download, chapterFilename: string) {
    let baseDir = this.downloads.configuration["PUBLIC_HOST_URL"];
    // Same server-side rule as buildDownloadLink above.
    if (download.download_type === 'audio') {
      baseDir = this.downloads.configuration["PUBLIC_HOST_AUDIO_URL"];
    }

    if (download.folder) {
      baseDir += this.encodeFolderPath(download.folder);
    }

    return baseDir + encodeURIComponent(chapterFilename);
  }

  private encodeFolderPath(folder: string): string {
    return folder
      .split('/')
      .filter(segment => segment.length > 0)
      .map(segment => encodeURIComponent(segment))
      .join('/') + '/';
  }

  getChapterFileName(filepath: string) {
    // Extract just the filename from the path
    const parts = filepath.split('/');
    return parts[parts.length - 1];
  }

  isNumber(event: KeyboardEvent) {
    const allowedControlKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'];
    if (allowedControlKeys.includes(event.key)) {
      return;
    }

    if (!/^[0-9]$/.test(event.key)) {
      event.preventDefault();
    }
  }

  // Toggle inline batch panel (if you want to use an inline panel for export; not used for import modal)
  toggleBatchPanel(): void {
    this.showBatchPanel = !this.showBatchPanel;
  }

  // Open the Batch Import modal
  openBatchImportModal(): void {
    this.lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

  // Close the Batch Import modal
  closeBatchImportModal(): void {
    this.batchImportModalOpen = false;
    this.lastFocusedElement?.focus();
  }

  // Start importing URLs from the batch modal textarea
  startBatchImport(): void {
    const urls = this.batchImportText
      .split(/\r?\n/)
      .map(url => url.trim())
      .filter(url => url.length > 0);
    if (urls.length === 0) {
      this.toasts.error('No valid URLs found.');
      return;
    }
    this.importInProgress = true;
    this.batchImportCount = 0;
    this.batchImportFailures = 0;
    this.batchImportTotal = urls.length;
    this.updateBatchImportStatus();

    from(urls).pipe(
      mergeMap(
        url => this.downloads.add(this.buildAddPayload({ url })).pipe(
          // downloads.add() already catches HTTP errors and emits a single
          // Status value, so `tap` (not `finalize`) is the right place to
          // count. This avoids incrementing the counter when an in-flight
          // request is aborted by cancellation.
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
    ).subscribe();
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

  // Cancel the batch import process: aborts in-flight and pending requests
  // immediately via the cancellation Subject wired into the pipeline.
  cancelBatchImport(): void {
    if (this.importInProgress) {
      this.batchImportCancel$.next();
    }
  }

  // Export URLs based on filter: 'pending', 'completed', 'failed', or 'all'
  exportBatchUrls(filter: BatchUrlFilter): void {
    this.batchUrls.export(filter);
  }

  // Copy URLs to clipboard based on filter: 'pending', 'completed', 'failed', or 'all'
  copyBatchUrls(filter: BatchUrlFilter): void {
    this.batchUrls.copy(filter);
  }

  fetchVersionInfo(): void {
    // eslint-disable-next-line no-useless-escape
    const baseUrl = `${window.location.origin}${window.location.pathname.replace(/\/[^\/]*$/, '/')}`;
    const versionUrl = `${baseUrl}version`;
    this.http.get<{ 'yt-dlp': string }>(versionUrl)
      .subscribe({
        next: (data) => {
          this.ytDlpVersion = data['yt-dlp'];
        },
        error: () => {
          this.ytDlpVersion = null;
        }
      });
  }

  toggleAdvanced() {
    this.isAdvancedOpen = !this.isAdvancedOpen;
  }

  toggleSortOrder() {
    this.sortAscending = !this.sortAscending;
    this.cookieService.set('metube_sort_ascending', this.sortAscending ? 'true' : 'false', { expires: this.settingsCookieExpiryDays });
    this.rebuildSortedDone();
  }

  toggleDownloadingCollapsed() {
    this.downloadingCollapsed = !this.downloadingCollapsed;
    this.cookieService.set('metube_downloading_collapsed', this.downloadingCollapsed ? 'true' : 'false', { expires: this.settingsCookieExpiryDays });
  }

  toggleCompletedCollapsed() {
    this.completedCollapsed = !this.completedCollapsed;
    this.cookieService.set('metube_completed_collapsed', this.completedCollapsed ? 'true' : 'false', { expires: this.settingsCookieExpiryDays });
  }

  private rebuildSortedDone() {
    const result: [string, Download][] = [];
    this.downloads.done.forEach((dl, key) => {
      result.push([key, dl]);
    });
    if (!this.sortAscending) {
      result.reverse();
    }
    this.cachedSortedDone = result;
    this.cachedSortedDoneIds = result.map(([key]) => key);
  }

  toggleErrorDetail(id: string) {
    if (this.expandedErrors.has(id)) this.expandedErrors.delete(id);
    else this.expandedErrors.add(id);
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
      setTimeout(() => { this.lastCopiedErrorId = null; }, 1500);
    };
    const fail = (err?: unknown) => {
      console.error('Clipboard write failed:', err);
      this.toasts.error('Failed to copy to clipboard. Your browser may require HTTPS for clipboard access.');
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fail);
    } else {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (e) {
        fail(e);
      }
    }
  }

  isErrorExpanded(id: string): boolean {
    return this.expandedErrors.has(id);
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
      },
      error: () => {
        this.refreshCookieStatus();
        this.cookieUploadInProgress = false;
        input.value = '';
        this.toasts.error('Error uploading cookies.');
      }
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
      }
    });
  }

  private refreshCookieStatus() {
    this.downloads.getCookieStatus().subscribe(data => {
      this.hasCookies = !!(data && typeof data === 'object' && 'has_cookies' in data && data.has_cookies);
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
