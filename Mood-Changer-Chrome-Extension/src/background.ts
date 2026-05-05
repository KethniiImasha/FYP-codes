// Error Logging
self.addEventListener("error", (e) => {
    console.error("[EmoUI Background Error]", e.error || e.message);
});
self.addEventListener("unhandledrejection", (e) => {
    console.error("[EmoUI Background Promise Error]", e.reason);
});

const ICON_DATA_URL = chrome.runtime.getURL('icon128.png');

const MESSAGES: Record<string, string[]> = {
  negative: [
    "It's okay to feel this way. Take a deep breath.",
    "Everything will be okay. You're doing your best.",
    "Small steps lead to big changes.",
    "Treat yourself with kindness today."
  ],
  positive: [
    "Keep spreading that joy!",
    "You're glowing today!",
    "Happiness looks good on you!"
  ]
};

const MESSAGES_SINHALA: Record<string, string[]> = {
  negative: [
    "ඔබට මෙසේ හැඟීම සාමාන්‍යයි. ගැඹුරු හුස්මක් ගන්න.",
    "සියල්ල හරියාවි. ඔබ ඔබේ උපරිමය කරනවා.",
    "කුඩා පියවර විශාල වෙනසක් ඇති කරයි.",
    "අද ඔබටම කරුණාවන්ත වන්න."
  ],
  positive: [
    "ඒ සතුට දිගටම පතුරවන්න!",
    "ඔබ අද හරිම ලස්සනයි!",
    "සතුට ඔබට හොඳින් ගැලපෙනවා!"
  ]
};

// State 
let currentMood = "neutral";
let currentQuote = "";
let moodReadings: string[] = [];
let intervalStartTime = Date.now();
let musicEnabled = "yes";
let quoteLanguage = "english";
let openaiApiKey = "";
let isRunning = false; // Track whether extension is actively running

// Pause State Management
let isMusicPlaying = false;
let isNotificationPending = false;
let notificationAutoResumeTimer: ReturnType<typeof setTimeout> | null = null;

// Default detection interval
let detectionIntervalMs = 5 * 1000;

function updatePauseState() {
    const paused = isMusicPlaying || isNotificationPending;
    console.log(`[Background] Pause State Updated: paused=${paused} (music=${isMusicPlaying}, notification=${isNotificationPending})`);
    // Broadcast to popup UI
    chrome.runtime.sendMessage({ type: "PAUSED_STATE", isPaused: paused }).catch(() => {});
    // Broadcast to offscreen inference loop
    chrome.runtime.sendMessage({ type: "SET_PAUSE_INFERENCE", isPaused: paused }).catch(() => {});
}

function clearNotificationPause() {
    if (notificationAutoResumeTimer) {
        clearTimeout(notificationAutoResumeTimer);
        notificationAutoResumeTimer = null;
    }
    if (isNotificationPending) {
        isNotificationPending = false;
        updatePauseState();
    }
}

// Load saved settings 
chrome.storage.local.get(["detectionInterval", "musicEnabled", "quoteLanguage", "openaiApiKey", "musicIsPlaying"], (result) => {
    if (result.detectionInterval && typeof result.detectionInterval === 'string') {
        detectionIntervalMs = parseFloat(result.detectionInterval) * 60 * 1000;
    }
    if (result.musicEnabled && typeof result.musicEnabled === 'string') {
        musicEnabled = result.musicEnabled;
    }
    if (result.quoteLanguage && typeof result.quoteLanguage === 'string') {
        quoteLanguage = result.quoteLanguage;
    }
    if (result.openaiApiKey && typeof result.openaiApiKey === 'string') {
        openaiApiKey = result.openaiApiKey;
    }
    if (result.musicIsPlaying !== undefined) {
        isMusicPlaying = Boolean(result.musicIsPlaying);
    }
});

