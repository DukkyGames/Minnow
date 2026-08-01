# Voice

Minnow can listen and speak. Both run locally by default — the audio does not leave your machine unless you deliberately point voice at a cloud provider.

Set it up in **Models → Voice**.

## Dictation

The microphone button in the composer. Press it, talk, and your words appear in the composer where you can edit them before sending.

Two modes, depending on what you have configured:

- **Live local streaming** — a local Whisper model transcribes as you speak, with words appearing progressively.
- **Batch** — the recording is transcribed in one pass when you stop, via a provider.

Minnow watches for silence and can end the recording for you rather than making you find the button again.

Dictation replaces only the range it inserted, so speaking into a half-written message adds to it instead of wiping it.

## Speech-to-text models

Local Whisper models, from **Models → Voice**:

| Model | Trade-off |
|-------|-----------|
| **Whisper Tiny** | Fastest, least accurate. Fine for short commands. |
| **Whisper Base** | A good default on modest hardware |
| **Whisper Small** | Noticeably better on technical vocabulary |
| **Whisper Medium** | Better again; heavier |
| **Whisper Large v3** | Best accuracy, largest download |

Technical terms, names and code identifiers are where the bigger models earn their size. If you dictate prose, Base is usually enough.

You can point speech-to-text at a provider instead of running it locally.

## Text-to-speech

Qwen3-TTS models, in 0.6B and 1.7B sizes:

- **CustomVoice** — pick from provided voices.
- **VoiceDesign** — describe the voice you want.
- **Base (clone)** — clone a voice from a sample.

The 0.6B models are quicker to generate; the 1.7B models sound better.

Speed and output format are configurable, along with limits on audio size and duration.

## The Python worker

Local speech-to-text and text-to-speech run in a Python worker that Minnow provisions on first use, into a virtual environment inside your Minnow home. You need Python 3 available.

First run downloads and sets up, so it is slower than every run after it. If provisioning fails, the fallback is to use a provider for voice instead — the rest of Minnow is unaffected.

## Audio devices

**Settings → General → Audio** picks your input and output devices and toggles echo cancellation, noise suppression and automatic gain control.

If dictation is picking up your speakers, echo cancellation is the setting to check first.

## Where the models live

Under `models/voice/` in your Minnow home, with the Python environment under `voice/`. Both can be deleted to reclaim space; Minnow re-provisions on next use.

## Related

- [Models app](../apps/models.md)
- [Working in chat](../chat/chatting.md)
- [Where your data lives](../reference/configuration.md)
