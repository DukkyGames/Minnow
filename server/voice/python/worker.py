#!/usr/bin/env python3
"""
Minnow voice worker — local Whisper STT + Qwen3-TTS inference.
"""

from __future__ import annotations

import argparse
import base64
import cgi
import io
import json
import os
import tempfile
import traceback
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

# Lazy-loaded ML stack — import only when inference routes are called.
_stt_pipeline: Any = None
_tts_model: Any = None
_loaded_model_id: str | None = None
_loaded_kind: str | None = None
_loaded_mode: str | None = None
_tts_speakers: list[str] = []
_tts_languages: list[str] = []


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def _flash_attn_available() -> bool:
    try:
        import flash_attn  # noqa: F401

        return True
    except Exception:
        return False


def _resolve_device(config: dict[str, Any]) -> str:
    device_pref = str(config.get("device", "auto") or "auto")
    if device_pref == "cpu":
        return "cpu"
    if device_pref == "cuda":
        return "cuda:0" if _cuda_available() else "cpu"
    return "cuda:0" if _cuda_available() else "cpu"


def _resolve_dtype(config: dict[str, Any], device: str):
    import torch

    compute = str(config.get("computeType", "auto") or "auto")
    if device.startswith("cpu"):
        return torch.float32
    if compute == "float16":
        return torch.float16
    if compute == "bfloat16":
        return torch.bfloat16
    if compute == "float32":
        return torch.float32
    return torch.float16 if _cuda_available() else torch.float32


def _resolve_tts_device_map(config: dict[str, Any]) -> str:
    device_map = str(config.get("deviceMap", "auto") or "auto")
    if device_map == "cpu":
        return "cpu"
    if device_map == "cuda:0":
        return "cuda:0" if _cuda_available() else "cpu"
    return "cuda:0" if _cuda_available() else "cpu"


def _resolve_tts_dtype(config: dict[str, Any]):
    import torch

    dtype_pref = str(config.get("dtype", "auto") or "auto")
    if dtype_pref == "float16":
        return torch.float16
    if dtype_pref == "bfloat16":
        return torch.bfloat16
    if dtype_pref == "float32":
        return torch.float32
    return torch.bfloat16 if _cuda_available() else torch.float32


def _unload_model() -> None:
    global _stt_pipeline, _tts_model, _loaded_model_id, _loaded_kind, _loaded_mode
    global _tts_speakers, _tts_languages
    _stt_pipeline = None
    _tts_model = None
    _loaded_model_id = None
    _loaded_kind = None
    _loaded_mode = None
    _tts_speakers = []
    _tts_languages = []
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def _load_stt_model(model_id: str, model_path: str, config: dict[str, Any]) -> None:
    global _stt_pipeline, _loaded_model_id, _loaded_kind

    from transformers import pipeline

    device = _resolve_device(config)
    torch_dtype = _resolve_dtype(config, device)
    attn = str(config.get("attnImplementation", "auto") or "auto")
    model_kwargs: dict[str, Any] = {
        "torch_dtype": torch_dtype,
        "low_cpu_mem_usage": bool(config.get("lowCpuMemUsage", True)),
        "use_safetensors": bool(config.get("useSafetensors", True)),
    }
    if attn != "auto":
        model_kwargs["attn_implementation"] = attn

    source = model_path if model_path else model_id
    _stt_pipeline = pipeline(
        "automatic-speech-recognition",
        model=source,
        device=0 if device.startswith("cuda") else -1,
        model_kwargs=model_kwargs,
    )
    _loaded_model_id = model_id
    _loaded_kind = "stt"


