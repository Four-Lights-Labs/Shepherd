(() => {
  const SHEPHERD_OVERLAY_ID = "shepherd-overlay";
  const SESSION_KEY = "session";
  const METRICS_KEY = "metrics";

  console.log("[Shepherd] content script loaded", window.location.href);
  setInterval(() => {
    const input = document.querySelector("textarea");
    console.log("[Shepherd] textarea found?", !!input, input);
  }, 3000);

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
    console.log("[Shepherd]", ...args);
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
      await saveState({
        [SESSION_KEY]: {
          startedAt: Date.now(),
          firstPrompt: true,
          lastPromptAt: 0
        }
      });
    }
  }

  async function recordIntercept() {
    const state = await loadState();
    const metrics = { ...state.metrics };
    metrics.promptsIntercepted += 1;

    await saveState({
      [METRICS_KEY]: metrics
    });
  }

  async function recordEditAfterIntercept() {
    const state = await loadState();
    const metrics = { ...state.metrics };
    metrics.promptsEditedAfterIntercept += 1;

    await saveState({
      [METRICS_KEY]: metrics
    });
  }

  async function recordSend() {
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
  }

  function getPromptInput() {
    // ChatGPT commonly uses textarea for prompt input.
    const textarea = document.querySelector("textarea");
    if (textarea) return textarea;

    // Fallback if the UI changes.
    const editable = document.querySelector('[contenteditable="true"]');
    return editable || null;
  }

  function getPromptText(input) {
    if (!input) return "";
    if ("value" in input) return input.value || "";
    return input.textContent || "";
  }

  function setFocus(input) {
    if (!input) return;
    input.focus();

    // Place cursor at end for textarea-like inputs.
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

    const haystack = `${ariaLabel} ${title} ${text} ${dataTestId}`;

    return (
      haystack.includes("send") ||
      haystack.includes("submit") ||
      haystack.includes("prompt")
    );
  }

  function getSendButton() {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.find(looksLikeSendButton) || null;
  }

  function shouldInterrupt(promptText, session) {
    const trimmed = promptText.trim();
    const now = Date.now();

    if (!trimmed) return false;

    // Always interrupt first prompt of a session.
    if (session.firstPrompt) return true;

    // Interrupt short prompts.
    if (trimmed.length < 80) return true;

    // Interrupt rapid-fire prompts.
    if (session.lastPromptAt && now - session.lastPromptAt < 10000) return true;

    return false;
  }

  function removePromptGate() {
    const existing = document.getElementById(SHEPHERD_OVERLAY_ID);
    if (existing) existing.remove();
    modalOpen = false;
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

    // Escape closes the modal into Edit behavior.
    const escHandler = async (e) => {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", escHandler, true);
        await onEdit();
      }
    };

    document.addEventListener("keydown", escHandler, true);
    editBtn.focus();
    modalOpen = true;
  }

  function dispatchNativeEnter(input) {
    setFocus(input);

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

  function triggerSend(input, source) {
    setFocus(input);

    if (source === "button") {
      const sendButton = getSendButton();
      if (sendButton) {
        sendButton.click();
        return;
      }
    }

    dispatchNativeEnter(input);
  }

  async function handleAttemptedSend(event, source) {
    if (modalOpen) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    if (bypassNextSend) {
      bypassNextSend = false;
      return;
    }

    const input = getPromptInput();
    if (!input) return;

    const promptText = getPromptText(input);
    if (!promptText.trim()) return;

    const state = await loadState();

    if (!state.enabled || state.mode === "explore") {
      await recordSend();
      return;
    }

    const interrupt = shouldInterrupt(promptText, state.session);

    if (!interrupt) {
      await recordSend();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    await recordIntercept();

    // Small delay so it feels intentional, not glitchy.
    window.setTimeout(() => {
      showPromptGate({
        onEdit: async () => {
          removePromptGate();
          await recordEditAfterIntercept();
          setFocus(input);
        },
        onSendAnyway: async () => {
          removePromptGate();
          await recordSend();
          bypassNextSend = true;
          window.setTimeout(() => triggerSend(input, source), 0);
        }
      });
    }, 450);
  }

  function handleKeydown(e) {
    const input = getPromptInput();
    if (!input) return;
    if (document.activeElement !== input) return;

    const isPlainEnter = e.key === "Enter" && !e.shiftKey;
    if (!isPlainEnter) return;

    // Escape hatch for power users.
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    handleAttemptedSend(e, "keyboard").catch((err) => {
      console.error("[Shepherd] keydown interception failed:", err);
    });
  }

  function handleClick(e) {
    const button = e.target.closest("button");
    if (!button) return;
    if (!looksLikeSendButton(button)) return;

    const input = getPromptInput();
    if (!input) return;

    const promptText = getPromptText(input);
    if (!promptText.trim()) return;

    handleAttemptedSend(e, "button").catch((err) => {
      console.error("[Shepherd] click interception failed:", err);
    });
  }

  async function init() {
    await resetSessionIfNeeded();

    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("click", handleClick, true);

    log("Loaded");
  }

  init().catch((err) => {
    console.error("[Shepherd] init failed:", err);
  });
})();
