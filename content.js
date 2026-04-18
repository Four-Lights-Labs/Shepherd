(() => {
  // Prevent duplicate injection / duplicate listeners.
  if (window.__shepherdLoaded) {
    console.log("[Shepherd] already loaded; skipping duplicate init");
    return;
  }
  window.__shepherdLoaded = true;

  const SHEPHERD_OVERLAY_ID = "shepherd-overlay";
  const SESSION_KEY = "session";
  const METRICS_KEY = "metrics";

  // Toggle this to false once things are stable.
  const DEBUG = true;

  const DEFAULT_STATE = {
    enabled: true,
    mode: "intent", // "intent" | "explore"
    session: {
      startedAt: null,
      firstPrompt: true,
      lastPromptAt: 0
    },
    metrics: {
      promptsSent: 0,
      promptsIntercepted: 0,
      promptsEditedAfterIntercept: 0
    }
  };

  let modalOpen = false;
  let bypassNextSend = false;

  function log(...args) {
    if (DEBUG) console.log("[Shepherd]", ...args);
  }

  function warn(...args) {
    if (DEBUG) console.warn("[Shepherd]", ...args);
  }

  function error(...args) {
    console.error("[Shepherd]", ...args);
  }

  function debugGroup(label, fn) {
    if (!DEBUG) {
      fn();
      return;
    }
    console.groupCollapsed(`[Shepherd] ${label}`);
    try {
      fn();
    } finally {
      console.groupEnd();
    }
  }

  async function loadState() {
    const stored = await chrome.storage.local.get([
      "enabled",
      "mode",
      SESSION_KEY,
      METRICS_KEY
    ]);

    return {
      enabled:
        typeof stored.enabled === "boolean"
          ? stored.enabled
          : DEFAULT_STATE.enabled,
      mode: stored.mode || DEFAULT_STATE.mode,
      session: {
        ...DEFAULT_STATE.session,
        ...(stored[SESSION_KEY] || {})
      },
      metrics: {
        ...DEFAULT_STATE.metrics,
        ...(stored[METRICS_KEY] || {})
      }
    };
  }

  async function saveState(partial) {
    await chrome.storage.local.set(partial);
  }

  async function resetSessionIfNeeded() {
    const state = await loadState();

    if (!state.session.startedAt) {
      const session = {
        startedAt: Date.now(),
        firstPrompt: true,
        lastPromptAt: 0
      };

      await saveState({ [SESSION_KEY]: session });
      log("session initialized", session);
    }
  }

  async function recordIntercept(meta = {}) {
    const state = await loadState();
    const metrics = { ...state.metrics };
    metrics.promptsIntercepted += 1;

    await saveState({
      [METRICS_KEY]: metrics
    });

    log("recordIntercept", { metrics, meta });
  }

  async function recordEditAfterIntercept(meta = {}) {
    const state = await loadState();
    const metrics = { ...state.metrics };
    metrics.promptsEditedAfterIntercept += 1;

    await saveState({
      [METRICS_KEY]: metrics
    });

    log("recordEditAfterIntercept", { metrics, meta });
  }

  async function recordSend(meta = {}) {
    const state = await loadState();
    const metrics = { ...state.metrics };
    const session = { ...state.session };

    metrics.promptsSent += 1;
    session.firstPrompt = false;
    session.lastPromptAt = Date.now();

    if (!session.startedAt) {
      session.startedAt = Date.now();
    }

    await saveState({
      [METRICS_KEY]: metrics,
      [SESSION_KEY]: session
    });

    log("recordSend", { metrics, session, meta });
  }

  function isEditableElement(el) {
    if (!el) return false;
    return (
      el.tagName === "TEXTAREA" ||
      el.getAttribute?.("contenteditable") === "true"
    );
  }

  function getPromptInput() {
    // Prefer the active element if it's editable.
    const active = document.activeElement;
    if (active && isEditableElement(active)) {
      return active;
    }

    // ChatGPT composer variants.
    const selectors = [
      "#prompt-textarea",
      "textarea",
      'div.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }

    return null;
  }

  function getPromptText(input) {
    if (!input) return "";

    // Standard textarea/input path
    if ("value" in input && typeof input.value === "string") {
      if (input.value.trim()) return input.value;
    }

    // Contenteditable path
    const innerText = input.innerText || "";
    if (innerText.trim()) return innerText;

    const textContent = input.textContent || "";
    if (textContent.trim()) return textContent;

    return "";
  }

  function setFocus(input) {
    if (!input) return;
    input.focus();

    if ("selectionStart" in input && "value" in input) {
      const len = input.value.length;
      input.selectionStart = len;
      input.selectionEnd = len;
    }
  }

  function looksLikeSendButton(button) {
    if (!button) return false;

    const ariaLabel = (button.getAttribute("aria-label") || "").toLowerCase();
    const title = (button.getAttribute("title") || "").toLowerCase();
    const text = (button.textContent || "").toLowerCase();
    const dataTestId = (button.getAttribute("data-testid") || "").toLowerCase();
    const id = (button.getAttribute("id") || "").toLowerCase();

    const haystack = `${ariaLabel} ${title} ${text} ${dataTestId} ${id}`;

    return (
      haystack.includes("send") ||
      haystack.includes("submit") ||
      haystack.includes("prompt")
    );
  }

  function getAllButtonsSummary() {
    return Array.from(document.querySelectorAll("button")).map((btn, index) => ({
      index,
      aria: btn.getAttribute("aria-label"),
      title: btn.getAttribute("title"),
      text: (btn.textContent || "").trim(),
      dataTestId: btn.getAttribute("data-testid"),
      id: btn.getAttribute("id"),
      disabled: btn.disabled
    }));
  }

  function getSendButton() {
    const buttons = Array.from(document.querySelectorAll("button"));
    const match =
      buttons.find((btn) => {
        const dataTestId = (btn.getAttribute("data-testid") || "").toLowerCase();
        const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
        const id = (btn.getAttribute("id") || "").toLowerCase();

        return (
          dataTestId === "send-button" ||
          ariaLabel.includes("send prompt") ||
          id === "composer-submit-button" ||
          looksLikeSendButton(btn)
        );
      }) || null;

    if (DEBUG) {
      debugGroup("send button lookup", () => {
        log("matched button", match);
        log("all buttons", getAllButtonsSummary());
      });
    }

    return match;
  }

  function findComposerInputNearButton(button) {
    if (!button) return null;

    const composerRoot =
      button.closest("form") ||
      button.closest('[data-testid*="composer"]') ||
      button.parentElement?.parentElement ||
      document;

    const selectors = [
      "#prompt-textarea",
      "textarea",
      'div.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"]'
    ];

    for (const selector of selectors) {
      const el = composerRoot.querySelector?.(selector);
      if (el) return el;
    }

    return getPromptInput();
  }

  function shouldInterrupt(promptText, session) {
    const trimmed = promptText.trim();
    const now = Date.now();

    if (!trimmed) {
      log("shouldInterrupt=false (empty prompt)");
      return false;
    }

    if (session.firstPrompt) {
      log("shouldInterrupt=true (first prompt)");
      return true;
    }

    if (trimmed.length < 80) {
      log("shouldInterrupt=true (short prompt)", { length: trimmed.length });
      return true;
    }

    if (session.lastPromptAt && now - session.lastPromptAt < 10000) {
      log("shouldInterrupt=true (rapid-fire prompt)", {
        msSinceLastPrompt: now - session.lastPromptAt
      });
      return true;
    }

    log("shouldInterrupt=false");
    return false;
  }

  function removePromptGate() {
    const existing = document.getElementById(SHEPHERD_OVERLAY_ID);
    if (existing) existing.remove();
    modalOpen = false;
    log("prompt gate removed");
  }

  function showPromptGate({ onEdit, onSendAnyway }) {
    removePromptGate();

    const overlay = document.createElement("div");
    overlay.id = SHEPHERD_OVERLAY_ID;
    overlay.innerHTML = `
      <div id="shepherd-modal" role="dialog" aria-modal="true" aria-labelledby="shepherd-title">
        <div class="shepherd-kicker">Shepherd</div>
        <h2 id="shepherd-title">Pause.</h2>
        <p>What are you trying to get from this?</p>
        <div class="shepherd-actions">
          <button id="shepherd-edit" class="shepherd-btn shepherd-btn-primary">Edit</button>
          <button id="shepherd-send" class="shepherd-btn shepherd-btn-secondary">Send anyway</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const editBtn = document.getElementById("shepherd-edit");
    const sendBtn = document.getElementById("shepherd-send");

    editBtn.addEventListener("click", onEdit);
    sendBtn.addEventListener("click", onSendAnyway);

    const escHandler = async (e) => {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", escHandler, true);
        await onEdit();
      }
    };

    document.addEventListener("keydown", escHandler, true);
    editBtn.focus();
    modalOpen = true;

    log("prompt gate shown", {
      activeElement: document.activeElement
    });
  }

  function dispatchNativeEnter(input) {
    setFocus(input);

    log("dispatchNativeEnter", {
      activeElement: document.activeElement,
      input
    });

    const down = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });

    const up = new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });

    input.dispatchEvent(down);
    input.dispatchEvent(up);
  }

  function triggerSend(source) {
    const freshInput = getPromptInput();

    log("triggerSend", {
      source,
      freshInput,
      activeElement: document.activeElement
    });

    if (!freshInput) {
      warn("triggerSend aborted: no prompt input found");
      return;
    }

    setFocus(freshInput);

    const sendButton = getSendButton();
    if (sendButton && !sendButton.disabled) {
      log("triggerSend using send button click");
      sendButton.click();
      return;
    }

    log("triggerSend falling back to synthetic Enter");
    dispatchNativeEnter(freshInput);
  }

  async function handleAttemptedSend(event, source, providedInput = null) {
    debugGroup(`handleAttemptedSend (${source})`, () => {
      log("event target", event.target);
      log("event type", event.type);
      log("defaultPrevented before", event.defaultPrevented);
      log("bypassNextSend before", bypassNextSend);
      log("modalOpen before", modalOpen);
      log("activeElement", document.activeElement);
    });

    if (modalOpen) {
      log("blocked because modal is already open");
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    if (bypassNextSend) {
      log("bypassing one send");
      bypassNextSend = false;
      return;
    }

    const input = providedInput || getPromptInput();
    if (!input) {
      warn("no prompt input found during attempted send");
      return;
    }

    const promptText = getPromptText(input);
    if (!promptText.trim()) {
      log("ignored send attempt because prompt is empty");
      log("handleAttemptedSend prompt inspection", {
        input,
        tagName: input?.tagName,
        contenteditable: input?.getAttribute?.("contenteditable"),
        value: input?.value,
        innerText: input?.innerText,
        textContent: input?.textContent
      });
      return;
    }

    const state = await loadState();

    log("current state", state);
    log("prompt details", {
      length: promptText.trim().length,
      preview: promptText.trim().slice(0, 120),
      source
    });

    log("handleAttemptedSend prompt inspection", {
      input,
      tagName: input?.tagName,
      contenteditable: input?.getAttribute?.("contenteditable"),
      value: input?.value,
      innerText: input?.innerText,
      textContent: input?.textContent
    });

    if (!state.enabled) {
      log("Shepherd disabled; allowing send");
      await recordSend({ reason: "disabled", source });
      return;
    }

    if (state.mode === "explore") {
      log("Explore mode active; allowing send");
      await recordSend({ reason: "explore_mode", source });
      return;
    }

    const interrupt = shouldInterrupt(promptText, state.session);

    if (!interrupt) {
      log("no interruption needed; allowing send");
      await recordSend({ reason: "no_interrupt", source });
      return;
    }

    log("interrupting send");
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    log("defaultPrevented after", event.defaultPrevented);
    log("native send should now be blocked");

    await recordIntercept({ source });

    showPromptGate({
      onEdit: async () => {
        log("prompt gate action: Edit");
        removePromptGate();
        await recordEditAfterIntercept({ source });
        const freshInput = getPromptInput();
        setFocus(freshInput || input);
      },
      onSendAnyway: async () => {
        log("prompt gate action: Send anyway");
        removePromptGate();
        await recordSend({ reason: "send_anyway", source });
        bypassNextSend = true;
        log("bypassNextSend set to true");

        window.setTimeout(() => {
          triggerSend(source);
        }, 0);
      }
    });
  }

  function handleKeydown(e) {
    if (DEBUG && e.key === "Enter") {
      log("keydown Enter observed", {
        target: e.target,
        activeElement: document.activeElement,
        defaultPrevented: e.defaultPrevented,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey
      });
    }

    const isPlainEnter = e.key === "Enter" && !e.shiftKey;
    if (!isPlainEnter) return;

    const targetIsEditable = isEditableElement(e.target);
    const activeIsEditable = isEditableElement(document.activeElement);

    if (!targetIsEditable && !activeIsEditable) return;

    if (e.metaKey || e.ctrlKey || e.altKey) {
      log("skipping because modifier key is pressed");
      return;
    }

    handleAttemptedSend(e, "keyboard").catch((err) => {
      error("keydown interception failed:", err);
    });
  }

  function handleClick(e) {
    const button = e.target.closest("button");
    if (!button) return;

    if (DEBUG) {
      log("button click observed", {
        button,
        aria: button.getAttribute("aria-label"),
        title: button.getAttribute("title"),
        text: (button.textContent || "").trim(),
        dataTestId: button.getAttribute("data-testid"),
        id: button.getAttribute("id")
      });
    }

    if (!looksLikeSendButton(button)) return;

    const input = findComposerInputNearButton(button);
    if (!input) {
      warn("send-like button clicked but no prompt input found");
      return;
    }

    const promptText = getPromptText(input);

    log("click-path prompt read", {
      input,
      tagName: input?.tagName,
      contenteditable: input?.getAttribute?.("contenteditable"),
      promptLength: promptText.trim().length,
      promptPreview: promptText.trim().slice(0, 120),
      value: input?.value,
      innerText: input?.innerText,
      textContent: input?.textContent
    });

    if (!promptText.trim()) {
      warn("send-like button clicked but composer text read as empty");
      return;
    }

    handleAttemptedSend(e, "button", input).catch((err) => {
      error("click interception failed:", err);
    });
  }

  function handleSubmit(e) {
    log("submit observed", {
      target: e.target,
      activeElement: document.activeElement,
      defaultPrevented: e.defaultPrevented
    });

    const input = getPromptInput();
    if (!input) {
      warn("submit observed but no prompt input found");
      return;
    }

    const promptText = getPromptText(input);

    log("submit-path prompt read", {
      input,
      tagName: input?.tagName,
      contenteditable: input?.getAttribute?.("contenteditable"),
      promptLength: promptText.trim().length,
      promptPreview: promptText.trim().slice(0, 120),
      value: input?.value,
      innerText: input?.innerText,
      textContent: input?.textContent
    });

    if (!promptText.trim()) {
      log("submit ignored because prompt is empty");
      return;
    }

    handleAttemptedSend(e, "submit", input).catch((err) => {
      error("submit interception failed:", err);
    });
  }

  function installDebugHelpers() {
    if (!DEBUG) return;

    // Note: this is visible in the content-script execution context,
    // not always the page's main JS world.
    window.ShepherdDebug = {
      getPromptInput,
      getSendButton,
      getAllButtonsSummary,
      removePromptGate,
      async getState() {
        return await loadState();
      },
      async resetMetrics() {
        await chrome.storage.local.set({
          [METRICS_KEY]: {
            promptsSent: 0,
            promptsIntercepted: 0,
            promptsEditedAfterIntercept: 0
          }
        });
        log("metrics reset");
      },
      async resetSession() {
        await chrome.storage.local.set({
          [SESSION_KEY]: {
            startedAt: Date.now(),
            firstPrompt: true,
            lastPromptAt: 0
          }
        });
        log("session reset");
      },
      async setMode(mode) {
        await chrome.storage.local.set({ mode });
        log("mode set", mode);
      },
      async setEnabled(enabled) {
        await chrome.storage.local.set({ enabled });
        log("enabled set", enabled);
      },
      inspect() {
        debugGroup("ShepherdDebug.inspect()", () => {
          log("url", window.location.href);
          log("activeElement", document.activeElement);
          log("promptInput", getPromptInput());
          log("sendButton", getSendButton());
          log("buttons", getAllButtonsSummary());
        });
      }
    };

    log("debug helpers installed on window.ShepherdDebug");
  }

  function installEventDiagnostics() {
    if (!DEBUG) return;

    ["keydown", "keypress", "keyup", "submit"].forEach((type) => {
      document.addEventListener(
        type,
        (e) => {
          if (type === "submit" || e.key === "Enter") {
            log(`diagnostic ${type}`, {
              target: e.target,
              activeElement: document.activeElement,
              defaultPrevented: e.defaultPrevented
            });
          }
        },
        true
      );
    });
  }

  async function init() {
    log("content script loaded", window.location.href);

    await resetSessionIfNeeded();

    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", handleSubmit, true);

    installDebugHelpers();
    installEventDiagnostics();

    log("listeners attached");
  }

  init().catch((err) => {
    error("init failed:", err);
  });
})();
