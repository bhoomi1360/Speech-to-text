/* ══════════════════════════════════════════════
   VoiceScribe — script.js
   Full audio handling:
   1. Live microphone recording (MediaRecorder)
   2. File upload & drag-and-drop (OGG, MP3, WAV, etc.)
   3. Backend transcription API integration
   4. Copy, Download, and UI states
   ══════════════════════════════════════════════ */

(() => {
  "use strict";

  // ── DOM References ──────────────────────────
  const tabRecord       = document.getElementById("tab-record");
  const tabUpload       = document.getElementById("tab-upload");
  const recordPane      = document.getElementById("record-pane");
  const uploadZone      = document.getElementById("upload-zone");

  const recordBtn       = document.getElementById("record-btn");
  const micIcon         = document.getElementById("mic-icon");
  const stopSquare      = document.getElementById("stop-square");
  const recordingTimer  = document.getElementById("recording-timer");
  const recordHint      = document.getElementById("record-hint");
  const recordSub       = document.getElementById("record-sub");
  const waveform        = document.getElementById("waveform");

  const audioInput      = document.getElementById("audio-input");
  const fileStrip       = document.getElementById("file-strip");
  const fileName        = document.getElementById("file-name");
  const fileSize        = document.getElementById("file-size");
  const clearFileBtn    = document.getElementById("clear-file-btn");

  const transcribeBtn   = document.getElementById("transcribe-btn");
  const btnIdle         = transcribeBtn.querySelector(".btn-idle");
  const btnLoading      = transcribeBtn.querySelector(".btn-loading");

  const langSelect      = document.getElementById("language-select");
  const statusPill      = document.getElementById("status-pill");
  const statusText      = statusPill.querySelector(".status-text");

  const resultCard      = document.getElementById("result-card");
  const transcriptionEl = document.getElementById("transcription-text");
  const wordCountEl     = document.getElementById("word-count");
  const langBadge       = document.getElementById("lang-badge");
  const copyBtn         = document.getElementById("copy-btn");
  const downloadBtn     = document.getElementById("download-btn");
  const clearResultBtn  = document.getElementById("clear-result-btn");

  const errorBanner     = document.getElementById("error-banner");
  const errorMsg        = document.getElementById("error-msg");
  const errorClose      = document.getElementById("error-close");

  let selectedFile = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordTimerInterval = null;
  let recordSeconds = 0;
  let isRecording = false;

  // ── Tab Switching ────────────────────────────
  tabRecord.addEventListener("click", () => {
    tabRecord.classList.add("active");
    tabUpload.classList.remove("active");
    recordPane.classList.remove("hidden");
    uploadZone.classList.add("hidden");
  });

  tabUpload.addEventListener("click", () => {
    if (isRecording) stopRecording();
    tabUpload.classList.add("active");
    tabRecord.classList.remove("active");
    uploadZone.classList.remove("hidden");
    recordPane.classList.add("hidden");
  });

  // ── Utility: format bytes ────────────────────
  function formatBytes(bytes) {
    if (bytes < 1024)       return `${bytes} B`;
    if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  }

  // ── Utility: word count ──────────────────────
  function countWords(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  // ── Status helpers ───────────────────────────
  function setStatus(state, text) {
    statusPill.className = "status-pill";
    if (state !== "ready") statusPill.classList.add(state);
    statusText.textContent = text;
  }

  // ── Error helpers ────────────────────────────
  function showError(msg) {
    errorMsg.textContent = msg;
    errorBanner.classList.remove("hidden");
    setStatus("error", "Error");
  }

  function hideError() {
    errorBanner.classList.add("hidden");
  }

  errorClose.addEventListener("click", () => {
    hideError();
    setStatus("ready", "Ready");
  });

  // ── File Selection Handler ───────────────────
  function setFile(file) {
    if (!file) return;

    selectedFile = file;
    hideError();

    // Display file info
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    fileStrip.classList.remove("hidden");
    transcribeBtn.disabled = false;
    setStatus("ready", "Audio ready");
    resultCard.classList.add("hidden");
  }

  // Clear file
  function clearFile() {
    if (isRecording) stopRecording();
    selectedFile = null;
    audioInput.value = "";
    fileStrip.classList.add("hidden");
    transcribeBtn.disabled = true;
    setStatus("ready", "Ready");
    hideError();
  }

  clearFileBtn.addEventListener("click", clearFile);

  // ── File Input & Drop Zone ───────────────────
  uploadZone.addEventListener("click", () => audioInput.click());

  audioInput.addEventListener("change", () => {
    if (audioInput.files.length > 0) {
      setFile(audioInput.files[0]);
    }
  });

  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("drag-over");
  });

  ["dragleave", "dragend"].forEach(ev =>
    uploadZone.addEventListener(ev, () => uploadZone.classList.remove("drag-over"))
  );

  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) setFile(file);
  });

  // ── Live Microphone Recording ────────────────
  recordBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  });

  async function startRecording() {
    hideError();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError("Live microphone recording is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];

      // Detect supported mime type
      const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/wav"];
      let selectedMime = "";
      for (const m of mimeTypes) {
        if (MediaRecorder.isTypeSupported(m)) {
          selectedMime = m;
          break;
        }
      }

      const options = selectedMime ? { mimeType: selectedMime } : {};
      mediaRecorder = new MediaRecorder(stream, options);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Stop all microphone tracks to release the mic
        stream.getTracks().forEach(track => track.stop());

        const mime = selectedMime || "audio/webm";
        const ext = mime.includes("ogg") ? "ogg" : (mime.includes("wav") ? "wav" : "webm");
        const audioBlob = new Blob(audioChunks, { type: mime });
        const recordedAudioFile = new File([audioBlob], `recording_${Date.now()}.${ext}`, { type: mime });

        setFile(recordedAudioFile);

        recordHint.textContent = "Recording saved!";
        recordSub.textContent = "Hit 'Transcribe Audio' below or record again";
      };

      mediaRecorder.start(200); // 200ms slice
      isRecording = true;

      // Update UI for recording state
      recordBtn.classList.add("is-recording");
      micIcon.classList.add("hidden");
      stopSquare.classList.remove("hidden");
      waveform.classList.add("active");
      recordingTimer.classList.remove("hidden");
      recordSeconds = 0;
      updateTimerDisplay();

      recordTimerInterval = setInterval(() => {
        recordSeconds++;
        updateTimerDisplay();
      }, 1000);

      recordHint.textContent = "Recording in progress…";
      recordSub.textContent = "Click red button to stop recording";
      setStatus("processing", "Recording…");

    } catch (err) {
      console.error(err);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        showError("Microphone access was denied. Please allow microphone permissions in your browser.");
      } else {
        showError(`Could not access microphone: ${err.message}`);
      }
    }
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }

    clearInterval(recordTimerInterval);

    // Reset recording UI
    recordBtn.classList.remove("is-recording");
    micIcon.classList.remove("hidden");
    stopSquare.classList.add("hidden");
    waveform.classList.remove("active");
    recordingTimer.classList.add("hidden");
    setStatus("ready", "Audio ready");
  }

  function updateTimerDisplay() {
    const mins = String(Math.floor(recordSeconds / 60)).padStart(2, "0");
    const secs = String(recordSeconds % 60).padStart(2, "0");
    recordingTimer.textContent = `${mins}:${secs}`;
  }

  // ── Transcribe Request ───────────────────────
  transcribeBtn.addEventListener("click", async () => {
    if (!selectedFile) return;

    if (isRecording) stopRecording();

    // UI Loading state
    transcribeBtn.disabled = true;
    btnIdle.classList.add("hidden");
    btnLoading.classList.remove("hidden");
    waveform.classList.add("active");
    setStatus("processing", "Transcribing…");
    hideError();
    resultCard.classList.add("hidden");

    const formData = new FormData();
    formData.append("audio", selectedFile);
    formData.append("language", langSelect.value);

    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Server responded with error status ${res.status}`);
      }

      showResult(data.text, data.language);

    } catch (err) {
      console.error(err);
      showError(err.message || "Failed to transcribe audio.");
    } finally {
      transcribeBtn.disabled = false;
      btnIdle.classList.remove("hidden");
      btnLoading.classList.add("hidden");
      waveform.classList.remove("active");

      if (errorBanner.classList.contains("hidden")) {
        setStatus("ready", "Done ✓");
      } else {
        setStatus("error", "Error");
      }
    }
  });

  // ── Display Result ───────────────────────────
  function showResult(text, language) {
    transcriptionEl.textContent = text;
    const wc = countWords(text);
    wordCountEl.textContent = `${wc} word${wc !== 1 ? "s" : ""}`;
    langBadge.textContent = language || langSelect.value;
    resultCard.classList.remove("hidden");
    setTimeout(() => resultCard.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }

  // ── Copy Text ────────────────────────────────
  copyBtn.addEventListener("click", async () => {
    const text = transcriptionEl.textContent;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.classList.add("copied");
      const orig = copyBtn.innerHTML;
      copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyBtn.innerHTML = orig;
      }, 2000);
    } catch {
      showError("Could not copy automatically. Please copy the text manually.");
    }
  });

  // ── Download Text ────────────────────────────
  downloadBtn.addEventListener("click", () => {
    const text = transcriptionEl.textContent;
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    const base = selectedFile ? selectedFile.name.replace(/\.[^.]+$/, "") : "transcription";
    a.href     = url;
    a.download = `${base}_transcribed.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── Clear Result ─────────────────────────────
  clearResultBtn.addEventListener("click", () => {
    resultCard.classList.add("hidden");
    transcriptionEl.textContent = "";
    setStatus("ready", "Ready");
  });

})();
