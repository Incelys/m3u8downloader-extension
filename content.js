function getM3U8Links() {
    const links = [];
    const m3u8Links = document.querySelectorAll('a[href*=".m3u8"]');
    m3u8Links.forEach(link => {
        links.push(link.href);
    });
    return links;
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'getM3U8Links') {
        const links = getM3U8Links();
        sendResponse(links);
    }
});