import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { PlaybackOrder, Playlist, Provider, Track } from '../../shared/types';
import { persistPlayback, restorePlayback } from './persistence';
import {
  canStep,
  changeSessionOrder,
  createSession,
  firstTrack,
  queuePosition,
  trackAtOffset,
  unavailableOutcome,
} from './queue';
import { SoundCloudController } from './soundcloud';
import type {
  PlaybackSession,
  ProviderController,
  ProviderEvent,
} from './types';
import { YouTubeController } from './youtube';

interface Controllers {
  youtube: ProviderController;
  soundcloud: ProviderController;
}

interface StartOptions {
  trackId?: string;
  progress?: number;
  autoplay?: boolean;
  notice?: string;
}

export interface PlaybackControls {
  session?: PlaybackSession;
  playingPlaylist?: Playlist;
  currentTrack?: Track;
  queueIndex: number;
  queueTotal: number;
  canPrevious: boolean;
  canNext: boolean;
  activeProvider?: Provider;
  startPlaylist: (playlist: Playlist, order: PlaybackOrder, trackId?: string) => void;
  setOrder: (order: PlaybackOrder) => void;
  togglePlay: () => void;
  previous: () => void;
  next: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  retryCurrent: () => void;
  skipCurrent: () => void;
}

export function usePlayback(
  playlists: Playlist[],
  youtubeHostRef: RefObject<HTMLDivElement | null>,
  soundCloudHostRef: RefObject<HTMLDivElement | null>,
): PlaybackControls {
  const [session, setSession] = useState<PlaybackSession>();
  const [controllerVersion, setControllerVersion] = useState(0);
  const sessionRef = useRef<PlaybackSession | undefined>(undefined);
  const playlistsRef = useRef(playlists);
  const controllersRef = useRef<Controllers | undefined>(undefined);
  const generationRef = useRef(0);
  const handledEndGenerationRef = useRef<number | undefined>(undefined);
  const initializedControllerVersionRef = useRef(0);
  const failedTrackIdsRef = useRef(new Set<string>());
  const eventHandlerRef = useRef<(event: ProviderEvent) => void>(() => undefined);
  const advanceRef = useRef<(offset: number, forcePlay: boolean) => void>(() => undefined);
  const unavailableRef = useRef<(message: string) => void>(() => undefined);

  playlistsRef.current = playlists;

  const updateSession = useCallback(
    (updater: (current: PlaybackSession) => PlaybackSession) => {
      const current = sessionRef.current;
      if (!current) {
        return;
      }
      const updated = updater(current);
      sessionRef.current = updated;
      setSession(updated);
    },
    [],
  );

  const findPlaylist = useCallback(
    (playlistId: string) => playlistsRef.current.find((item) => item.id === playlistId),
    [],
  );

  const loadTrack = useCallback(
    async (playlist: Playlist, track: Track, options: StartOptions = {}) => {
      const controllers = controllersRef.current;
      if (!controllers) {
        return;
      }
      const current = sessionRef.current;
      if (!current || current.playlistId !== playlist.id) {
        return;
      }
      const generation = ++generationRef.current;
      handledEndGenerationRef.current = undefined;
      const autoplay = options.autoplay ?? current.intentPlaying;
      const progress = Math.max(0, options.progress ?? 0);
      const targetController = controllers[track.provider];
      const inactiveProvider: Provider = track.provider === 'youtube' ? 'soundcloud' : 'youtube';
      controllers[inactiveProvider].setActive(false);
      targetController.setActive(true);
      const nextSession: PlaybackSession = {
        ...current,
        trackId: track.id,
        status: autoplay ? 'loading' : 'paused',
        intentPlaying: autoplay,
        progress,
        duration: 0,
        notice: options.notice,
        errorKind: undefined,
      };
      sessionRef.current = nextSession;
      setSession(nextSession);
      try {
        await targetController.load(track, {
          autoplay,
          progress,
          volume: nextSession.volume,
          generation,
        });
      } catch (error) {
        if (generationRef.current !== generation || sessionRef.current?.trackId !== track.id) {
          return;
        }
        const message = error instanceof Error ? error.message : 'The embedded player could not initialize.';
        updateSession((value) => ({
          ...value,
          status: 'error',
          intentPlaying: false,
          notice: `${message} Retry when your connection is ready.`,
          errorKind: 'sdk',
        }));
      }
    },
    [updateSession],
  );

  const advance = useCallback(
    (offset: number, forcePlay: boolean) => {
      const current = sessionRef.current;
      if (!current) {
        return;
      }
      const playlist = findPlaylist(current.playlistId);
      if (!playlist) {
        return;
      }
      const nextTrack = trackAtOffset(playlist, current.order, current.trackId, offset);
      if (!nextTrack) {
        if (offset > 0) {
          updateSession((value) => ({
            ...value,
            status: 'ended',
            intentPlaying: false,
            progress: value.duration || value.progress,
            notice: 'You reached the end of this playlist.',
            errorKind: undefined,
          }));
        }
        return;
      }
      const shouldPlay =
        forcePlay ||
        current.intentPlaying ||
        current.status === 'playing' ||
        current.status === 'buffering' ||
        current.status === 'loading';
      void loadTrack(playlist, nextTrack, { autoplay: shouldPlay });
    },
    [findPlaylist, loadTrack, updateSession],
  );

  advanceRef.current = advance;

  const handleUnavailable = useCallback(
    (message: string) => {
      const current = sessionRef.current;
      if (!current) {
        return;
      }
      const playlist = findPlaylist(current.playlistId);
      if (!playlist) {
        return;
      }
      failedTrackIdsRef.current.add(current.trackId);
      const outcome = unavailableOutcome(
        playlist,
        current.order,
        current.trackId,
        failedTrackIdsRef.current,
      );
      if (!outcome.nextTrack || outcome.exhausted) {
        updateSession((value) => ({
          ...value,
          status: 'error',
          intentPlaying: false,
          notice: `${message} There are no later playable entries in this order.`,
          errorKind: 'item',
        }));
        return;
      }
      const shouldPlay =
        current.intentPlaying ||
        current.status === 'playing' ||
        current.status === 'buffering';
      void loadTrack(playlist, outcome.nextTrack, {
        autoplay: shouldPlay,
        notice: 'Skipped one unavailable source and kept the queue moving.',
      });
    },
    [findPlaylist, loadTrack, updateSession],
  );

  unavailableRef.current = handleUnavailable;

  const handleProviderEvent = useCallback(
    (event: ProviderEvent) => {
      const current = sessionRef.current;
      if (
        !current ||
        generationRef.current !== event.generation ||
        current.trackId !== event.trackId
      ) {
        return;
      }
      if (event.type === 'progress') {
        updateSession((value) => ({
          ...value,
          progress: event.progress,
          duration: event.duration,
        }));
        return;
      }
      if (event.type === 'playing') {
        failedTrackIdsRef.current.clear();
        updateSession((value) => ({
          ...value,
          status: 'playing',
          intentPlaying: true,
          hasStarted: true,
          notice: undefined,
          errorKind: undefined,
        }));
        return;
      }
      if (event.type === 'paused') {
        updateSession((value) => ({
          ...value,
          status: 'paused',
          intentPlaying: false,
        }));
        return;
      }
      if (event.type === 'loading' || event.type === 'buffering') {
        updateSession((value) => ({
          ...value,
          status: event.type,
        }));
        return;
      }
      if (event.type === 'blocked') {
        updateSession((value) => ({
          ...value,
          status: 'blocked',
          intentPlaying: false,
          notice: event.message,
          errorKind: undefined,
        }));
        return;
      }
      if (event.type === 'ended') {
        if (handledEndGenerationRef.current === event.generation) {
          return;
        }
        handledEndGenerationRef.current = event.generation;
        advanceRef.current(1, true);
        return;
      }
      if (event.kind === 'item') {
        unavailableRef.current(event.message);
        return;
      }
      updateSession((value) => ({
        ...value,
        status: 'error',
        intentPlaying: false,
        notice: event.message,
        errorKind: event.kind,
      }));
    },
    [updateSession],
  );

  eventHandlerRef.current = handleProviderEvent;

  useEffect(() => {
    const youtubeHost = youtubeHostRef.current;
    const soundCloudHost = soundCloudHostRef.current;
    if (!youtubeHost || !soundCloudHost) {
      return;
    }
    const controllers: Controllers = {
      youtube: new YouTubeController(youtubeHost, (event) => eventHandlerRef.current(event)),
      soundcloud: new SoundCloudController(soundCloudHost, (event) => eventHandlerRef.current(event)),
    };
    controllersRef.current = controllers;
    setControllerVersion((value) => value + 1);
    return () => {
      controllers.youtube.destroy();
      controllers.soundcloud.destroy();
      if (controllersRef.current === controllers) {
        controllersRef.current = undefined;
      }
    };
  }, [soundCloudHostRef, youtubeHostRef]);

  useEffect(() => {
    if (!controllerVersion || !controllersRef.current || playlists.length === 0) {
      return;
    }
    if (initializedControllerVersionRef.current === controllerVersion) {
      return;
    }
    initializedControllerVersionRef.current = controllerVersion;
    const restored = sessionRef.current ?? restorePlayback(playlists);
    const latestPlaylist = playlists[0];
    const defaultTrack = firstTrack(latestPlaylist, 'original');
    const initial =
      restored ??
      (defaultTrack
        ? createSession(latestPlaylist, 'original', defaultTrack.id, 0.78, false)
        : undefined);
    if (!initial) {
      return;
    }
    const playlist = playlists.find((item) => item.id === initial.playlistId) ?? latestPlaylist;
    const track = playlist.tracks.find((item) => item.id === initial.trackId) ?? firstTrack(playlist, initial.order);
    if (!track) {
      return;
    }
    const normalized =
      initial.playlistId === playlist.id && initial.trackId === track.id
        ? initial
        : createSession(playlist, initial.order, track.id, initial.volume, false);
    normalized.intentPlaying = false;
    normalized.status = 'paused';
    sessionRef.current = normalized;
    setSession(normalized);
    void loadTrack(playlist, track, {
      autoplay: false,
      progress: normalized.progress,
    });
  }, [controllerVersion, loadTrack]);

  useEffect(() => {
    if (session) {
      persistPlayback(session);
    }
  }, [session]);

  const startPlaylist = useCallback(
    (playlist: Playlist, order: PlaybackOrder, trackId?: string) => {
      const track =
        playlist.tracks.find((item) => item.id === trackId) ?? firstTrack(playlist, order);
      if (!track) {
        return;
      }
      const volume = sessionRef.current?.volume ?? 0.78;
      failedTrackIdsRef.current.clear();
      const nextSession = createSession(playlist, order, track.id, volume, true);
      sessionRef.current = nextSession;
      setSession(nextSession);
      void loadTrack(playlist, track, { autoplay: true });
    },
    [loadTrack],
  );

  const setOrder = useCallback((order: PlaybackOrder) => {
    const current = sessionRef.current;
    if (!current) {
      return;
    }
    const playlist = findPlaylist(current.playlistId);
    if (!playlist) {
      return;
    }
    if (current.hasStarted) {
      updateSession((value) => changeSessionOrder(value, order));
      return;
    }
    const track = firstTrack(playlist, order);
    if (!track) {
      return;
    }
    const reordered = changeSessionOrder(current, order);
    sessionRef.current = reordered;
    setSession(reordered);
    void loadTrack(playlist, track, { autoplay: false, progress: 0 });
  }, [findPlaylist, loadTrack, updateSession]);

  const togglePlay = useCallback(() => {
    const current = sessionRef.current;
    if (!current) {
      return;
    }
    const playlist = findPlaylist(current.playlistId);
    const track = playlist?.tracks.find((item) => item.id === current.trackId);
    if (!playlist || !track) {
      return;
    }
    const controller = controllersRef.current?.[track.provider];
    if (!controller) {
      return;
    }
    if (
      current.status === 'playing' ||
      current.status === 'buffering' ||
      (current.status === 'loading' && current.intentPlaying)
    ) {
      updateSession((value) => ({ ...value, intentPlaying: false }));
      controller.pause();
      return;
    }
    if (current.status === 'ended') {
      void loadTrack(playlist, track, { autoplay: true, progress: 0 });
      return;
    }
    if (current.status === 'error') {
      controller.retrySdk();
      failedTrackIdsRef.current.delete(track.id);
      void loadTrack(playlist, track, { autoplay: true, progress: current.progress });
      return;
    }
    updateSession((value) => ({
      ...value,
      status: 'loading',
      intentPlaying: true,
      notice: undefined,
      errorKind: undefined,
    }));
    controller.play();
  }, [findPlaylist, loadTrack, updateSession]);

  const seek = useCallback(
    (seconds: number) => {
      const current = sessionRef.current;
      if (!current) {
        return;
      }
      const playlist = findPlaylist(current.playlistId);
      const track = playlist?.tracks.find((item) => item.id === current.trackId);
      if (!track) {
        return;
      }
      const bounded = Math.max(0, current.duration ? Math.min(seconds, current.duration) : seconds);
      updateSession((value) => ({ ...value, progress: bounded }));
      controllersRef.current?.[track.provider].seek(bounded);
    },
    [findPlaylist, updateSession],
  );

  const setVolume = useCallback(
    (volume: number) => {
      const bounded = Math.min(1, Math.max(0, volume));
      updateSession((value) => ({ ...value, volume: bounded }));
      controllersRef.current?.youtube.setVolume(bounded);
      controllersRef.current?.soundcloud.setVolume(bounded);
    },
    [updateSession],
  );

  const retryCurrent = useCallback(() => {
    const current = sessionRef.current;
    if (!current) {
      return;
    }
    const playlist = findPlaylist(current.playlistId);
    const track = playlist?.tracks.find((item) => item.id === current.trackId);
    if (!playlist || !track) {
      return;
    }
    failedTrackIdsRef.current.delete(track.id);
    controllersRef.current?.[track.provider].retrySdk();
    void loadTrack(playlist, track, { autoplay: true, progress: current.progress });
  }, [findPlaylist, loadTrack]);

  const skipCurrent = useCallback(() => advance(1, true), [advance]);

  const playingPlaylist = session
    ? playlists.find((playlist) => playlist.id === session.playlistId)
    : undefined;
  const currentTrack = playingPlaylist?.tracks.find((track) => track.id === session?.trackId);
  const position =
    session && playingPlaylist
      ? queuePosition(playingPlaylist, session.order, session.trackId)
      : { index: -1, total: 0 };

  return useMemo(
    () => ({
      session,
      playingPlaylist,
      currentTrack,
      queueIndex: position.index,
      queueTotal: position.total,
      canPrevious: Boolean(
        session &&
          playingPlaylist &&
          canStep(playingPlaylist, session.order, session.trackId, -1),
      ),
      canNext: Boolean(
        session &&
          playingPlaylist &&
          canStep(playingPlaylist, session.order, session.trackId, 1),
      ),
      activeProvider: currentTrack?.provider,
      startPlaylist,
      setOrder,
      togglePlay,
      previous: () => advance(-1, false),
      next: () => advance(1, false),
      seek,
      setVolume,
      retryCurrent,
      skipCurrent,
    }),
    [
      advance,
      currentTrack,
      playingPlaylist,
      position.index,
      position.total,
      retryCurrent,
      seek,
      session,
      setOrder,
      setVolume,
      skipCurrent,
      startPlaylist,
      togglePlay,
    ],
  );
}
