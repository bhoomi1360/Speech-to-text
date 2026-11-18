import os
import io
import json
import uuid
import tempfile
import logging
import subprocess
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import speech_recognition as sr
import imageio_ffmpeg

# ──────────────────────────────────────────────
# App Setup & Logging
# ──────────────────────────────────────────────
app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Supported Languages for Google Speech Recognition
SUPPORTED_LANGUAGES = {
    "en-US": "English (US)",
    "en-GB": "English (UK)",
    "hi-IN": "Hindi",
    "fr-FR": "French",
    "de-DE": "German",
    "es-ES": "Spanish",
    "it-IT": "Italian",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "pt-BR": "Portuguese (Brazil)",
    "zh-CN": "Chinese (Mandarin)",
    "ar-SA": "Arabic",
    "ru-RU": "Russian",
}

recognizer = sr.Recognizer()

# Ensure ffmpeg binary is resolved
FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
logger.info("Using FFmpeg binary at: %s", FFMPEG_EXE)


# ──────────────────────────────────────────────
# Helper: Convert any audio format to 16kHz mono WAV
# ──────────────────────────────────────────────
def convert_to_wav(file_bytes: bytes, original_ext: str) -> bytes:
    """
    Convert any audio format (OGG, MP3, M4A, AAC, FLAC, WEBM, WAV, etc.)
    directly into 16kHz 16-bit mono PCM WAV using imageio-ffmpeg.
    This bypasses pydub's dependency on ffprobe.
    """
    ext = original_ext if original_ext.startswith(".") else f".{original_ext}"
    if not ext or ext == ".":
        ext = ".wav"

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as in_file:
        in_file.write(file_bytes)
        in_path = in_file.name

    out_path = in_path + "_out.wav"

    try:
        # ffmpeg convert command: mono, 16000Hz sample rate, 16-bit PCM WAV
        cmd = [
            FFMPEG_EXE,
            "-y",
            "-i", in_path,
            "-vn",                # discard video if container has any
            "-ac", "1",           # mono channel
            "-ar", "16000",       # 16000 Hz
            "-acodec", "pcm_s16le", # standard PCM 16-bit
            "-f", "wav",
            out_path
        ]

        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode != 0:
            err_msg = result.stderr.decode("utf-8", errors="replace")
            logger.error("FFmpeg error: %s", err_msg)
            raise RuntimeError(f"Audio conversion failed: {err_msg[:200]}")

        with open(out_path, "rb") as f:
            wav_bytes = f.read()

        if not wav_bytes:
            raise RuntimeError("Converted WAV file is empty.")

        return wav_bytes

    finally:
        for p in (in_path, out_path):
            if os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass


# ──────────────────────────────────────────────
# Helper: Transcribe WAV bytes
# ──────────────────────────────────────────────
def transcribe_wav(wav_bytes: bytes, language: str) -> dict:
    """Run Google Speech Recognition on WAV bytes and return result dict."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(wav_bytes)
        tmp_path = tmp.name

    try:
        with sr.AudioFile(tmp_path) as source:
            audio_data = recognizer.record(source)

        text = recognizer.recognize_google(audio_data, language=language)
        return {"success": True, "text": text, "language": language}

    except sr.UnknownValueError:
        return {
            "success": False,
            "error": "Could not understand the audio. Please ensure the speech is clear, audible, and matches the selected language.",
        }
    except sr.RequestError as exc:
        return {
            "success": False,
            "error": f"Speech recognition service error: {exc}. Please check your internet connection.",
        }
    except Exception as exc:
        logger.exception("Unexpected error during transcription")
        return {"success": False, "error": str(exc)}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html", languages=SUPPORTED_LANGUAGES)


@app.route("/api/transcribe", methods=["POST"])
def transcribe():
    """Accept an audio file upload and return transcription JSON."""
    if "audio" not in request.files:
        return jsonify({"success": False, "error": "No audio file provided."}), 400

    audio_file = request.files["audio"]
    language = request.form.get("language", "en-US")

    if language not in SUPPORTED_LANGUAGES:
        language = "en-US"

    filename = audio_file.filename or "audio.wav"
    ext = os.path.splitext(filename)[-1] if "." in filename else ".wav"

    file_bytes = audio_file.read()
    if not file_bytes:
        return jsonify({"success": False, "error": "Uploaded audio file is empty."}), 400

    logger.info("Processing file: %s | lang: %s | size: %d bytes", filename, language, len(file_bytes))

    try:
        wav_bytes = convert_to_wav(file_bytes, ext)
    except Exception as exc:
        logger.exception("Audio conversion error")
        return jsonify({"success": False, "error": f"Audio processing error: {exc}"}), 400

    result = transcribe_wav(wav_bytes, language)
    return jsonify(result)


@app.route("/api/languages")
def languages():
    """Return all supported language codes and labels."""
    return jsonify(SUPPORTED_LANGUAGES)


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "version": "1.1.0"})


# ──────────────────────────────────────────────
# Entry Point
# ──────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "=" * 55)
    print("  [VoiceScribe] Speech-to-Text Transcription Tool")
    print("=" * 55)
    print("  >>  Local:   http://127.0.0.1:5001")
    print("  >>  Upload & transcribe audio files (OGG, MP3, WAV, M4A, etc.)")
    print(f"  >>  Supported languages: {len(SUPPORTED_LANGUAGES)}")
    print("=" * 55 + "\n")
    app.run(debug=True, host="0.0.0.0", port=5001)