def _load_tts_model(
    model_id: str,
    model_path: str,
    tokenizer_path: str,
    config: dict[str, Any],
) -> None:
    global _tts_model, _loaded_model_id, _loaded_kind, _loaded_mode
    global _tts_speakers, _tts_languages

    try:
        from qwen_tts import Qwen3TTSModel
    except ImportError as err:
        raise RuntimeError(
            "qwen-tts is not installed in the voice runtime. Repair from Models → Voice."
        ) from err

    import torch

    device_map = _resolve_tts_device_map(config)
    dtype = _resolve_tts_dtype(config)
    attn = str(config.get("attnImplementation", "auto") or "auto")
    load_kwargs: dict[str, Any] = {
        "device_map": device_map,
        "dtype": dtype,
    }
    if attn != "auto":
        load_kwargs["attn_implementation"] = attn

    source = model_path if model_path else model_id
    _tts_model = Qwen3TTSModel.from_pretrained(source, **load_kwargs)

    mode = str(config.get("mode", "custom_voice") or "custom_voice")
    _loaded_model_id = model_id
    _loaded_kind = "tts"
    _loaded_mode = mode

    _tts_speakers = []
    _tts_languages = []
    try:
        if hasattr(_tts_model, "get_supported_speakers"):
            _tts_speakers = list(_tts_model.get_supported_speakers() or [])
    except Exception:
        _tts_speakers = []
    try:
        if hasattr(_tts_model, "get_supported_languages"):
            _tts_languages = list(_tts_model.get_supported_languages() or [])
    except Exception:
        _tts_languages = []


def _parse_multipart(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    content_type = handler.headers.get("Content-Type", "")
    if "multipart/form-data" not in content_type:
        length = int(handler.headers.get("Content-Length", "0") or "0")
        raw = handler.rfile.read(length) if length > 0 else b""
        if not raw:
            return {}
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}
        audio_b64 = payload.get("audioBase64")
        if isinstance(audio_b64, str) and audio_b64:
            return {
                "audio": base64.b64decode(audio_b64),
                "mime": str(payload.get("mime", "audio/wav")),
                "config": payload.get("config") if isinstance(payload.get("config"), dict) else {},
            }
        return {}

    form = cgi.FieldStorage(
        fp=handler.rfile,
        headers=handler.headers,
        environ={
            "REQUEST_METHOD": "POST",
            "CONTENT_TYPE": content_type,
        },
    )

    audio_bytes = b""
    mime = "audio/webm"
    config: dict[str, Any] = {}

    if "file" in form:
        file_item = form["file"]
        audio_bytes = file_item.file.read() if hasattr(file_item, "file") else b""
        mime = getattr(file_item, "type", None) or mime

    if "config" in form:
        raw_config = form.getfirst("config")
        if isinstance(raw_config, str) and raw_config.strip():
            try:
                parsed = json.loads(raw_config)
                if isinstance(parsed, dict):
                    config = parsed
            except json.JSONDecodeError:
                config = {}

    return {"audio": audio_bytes, "mime": mime, "config": config}


def _transcribe_audio(audio_bytes: bytes, config: dict[str, Any]) -> str:
    if _stt_pipeline is None:
        raise RuntimeError("STT model is not loaded")

    import soundfile as sf

    with tempfile.NamedTemporaryFile(suffix=".audio", delete=True) as tmp:
        tmp.write(audio_bytes)
        tmp.flush()
        try:
            data, sample_rate = sf.read(tmp.name)
        except Exception:
            data, sample_rate = sf.read(io.BytesIO(audio_bytes))

    generate_kwargs: dict[str, Any] = {}
    language = str(config.get("language", "") or "").strip()
    if language:
        generate_kwargs["language"] = language
    task = config.get("task")
    if task in ("transcribe", "translate"):
        generate_kwargs["task"] = task

    if bool(config.get("returnTimestamps", False)):
        granularity = config.get("timestampGranularity", "segment")
        generate_kwargs["return_timestamps"] = (
            granularity if granularity in ("word", "segment") else "segment"
        )

    chunk_length = int(config.get("chunkLengthSeconds", 30) or 30)
    batch_size = int(config.get("batchSize", 1) or 1)

    result = _stt_pipeline(
        {"array": data, "sampling_rate": sample_rate},
        chunk_length_s=chunk_length,
        batch_size=batch_size,
        generate_kwargs=generate_kwargs,
    )

    if isinstance(result, dict):
        text = result.get("text", "")
        return str(text).strip()
    return str(result).strip()


def _normalize_language(language: str) -> str:
    lang = str(language or "").strip()
    if not lang or lang.lower() == "auto":
        return "Auto"
    return lang