// React to settings changes in real-time
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.detectionInterval && typeof changes.detectionInterval.newValue === 'string') {
        const parsed = parseFloat(changes.detectionInterval.newValue);
        detectionIntervalMs = (isNaN(parsed) ? 1 : parsed) * 60 * 1000;
        // Reset interval so next reading triggers immediately with new timing
        intervalStartTime = Date.now();
        moodReadings = [];
        console.log(`[Background] Detection interval changed to ${detectionIntervalMs}ms`);
    }
    if (changes.musicEnabled && typeof changes.musicEnabled.newValue === 'string') {
        musicEnabled = changes.musicEnabled.newValue;
    }
    if (changes.quoteLanguage && typeof changes.quoteLanguage.newValue === 'string') {
        quoteLanguage = changes.quoteLanguage.newValue;
        console.log(`[Background] Language changed to ${quoteLanguage}`);
    }
    if (changes.openaiApiKey && typeof changes.openaiApiKey.newValue === 'string') {
        openaiApiKey = changes.openaiApiKey.newValue;
    }
    if (changes.musicIsPlaying) {
        isMusicPlaying = Boolean(changes.musicIsPlaying.newValue);
        updatePauseState();
    }
});

// SINGLE unified message handler
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "MOOD_READING") {
        if (isMusicPlaying || isNotificationPending) return; // Skip if paused

        moodReadings.push(msg.mood);
        console.log(`[Background] Collected Reading: ${msg.mood}. Total: ${moodReadings.length}`);

        const now = Date.now();
        if (now - intervalStartTime >= detectionIntervalMs) {
            processInterval();
        }
    } else if (msg.type === "START_EXTENSION") {
        console.log("[Background] START_EXTENSION received");
        isRunning = true;
        isNotificationPending = false;
        moodReadings = [];
        intervalStartTime = Date.now();
        currentMood = "neutral";
        currentQuote = "";
        updatePauseState();
    } else if (msg.type === "STOP_EXTENSION") {
        console.log("[Background] STOP_EXTENSION received");
        isRunning = false;
        isNotificationPending = false;
        moodReadings = [];
        currentMood = "neutral";
        currentQuote = "";
        if (notificationAutoResumeTimer) {
            clearTimeout(notificationAutoResumeTimer);
            notificationAutoResumeTimer = null;
        }
        chrome.notifications.clear('mood-prompt');
        chrome.notifications.clear('music-select');
        updatePauseState();
        // Also broadcast neutral to all tabs to remove overlays
        sendMoodToAllTabs();
    } else if (msg.type === "GET_MOOD") {
        sendResponse({ mood: currentMood, quote: currentQuote, isRunning });
        return true; // Keep the message channel open for sendResponse
    }
});

