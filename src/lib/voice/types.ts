/**
 * Voice architecture.
 *
 * The text interview is complete and is what ships. Voice is defined here as a
 * set of provider interfaces so that adding it later is an implementation
 * behind these seams rather than a rewrite of the interview room.
 *
 * The intended pipeline:
 *
 *   microphone → AudioRecorder → VoiceActivityDetector (endpointing)
 *              → SpeechToText  → the same submitAnswer() the text path uses
 *              → TextToSpeech  → the interviewer's next question is spoken
 *
 * The engine is already agnostic: interview_answers.transcript_source records
 * whether an answer arrived as text or speech, and nothing in the engine cares
 * which. That is the property that makes this a seam rather than a promise.
 */

export interface TranscriptionResult {
  text: string;
  /** 0–1 where the provider reports one. */
  confidence: number | null;
  /** Detected language tag, e.g. "en-GB". */
  language: string | null;
  durationSeconds: number | null;
}

export interface SpeechToTextProvider {
  readonly name: string;
  /** Whether this provider can run in the browser without a server round trip. */
  readonly isClientSide: boolean;
  transcribe(audio: Blob, options?: { language?: string }): Promise<TranscriptionResult>;
}

export interface SynthesisOptions {
  /** Provider-specific voice identifier. */
  voice?: string;
  /** 1 is normal. */
  rate?: number;
  pitch?: number;
}

export interface TextToSpeechProvider {
  readonly name: string;
  readonly isClientSide: boolean;
  /** Resolves when the utterance has finished playing, or rejects on failure. */
  speak(text: string, options?: SynthesisOptions): Promise<void>;
  cancel(): void;
  listVoices(): Promise<Array<{ id: string; label: string; language: string }>>;
}

export interface VoiceActivityEvent {
  type: 'speech_start' | 'speech_end' | 'silence_timeout';
  timestampMs: number;
}

/**
 * Endpointing: deciding when the candidate has finished speaking.
 *
 * This is the hard part of a voice interview. Cutting a candidate off
 * mid-sentence is worse than waiting a beat too long, so any implementation
 * should bias toward patience.
 */
export interface VoiceActivityDetector {
  readonly name: string;
  start(stream: MediaStream, onEvent: (event: VoiceActivityEvent) => void): Promise<void>;
  stop(): void;
  /** Silence in milliseconds before an utterance is considered finished. */
  readonly silenceThresholdMs: number;
}

export interface RecordingHandle {
  stop(): Promise<Blob>;
  cancel(): void;
  readonly mimeType: string;
}

export interface AudioRecorder {
  readonly name: string;
  isSupported(): boolean;
  start(options?: { deviceId?: string }): Promise<RecordingHandle>;
}

/** What the UI needs to know about voice availability. */
export interface VoiceCapabilities {
  speechToText: boolean;
  textToSpeech: boolean;
  recording: boolean;
  /** Populated when a capability is missing, for an honest UI message. */
  unavailableReason: string | null;
}