def _generation_kwargs(config: dict[str, Any]) -> dict[str, Any]:
    generation = config.get("generation") if isinstance(config.get("generation"), dict) else {}
    kwargs: dict[str, Any] = {}
    for key in ("maxNewTokens", "topP", "topK", "temperature", "repetitionPenalty"):
        if key in generation:
            snake = "".join(
                ["_" + c.lower() if c.isupper() else c for c in key]
            ).lstrip("_")
            kwargs[snake] = generation[key]
    return kwargs


def _wav_bytes_from_numpy(wavs: Any, sample_rate: int) -> bytes:
    import numpy as np

    audio = wavs[0] if isinstance(wavs, (list, tuple)) else wavs
    arr = np.asarray(audio, dtype=np.float32)
    if arr.ndim > 1:
        arr = arr.reshape(-1)
    arr = np.clip(arr, -1.0, 1.0)
    pcm = (arr * 32767.0).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def _resolve_ref_audio(ref_audio_path: str) -> str:
    if not ref_audio_path:
        raise ValueError("Reference audio path is required for voice clone")
    if os.path.isfile(ref_audio_path):
        return ref_audio_path
    home = os.path.expanduser("~/.minnow/voice/refs")
    candidate = os.path.join(home, os.path.basename(ref_audio_path))
    if os.path.isfile(candidate):
        return candidate
    raise ValueError(f"Reference audio not found: {ref_audio_path}")


def _synthesize_tts(text: str, config: dict[str, Any]) -> tuple[bytes, str]:
    if _tts_model is None:
        raise RuntimeError("TTS model is not loaded")

    mode = str(config.get("mode", _loaded_mode or "custom_voice") or "custom_voice")
    gen_kwargs = _generation_kwargs(config)

    if mode == "custom_voice":
        custom = config.get("customVoice") if isinstance(config.get("customVoice"), dict) else {}
        speaker = str(custom.get("speaker", "Ryan") or "Ryan")
        language = _normalize_language(str(custom.get("language", "Auto") or "Auto"))
        instruct = str(custom.get("instruct", "") or "").strip()
        call_kwargs: dict[str, Any] = {
            "text": text,
            "language": language,
            "speaker": speaker,
            **gen_kwargs,
        }
        if instruct:
            call_kwargs["instruct"] = instruct
        wavs, sr = _tts_model.generate_custom_voice(**call_kwargs)
    elif mode == "voice_design":
        design = config.get("voiceDesign") if isinstance(config.get("voiceDesign"), dict) else {}
        language = _normalize_language(str(design.get("language", "Auto") or "Auto"))
        instruct = str(design.get("instruct", "") or "").strip()
        if not instruct:
            raise ValueError("Voice design instruct is required")
        wavs, sr = _tts_model.generate_voice_design(
            text=text,
            language=language,
            instruct=instruct,
            **gen_kwargs,
        )
    elif mode == "voice_clone":
        clone = config.get("voiceClone") if isinstance(config.get("voiceClone"), dict) else {}
        language = _normalize_language(str(clone.get("language", "Auto") or "Auto"))
        ref_text = str(clone.get("refText", "") or "").strip()
        ref_audio_path = _resolve_ref_audio(str(clone.get("refAudioPath", "") or ""))
        x_vector_only = bool(clone.get("xVectorOnlyMode", False))
        wavs, sr = _tts_model.generate_voice_clone(
            text=text,
            language=language,
            ref_audio=ref_audio_path,
            ref_text=ref_text,
            x_vector_only_mode=x_vector_only,
            **gen_kwargs,
        )
    else:
        raise ValueError(f"Unsupported TTS mode: {mode}")

    return _wav_bytes_from_numpy(wavs, sr), "audio/wav"


