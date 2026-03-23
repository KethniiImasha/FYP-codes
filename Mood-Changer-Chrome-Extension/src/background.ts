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

let currentMood = "neutral";
let moodReadings: string[] = [];
let intervalStartTime = Date.now();
let musicEnabled = "yes";

// Default detection interval: 1 minute (in milliseconds)
// Can be changed by the user in settings
let detectionIntervalMs = 5 * 1000;

chrome.storage.local.get(["detectionInterval", "musicEnabled"], (result) => {
    if (result.detectionInterval && typeof result.detectionInterval === 'string') {
        detectionIntervalMs = parseFloat(result.detectionInterval) * 60 * 1000;
    }
    if (result.musicEnabled && typeof result.musicEnabled === 'string') {
        musicEnabled = result.musicEnabled;
    }
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.detectionInterval && typeof changes.detectionInterval.newValue === 'string') {
        const parsed = parseFloat(changes.detectionInterval.newValue);
        detectionIntervalMs = (isNaN(parsed) ? 1 : parsed) * 60 * 1000;
        // reset interval when settings change
        intervalStartTime = Date.now();
        moodReadings = [];
    }
    if (area === 'local' && changes.musicEnabled && typeof changes.musicEnabled.newValue === 'string') {
        musicEnabled = changes.musicEnabled.newValue;
    }
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "MOOD_READING") {
        moodReadings.push(msg.mood);
        console.log(`[Background] Collected Reading: ${msg.mood}. Total: ${moodReadings.length}`);
        
        const now = Date.now();
        if (now - intervalStartTime >= detectionIntervalMs) {
            processInterval();
        }
    }
});

function processInterval() {
    if (moodReadings.length === 0) return;

    // Calculate Mode (Most Frequent Mood)
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

    // 1. Notify UI to update colors
    sendMoodToActiveTab();
    chrome.runtime.sendMessage({ type: "MOOD", mood: currentMood }).catch(() => {});

    // 2. Handle Notifications
    if (["positive", "negative"].includes(currentMood)) {
        const messages = MESSAGES[currentMood];
        const randomMsg = messages[Math.floor(Math.random() * messages.length)];
        
        // @ts-ignore
        const notificationOptions: chrome.notifications.NotificationOptions = {
            type: 'basic',
            iconUrl: ICON_DATA_URL,
            title: `Mood detected: ${currentMood.toUpperCase()}`,
            message: randomMsg,
            priority: 2,
            requireInteraction: true
        };

        if (currentMood === "negative" && musicEnabled === "yes") {
            notificationOptions.buttons = [
                { title: "I need music" },
                { title: "No thanks" }
            ];
        }

        // @ts-ignore
        chrome.notifications.create('mood-prompt', notificationOptions);
    } // If neutral, we do nothing and let it coast.

    // Reset for next interval
    moodReadings = [];
    intervalStartTime = Date.now();
}


chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    if (notificationId === 'mood-prompt') {
        if (buttonIndex === 0) {
            // "I need music"
            // Show second notification with choices
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
    } else if (notificationId === 'music-select') {
        const SONGS = [
            "https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf07a.mp3", // Rain & Piano
            "https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=relaxing-music-119247.mp3" // Deep Meditation
        ];
        const url = SONGS[buttonIndex];
        if (url) {
            chrome.storage.local.set({ musicIsPlaying: true, selectedSong: url });
            chrome.runtime.sendMessage({ type: "PLAY_MUSIC", url }).catch((e) => console.error(e));
        }
    }
    
    // Clear notification automatically after clicking a button
    chrome.notifications.clear(notificationId);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "GET_MOOD") {
        sendResponse({ mood: currentMood });
    }
});

// Send mood to newly activated tabs immediately
chrome.tabs.onActivated.addListener(() => {
    sendMoodToActiveTab();
});

// Send mood to newly updated/reloaded tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        sendMoodToActiveTab(tabId, tab.url);
    }
});

function sendMoodToActiveTab(tabId?: number, url?: string) {
    if (tabId && url) {
        if (!url.startsWith("chrome://")) {
            chrome.tabs.sendMessage(tabId, { type: "MOOD", mood: currentMood }).catch(() => {});
        }
    } else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            if (activeTab?.id && activeTab.url && !activeTab.url.startsWith("chrome://")) {
                chrome.tabs.sendMessage(activeTab.id, { type: "MOOD", mood: currentMood }).catch(() => {});
            }
        });
    }
}