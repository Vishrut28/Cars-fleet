const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

async function serveVideo(req, res, pool, videoType, next) {
    const column = videoType === 'exterior' ? 'exterior_video_path' : 'interior_video_path';
    try {
        const result = await pool.query(`SELECT ${column} FROM cleaning_reports WHERE id = $1`, [req.params.id]);
        if (result.rows.length === 0 || !result.rows[0][column]) {
            return res.status(404).json({ error: 'Video record not found in database.' });
        }
        const videoPath = path.join(__dirname, '../../', result.rows[0][column]);
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
            const head = { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' };
            res.writeHead(200, head);
            fs.createReadStream(videoPath).pipe(res);
        }
    } catch (err) {
        next(err);
    }
}

module.exports = (pool, requireAuth) => {
    router.get('/hubs', requireAuth(), async (req, res, next) => {
        try {
            const result = await pool.query('SELECT id, name, location FROM hubs ORDER BY name');
            res.json(result.rows);
        } catch (err) {
            next(err);
        }
    });

    router.get('/video/exterior/:id', requireAuth(), (req, res, next) => serveVideo(req, res, pool, 'exterior', next));
    router.get('/video/interior/:id', requireAuth(), (req, res, next) => serveVideo(req, res, pool, 'interior', next));
    
    return router;
};