// OpenAI API
async function fetchOpenAIQuote(mood: string, lang: string): Promise<string> {
    if (!openaiApiKey) return "";
    try {
        const prompt = `Generate a short, soothing or encouraging quote for someone who is feeling ${mood}. Respond ONLY with the quote itself, without quotation marks. Generate the quote in the ${lang} language. Max 15 words.`;
        const res = await fetch(`https://api.openai.com/v1/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7,
                max_tokens: 50
            })
        });

        if (!res.ok) {
            if (res.status === 429) {
                console.error("[EmoUI Background Error] OpenAI API Quota Exceeded (429). Check your token balance. Falling back to native localized quotes.");
            } else if (res.status === 401) {
                console.error(`[EmoUI Background Error] OpenAI API Unauthorized (401). Invalid API Key. Falling back to native localized quotes.`);
            } else {
                console.error("[EmoUI Background Error] OpenAI API Error", await res.text());
            }
            return "";
        }

        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || "";
        return text.trim();
    } catch (e) {
        console.error("Failed to fetch from OpenAI API", e);
        return "";
    }
}

// Core mood processing 
async function processInterval() {
    if (moodReadings.length === 0) return;

    const counts: Record<string, number> = { positive: 0, negative: 0, neutral: 0 };
    for (const mood of moodReadings) {
        if (counts[mood] !== undefined) {
            counts[mood]++;
        }
    }

    let maxCount = 0;
    let averageMood = "neutral";
    for (const [mood, count] of Object.entries(counts)) {
        if (count > maxCount) {
            maxCount = count;
            averageMood = mood;
        }
    }

    console.log(`[Background] Interval Complete. Average Mood: ${averageMood}`);
    currentMood = averageMood;

    // Reset for next interval immediately
    moodReadings = [];
    intervalStartTime = Date.now();

    if (["positive", "negative"].includes(currentMood)) {
        const fallbackMessages = quoteLanguage === "sinhala" ? MESSAGES_SINHALA[currentMood] : MESSAGES[currentMood];
        let randomMsg = fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];

        if (!openaiApiKey) {
             console.error("[EmoUI Background Error] No OpenAI API Key found. Using hardcoded fallback.");
        }

        const apiQuote = await fetchOpenAIQuote(currentMood, quoteLanguage);
        if (apiQuote) {
            randomMsg = apiQuote;
        } else if (openaiApiKey) {
             console.error("[EmoUI Background Error] OpenAI API returned empty content. Check API key status.");
        }
        currentQuote = randomMsg;

        // Broadcast mood to all tabs and popup
        sendMoodToAllTabs();
        chrome.runtime.sendMessage({ type: "MOOD", mood: currentMood, quote: currentQuote }).catch(() => {});

        // Only pause detection for NEGATIVE mood with music buttons
        // Positive moods should NOT pause — they have no user interaction
        const needsUserAction = currentMood === "negative" && musicEnabled === "yes";

        if (needsUserAction) {
            isNotificationPending = true;
            updatePauseState();
        }

        // Build notification
        // @ts-ignore
        const notificationOptions: chrome.notifications.NotificationOptions = {
            type: 'basic',
            iconUrl: ICON_DATA_URL,
            title: `Mood detected: ${currentMood.toUpperCase()}`,
            message: randomMsg,
            priority: 2,
            requireInteraction: needsUserAction
        };

        if (needsUserAction) {
            notificationOptions.buttons = [
                { title: "I need music" },
                { title: "No thanks" }
            ];
        }

        // @ts-ignore
        chrome.notifications.create('mood-prompt', notificationOptions);
    } else {
        // Neutral - just broadcast without pausing
        currentQuote = "Feeling balanced.";
        sendMoodToAllTabs();
        chrome.runtime.sendMessage({ type: "MOOD", mood: currentMood, quote: currentQuote }).catch(() => {});
    }
}

// Notification handlers
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    if (notificationId === 'mood-prompt') {
        if (buttonIndex === 0 && currentMood === "negative" && musicEnabled === "yes") {
            // "I need music" - show music selection
            // @ts-ignore
            chrome.notifications.create('music-select', {
                type: 'basic',
                iconUrl: ICON_DATA_URL,
                title: 'Select Soothing Music',
                message: 'Which track would you like to hear?',
                buttons: [
                    { title: 'Rain & Piano' },
                    { title: 'Deep Meditation' }
                ],
                priority: 2,
                requireInteraction: true
            });
        }
        clearNotificationPause();
    } else if (notificationId === 'music-select') {
        const SONGS = [
            "https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf07a.mp3",
            "https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=relaxing-music-119247.mp3"
        ];
        const url = SONGS[buttonIndex];
        if (url) {
            chrome.storage.local.set({ musicIsPlaying: true, selectedSong: url });
            chrome.runtime.sendMessage({ type: "PLAY_MUSIC", url }).catch((e) => console.error(e));
        }
        clearNotificationPause();
    }

    chrome.notifications.clear(notificationId);
});

chrome.notifications.onClosed.addListener((notificationId) => {
    if (notificationId === 'mood-prompt' || notificationId === 'music-select') {
        clearNotificationPause();
    }
});

// Tab change: send current mood to new active tab
chrome.tabs.onActivated.addListener((activeInfo) => {
    if (!isRunning) return;
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (chrome.runtime.lastError) return;
        if (tab?.url && !tab.url.startsWith("chrome://")) {
            chrome.tabs.sendMessage(activeInfo.tabId, { type: "MOOD", mood: currentMood, quote: currentQuote }).catch(() => {});
        }
    });
});

// Tab loaded: send current mood 
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!isRunning) return;
    if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith("chrome://")) {
        chrome.tabs.sendMessage(tabId, { type: "MOOD", mood: currentMood, quote: currentQuote }).catch(() => {});
    }
});

// Broadcast mood to ALL currently open tabs 
function sendMoodToAllTabs() {
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            if (tab.id && tab.url && !tab.url.startsWith("chrome://")) {
                chrome.tabs.sendMessage(tab.id, { type: "MOOD", mood: currentMood, quote: currentQuote }).catch(() => {});
            }
        }
    });
}