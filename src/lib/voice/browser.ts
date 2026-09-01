'use client';

import type {
  AudioRecorder,
  RecordingHandle,
  SynthesisOptions,
  TextToSpeechProvider,
  VoiceCapabilities,
} from '@/lib/voice/types';

/**
 * Browser-native voice implementations.
 *
 * Text-to-speech and recording are implemented here because the Web Speech and
 * MediaRecorder APIs make them genuinely available with no server component.
 *
 * Speech-to-text is deliberately NOT implemented against the browser's
 * SpeechRecognition API: outside Chrome it is absent, and where present it
 * streams audio to a vendor service without that being obvious to the user. A
 * server-side transcription provider is the right way to do it, so the seam in
 * voice/types.ts stays unimplemented rather than being filled with something
 * that would only appear to work.
 */

export class BrowserTextToSpeech implements TextToSpeechProvider {
  readonly name = 'browser-speech-synthesis';
  readonly isClientSide = true;

  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  speak(text: string, options: SynthesisOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!BrowserTextToSpeech.isSupported()) {
        reject(new Error('This browser cannot speak text.'));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      if (options.rate !== undefined) utterance.rate = options.rate;
      if (options.pitch !== undefined) utterance.pitch = options.pitch;

      if (options.voice) {
        const match = window.speechSynthesis.getVoices().find((v) => v.voiceURI === options.voice);
        if (match) utterance.voice = match;
      }

      utterance.onend = () => resolve();
      utterance.onerror = (event) => reject(new Error(`Speech synthesis failed: ${event.error}`));

      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }

  cancel(): void {
    if (BrowserTextToSpeech.isSupported()) window.speechSynthesis.cancel();
  }

  async listVoices(): Promise<Array<{ id: string; label: string; language: string }>> {
    if (!BrowserTextToSpeech.isSupported()) return [];

    // Voices load asynchronously in most browsers; the first call often returns
    // an empty list until the voiceschanged event fires.
    const voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const existing = window.speechSynthesis.getVoices();
      if (existing.length > 0) {
        resolve(existing);
        return;
      }
      const timer = setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
      window.speechSynthesis.addEventListener(
        'voiceschanged',
        () => {
          clearTimeout(timer);
          resolve(window.speechSynthesis.getVoices());
        },
        { once: true },
      );
    });

    return voices.map((voice) => ({
      id: voice.voiceURI,
      label: voice.name,
      language: voice.lang,
    }));
  }
}

export class BrowserAudioRecorder implements AudioRecorder {
  readonly name = 'browser-media-recorder';

  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof MediaRecorder !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia)
    );
  }

  async start(options: { deviceId?: string } = {}): Promise<RecordingHandle> {
    if (!this.isSupported()) {
      throw new Error('This browser cannot record audio.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: options.deviceId ? { deviceId: { exact: options.deviceId } } : true,
    });

    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) ?? '';

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start(250);

    const releaseTracks = (): void => {
      for (const track of stream.getTracks()) track.stop();
    };

    return {
      mimeType: recorder.mimeType,
      stop: () =>
        new Promise<Blob>((resolve) => {
          recorder.onstop = () => {
            releaseTracks();
            resolve(new Blob(chunks, { type: recorder.mimeType }));
          };
          recorder.stop();
        }),
      cancel: () => {
        // Release the microphone immediately — leaving the indicator on after
        // the user cancelled is a trust problem, not just a resource leak.
        try {
          recorder.stop();
        } catch {
          // Already stopped.
        }
        releaseTracks();
      },
    };
  }
}

/** What this browser can actually do, for an honest UI. */
export function detectVoiceCapabilities(): VoiceCapabilities {
  if (typeof window === 'undefined') {
    return {
      speechToText: false,
      textToSpeech: false,
      recording: false,
      unavailableReason: 'Voice is only available in the browser.',
    };
  }

  const textToSpeech = BrowserTextToSpeech.isSupported();
  const recording = new BrowserAudioRecorder().isSupported();

  return {
    // No speech-to-text provider is configured, so this is false rather than a
    // capability the UI would offer and then fail to deliver.
    speechToText: false,
    textToSpeech,
    recording,
    unavailableReason:
      'Spoken answers need a transcription provider, which is not configured on this deployment.',
  };
}
