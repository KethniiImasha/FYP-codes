// Error Logging 
window.addEventListener("error", (e) => {
    if (e.filename && e.filename.includes("chrome-extension")) {
        console.error("[EmoUI Content Error]", e.error || e.message);
    }
});
window.addEventListener("unhandledrejection", (e) => {
    if (e.reason && e.reason.stack && e.reason.stack.includes("chrome-extension")) {
        console.error("[EmoUI Content Promise Error]", e.reason);
    }
});

const colors: Record<string, string> = {
  positive: "rgba(251, 191, 36, 0.15)", // Amber
  negative: "rgba(96, 165, 250, 0.15)", // Blue
  neutral: "rgba(148, 163, 184, 0.08)", // Slate
};

function applyMoodOverlay(mood: string) {
  const color = colors[mood] || "transparent";

  let overlay = document.getElementById("mood-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "mood-overlay";
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "999999";
    overlay.style.transition = "background-color 2s ease";
    document.body.appendChild(overlay);
  }

  overlay.style.backgroundColor = color;
}

function removeMoodOverlay() {
  const overlay = document.getElementById("mood-overlay");
  if (overlay) {
    overlay.remove();
  }
}

// Listen for mood updates from the background script
chrome.runtime.onMessage.addListener((msg: any) => {
  if (msg.type === "MOOD") {
      applyMoodOverlay(msg.mood);
  }
});

// On page load, ask background for the current mood and apply it
// This ensures overlay is correct when switching tabs or reloading
setTimeout(() => {
    chrome.runtime.sendMessage({ type: "GET_MOOD" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.isRunning && response.mood) {
            applyMoodOverlay(response.mood);
        } else {
            // Extension is not running, make sure no overlay is shown
            removeMoodOverlay();
        }
    });
}, 300);