import type { Page, Route } from '@playwright/test';

export type MockProvider = 'youtube' | 'soundcloud';

export interface MockCall {
  provider: MockProvider;
  instanceId: number;
  method: string;
  arguments: unknown[];
}

export interface MockInstanceSnapshot {
  provider: MockProvider;
  instanceId: number;
  ready: boolean;
  playing: boolean;
  mediaId: string;
  position: number;
  duration: number;
  volume: number;
  collectionIndex: number;
  collectionLength: number;
  destroyed: boolean;
  playerState?: number;
}

export interface MockSdkSnapshot {
  calls: MockCall[];
  instances: MockInstanceSnapshot[];
}

export interface MockSdkDriver {
  snapshot(): MockSdkSnapshot;
  clearCalls(): void;
  delayReady(provider: MockProvider, milliseconds: number): void;
  blockNextPlay(provider: MockProvider): void;
  finish(provider: MockProvider, repeats?: number, instanceId?: number): void;
  fail(provider: MockProvider, code?: number | string, instanceId?: number): void;
  setProgress(provider: MockProvider, seconds: number, duration?: number, instanceId?: number): void;
}

export interface MockSdkOptions {
  readyDelays?: Partial<Record<MockProvider, number>>;
  blockNextPlay?: MockProvider;
}

declare global {
  interface Window {
    __pilldiffSdkDriver: MockSdkDriver;
  }
}

const thirdPartyScriptPattern = /(?:youtube\.com\/iframe_api|soundcloud\.com\/player\/api\.js)/;
const thirdPartyFramePattern = /(?:youtube(?:-nocookie)?\.com\/embed|w\.soundcloud\.com\/player)/;

async function fulfillSdkScript(route: Route): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'window.onYouTubeIframeAPIReady?.();',
  });
}

async function fulfillPlayerFrame(route: Route): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><body></body></html>',
  });
}

