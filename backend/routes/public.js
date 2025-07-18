const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Helper function to serve videos
function serveVideo(req, res, db, videoType, next) {
    const column = videoType === 'exterior' ? 'exterior_video_path' : 'interior_video_path';
    db.get(`SELECT ${column} FROM cleaning_reports WHERE id = ?`, [req.params.id], (err, row) => {
        if (err) return next(err);
        if (!row || !row[column]) {
            return res.status(404).json({ error: 'Video record not found in database.' });
        }

        // IMPORTANT: The path stored in the DB should be relative to the project root.
        // e.g., 'uploads/video-file-name.mp4'
        const videoPath = path.join(__dirname, '../../', row[column]);

        if (!fs.existsSync(videoPath)) {
            return res.status(404).json({ error: 'Video file is missing from the server filesystem.' });
        }

        const stat = fs.statSync(videoPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(videoPath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/mp4',
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
            };
            res.writeHead(200, head);
            fs.createReadStream(videoPath).pipe(res);
        }
    });
}

module.exports = (db, requireAuth) => {
    // This route needs authentication, but any role can access it.
    router.get('/hubs', requireAuth(), (req, res, next) => {
        db.all(`SELECT id, name, location FROM hubs ORDER BY name`, [], (err, rows) => {
            if (err) return next(err);
            res.json(rows);
        });
    });

    // Video endpoints are also accessible to authenticated users (auditors, yard managers).
    router.get('/video/exterior/:id', requireAuth(), (req, res, next) => serveVideo(req, res, db, 'exterior', next));
    router.get('/video/interior/:id', requireAuth(), (req, res, next) => serveVideo(req, res, db, 'interior', next));
    
    return router;
};