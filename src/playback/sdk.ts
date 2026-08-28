interface YouTubePlayerOptions {
  height?: string;
  width?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: { target: YouTubePlayer }) => void;
    onStateChange?: (event: { data: number; target: YouTubePlayer }) => void;
    onError?: (event: { data: number; target: YouTubePlayer }) => void;
    onAutoplayBlocked?: (event: { target: YouTubePlayer }) => void;
  };
}

export interface YouTubePlayer {
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  cueVideoById(options: { videoId: string; startSeconds?: number }): void;
  loadPlaylist(options: { list: string; listType: 'playlist'; index?: number; startSeconds?: number }): void;
  cuePlaylist(options: { list: string; listType: 'playlist'; index?: number; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData(): { video_id?: string };
  getPlaylist(): string[] | null;
  getPlaylistIndex(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}

interface YouTubeApi {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}

export interface SoundCloudWidget {
  bind(eventName: string, listener: (data?: unknown) => void): void;
  unbind(eventName: string): void;
  load(url: string, options: Record<string, unknown>): void;
  play(): void;
  pause(): void;
  seekTo(milliseconds: number): void;
  setVolume(volume: number): void;
  getDuration(callback: (duration: number) => void): void;
  getPosition(callback: (position: number) => void): void;
  getSounds(callback: (sounds: unknown[]) => void): void;
  getCurrentSoundIndex(callback: (index: number) => void): void;
  getCurrentSound(callback: (sound: { permalink_url?: string } | undefined) => void): void;
  isPaused(callback: (paused: boolean) => void): void;
}

interface SoundCloudApi {
  Widget: ((iframe: HTMLIFrameElement) => SoundCloudWidget) & {
    Events: {
      READY: string;
      PLAY: string;
      PAUSE: string;
      PLAY_PROGRESS: string;
      FINISH: string;
      ERROR: string;
    };
  };
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    SC?: SoundCloudApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubePromise: Promise<YouTubeApi> | undefined;
let soundCloudPromise: Promise<SoundCloudApi> | undefined;

export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (youtubePromise) {
    return youtubePromise;
  }
  youtubePromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => {
      youtubePromise = undefined;
      document.querySelector('script[data-pilldiff-youtube]')?.remove();
      reject(new Error('YouTube took too long to initialize.'));
    }, 15_000);
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      window.clearTimeout(timeout);
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        youtubePromise = undefined;
        reject(new Error('YouTube initialized without a player API.'));
      }
    };
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.pilldiffYoutube = 'true';
      script.onerror = () => {
        window.clearTimeout(timeout);
        youtubePromise = undefined;
        script.remove();
        reject(new Error('YouTube could not be reached.'));
      };
      document.head.append(script);
    }
  });
  return youtubePromise;
}

export function retryYouTubeApi(): void {
  youtubePromise = undefined;
  document.querySelector('script[data-pilldiff-youtube]')?.remove();
}

export function loadSoundCloudApi(): Promise<SoundCloudApi> {
  if (window.SC?.Widget) {
    return Promise.resolve(window.SC);
  }
  if (soundCloudPromise) {
    return soundCloudPromise;
  }
  soundCloudPromise = new Promise<SoundCloudApi>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      soundCloudPromise = undefined;
      document.querySelector('script[data-pilldiff-soundcloud]')?.remove();
      reject(new Error('SoundCloud took too long to initialize.'));
    }, 15_000);
    const finish = () => {
      if (!window.SC?.Widget) {
        window.clearTimeout(timeout);
        soundCloudPromise = undefined;
        reject(new Error('SoundCloud initialized without its widget API.'));
        return;
      }
      window.clearTimeout(timeout);
      resolve(window.SC);
    };
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://w.soundcloud.com/player/api.js"]',
    );
    if (existingScript) {
      existingScript.addEventListener('load', finish, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://w.soundcloud.com/player/api.js';
    script.async = true;
    script.dataset.pilldiffSoundcloud = 'true';
    script.addEventListener('load', finish, { once: true });
    script.addEventListener(
      'error',
      () => {
        window.clearTimeout(timeout);
        soundCloudPromise = undefined;
        script.remove();
        reject(new Error('SoundCloud could not be reached.'));
      },
      { once: true },
    );
    document.head.append(script);
  });
  return soundCloudPromise;
}

export function retrySoundCloudApi(): void {
  soundCloudPromise = undefined;
  document.querySelector('script[data-pilldiff-soundcloud]')?.remove();
}
