document.addEventListener('DOMContentLoaded', function() {
    const urlList = document.getElementById('urlList');
    const statusMessage = document.getElementById('statusMessage');
    const clearButton = document.getElementById('clearButton');

    function showNotification(message) {
        const statusMessage = document.getElementById('statusMessage');
        statusMessage.textContent = message;
        statusMessage.style.opacity = 1;
        
        setTimeout(() => {
            statusMessage.style.opacity = 0;
        }, 3000);
    }

    function createURLElement(urlData) {
        const container = document.createElement('div');
        container.className = 'url-item';

        const urlText = document.createElement('span');
        urlText.className = 'url-text';
        urlText.textContent = urlData.url;

        const buttonContainer = document.createElement('div');
        
        const playButton = document.createElement('button');
        playButton.className = 'play-btn';
        playButton.textContent = 'Play';
        playButton.onclick = () => playM3U8(urlData.url);

        const downloadButton = document.createElement('button');
        downloadButton.className = 'download-btn';
        downloadButton.textContent = 'Download';
        downloadButton.onclick = () => downloadVideo(urlData.url);

        const copyButton = document.createElement('button');
        copyButton.className = 'copy-btn';
        copyButton.textContent = 'Copy';
        copyButton.onclick = () => {
            navigator.clipboard.writeText(urlData.url)
                .then(() => showNotification('URL copied to clipboard!'));
        };

        buttonContainer.appendChild(playButton);
        buttonContainer.appendChild(downloadButton);
        buttonContainer.appendChild(copyButton);

        container.appendChild(urlText);
        container.appendChild(buttonContainer);

        return container;
    }

    function playM3U8(url) {
        const videoContainer = document.getElementById('videoContainer');
        const video = document.getElementById('video');
        
        // Reset video element
        video.pause();
        video.removeAttribute('src');
        video.load();
        
        videoContainer.style.display = 'block';
        showNotification('Loading video...');
    
        // Destroy existing Hls instance if exists
        if (window.hls) {
            window.hls.destroy();
        }
    
        try {
            // Check if Hls is defined
            if (typeof Hls === 'undefined') {
                throw new Error('HLS.js library not loaded. Please refresh the page.');
            }
    
            if (Hls.isSupported()) {
                const hls = new Hls({
                    debug: false,
                    enableWorker: true
                });
                window.hls = hls;
                hls.loadSource(url);
                hls.attachMedia(video);
                
                hls.on(Hls.Events.MANIFEST_PARSED, function() {
                    console.log('Video manifest parsed');
                    video.play()
                        .then(() => {
                            console.log('Video playback started');
                            showNotification('Video playback started');
                        })
                        .catch(e => {
                            console.error("Error playing video:", e);
                            showNotification("Error playing video: " + e.message);
                        });
                });
                
                hls.on(Hls.Events.ERROR, function(event, data) {
                    console.error("HLS error:", data);
                    if (data.fatal) {
                        switch(data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                showNotification("Network error, trying to recover...");
                                hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                showNotification("Media error, trying to recover...");
                                hls.recoverMediaError();
                                break;
                            default:
                                showNotification("Fatal error playing video");
                                hls.destroy();
                                break;
                        }
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
                video.addEventListener('loadedmetadata', function() {
                    video.play()
                        .then(() => showNotification('Video playback started'))
                        .catch(e => {
                            console.error("Error playing video:", e);
                            showNotification("Error playing video: " + e.message);
                        });
                });
            } else {
                showNotification("HLS is not supported on this browser.");
            }
        } catch (error) {
            console.error('Error initializing video player:', error);
            showNotification('Error initializing video player: ' + error.message);
        }
    }

    function downloadVideo(url) {
        const progressContainer = document.getElementById('downloadProgress');
        const progressBar = document.getElementById('progressBar');
        const progressPercent = document.getElementById('progressPercent');
        const pauseButton = document.getElementById('pauseDownload');
        const cancelButton = document.getElementById('cancelDownload');
        
        let currentDownloadId = null;
        let isPaused = false;
        
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressPercent.textContent = '0%';
        
        pauseButton.disabled = false;
        cancelButton.disabled = false;
        pauseButton.textContent = 'Pause';
        
        showNotification('Starting download... Please wait.');
        
        // Setup pause button handler
        pauseButton.onclick = () => {
            if (!currentDownloadId) return;
            
            const action = isPaused ? 'resume' : 'pause';
            fetch(`http://localhost:3000/download/control/${currentDownloadId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    // Jika ada error karena Windows tidak mendukung resume
                    if (data.error === 'Resume not supported on Windows') {
                        // Mulai download baru dari awal
                        showNotification('Restarting download...');
                        downloadVideo(url);
                    } else {
                        throw new Error(data.error);
                    }
                } else if (data.status === 'paused') {
                    isPaused = true;
                    pauseButton.textContent = 'Resume';
                    showNotification('Download paused');
                } else if (data.status === 'resumed') {
                    isPaused = false;
                    pauseButton.textContent = 'Pause';
                    showNotification('Download resumed');
                }
            })
            .catch(error => {
                console.error('Error controlling download:', error);
                showNotification('Error controlling download: ' + error.message);
            });
        };
        
        // Setup cancel button handler
        cancelButton.onclick = () => {
            if (!currentDownloadId) return;
            
            fetch(`http://localhost:3000/download/control/${currentDownloadId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'cancel' })
            })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'cancelled') {
                    progressContainer.style.display = 'none';
                    showNotification('Download cancelled');
                }
            })
            .catch(error => {
                console.error('Error cancelling download:', error);
                showNotification('Error cancelling download: ' + error.message);
            });
        };
    
        console.log('Starting download for URL:', url);
        
        fetch('http://localhost:3000/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ m3u8Url: url })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Download initiated:', data);
            currentDownloadId = data.downloadId;
            
            const eventSource = new EventSource(`http://localhost:3000/progress/${currentDownloadId}`);
            
            eventSource.onmessage = function(event ) {
                const data = JSON.parse(event.data);
                const percent = Math.round(data.percent || 0);
                progressBar.style.width = `${percent}%`;
                progressPercent.textContent = `${percent}%`;
                
                if (data.status === 'complete') {
                    progressContainer.style.display = 'none';
                    showNotification('Download complete');
                    fetch(`http://localhost:3000/download/${currentDownloadId}`)
                        .then(response => response.blob())
                        .then(blob => {
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `video_${currentDownloadId}.mp4`;
                            a.click();
                        })
                        .catch(error => {
                            console.error('Error downloading file:', error);
                            showNotification('Error downloading file: ' + error.message);
                        });
                }
            };
            
            eventSource.onerror = function(event) {
                console.error('Error occurred:', event);
                showNotification('Error occurred: ' + event.type);
            };
        })
        .catch(error => {
            console.error('Error initiating download:', error);
            showNotification('Error initiating download: ' + error.message);
        });
    }

    function updateURLList() {
        chrome.runtime.sendMessage({action: "getURLs"}, function(response) {
            if (response && response.urls) {
                urlList.innerHTML = '';
                if (response.urls.length === 0) {
                    showNotification('No M3U8 URLs found yet');
                } else {
                    response.urls.forEach(urlData => {
                        urlList.appendChild(createURLElement(urlData));
                    });
                }
            }
        });
    }

    // Update list when popup opens
    updateURLList();

    // Listen for new URLs
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.action === 'newURL') {
            urlList.appendChild(createURLElement(request.data));
        }
    });

    clearButton.addEventListener('click', function() {
        chrome.runtime.sendMessage({action: "clearAll"}, function(response) {
            if (response && response.success) {
                urlList.innerHTML = '';
                showNotification('List cleared');
            }
        });
    });
});