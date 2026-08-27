export type MultiplayerLobbySound = "JOIN" | "LEAVE";

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContextConstructor();
  }
  return audioContext;
}

/**
 * Creates/resumes the shared lobby AudioContext while a create/join click still carries browser
 * user activation. Later roster polling can then play a short arrival/departure cue without
 * shipping or downloading audio assets.
 */
export function primeMultiplayerLobbySound(): void {
  const context = getAudioContext();
  if (context?.state === "suspended") void context.resume().catch(() => undefined);
}

function scheduleLobbySound(context: AudioContext, sound: MultiplayerLobbySound): void {
  const frequencies = sound === "JOIN" ? [440, 660] : [440, 294];
  const startsAt = context.currentTime + 0.01;

  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const noteStartsAt = startsAt + index * 0.085;
    oscillator.type = sound === "JOIN" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(frequency, noteStartsAt);
    gain.gain.setValueAtTime(0.0001, noteStartsAt);
    gain.gain.exponentialRampToValueAtTime(0.045, noteStartsAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStartsAt + 0.13);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(noteStartsAt);
    oscillator.stop(noteStartsAt + 0.15);
  });
}

export function playMultiplayerLobbySound(sound: MultiplayerLobbySound): void {
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "suspended") {
    void context
      .resume()
      .then(() => scheduleLobbySound(context, sound))
      .catch(() => undefined);
    return;
  }
  scheduleLobbySound(context, sound);
}
