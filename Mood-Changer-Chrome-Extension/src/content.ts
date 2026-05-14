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

// Mood Overlay Configuration 
const colors: Record<string, string> = {
  positive: "rgba(251, 191, 36, 0.25)", // Amber - increased opacity from 0.15 to 0.25
  negative: "rgba(96, 165, 250, 0.25)", // Blue - increased opacity from 0.15 to 0.25
  neutral: "rgba(148, 163, 184, 0.15)", // Slate - increased opacity from 0.08 to 0.15
};

// Track current mood state
let currentMood: string = "neutral";
let mutationObserver: MutationObserver | null = null;

// Helper: Wait for DOM to be ready 
function waitForDocumentReady(): Promise<void> {
  return new Promise((resolve) => {
    if (document.body && document.documentElement) {
      resolve();
    } else {
      const checkDOM = () => {
        if (document.body && document.documentElement) {
          resolve();
        } else {
          setTimeout(checkDOM, 50);
        }
      };
      checkDOM();
    }
  });
}

// Create and manage mood overlay 
async function ensureMoodOverlay(mood: string) {
  try {
    // Wait for document to be ready
    await waitForDocumentReady();

    const color = colors[mood] || "transparent";
    let overlay = document.getElementById("mood-overlay");

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "mood-overlay";
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 2147483647;
        transition: background-color 2s ease;
        background-color: ${color};
      `;

      // Use document.documentElement as fallback if body isn't stable
      const container = document.body || document.documentElement;
      container.appendChild(overlay);
      console.log(`[EmoUI] Overlay created with mood: ${mood}`);
    } else {
      // Overlay exists, just update color
      overlay.style.backgroundColor = color;
      console.log(`[EmoUI] Overlay updated to mood: ${mood}`);
    }

    currentMood = mood;
  } catch (error) {
    console.error("[EmoUI] Error applying mood overlay:", error);
  }
}

function removeMoodOverlay() {
  try {
    const overlay = document.getElementById("mood-overlay");
    if (overlay) {
      overlay.remove();
      console.log("[EmoUI] Overlay removed");
    }
  } catch (error) {
    console.error("[EmoUI] Error removing mood overlay:", error);
  }
}

// Setup MutationObserver to reapply overlay if DOM changes
function setupMutationObserver() {
  if (mutationObserver) {
    mutationObserver.disconnect();
  }

  try {
    mutationObserver = new MutationObserver((_mutations) => {
      // Check if our overlay was removed
      const overlay = document.getElementById("mood-overlay");
      if (!overlay && currentMood !== "neutral") {
        console.log("[EmoUI] Overlay was removed by page scripts, re-applying...");
        ensureMoodOverlay(currentMood);
      }
    });

    // Observe document.body for removals and child mutations
    const container = document.body || document.documentElement;
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false,
    });

    console.log("[EmoUI] MutationObserver setup complete");
  } catch (error) {
    console.error("[EmoUI] Error setting up MutationObserver:", error);
  }
}

// Listen for mood updates from the background script 
chrome.runtime.onMessage.addListener((msg: any) => {
  if (msg.type === "MOOD") {
    console.log(`[EmoUI] Received MOOD message: ${msg.mood}`);
    ensureMoodOverlay(msg.mood);
  }
});

// On page load, request current mood and apply it 
async function initializeOverlay() {
  try {
    // Wait a bit for page to settle
    await new Promise((resolve) => setTimeout(resolve, 500));

    chrome.runtime.sendMessage({ type: "GET_MOOD" }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[EmoUI] Could not reach background:", chrome.runtime.lastError);
        return;
      }

      if (response && response.isRunning && response.mood) {
        console.log(`[EmoUI] Extension is running with mood: ${response.mood}`);
        ensureMoodOverlay(response.mood);
        setupMutationObserver(); // Start watching for DOM changes
      } else {
        console.log("[EmoUI] Extension is not running, removing overlay");
        removeMoodOverlay();
      }
    });
  } catch (error) {
    console.error("[EmoUI] Error during initialization:", error);
  }
}

// Initialize on page load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeOverlay);
} else {
  initializeOverlay();
}