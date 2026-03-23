// 1. DOM Elements
const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;
const statusDot = document.getElementById("status-dot") as HTMLSpanElement;
const moodBadge = document.getElementById("mood-badge") as HTMLDivElement;
const moodIcon = document.getElementById("mood-icon") as HTMLDivElement;
const moodLabel = document.getElementById("mood-label") as HTMLDivElement;
const messageContainer = document.getElementById("message-container") as HTMLDivElement;
const soothingMessage = document.getElementById("soothing-message") as HTMLParagraphElement;
const intervalSelect = document.getElementById("intervalSelect") as HTMLSelectElement;
const musicSelect = document.getElementById("musicSelect") as HTMLSelectElement;
const musicPlayerWrapper = document.getElementById("musicPlayerWrapper") as HTMLDivElement;
const stopMusicBtn = document.getElementById("stopMusicBtn") as HTMLButtonElement;

// 2. Configuration 
const MOOD_CONFIG: Record<
  string,
  { icon: string; bgGradient: string; label: string; messages: string[] }
> = {
  positive: {
    icon: "✨",
    bgGradient: "var(--mood-positive)",
    label: "Feeling Great!",
    messages: [
      "Keep spreading that joy!",
      "You're glowing today!",
      "Happiness looks good on you!",
    ],
  },
  negative: {
    icon: "🌧️",
    bgGradient: "var(--mood-negative)",
    label: "Take a Moment",
    messages: [
      "It's okay to feel this way. Take a deep breath.",
      "Everything will be okay. You're doing your best.",
      "Small steps lead to big changes.",
      "Treat yourself with kindness today.",
    ],
  },
  neutral: {
    icon: "☁️",
    bgGradient: "var(--mood-neutral)",
    label: "Feeling Balanced",
    messages: [
      "A peaceful mind is a powerful mind.",
      "Enjoy the steady flow of today.",
      "Neutral is a good place to be.",
    ],
  },
};

// 3. Storage & Settings
chrome.storage.local.get(["detectionInterval", "musicEnabled", "musicIsPlaying"], (res) => {
    if (res.detectionInterval && typeof res.detectionInterval === 'string') {
        intervalSelect.value = res.detectionInterval;
    }
    if (res.musicEnabled && typeof res.musicEnabled === 'string') {
        musicSelect.value = res.musicEnabled;
    } else {
        musicSelect.value = "yes"; // Default
    }
    if (res.musicIsPlaying) {
        musicPlayerWrapper.classList.remove("hidden");
    } else {
        musicPlayerWrapper.classList.add("hidden");
    }
});

intervalSelect.addEventListener("change", () => {
    const val = intervalSelect.value;
    chrome.storage.local.set({ detectionInterval: val });
});

musicSelect.addEventListener("change", () => {
    const val = musicSelect.value;
    chrome.storage.local.set({ musicEnabled: val });
});

stopMusicBtn.addEventListener("click", () => {
    chrome.storage.local.set({ musicIsPlaying: false });
    chrome.runtime.sendMessage({ type: "STOP_MUSIC" }).catch((e) => console.error(e));
    musicPlayerWrapper.classList.add("hidden");
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.musicIsPlaying) {
        if (changes.musicIsPlaying.newValue) {
            musicPlayerWrapper.classList.remove("hidden");
        } else {
            musicPlayerWrapper.classList.add("hidden");
        }
    }
});


//4. UI Logic

function updateMoodUI(mood: string) {
  const config = MOOD_CONFIG[mood] || MOOD_CONFIG.neutral;

  // Update theme glow layer
  document.documentElement.style.setProperty(
    "--current-mood-bg",
    config.bgGradient,
  );

  // Update badge and label
  moodIcon.textContent = config.icon;
  moodLabel.textContent = config.label;

  // Show soothing message for positive and negative moods
  if (["positive", "negative"].includes(mood)) {
    const randomMsg =
      config.messages[Math.floor(Math.random() * config.messages.length)];
    soothingMessage.textContent = randomMsg;
    messageContainer.classList.remove("hidden");
  } else {
    messageContainer.classList.add("hidden");
  }
}

function showRunningState() {
  statusText.textContent = "Status: Active";
  statusDot.classList.add("active-dot");
  startBtn.classList.add("hidden");
  stopBtn.classList.remove("hidden");
  moodBadge.textContent = "Detecting...";
}

function showStoppedState() {
  statusText.textContent = "Status: Inactive";
  statusDot.classList.remove("active-dot");
  startBtn.classList.remove("hidden");
  stopBtn.classList.add("hidden");
  moodBadge.textContent = "Offline";
  moodIcon.textContent = "💤";
  moodLabel.textContent = "Resting aura";
  messageContainer.classList.add("hidden");
  document.documentElement.style.setProperty(
    "--current-mood-bg",
    "var(--mood-neutral)",
  );
}

// 5. Chrome Integration

async function checkStatus() {
  try {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) {
      showRunningState();
    } else {
      showStoppedState();
    }
  } catch (e: any) {
    statusText.textContent = `Init Error: ${e.message}`;
  }
}

startBtn.addEventListener("click", async () => {
  try {
    // Explicitly request camera permissions in the popup (user gesture)
    // This is required, especially on macOS, to show the OS-level prompt
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      throw new Error("Camera permission denied. Please allow camera access.");
    }

    const hasDoc = await chrome.offscreen.hasDocument();
    if (!hasDoc) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: "To access webcam for mood detection",
      });
    }
    showRunningState();
  } catch (error: any) {
    statusText.textContent = `Error: ${error.message}`;
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    await chrome.offscreen.closeDocument();
    showStoppedState();
  } catch (error: any) {
    statusText.textContent = `Error: ${error.message}`;
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "MOOD") {
      updateMoodUI(msg.mood);
  }
});

// Initialize
checkStatus();
