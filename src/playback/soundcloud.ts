import type { Track } from '../../shared/types';
import {
  loadSoundCloudApi,
  retrySoundCloudApi,
  type SoundCloudWidget,
} from './sdk';
import type {
  ProviderController,
  ProviderEvent,
  ProviderLoadOptions,
} from './types';

interface SoundCloudProgress {
  currentPosition?: number;
}

export class SoundCloudController implements ProviderController {
  private iframe?: HTMLIFrameElement;
  private widget?: SoundCloudWidget;
  private widgetPromise?: Promise<SoundCloudWidget>;
  private track?: Track;
  private initialTrackUrl?: string;
  private generation = 0;
  private active = false;
  private readyForEvents = false;
  private desiredPlay = false;
  private started = false;
  private startedGeneration?: number;
  private finishedGeneration?: number;
  private destroyed = false;
  private autoplayTimer?: number;
  private loadTimer?: number;
  private loadPending = false;
  private errorGeneration?: number;
  private widgetAttempt = 0;
  private eventNames?: Record<'ready' | 'play' | 'pause' | 'progress' | 'finish' | 'error', string>;

  constructor(
    private readonly host: HTMLElement,
    private readonly onEvent: (event: ProviderEvent) => void,
  ) {}

  async load(track: Track, options: ProviderLoadOptions): Promise<void> {
    this.track = track;
    this.generation = options.generation;
    this.readyForEvents = false;
    this.desiredPlay = options.autoplay;
    this.started = false;
    this.startedGeneration = undefined;
    this.finishedGeneration = undefined;
    this.errorGeneration = undefined;
    this.loadPending = true;
    this.clearAutoplayTimer();
    this.clearLoadTimer();
    this.emit({ type: 'loading', generation: this.generation, trackId: track.id });
    const hadWidget = Boolean(this.widget);
    const widget = await this.ensureWidget(track);
    if (!this.isCurrent(options.generation, track.id)) {
      return;
    }
    const completeLoad = () => {
      if (!this.isCurrent(options.generation, track.id)) {
        return;
      }
      this.clearLoadTimer();
      this.loadPending = false;
      this.readyForEvents = true;
      widget.setVolume(Math.round(options.volume * 100));
      const startSeconds = Math.max(options.progress, track.startSeconds ?? 0);
      if (startSeconds > 0) {
        widget.seekTo(startSeconds * 1000);
      }
      if (this.desiredPlay && this.active) {
        widget.play();
        this.armAutoplayCheck();
      } else {
        this.emitCurrent('paused');
        this.emitPosition();
      }
    };
    if (!hadWidget && this.initialTrackUrl === track.playbackUrl) {
      completeLoad();
      return;
    }
    this.loadTimer = window.setTimeout(() => {
      if (!this.isCurrent(options.generation, track.id) || !this.loadPending) {
        return;
      }
      this.loadPending = false;
      this.emitItemError('SoundCloud could not load this source. It may have been removed or made private.');
    }, 12_000);
    widget.load(track.playbackUrl, {
      auto_play: false,
      hide_related: true,
      show_comments: false,
      show_reposts: false,
      show_teaser: false,
      visual: true,
      callback: completeLoad,
    });
  }

  play(): void {
    if (!this.track || !this.active) {
      return;
    }
    this.desiredPlay = true;
    if (this.widget) {
      this.widget.play();
      this.armAutoplayCheck();
    }
  }

  pause(): void {
    this.desiredPlay = false;
    this.clearAutoplayTimer();
    this.widget?.pause();
  }

  seek(seconds: number): void {
    this.widget?.seekTo(Math.max(0, seconds) * 1000);
  }

