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

chrome.runtime.onMessage.addListener((msg: any) => {
  if (msg.type === "MOOD") {
      applyMoodOverlay(msg.mood);
  }
});

// Immediately ask for current mood on page load
// Use a small timeout to let the page settle
setTimeout(() => {
    chrome.runtime.sendMessage({ type: "GET_MOOD" }, (response) => {
        if (!chrome.runtime.lastError && response && response.mood) {
            applyMoodOverlay(response.mood);
        }
    });
}, 500);