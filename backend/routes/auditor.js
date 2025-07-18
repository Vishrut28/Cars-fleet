const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

module.exports = (pool) => {
    router.get('/stats', async (req, res, next) => {
        try {
            const query = `SELECT
                (SELECT COUNT(*) FROM cleaning_reports)::int as total,
                (SELECT COUNT(*) FROM cleaning_reports WHERE audit_status = 'pending')::int as pending,
                (SELECT COUNT(*) FROM cleaning_reports WHERE audit_status = 'approved')::int as approved,
                (SELECT COUNT(*) FROM cleaning_reports WHERE audit_status = 'rejected')::int as rejected`;
            const result = await pool.query(query);
            res.json(result.rows[0]);
        } catch (err) {
            next(err);
        }
    });

    router.get('/pending-audits', async (req, res, next) => {
        try {
            const result = await pool.query(`SELECT id, reg_no, hub_location, cleaning_date, submission_date, user_email FROM cleaning_reports WHERE audit_status = 'pending' ORDER BY submission_date DESC`);
            res.json(result.rows);
        } catch (err) {
            next(err);
        }
    });
    
    router.get('/all-audits', async (req, res, next) => {
        try {
            const result = await pool.query(`SELECT id, reg_no, hub_location, submission_date as audit_date, audit_status as status, audit_rating FROM cleaning_reports ORDER BY submission_date DESC LIMIT 100`);
            res.json(result.rows);
        } catch (err) {
            next(err);
        }
    });

    router.get('/video-info/:id', async (req, res, next) => {
        try {
            const result = await pool.query(`SELECT * FROM cleaning_reports WHERE id = $1`, [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Audit record not found' });
            
            const row = result.rows[0];
            const exteriorVideoPath = row.exterior_video_path ? path.join(__dirname, '../../', row.exterior_video_path) : null;
            const interiorVideoPath = row.interior_video_path ? path.join(__dirname, '../../', row.interior_video_path) : null;
            
            res.json({
                ...row,
                exterior_video_available: exteriorVideoPath && fs.existsSync(exteriorVideoPath),
                interior_video_available: interiorVideoPath && fs.existsSync(interiorVideoPath)
            });
        } catch (err) {
            next(err);
        }
    });

    router.post('/audit/:id', async (req, res, next) => {
        const { audit_status, audit_rating, audit_notes } = req.body;
        if (!audit_status || !audit_rating || audit_rating < 1 || audit_rating > 5) {
            return res.status(400).json({ error: 'Valid status and rating (1-5) are required' });
        }
        try {
            const result = await pool.query(`UPDATE cleaning_reports SET audit_status=$1, audit_rating=$2, audit_notes=$3 WHERE id=$4`, [audit_status, audit_rating, audit_notes || '', req.params.id]);
            if (result.rowCount === 0) return res.status(404).json({ error: 'Audit record not found' });
            res.json({ success: true, message: 'Audit submitted successfully' });
        } catch (err) {
            next(err);
        }
    });

    return router;
};