document.addEventListener("DOMContentLoaded", async () => {
  const enabledEl = document.getElementById("enabled");
  const modeEl = document.getElementById("mode");

  const interceptedEl = document.getElementById("promptsIntercepted");
  const editedEl = document.getElementById("promptsEditedAfterIntercept");
  const sentEl = document.getElementById("promptsSent");

  const stored = await chrome.storage.local.get([
    "enabled",
    "mode",
    "metrics"
  ]);

  const enabled =
    typeof stored.enabled === "boolean" ? stored.enabled : true;
  const mode = stored.mode || "intent";
  const metrics = stored.metrics || {
    promptsSent: 0,
    promptsIntercepted: 0,
    promptsEditedAfterIntercept: 0
  };

  enabledEl.checked = enabled;
  modeEl.value = mode;

  interceptedEl.textContent = String(metrics.promptsIntercepted || 0);
  editedEl.textContent = String(metrics.promptsEditedAfterIntercept || 0);
  sentEl.textContent = String(metrics.promptsSent || 0);

  enabledEl.addEventListener("change", async () => {
    await chrome.storage.local.set({
      enabled: enabledEl.checked
    });
  });

  modeEl.addEventListener("change", async () => {
    await chrome.storage.local.set({
      mode: modeEl.value
    });
  });
});