class VoiceWorkerHandler(BaseHTTPRequestHandler):
    """JSON API for voice runtime health, STT/TTS inference, and model lifecycle."""

    server_version = "MinnowVoiceWorker/0.3"

    def log_message(self, fmt: str, *args: object) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            _json_response(self, 200, {"ok": True, "status": "ready"})
            return
        if self.path == "/voice/capabilities":
            model_loaded = _stt_pipeline is not None or _tts_model is not None
            _json_response(
                self,
                200,
                {
                    "cuda": _cuda_available(),
                    "flashAttnAvailable": _flash_attn_available(),
                    "modelLoaded": model_loaded,
                    "loadedModelId": _loaded_model_id,
                    "loadedKind": _loaded_kind,
                    "loadedMode": _loaded_mode,
                    "speakers": _tts_speakers,
                    "languages": _tts_languages,
                },
            )
            return
        _json_response(self, 404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/models/load":
            self._handle_models_load()
            return
        if self.path == "/models/unload":
            self._handle_models_unload()
            return
        if self.path == "/stt/transcribe":
            self._handle_stt_transcribe()
            return
        if self.path == "/tts/synthesize":
            self._handle_tts_synthesize()
            return
        _json_response(self, 404, {"error": "Not found"})

    def _read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            payload = {}
        return payload if isinstance(payload, dict) else {}

    def _handle_models_load(self) -> None:
        try:
            payload = self._read_json_body()
            kind = str(payload.get("kind", "") or "")
            model_id = str(payload.get("modelId", "") or "").strip()
            model_path = str(payload.get("modelPath", "") or "").strip()
            config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
            if not model_id:
                _json_response(self, 400, {"error": "modelId is required"})
                return

            if kind == "stt":
                if _loaded_model_id == model_id and _stt_pipeline is not None:
                    _json_response(self, 200, {"ok": True, "modelId": model_id, "alreadyLoaded": True})
                    return
                _unload_model()
                _load_stt_model(model_id, model_path, config)
                _json_response(self, 200, {"ok": True, "modelId": model_id, "kind": "stt"})
                return

            if kind == "tts":
                if _loaded_model_id == model_id and _tts_model is not None:
                    _json_response(self, 200, {"ok": True, "modelId": model_id, "alreadyLoaded": True})
                    return
                _unload_model()
                tokenizer_path = str(payload.get("tokenizerPath", "") or "").strip()
                _load_tts_model(model_id, model_path, tokenizer_path, config)
                _json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "modelId": model_id,
                        "kind": "tts",
                        "mode": _loaded_mode,
                        "speakers": _tts_speakers,
                        "languages": _tts_languages,
                    },
                )
                return

            _json_response(self, 400, {"error": "kind must be stt or tts"})
        except Exception as err:
            _json_response(
                self,
                500,
                {"error": str(err), "trace": traceback.format_exc()[-2000:]},
            )

    def _handle_models_unload(self) -> None:
        payload = self._read_json_body()
        kind = str(payload.get("kind", "") or "")
        if kind and kind != _loaded_kind:
            _json_response(self, 200, {"ok": True, "wasLoaded": False})
            return
        was_loaded = _stt_pipeline is not None or _tts_model is not None
        _unload_model()
        _json_response(self, 200, {"ok": True, "wasLoaded": was_loaded})

    def _handle_stt_transcribe(self) -> None:
        try:
            parsed = _parse_multipart(self)
            audio = parsed.get("audio", b"")
            if not audio:
                _json_response(self, 400, {"error": "Empty audio payload"})
                return
            config = parsed.get("config", {})
            if not isinstance(config, dict):
                config = {}
            text = _transcribe_audio(audio, config)
            _json_response(self, 200, {"text": text})
        except Exception as err:
            _json_response(self, 500, {"error": str(err)})

    def _handle_tts_synthesize(self) -> None:
        try:
            payload = self._read_json_body()
            text = str(payload.get("text", "") or "").strip()
            if not text:
                _json_response(self, 400, {"error": "text is required"})
                return
            config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
            audio_bytes, mime = _synthesize_tts(text, config)
            _json_response(
                self,
                200,
                {
                    "audioBase64": base64.b64encode(audio_bytes).decode("ascii"),
                    "mime": mime,
                },
            )
        except Exception as err:
            _json_response(self, 500, {"error": str(err)})


def main() -> None:
    parser = argparse.ArgumentParser(description="Minnow voice worker")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), VoiceWorkerHandler)
    print(f"voice-worker listening on http://{args.host}:{args.port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
