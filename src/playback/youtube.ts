import type { Track } from '../../shared/types';
import {
  loadYouTubeApi,
  retryYouTubeApi,
  type YouTubePlayer,
} from './sdk';
import type {
  ProviderController,
  ProviderEvent,
  ProviderLoadOptions,
} from './types';

const YOUTUBE_STATE_ENDED = 0;
const YOUTUBE_STATE_PLAYING = 1;
const YOUTUBE_STATE_PAUSED = 2;
const YOUTUBE_STATE_BUFFERING = 3;
const YOUTUBE_STATE_CUED = 5;

export class YouTubeController implements ProviderController {
  private player?: YouTubePlayer;
  private playerPromise?: Promise<YouTubePlayer>;
  private mount?: HTMLDivElement;
  private track?: Track;
  private generation = 0;
  private active = false;
  private readyForEvents = false;
  private desiredPlay = false;
  private started = false;
  private startedGeneration?: number;
  private endedGeneration?: number;
  private destroyed = false;
  private progressTimer?: number;
  private autoplayTimer?: number;
  private playerAttempt = 0;

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
    this.endedGeneration = undefined;
    this.clearTimers();
    this.emit({ type: 'loading', generation: this.generation, trackId: track.id });
    const player = await this.ensurePlayer();
    if (!this.isCurrent(options.generation, track.id)) {
      return;
    }
    player.setVolume(Math.round(options.volume * 100));
    const startSeconds = Math.max(options.progress, track.startSeconds ?? 0);
    const shouldPlay = this.desiredPlay && this.active;
    this.readyForEvents = true;
    if (track.kind === 'playlist' && track.playlistId) {
      const playlistOptions = {
        list: track.playlistId,
        listType: 'playlist' as const,
        index: 0,
        startSeconds,
      };
      if (shouldPlay) {
        player.loadPlaylist(playlistOptions);
      } else {
        player.cuePlaylist(playlistOptions);
      }
    } else if (track.videoId) {
      const videoOptions = { videoId: track.videoId, startSeconds };
      if (shouldPlay) {
        player.loadVideoById(videoOptions);
      } else {
        player.cueVideoById(videoOptions);
      }
    } else {
      this.emit({
        type: 'error',
        generation: this.generation,
        trackId: track.id,
        kind: 'item',
        message: 'This YouTube entry has no playable video identifier.',
      });
      return;
    }
    if (shouldPlay) {
      this.armAutoplayCheck();
    }
  }

  play(): void {
    if (!this.track || !this.active) {
      return;
    }
    this.desiredPlay = true;
    if (this.player) {
      this.player.playVideo();
      this.armAutoplayCheck();
    }
  }

  pause(): void {
    this.desiredPlay = false;
    this.clearAutoplayTimer();
    this.player?.pauseVideo();
  }

  seek(seconds: number): void {
    this.player?.seekTo(Math.max(0, seconds), true);
  }

  setVolume(volume: number): void {
    this.player?.setVolume(Math.round(Math.min(1, Math.max(0, volume)) * 100));
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.desiredPlay = false;
      this.clearTimers();
      this.player?.pauseVideo();
    }
  }

  retrySdk(): void {
    this.playerAttempt += 1;
    this.clearTimers();
    this.player?.destroy();
    this.player = undefined;
    this.mount = undefined;
    this.host.replaceChildren();
    retryYouTubeApi();
    this.playerPromise = undefined;
  }

  destroy(): void {
    this.destroyed = true;
    this.playerAttempt += 1;
    this.active = false;
    this.clearTimers();
    this.player?.destroy();
    this.host.replaceChildren();
    this.player = undefined;
    this.mount = undefined;
    this.playerPromise = undefined;
  }

  private ensurePlayer(): Promise<YouTubePlayer> {
    if (this.player) {
      return Promise.resolve(this.player);
    }
    if (this.playerPromise) {
      return this.playerPromise;
    }
    const mount = document.createElement('div');
    mount.className = 'youtube-player-mount';
    this.host.replaceChildren(mount);
    this.mount = mount;
    const attempt = ++this.playerAttempt;
    this.playerPromise = loadYouTubeApi().then(
      (api) =>
        new Promise<YouTubePlayer>((resolve, reject) => {
          if (this.destroyed || attempt !== this.playerAttempt) {
            reject(new Error('YouTube player was disposed.'));
            return;
          }
          const timeout = window.setTimeout(() => {
            if (attempt === this.playerAttempt) {
              this.playerPromise = undefined;
            }
            player.destroy();
            if (attempt === this.playerAttempt && this.mount === mount) {
              this.mount = undefined;
              this.host.replaceChildren();
            }
            reject(new Error('YouTube player did not become ready.'));
          }, 15_000);
          const player = new api.Player(mount, {
            height: '100%',
            width: '100%',
            playerVars: {
              controls: 1,
              playsinline: 1,
              origin: window.location.origin,
              rel: 0,
            },
            events: {
              onReady: () => {
                window.clearTimeout(timeout);
                if (this.destroyed || attempt !== this.playerAttempt) {
                  player.destroy();
                  reject(new Error('YouTube player was disposed.'));
                  return;
                }
                this.player = player;
                const iframe = player.getIframe();
                iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
                iframe.referrerPolicy = 'strict-origin-when-cross-origin';
                iframe.title = 'YouTube player';
                resolve(player);
              },
              onStateChange: (event) => this.handleState(event.data),
              onError: (event) => this.handleError(event.data),
              onAutoplayBlocked: () => this.handleAutoplayBlocked(),
            },
          });
        }),
    );
    return this.playerPromise;
  }

  private handleState(state: number): void {
    if (!this.isLive()) {
      return;
    }
    const currentState = this.player?.getPlayerState();
    if (currentState !== undefined && currentState !== state) {
      return;
    }
    if (state === YOUTUBE_STATE_PLAYING) {
      this.started = true;
      this.startedGeneration = this.generation;
      this.desiredPlay = true;
      this.clearAutoplayTimer();
      this.emitCurrent('playing');
      this.startProgressTimer();
      return;
    }
    if (state === YOUTUBE_STATE_BUFFERING) {
      this.emitCurrent('buffering');
      return;
    }
    if (state === YOUTUBE_STATE_PAUSED || state === YOUTUBE_STATE_CUED) {
      this.stopProgressTimer();
      if (!this.desiredPlay || this.started) {
        this.desiredPlay = false;
        this.emitProgress();
        this.emitCurrent('paused');
      }
      return;
    }
    if (state === YOUTUBE_STATE_ENDED) {
      this.stopProgressTimer();
      if (
        !this.started ||
        this.startedGeneration !== this.generation ||
        this.endedGeneration === this.generation ||
        this.player?.getPlayerState() !== YOUTUBE_STATE_ENDED
      ) {
        return;
      }
      if (this.track?.kind === 'playlist') {
        const playlist = this.player?.getPlaylist();
        const playlistIndex = this.player?.getPlaylistIndex() ?? -1;
        if (playlist && playlistIndex >= 0 && playlistIndex < playlist.length - 1) {
          return;
        }
      }
      this.desiredPlay = false;
      this.endedGeneration = this.generation;
      this.emitCurrent('ended');
    }
  }

  private handleError(code: number): void {
    if (!this.isLive() || !this.track) {
      return;
    }
    this.clearTimers();
    const environmentError = code === 153;
    this.emit({
      type: 'error',
      generation: this.generation,
      trackId: this.track.id,
      kind: environmentError ? 'environment' : 'item',
      code,
      message: environmentError
        ? 'YouTube rejected this browser context. Open the source or retry from a standard browser window.'
        : 'YouTube reports that this item is unavailable for embedded playback.',
    });
  }

  private handleAutoplayBlocked(): void {
    if (!this.isLive() || !this.desiredPlay || !this.track) {
      return;
    }
    this.desiredPlay = false;
    this.clearAutoplayTimer();
    this.emit({
      type: 'blocked',
      generation: this.generation,
      trackId: this.track.id,
      message: 'Your browser paused the handoff. Press continue to keep listening.',
    });
  }

  private armAutoplayCheck(): void {
    this.clearAutoplayTimer();
    const generation = this.generation;
    const trackId = this.track?.id;
    this.autoplayTimer = window.setTimeout(() => {
      if (
        trackId &&
        this.isCurrent(generation, trackId) &&
        this.desiredPlay &&
        this.player?.getPlayerState() !== YOUTUBE_STATE_PLAYING
      ) {
        this.handleAutoplayBlocked();
      }
    }, 6_000);
  }

  private startProgressTimer(): void {
    this.stopProgressTimer();
    this.emitProgress();
    this.progressTimer = window.setInterval(() => this.emitProgress(), 500);
  }

  private emitProgress(): void {
    if (!this.isLive() || !this.track || !this.player) {
      return;
    }
    this.emit({
      type: 'progress',
      generation: this.generation,
      trackId: this.track.id,
      progress: Math.max(0, this.player.getCurrentTime() || 0),
      duration: Math.max(0, this.player.getDuration() || 0),
    });
  }

  private emitCurrent(type: 'buffering' | 'playing' | 'paused' | 'ended'): void {
    if (!this.track) {
      return;
    }
    this.emit({ type, generation: this.generation, trackId: this.track.id });
  }

  private emit(event: ProviderEvent): void {
    this.onEvent(event);
  }

  private isLive(): boolean {
    if (!this.active || !this.readyForEvents || !this.track || this.destroyed) {
      return false;
    }
    if (this.track.kind === 'track' && this.track.videoId && this.player) {
      const activeVideoId = this.player.getVideoData().video_id;
      if (activeVideoId && activeVideoId !== this.track.videoId) {
        return false;
      }
    }
    return true;
  }

  private isCurrent(generation: number, trackId: string): boolean {
    return (
      !this.destroyed &&
      this.generation === generation &&
      this.track?.id === trackId
    );
  }

  private stopProgressTimer(): void {
    if (this.progressTimer !== undefined) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = undefined;
    }
  }

  private clearAutoplayTimer(): void {
    if (this.autoplayTimer !== undefined) {
      window.clearTimeout(this.autoplayTimer);
      this.autoplayTimer = undefined;
    }
  }

  private clearTimers(): void {
    this.stopProgressTimer();
    this.clearAutoplayTimer();
  }
}