export async function installMockSdks(page: Page, options: MockSdkOptions = {}): Promise<void> {
  await page.route(thirdPartyScriptPattern, fulfillSdkScript);
  await page.route(thirdPartyFramePattern, fulfillPlayerFrame);
  await page.addInitScript((initialOptions: MockSdkOptions) => {
    type ProviderName = 'youtube' | 'soundcloud';
    type EventCallback = (...argumentsList: unknown[]) => void;

    interface MockSound {
      id: string;
      title: string;
      permalink_url: string;
    }

    interface InternalInstance {
      provider: ProviderName;
      instanceId: number;
      ready: boolean;
      playing: boolean;
      mediaId: string;
      position: number;
      duration: number;
      volume: number;
      collectionIndex: number;
      collection: MockSound[];
      callbacks: Map<string, Set<EventCallback>>;
      iframe: HTMLIFrameElement;
      controller?: unknown;
      destroyed: boolean;
      playerState?: number;
    }

    interface YoutubeOptions {
      events?: Record<string, EventCallback>;
      height?: string | number;
      width?: string | number;
      videoId?: string;
    }

    const calls: MockCall[] = [];
    const instances: InternalInstance[] = [];
    const readyDelays: Record<ProviderName, number> = {
      youtube: initialOptions.readyDelays?.youtube ?? 0,
      soundcloud: initialOptions.readyDelays?.soundcloud ?? 0,
    };
    const blockedPlays: Record<ProviderName, boolean> = {
      youtube: initialOptions.blockNextPlay === 'youtube',
      soundcloud: initialOptions.blockNextPlay === 'soundcloud',
    };
    let nextInstanceId = 1;

    function record(instance: InternalInstance, method: string, argumentsList: unknown[]): void {
      const serializedArguments = JSON.parse(JSON.stringify(argumentsList, (propertyName, value: unknown) => {
        if (typeof value === 'function') {
          return '[function]';
        }
        if (value instanceof Element) {
          return `[${value.tagName.toLowerCase()}]`;
        }
        return value;
      })) as unknown[];
      calls.push({
        provider: instance.provider,
        instanceId: instance.instanceId,
        method,
        arguments: serializedArguments,
      });
    }

    function defer(callback: () => void, milliseconds = 0): void {
      window.setTimeout(callback, milliseconds);
    }

    function emit(instance: InternalInstance, eventName: string, ...argumentsList: unknown[]): void {
      const callbacks = instance.callbacks.get(eventName);
      if (!callbacks) {
        return;
      }
      defer(() => {
        for (const callback of callbacks) {
          callback(...argumentsList);
        }
      });
    }

    function bind(instance: InternalInstance, eventName: string, callback: EventCallback): void {
      const callbacks = instance.callbacks.get(eventName) ?? new Set<EventCallback>();
      callbacks.add(callback);
      instance.callbacks.set(eventName, callbacks);
    }

    function createIframe(provider: ProviderName, target?: Element | null): HTMLIFrameElement {
      const existingIframe = target instanceof HTMLIFrameElement ? target : undefined;
      const iframe = existingIframe ?? document.createElement('iframe');
      iframe.dataset.mockProvider = provider;
      iframe.title = provider === 'youtube' ? 'YouTube player' : 'SoundCloud player';
      iframe.src = provider === 'youtube'
        ? 'https://www.youtube.com/embed/mock'
        : 'https://w.soundcloud.com/player/?url=mock';
      iframe.style.display = 'block';
      iframe.style.width = '100%';
      iframe.style.minWidth = '200px';
      iframe.style.height = '240px';
      iframe.style.minHeight = '200px';
      if (!existingIframe && target) {
        target.replaceWith(iframe);
      }
      return iframe;
    }

    function createInstance(provider: ProviderName, iframe: HTMLIFrameElement): InternalInstance {
      const instance: InternalInstance = {
        provider,
        instanceId: nextInstanceId,
        ready: false,
        playing: false,
        mediaId: '',
        position: 0,
        duration: 240,
        volume: provider === 'youtube' ? 100 : 1,
        collectionIndex: 0,
        collection: [],
        callbacks: new Map(),
        iframe,
        destroyed: false,
        playerState: provider === 'youtube' ? -1 : undefined,
      };
      nextInstanceId += 1;
      instances.push(instance);
      return instance;
    }

    function latestInstance(provider: ProviderName, instanceId?: number): InternalInstance | undefined {
      if (instanceId !== undefined) {
        return instances.find((instance) => instance.instanceId === instanceId);
      }
      for (let instanceIndex = instances.length - 1; instanceIndex >= 0; instanceIndex -= 1) {
        if (
          instances[instanceIndex].provider === provider &&
          !instances[instanceIndex].destroyed &&
          instances[instanceIndex].iframe.isConnected
        ) {
          return instances[instanceIndex];
        }
      }
      return undefined;
    }

    function collectionFor(mediaId: string): MockSound[] {
      return [1, 2, 3].map((position) => ({
        id: `${mediaId || 'collection'}-${position}`,
        title: `Collection item ${position}`,
        permalink_url: `${mediaId || 'https://soundcloud.com/pilldiff/collection'}/${position}`,
      }));
    }

    class MockYoutubePlayer {
      private readonly instance: InternalInstance;
      private readonly events: Record<string, EventCallback>;

      constructor(target: string | HTMLElement, options: YoutubeOptions = {}) {
        const targetElement = typeof target === 'string' ? document.getElementById(target) : target;
        const iframe = createIframe('youtube', targetElement);
        if (options.width !== undefined) {
          iframe.width = String(options.width);
        }
        if (options.height !== undefined) {
          iframe.height = String(options.height);
        }
        this.instance = createInstance('youtube', iframe);
        this.instance.controller = this;
        this.events = options.events ?? {};
        for (const [eventName, callback] of Object.entries(this.events)) {
          const mappedEvent = eventName === 'onStateChange'
            ? 'state'
            : eventName === 'onError'
              ? 'error'
              : eventName;
          bind(this.instance, mappedEvent, callback);
        }
        this.instance.mediaId = options.videoId ?? '';
        record(this.instance, 'constructor', [options]);
        defer(() => {
          this.instance.ready = true;
          this.events.onReady?.({ target: this });
        }, readyDelays.youtube);
      }

      addEventListener(eventName: string, callback: EventCallback): void {
        const mappedEvent = eventName === 'onStateChange' ? 'state' : eventName;
        bind(this.instance, mappedEvent, callback);
      }

      removeEventListener(eventName: string, callback: EventCallback): void {
        const mappedEvent = eventName === 'onStateChange' ? 'state' : eventName;
        this.instance.callbacks.get(mappedEvent)?.delete(callback);
      }

      loadVideoById(input: string | { videoId: string; startSeconds?: number }): void {
        const mediaId = typeof input === 'string' ? input : input.videoId;
        const startSeconds = typeof input === 'string' ? 0 : input.startSeconds ?? 0;
        this.instance.mediaId = mediaId;
        this.instance.position = startSeconds;
        this.instance.collection = [];
        this.instance.collectionIndex = 0;
        this.instance.playerState = 1;
        record(this.instance, 'loadVideoById', [input]);
        this.playVideo();
      }

      cueVideoById(input: string | { videoId: string; startSeconds?: number }): void {
        const mediaId = typeof input === 'string' ? input : input.videoId;
        const startSeconds = typeof input === 'string' ? 0 : input.startSeconds ?? 0;
        this.instance.mediaId = mediaId;
        this.instance.position = startSeconds;
        this.instance.collection = [];
        this.instance.collectionIndex = 0;
        this.instance.playerState = 5;
        record(this.instance, 'cueVideoById', [input]);
        this.instance.playing = false;
        defer(() => this.events.onStateChange?.({ data: 5, target: this }));
      }

      loadPlaylist(input: string | { list?: string; playlist?: string[]; index?: number; startSeconds?: number }): void {
        const mediaId = typeof input === 'string' ? input : input.list ?? input.playlist?.join(',') ?? '';
        this.instance.mediaId = mediaId;
        this.instance.collection = collectionFor(mediaId);
        this.instance.collectionIndex = typeof input === 'string' ? 0 : input.index ?? 0;
        this.instance.position = typeof input === 'string' ? 0 : input.startSeconds ?? 0;
        this.instance.playerState = 1;
        record(this.instance, 'loadPlaylist', [input]);
        this.playVideo();
      }

      cuePlaylist(input: string | { list?: string; playlist?: string[]; index?: number; startSeconds?: number }): void {
        const mediaId = typeof input === 'string' ? input : input.list ?? input.playlist?.join(',') ?? '';
        this.instance.mediaId = mediaId;
        this.instance.collection = collectionFor(mediaId);
        this.instance.collectionIndex = typeof input === 'string' ? 0 : input.index ?? 0;
        this.instance.position = typeof input === 'string' ? 0 : input.startSeconds ?? 0;
        this.instance.playing = false;
        this.instance.playerState = 5;
        record(this.instance, 'cuePlaylist', [input]);
      }

      playVideo(): void {
        record(this.instance, 'playVideo', []);
        if (blockedPlays.youtube) {
          blockedPlays.youtube = false;
          this.instance.playing = false;
          this.instance.playerState = 2;
          defer(() => this.events.onAutoplayBlocked?.({ target: this }));
          return;
        }
        this.instance.playing = true;
        this.instance.playerState = 1;
        defer(() => this.events.onStateChange?.({ data: 1, target: this }));
      }

      pauseVideo(): void {
        record(this.instance, 'pauseVideo', []);
        this.instance.playing = false;
        this.instance.playerState = 2;
        defer(() => this.events.onStateChange?.({ data: 2, target: this }));
      }

      stopVideo(): void {
        record(this.instance, 'stopVideo', []);
        this.instance.playing = false;
        this.instance.playerState = 0;
      }

      seekTo(seconds: number, allowSeekAhead?: boolean): void {
        record(this.instance, 'seekTo', [seconds, allowSeekAhead]);
        this.instance.position = seconds;
      }

      getCurrentTime(): number {
        return this.instance.position;
      }

      getDuration(): number {
        return this.instance.duration;
      }

      getPlayerState(): number {
        return this.instance.playerState ?? -1;
      }

      getVideoData(): { video_id: string; title: string } {
        return {
          video_id: this.instance.collection[this.instance.collectionIndex]?.id ?? this.instance.mediaId,
          title: this.instance.collection[this.instance.collectionIndex]?.title ?? this.instance.mediaId,
        };
      }

      getPlaylist(): string[] {
        return this.instance.collection.map((item) => item.id);
      }

      getPlaylistIndex(): number {
        return this.instance.collectionIndex;
      }

      setVolume(volume: number): void {
        record(this.instance, 'setVolume', [volume]);
        this.instance.volume = volume;
      }

      getVolume(): number {
        return this.instance.volume;
      }

      getIframe(): HTMLIFrameElement {
        return this.instance.iframe;
      }

      setSize(width: number, height: number): void {
        record(this.instance, 'setSize', [width, height]);
        this.instance.iframe.width = String(width);
        this.instance.iframe.height = String(height);
      }

      destroy(): void {
        record(this.instance, 'destroy', []);
        this.instance.playing = false;
        this.instance.destroyed = true;
        this.instance.iframe.remove();
      }
    }

    class MockSoundCloudWidget {
      private readonly instance: InternalInstance;

      constructor(iframe: HTMLIFrameElement) {
        const initialSource = iframe.src;
        this.instance = createInstance('soundcloud', createIframe('soundcloud', iframe));
        const encodedMediaUrl = new URL(initialSource).searchParams.get('url');
        this.instance.mediaId = encodedMediaUrl ?? initialSource;
        this.instance.collection = this.instance.mediaId.includes('/sets/')
          ? collectionFor(this.instance.mediaId)
          : [];
        record(this.instance, 'constructor', []);
        defer(() => {
          this.instance.ready = true;
          emit(this.instance, 'ready');
        }, readyDelays.soundcloud);
      }

      bind(eventName: string, callback: EventCallback): void {
        bind(this.instance, eventName, callback);
      }

      unbind(eventName: string, callback?: EventCallback): void {
        if (callback) {
          this.instance.callbacks.get(eventName)?.delete(callback);
          return;
        }
        this.instance.callbacks.delete(eventName);
      }

      load(mediaUrl: string, optionsOrCallback?: Record<string, unknown> | EventCallback, callback?: EventCallback): void {
        const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback ?? {};
        const optionsCallback = typeof options.callback === 'function'
          ? options.callback as EventCallback
          : undefined;
        const completion = typeof optionsOrCallback === 'function'
          ? optionsOrCallback
          : callback ?? optionsCallback;
        this.instance.mediaId = mediaUrl;
        this.instance.position = 0;
        this.instance.collection = mediaUrl.includes('/sets/') ? collectionFor(mediaUrl) : [];
        this.instance.collectionIndex = 0;
        this.instance.playing = false;
        record(this.instance, 'load', [mediaUrl, options]);
        defer(() => {
          completion?.();
          emit(this.instance, 'ready');
          if (options.auto_play === true) {
            this.play();
          }
        }, readyDelays.soundcloud);
      }

      play(): void {
        record(this.instance, 'play', []);
        if (blockedPlays.soundcloud) {
          blockedPlays.soundcloud = false;
          this.instance.playing = false;
          return;
        }
        this.instance.playing = true;
        emit(this.instance, 'play');
      }

      pause(): void {
        record(this.instance, 'pause', []);
        this.instance.playing = false;
        emit(this.instance, 'pause');
      }

      seekTo(milliseconds: number): void {
        record(this.instance, 'seekTo', [milliseconds]);
        this.instance.position = milliseconds / 1000;
        emit(this.instance, 'playProgress', {
          currentPosition: milliseconds,
          relativePosition: milliseconds / (this.instance.duration * 1000),
          loadedProgress: 1,
        });
      }

      setVolume(volume: number): void {
        record(this.instance, 'setVolume', [volume]);
        this.instance.volume = volume;
      }

      getPosition(callback: (milliseconds: number) => void): void {
        defer(() => callback(this.instance.position * 1000));
      }

      getDuration(callback: (milliseconds: number) => void): void {
        defer(() => callback(this.instance.duration * 1000));
      }

      getSounds(callback: (sounds: MockSound[]) => void): void {
        defer(() => callback(structuredClone(this.instance.collection)));
      }

      getCurrentSound(callback: (sound: MockSound | null) => void): void {
        const currentSound = this.instance.collection[this.instance.collectionIndex] ?? (
          this.instance.mediaId
            ? {
                id: this.instance.mediaId,
                title: this.instance.mediaId,
                permalink_url: this.instance.mediaId,
              }
            : null
        );
        defer(() => callback(structuredClone(currentSound)));
      }

      getCurrentSoundIndex(callback: (index: number) => void): void {
        defer(() => callback(this.instance.collectionIndex));
      }

      isPaused(callback: (paused: boolean) => void): void {
        defer(() => callback(!this.instance.playing));
      }
    }

    const soundCloudEvents = {
      READY: 'ready',
      PLAY: 'play',
      PAUSE: 'pause',
      PLAY_PROGRESS: 'playProgress',
      FINISH: 'finish',
      ERROR: 'error',
    } as const;

    const soundCloudFactory = ((iframe: HTMLIFrameElement) => new MockSoundCloudWidget(iframe)) as {
      (iframe: HTMLIFrameElement): MockSoundCloudWidget;
      Events: typeof soundCloudEvents;
    };
    soundCloudFactory.Events = soundCloudEvents;

    const youtubeNamespace = {
      Player: MockYoutubePlayer,
      PlayerState: {
        UNSTARTED: -1,
        ENDED: 0,
        PLAYING: 1,
        PAUSED: 2,
        BUFFERING: 3,
        CUED: 5,
      },
    };

    Object.defineProperty(window, 'YT', {
      configurable: true,
      writable: true,
      value: youtubeNamespace,
    });
    Object.defineProperty(window, 'SC', {
      configurable: true,
      writable: true,
      value: { Widget: soundCloudFactory },
    });

    window.__pilldiffSdkDriver = {
      snapshot() {
        return {
          calls: structuredClone(calls),
          instances: instances.map((instance) => ({
            provider: instance.provider,
            instanceId: instance.instanceId,
            ready: instance.ready,
            playing: instance.playing,
            mediaId: instance.mediaId,
            position: instance.position,
            duration: instance.duration,
            volume: instance.volume,
            collectionIndex: instance.collectionIndex,
            collectionLength: instance.collection.length,
            destroyed: instance.destroyed || !instance.iframe.isConnected,
            playerState: instance.playerState,
          })),
        };
      },
      clearCalls() {
        calls.splice(0, calls.length);
      },
      delayReady(provider, milliseconds) {
        readyDelays[provider] = milliseconds;
      },
      blockNextPlay(provider) {
        blockedPlays[provider] = true;
      },
      finish(provider, repeats = 1, instanceId) {
        const instance = latestInstance(provider, instanceId);
        if (!instance) {
          throw new Error(`No ${provider} mock instance exists`);
        }
        const emitFinish = (): void => {
          instance.playing = false;
          if (provider === 'youtube') {
            instance.playerState = 0;
          }
          const hasNextCollectionItem =
            instance.collection.length > 0 && instance.collectionIndex < instance.collection.length - 1;
          if (provider === 'youtube') {
            const eventCallbacks = instance.callbacks.get('state');
            defer(() => {
              for (const callback of eventCallbacks ?? []) {
                callback({ data: 0, target: instance.controller });
              }
            });
          } else {
            emit(instance, 'finish');
          }
          if (hasNextCollectionItem) {
            defer(() => {
              instance.collectionIndex += 1;
              instance.playing = true;
              if (provider === 'youtube') {
                instance.playerState = 1;
                const eventCallbacks = instance.callbacks.get('state');
                for (const callback of eventCallbacks ?? []) {
                  callback({ data: 1, target: instance.controller });
                }
              } else {
                emit(instance, 'play');
              }
            }, 20);
          }
        };
        for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex += 1) {
          emitFinish();
        }
      },
      fail(provider, code = provider === 'youtube' ? 100 : 'unavailable', instanceId) {
        const instance = latestInstance(provider, instanceId);
        if (!instance) {
          throw new Error(`No ${provider} mock instance exists`);
        }
        instance.playing = false;
        if (provider === 'youtube') {
          defer(() => {
            const callbacks = instance.callbacks.get('error');
            for (const callback of callbacks ?? []) {
              callback({ data: code, target: instance.controller });
            }
          });
          return;
        }
        emit(instance, 'error', { message: String(code) });
      },
      setProgress(provider, seconds, duration = 240, instanceId) {
        const instance = latestInstance(provider, instanceId);
        if (!instance) {
          throw new Error(`No ${provider} mock instance exists`);
        }
        instance.position = seconds;
        instance.duration = duration;
        if (provider === 'soundcloud') {
          emit(instance, 'playProgress', {
            currentPosition: seconds * 1000,
            relativePosition: seconds / duration,
            loadedProgress: 1,
          });
        }
      },
    };

    defer(() => {
      const readyCallback = (window as Window & { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady;
      readyCallback?.();
    });
  }, options);
}

export async function sdkSnapshot(page: Page): Promise<MockSdkSnapshot> {
  return page.evaluate(() => window.__pilldiffSdkDriver.snapshot());
}
