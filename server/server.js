const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const TIMEOUT = 30 * 60 * 1000;
const activeDownloads = new Map();

app.get('/progress/:id', (req, res) => {
    const downloadId = req.params.id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    app.locals[downloadId] = res;
});

app.post('/download', async (req, res) => {
    const { m3u8Url } = req.body;

    if (!m3u8Url) {
        return res.status(400).json({ error: 'M3U8 URL is required' });
    }

    const downloadId = Date.now().toString();
    const customDownloadPath = 'D:/pc';
    const outputPath = path.join(customDownloadPath, `output_${downloadId}.mp4`);

    res.json({ downloadId });

    const ffmpegProcess = spawn('ffmpeg', [
        '-i', m3u8Url,
        '-c', 'copy',
        '-bsf:a', 'aac_adtstoasc',
        '-movflags', 'frag_keyframe+empty_moov',
        outputPath
    ]);

    activeDownloads.set(downloadId, {
        process: ffmpegProcess,
        status: 'downloading',
        outputPath
    });

    let duration = 0;
    let lastProgress = 0;

    ffmpegProcess.stderr.on('data', (data) => {
        const output = data.toString();

        // Try to get duration if we don't have it
        if (!duration) {
            const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}.\d{2})/);
            if (durationMatch) {
                const hours = parseInt(durationMatch[1]);
                const minutes = parseInt(durationMatch[2]);
                const seconds = parseFloat(durationMatch[3]);
                duration = (hours * 3600) + (minutes * 60) + seconds;
            }
        }

        // Get current time
        const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}.\d{2})/);
        if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const seconds = parseFloat(timeMatch[3]);
            const currentTime = (hours * 3600) + (minutes * 60) + seconds;

            // Calculate progress percentage
            const progress = duration ? (currentTime / duration) * 100 : 0;

            // Only send progress update if it has changed significantly
            if (Math.abs(progress - lastProgress) >= 1) {
                lastProgress = progress;
                const sseRes = app.locals[downloadId];
                if (sseRes) {
                    sseRes.write(`data: ${JSON.stringify({
                        percent: Math.round(progress),
                        time: `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`
                    })}\n\n`);
                }
            }
        }
    });

    ffmpegProcess.on('close', (code) => {
        const sseRes = app.locals[downloadId];
        if (sseRes) {
            if (code === 0) {
                sseRes.write(`data: ${JSON.stringify({ status: 'complete', downloadId })}\n\n`);
            } else {
                sseRes.write(`data: ${JSON.stringify({ status: 'error', message: `FFmpeg process exited with code ${code}` })}\n\n`);
            }
            sseRes.end();
            delete app.locals[downloadId];
        }
        activeDownloads.delete(downloadId);
    });

    ffmpegProcess.on('error', (err) => {
        console.error('FFmpeg process error:', err);
        const sseRes = app.locals[downloadId];
        if (sseRes) {
            sseRes.write(`data: ${JSON.stringify({ status: 'error', message: err.message })}\n\n`);
            sseRes.end();
            delete app.locals[downloadId];
        }
        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
        }
        activeDownloads.delete(downloadId);
    });
});

app.get('/download/:id', (req, res) => {
    const downloadId = req.params.id;
    const outputPath = path.join(__dirname, `output_${downloadId}.mp4`);

    if (fs.existsSync(outputPath)) {
        res.download(outputPath, `video_${downloadId}.mp4`, (err) => {
            if (err) console.error('Download error:', err);
            fs.unlink(outputPath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });
        });
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

app.post('/download/control/:id', (req, res) => {
    const { action } = req.body;
    const downloadId = req.params.id;
    const download = activeDownloads.get(downloadId);

    if (!download) {
        return res.status(404).json({ error: 'Download not found' });
    }

    try {
        switch (action) {
            case 'pause':
                if (download.process && download.status === 'downloading') {
                    if (process.platform === 'win32') {
                        download.process.kill();
                    } else {
                        download.process.kill('SIGSTOP');
                    }
                    download.status = 'paused';
                    res.json({ status: 'paused' });
                } else {
                    res.status(400).json({ error: 'Download cannot be paused' });
                }
                break;

            case 'resume':
                if (download.process && download.status === 'paused') {
                    if (process.platform === 'win32') {
                        // On Windows, we need to restart the process
                        // This is a limitation of Windows
                        res.status(400).json({ error: 'Resume not supported on Windows' });
                    } else {
                        download.process.kill('SIGCONT');
                        download.status = 'downloading';
                        res.json({ status: 'resumed' });
                    }
                } else {
                    res.status(400).json({ error: 'Download cannot be resumed' });
                }
                break;

            case 'cancel':
                if (download.process) {
                    download.process.kill();
                    if (fs.existsSync(download.outputPath)) {
                        fs.unlinkSync(download.outputPath);
                    }
                    activeDownloads.delete(downloadId);
                    res.json({ status: 'cancelled' });
                } else {
                    res.status(400).json({ error: 'Download cannot be cancelled' });
                }
                break;

            default:
                res.status(400).json({ error: 'Invalid action' });
        }
    } catch (error) {
        console.error('Control error:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    } finally {
        if (download && download.process) {
            download.process.removeAllListeners();
        }
    }
});

app.listen(port, () => {
    console.log(`Server started on port ${port}`);
});