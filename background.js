let m3u8Data = [];

function addM3U8URL(details) {
    const url = details.url;
    const sourceTab = details.tabId;

    chrome.tabs.get(sourceTab, (tab) => {
        const sourceURL = tab ? tab.url : "unknown";
        const timestamp = new Date().toISOString();

        const urlData = {
            url: url,
            sourceURL: sourceURL,
            timestamp: timestamp,
            id: Date.now()
        };

        // Periksa duplikat
        if (!m3u8Data.some(item => item.url === url)) {
            m3u8Data.push(urlData);
            // Simpan ke storage
            chrome.storage.local.set({ 'm3u8Data': m3u8Data }, function() {
                console.log('Data saved');
            });
            // Kirim pesan ke popup jika terbuka
            chrome.runtime.sendMessage({action: 'newURL', data: urlData});
        }
    });
}

chrome.webRequest.onBeforeRequest.addListener(
    function(details) {
        if (details.url.includes('.m3u8')) {
            addM3U8URL(details);
        }
    },
    { urls: ["<all_urls>"] },
    ["blocking"]
);

chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
        if (request.action === "getURLs") {
            sendResponse({ urls: m3u8Data });
        } else if (request.action === "clearAll") {
            m3u8Data = [];
            chrome.storage.local.remove('m3u8Data', function() {
                console.log('Data cleared');
            });
            sendResponse({ success: true });
        }
    }
);

// Load data dari storage saat startup
chrome.storage.local.get('m3u8Data', function(result) {
    if (result.m3u8Data) {
        m3u8Data = result.m3u8Data;
        console.log('Data loaded', m3u8Data);
    }
});