  setVolume(volume: number): void {
    this.widget?.setVolume(Math.round(Math.min(1, Math.max(0, volume)) * 100));
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.desiredPlay = false;
      this.clearAutoplayTimer();
      this.widget?.pause();
    }
  }

  retrySdk(): void {
    this.widgetAttempt += 1;
    this.clearAutoplayTimer();
    this.clearLoadTimer();
    if (this.widget && this.eventNames) {
      Object.values(this.eventNames).forEach((eventName) => this.widget?.unbind(eventName));
    }
    this.widget?.pause();
    this.iframe?.remove();
    this.host.replaceChildren();
    this.widget = undefined;
    this.iframe = undefined;
    this.initialTrackUrl = undefined;
    this.eventNames = undefined;
    this.readyForEvents = false;
    retrySoundCloudApi();
    this.widgetPromise = undefined;
  }

  destroy(): void {
    this.destroyed = true;
    this.widgetAttempt += 1;
    this.active = false;
    this.clearAutoplayTimer();
    this.clearLoadTimer();
    if (this.widget && this.eventNames) {
      Object.values(this.eventNames).forEach((eventName) => this.widget?.unbind(eventName));
    }
    this.widget?.pause();
    this.iframe?.remove();
    this.widget = undefined;
    this.widgetPromise = undefined;
  }

  private ensureWidget(track: Track): Promise<SoundCloudWidget> {
    if (this.widget) {
      return Promise.resolve(this.widget);
    }
    if (this.widgetPromise) {
      return this.widgetPromise;
    }
    this.initialTrackUrl = track.playbackUrl;
    const iframe = document.createElement('iframe');
    iframe.src = this.widgetUrl(track.playbackUrl);
    iframe.title = 'SoundCloud player';
    iframe.allow = 'autoplay';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('frameborder', 'no');
    this.host.replaceChildren(iframe);
    this.iframe = iframe;
    const attempt = ++this.widgetAttempt;
    this.widgetPromise = loadSoundCloudApi().then(
      (api) =>
        new Promise<SoundCloudWidget>((resolve, reject) => {
          if (this.destroyed || attempt !== this.widgetAttempt) {
            reject(new Error('SoundCloud player was disposed.'));
            return;
          }
          const widget = api.Widget(iframe);
          const events = api.Widget.Events;
          this.eventNames = {
            ready: events.READY,
            play: events.PLAY,
            pause: events.PAUSE,
            progress: events.PLAY_PROGRESS,
            finish: events.FINISH,
            error: events.ERROR,
          };
          const timeout = window.setTimeout(() => {
            if (attempt === this.widgetAttempt) {
              this.widgetPromise = undefined;
            }
            reject(new Error('SoundCloud player did not become ready.'));
          }, 15_000);
          widget.bind(events.READY, () => {
            window.clearTimeout(timeout);
            if (this.destroyed || attempt !== this.widgetAttempt) {
              reject(new Error('SoundCloud player was disposed.'));
              return;
            }
            this.widget = widget;
            resolve(widget);
          });
          widget.bind(events.PLAY, () => this.handlePlay());
          widget.bind(events.PAUSE, () => this.handlePause());
          widget.bind(events.PLAY_PROGRESS, (data) => this.handleProgress(data));
          widget.bind(events.FINISH, () => this.handleFinish());
          widget.bind(events.ERROR, () => this.handleError());
        }),
    );
    return this.widgetPromise;
  }

  private handlePlay(): void {
    if (!this.isLive() || !this.track || !this.widget) {
      return;
    }
    const generation = this.generation;
    const trackId = this.track.id;
    const confirmPlay = (soundUrl?: string) => {
      if (!this.isCurrent(generation, trackId) || !this.active || !this.track) {
        return;
      }
      if (
        this.track.kind === 'track' &&
        soundUrl &&
        !this.sameSoundCloudUrl(soundUrl, this.track.sourceUrl)
      ) {
        return;
      }
      this.started = true;
      this.startedGeneration = generation;
      this.desiredPlay = true;
      this.clearAutoplayTimer();
      this.emitCurrent('playing');
      this.emitPosition();
    };
    if (this.track.kind === 'track') {
      this.widget.getCurrentSound((sound) => confirmPlay(sound?.permalink_url));
    } else {
      confirmPlay();
    }
  }

  private handlePause(): void {
    if (!this.isLive() || !this.track || !this.widget || (this.desiredPlay && !this.started)) {
      return;
    }
    const generation = this.generation;
    const trackId = this.track.id;
    this.widget.isPaused((paused) => {
      if (!paused || !this.isCurrent(generation, trackId) || !this.active) {
        return;
      }
      this.desiredPlay = false;
      this.clearAutoplayTimer();
      this.emitPosition();
      this.emitCurrent('paused');
    });
  }

  private handleProgress(data: unknown): void {
    if (!this.isLive() || !this.track) {
      return;
    }
    const progress = data as SoundCloudProgress | undefined;
    if (typeof progress?.currentPosition !== 'number') {
      this.emitPosition();
      return;
    }
    const generation = this.generation;
    const trackId = this.track.id;
    this.widget?.getDuration((duration) => {
      if (!this.isCurrent(generation, trackId) || !this.active) {
        return;
      }
      this.emit({
        type: 'progress',
        generation,
        trackId,
        progress: Math.max(0, progress.currentPosition ?? 0) / 1000,
        duration: Math.max(0, duration) / 1000,
      });
    });
  }

  private handleFinish(): void {
    if (
      !this.isLive() ||
      !this.track ||
      !this.widget ||
      !this.started ||
      this.startedGeneration !== this.generation ||
      this.finishedGeneration === this.generation
    ) {
      return;
    }
    const generation = this.generation;
    const trackId = this.track.id;
    this.widget.getCurrentSound((sound) => {
      if (!this.isCurrent(generation, trackId) || !this.active || !this.track) {
        return;
      }
      if (
        this.track.kind === 'track' &&
        sound?.permalink_url &&
        !this.sameSoundCloudUrl(sound.permalink_url, this.track.sourceUrl)
      ) {
        return;
      }
      if (this.track.kind !== 'playlist') {
        this.desiredPlay = false;
        this.finishedGeneration = generation;
        this.emitCurrent('ended');
        return;
      }
      this.widget?.getSounds((sounds) => {
        this.widget?.getCurrentSoundIndex((index) => {
          if (!this.isCurrent(generation, trackId) || !this.active) {
            return;
          }
          if (index >= 0 && index < sounds.length - 1) {
            return;
          }
          this.desiredPlay = false;
          this.finishedGeneration = generation;
          this.emitCurrent('ended');
        });
      });
    });
  }

  private handleError(): void {
    if (!this.track || !this.active || !this.isCurrent(this.generation, this.track.id)) {
      return;
    }
    this.loadPending = false;
    this.clearLoadTimer();
    this.emitItemError('SoundCloud reports that this item is unavailable for embedded playback.');
  }

  private emitItemError(message: string): void {
    if (!this.track || this.errorGeneration === this.generation) {
      return;
    }
    this.errorGeneration = this.generation;
    this.clearAutoplayTimer();
    this.emit({
      type: 'error',
      generation: this.generation,
      trackId: this.track.id,
      kind: 'item',
      message,
    });
  }

  private sameSoundCloudUrl(firstUrl: string, secondUrl: string): boolean {
    try {
      const normalize = (value: string) => new URL(value).pathname.replace(/\/$/, '').toLocaleLowerCase();
      return normalize(firstUrl) === normalize(secondUrl);
    } catch {
      return firstUrl.replace(/\/$/, '') === secondUrl.replace(/\/$/, '');
    }
  }

  private clearLoadTimer(): void {
    if (this.loadTimer !== undefined) {
      window.clearTimeout(this.loadTimer);
      this.loadTimer = undefined;
    }
  }

  private armAutoplayCheck(): void {
    this.clearAutoplayTimer();
    const generation = this.generation;
    const trackId = this.track?.id;
    this.autoplayTimer = window.setTimeout(() => {
      if (trackId && this.isCurrent(generation, trackId) && this.desiredPlay && !this.started) {
        this.desiredPlay = false;
        this.emit({
          type: 'blocked',
          generation,
          trackId,
          message: 'Your browser paused the handoff. Press continue to keep listening.',
        });
      }
    }, 6_000);
  }

  private emitPosition(): void {
    if (!this.isLive() || !this.track || !this.widget) {
      return;
    }
    const generation = this.generation;
    const trackId = this.track.id;
    this.widget.getPosition((position) => {
      this.widget?.getDuration((duration) => {
        if (!this.isCurrent(generation, trackId) || !this.active) {
          return;
        }
        this.emit({
          type: 'progress',
          generation,
          trackId,
          progress: Math.max(0, position) / 1000,
          duration: Math.max(0, duration) / 1000,
        });
      });
    });
  }

  private emitCurrent(type: 'playing' | 'paused' | 'ended'): void {
    if (!this.track) {
      return;
    }
    this.emit({ type, generation: this.generation, trackId: this.track.id });
  }

  private emit(event: ProviderEvent): void {
    this.onEvent(event);
  }

  private isLive(): boolean {
    return Boolean(
      this.active &&
        this.readyForEvents &&
        this.track &&
        !this.destroyed,
    );
  }

  private isCurrent(generation: number, trackId: string): boolean {
    return (
      !this.destroyed &&
      this.generation === generation &&
      this.track?.id === trackId
    );
  }

  private clearAutoplayTimer(): void {
    if (this.autoplayTimer !== undefined) {
      window.clearTimeout(this.autoplayTimer);
      this.autoplayTimer = undefined;
    }
  }

  private widgetUrl(trackUrl: string): string {
    const parameters = new URLSearchParams({
      url: trackUrl,
      auto_play: 'false',
      hide_related: 'true',
      show_comments: 'false',
      show_reposts: 'false',
      show_teaser: 'false',
      visual: 'true',
    });
    return `https://w.soundcloud.com/player/?${parameters.toString()}`;
  }
}
