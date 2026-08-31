/* ==========================================================================
   PyLogic Bench — App logic
   Talks only to YOUR Cloudflare Worker (never to the AI provider directly).
   The Worker holds the API key, the persona system prompt, and rate limits.
   ========================================================================== */

(function () {
  "use strict";

  const els = {
    tabs: document.querySelectorAll(".rail-tab"),
    modeLabel: document.getElementById("mode-label"),
    wordCount: document.getElementById("word-count"),
    algoEditor: document.getElementById("algorithm-editor"),
    pseudoEditor: document.getElementById("pseudocode-editor"),
    flowchartWrap: document.getElementById("flowchart-wrap"),
    flowchartSvg: document.getElementById("flowchart-svg"),
    palette: document.getElementById("palette"),
    fcClear: document.getElementById("fc-clear"),
    explainBtn: document.getElementById("explain-selection-btn"),
    generateBtn: document.getElementById("generate-btn"),
    statusLine: document.getElementById("status-line"),
    codeOutput: document.getElementById("code-output"),
    runOutput: document.getElementById("run-output"),
    notesPane: document.getElementById("notes-pane"),
    consoleTabs: document.querySelectorAll(".console-tab"),
    runBtn: document.getElementById("run-code-btn"),
    copyBtn: document.getElementById("copy-code-btn"),
    providerSelect: document.getElementById("provider-select"),
    settingsBtn: document.getElementById("settings-btn"),
    settingsDialog: document.getElementById("settings-dialog"),
    workerUrlInput: document.getElementById("worker-url"),
    clientCodeInput: document.getElementById("client-code"),
    connDot: document.getElementById("conn-dot"),
    connText: document.getElementById("conn-text"),
    rateText: document.getElementById("rate-text"),
  };

  let mode = "algorithm";
  let lastGeneratedCode = "";
  let pyodideInstance = null;

  // ---------- Settings (worker URL + optional client code) ----------
  const SETTINGS_KEY = "pylogicbench.settings";
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
    catch { return {}; }
  }
  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }
  let settings = loadSettings();
  els.workerUrlInput.value = settings.workerUrl || "";
  els.clientCodeInput.value = settings.clientCode || "";
  updateConnStatus();

  els.settingsBtn.addEventListener("click", () => els.settingsDialog.showModal());
  document.getElementById("settings-save").addEventListener("click", () => {
    settings = {
      workerUrl: els.workerUrlInput.value.trim().replace(/\/+$/, ""),
      clientCode: els.clientCodeInput.value.trim(),
    };
    saveSettings(settings);
    updateConnStatus();
  });

  function updateConnStatus() {
    if (settings.workerUrl) {
      els.connDot.className = "conn-dot is-live";
      els.connText.textContent = "Worker: " + settings.workerUrl.replace(/^https?:\/\//, "");
    } else {
      els.connDot.className = "conn-dot";
      els.connText.textContent = "Backend not configured — click the gear icon";
    }
  }

  // ---------- Tabs ----------
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });

  function setMode(next) {
    mode = next;
    els.tabs.forEach((t) => {
      const active = t.dataset.mode === mode;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", String(active));
    });
    els.modeLabel.textContent = mode[0].toUpperCase() + mode.slice(1);

    els.algoEditor.classList.toggle("hidden", mode !== "algorithm");
    els.pseudoEditor.classList.toggle("hidden", mode !== "pseudocode");
    els.flowchartWrap.classList.toggle("hidden", mode !== "flowchart");
    els.palette.classList.toggle("hidden", mode !== "flowchart");
    els.explainBtn.disabled = mode === "flowchart" || !currentSelectionText();
    updateWordCount();
  }

  function currentEditor() {
    return mode === "pseudocode" ? els.pseudoEditor : els.algoEditor;
  }

  function updateWordCount() {
    if (mode === "flowchart") {
      const n = Flowchart.isEmpty() ? 0 : 1;
      els.wordCount.textContent = n ? "flowchart drawn" : "empty board";
      return;
    }
    const words = currentEditor().value.trim().split(/\s+/).filter(Boolean).length;
    els.wordCount.textContent = words + " words";
  }
  [els.algoEditor, els.pseudoEditor].forEach((ta) => {
    ta.addEventListener("input", updateWordCount);
    ta.addEventListener("select", () => { els.explainBtn.disabled = !currentSelectionText(); });
    ta.addEventListener("mouseup", () => { els.explainBtn.disabled = !currentSelectionText(); });
    ta.addEventListener("keyup", () => { els.explainBtn.disabled = !currentSelectionText(); });
  });

  function currentSelectionText() {
    if (mode === "flowchart") return "";
    const ta = currentEditor();
    return ta.value.substring(ta.selectionStart, ta.selectionEnd).trim();
  }

  // ---------- Flowchart init ----------
  Flowchart.init(els.flowchartSvg);
  els.fcClear.addEventListener("click", () => {
    if (confirm("Clear the whole board?")) { Flowchart.clear(); updateWordCount(); }
  });

  // ---------- Console tab switching ----------
  els.consoleTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      els.consoleTabs.forEach((t) => t.classList.toggle("is-active", t === tab));
      document.querySelectorAll(".console-pane").forEach((p) => p.classList.remove("is-active"));
      document.getElementById(tab.dataset.pane + "-pane").classList.add("is-active");
    });
  });
  function showConsolePane(name) {
    document.querySelector(`.console-tab[data-pane="${name}"]`)?.click();
  }

  // ---------- Building the input payload ----------
  function buildSourcePayload() {
    if (mode === "flowchart") {
      return { kind: "flowchart", content: Flowchart.toDescription() };
    }
    return { kind: mode, content: currentEditor().value.trim() };
  }

  // ---------- Networking helpers ----------
  function workerFetch(path, body) {
    if (!settings.workerUrl) {
      throw new Object({ userMessage: "No backend connected yet. Click the gear icon and paste your Worker URL." });
    }
    const headers = { "Content-Type": "application/json" };
    if (settings.clientCode) headers["X-Client-Code"] = settings.clientCode;
    return fetch(settings.workerUrl + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  async function handleResponse(res) {
    if (res.status === 429) {
      const retry = res.headers.get("Retry-After");
      els.rateText.textContent = "Rate limit hit" + (retry ? ` — try again in ${retry}s` : "");
      throw { userMessage: "You're sending requests too fast. Wait a few seconds and try again." };
    }
    if (!res.ok) {
      let msg = "The backend returned an error.";
      try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
      throw { userMessage: msg };
    }
    const remaining = res.headers.get("X-RateLimit-Remaining");
    if (remaining !== null) els.rateText.textContent = remaining + " requests left this minute";
    return res.json();
  }

  // ---------- Generate & Run ----------
  els.generateBtn.addEventListener("click", async () => {
    const payload = buildSourcePayload();
    if (!payload.content) {
      setStatus("Write something first — an algorithm, pseudocode, or a flowchart.", true);
      return;
    }
    setStatus("Sending to tutor…");
    els.generateBtn.disabled = true;
    try {
      const res = await workerFetch("/generate", {
        source: payload,
        provider: els.providerSelect.value,
      });
      const data = await handleResponse(res);
      renderGenerateResult(data);
    } catch (err) {
      setStatus(err.userMessage || "Something went wrong.", true);
      els.notesPane.innerHTML = `<p class="note-error">${escapeHtml(err.userMessage || "Something went wrong.")}</p>`;
      showConsolePane("notes");
    } finally {
      els.generateBtn.disabled = false;
    }
  });

  function renderGenerateResult(data) {
    // Expected shape from Worker: { code, notes, hasError }
    lastGeneratedCode = data.code || "";
    els.codeOutput.textContent = lastGeneratedCode || "(no code returned)";
    els.runBtn.disabled = !lastGeneratedCode;
    els.copyBtn.disabled = !lastGeneratedCode;

    els.notesPane.innerHTML = "";
    if (data.notes) {
      const p = document.createElement("p");
      if (data.hasError) p.classList.add("note-error");
      p.textContent = data.notes;
      els.notesPane.appendChild(p);
    }
    showConsolePane(data.hasError ? "notes" : "code");
    setStatus(data.hasError ? "The tutor found an issue in the logic." : "Done. Code is ready to run.");
  }

  // ---------- Explain selection ----------
  els.explainBtn.addEventListener("click", async () => {
    const selection = currentSelectionText();
    if (!selection) return;
    const payload = buildSourcePayload();
    setStatus("Asking tutor to explain the selection…");
    try {
      const res = await workerFetch("/explain", {
        selection,
        source: payload,
        provider: els.providerSelect.value,
      });
      const data = await handleResponse(res);
      els.notesPane.innerHTML = `<p>${escapeHtml(data.explanation || "No explanation returned.")}</p>`;
      showConsolePane("notes");
      setStatus("Explanation ready.");
    } catch (err) {
      setStatus(err.userMessage || "Could not get an explanation.", true);
    }
  });

  // ---------- Run code (Pyodide, fully client-side, no network) ----------
  els.runBtn.addEventListener("click", async () => {
    if (!lastGeneratedCode) return;
    els.runBtn.disabled = true;
    els.runOutput.textContent = "Booting Python…";
    showConsolePane("run");
    try {
      if (!pyodideInstance) {
        pyodideInstance = await loadPyodide();
      }
      pyodideInstance.setStdout({ batched: (s) => appendRunOutput(s) });
      pyodideInstance.setStderr({ batched: (s) => appendRunOutput(s) });
      els.runOutput.textContent = "";
      await pyodideInstance.runPythonAsync(lastGeneratedCode);
      appendRunOutput("\n[program finished]");
    } catch (e) {
      appendRunOutput("\n" + String(e));
    } finally {
      els.runBtn.disabled = false;
    }
  });

  function appendRunOutput(text) {
    els.runOutput.textContent += (els.runOutput.textContent ? "\n" : "") + text;
  }

  els.copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lastGeneratedCode);
      setStatus("Code copied.");
    } catch {
      setStatus("Could not copy — select the code manually.", true);
    }
  });

  // ---------- utils ----------
  function setStatus(text, isError) {
    els.statusLine.textContent = text;
    els.statusLine.style.color = isError ? "#f0a08f" : "";
  }
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  setMode("algorithm");
})();
