const express = require('express');
const router = express.Router();
const fs = require('fs');

module.exports = (db) => {
    router.get('/stats', (req, res, next) => {
        db.get(`SELECT
            (SELECT COUNT(*) FROM cleaning_reports) as total,
            (SELECT COUNT(*) FROM cleaning_reports WHERE audit_status = 'pending') as pending,
            (SELECT COUNT(*) FROM cleaning_reports WHERE audit_status = 'approved') as approved,
            (SELECT COUNT(*) FROM cleaning_reports WHERE audit_status = 'rejected') as rejected
            `, (err, row) => {
            if (err) return next(err);
            res.json(row);
        });
    });

    router.get('/pending-audits', (req, res, next) => {
        db.all(`SELECT id, reg_no, hub_location, cleaning_date, submission_date, user_email FROM cleaning_reports WHERE audit_status = 'pending' ORDER BY submission_date DESC`, (err, rows) => {
            if (err) return next(err);
            res.json(rows);
        });
    });
    
    router.get('/all-audits', (req, res, next) => {
        db.all(`SELECT id, reg_no, hub_location, submission_date as audit_date, audit_status as status, audit_rating FROM cleaning_reports ORDER BY submission_date DESC LIMIT 100`, (err, rows) => {
            if (err) return next(err);
            res.json(rows);
        });
    });

    router.get('/video-info/:id', (req, res, next) => {
        db.get(`SELECT * FROM cleaning_reports WHERE id = ?`, [req.params.id], (err, row) => {
            if (err) return next(err);
            if (!row) return res.status(404).json({ error: 'Audit record not found' });
            res.json({
                ...row,
                exterior_video_available: row.exterior_video_path && fs.existsSync(row.exterior_video_path),
                interior_video_available: row.interior_video_path && fs.existsSync(row.interior_video_path)
            });
        });
    });

    router.post('/audit/:id', (req, res, next) => {
        const { audit_status, audit_rating, audit_notes } = req.body;
        if (!audit_status || !audit_rating || audit_rating < 1 || audit_rating > 5) {
            return res.status(400).json({ error: 'Valid status and rating (1-5) are required' });
        }
        db.run(`UPDATE cleaning_reports SET audit_status=?, audit_rating=?, audit_notes=? WHERE id=?`, [audit_status, audit_rating, audit_notes || '', req.params.id], function(err) {
            if (err) return next(err);
            if (this.changes === 0) return res.status(404).json({ error: 'Audit record not found' });
            res.json({ success: true, message: 'Audit submitted successfully' });
        });
    });

    return router;
};