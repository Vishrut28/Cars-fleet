const express = require('express');
const router = express.Router();

module.exports = (db) => {
    // GET YARD MANAGER STATISTICS
    router.get('/stats', (req, res, next) => {
        const userId = req.session.userId;
        const queries = {
            assigned_cars: `SELECT COUNT(DISTINCT ca.id) as count FROM car_assignments ca JOIN hub_assignments ha ON ca.hub_location = (SELECT name FROM hubs WHERE id=ha.hub_id) WHERE ha.user_id = ? AND ha.role = 'yard_manager'`,
            uploaded_videos: `SELECT COUNT(cr.id) as count FROM cleaning_reports cr JOIN hub_assignments ha ON cr.hub_location = (SELECT name FROM hubs WHERE id=ha.hub_id) WHERE ha.user_id = ? AND ha.role = 'yard_manager'`,
            pending_audits: `SELECT COUNT(cr.id) as count FROM cleaning_reports cr JOIN hub_assignments ha ON cr.hub_location = (SELECT name FROM hubs WHERE id=ha.hub_id) WHERE ha.user_id = ? AND ha.role = 'yard_manager' AND cr.audit_status = 'pending'`
        };

        let stats = {};
        let completed = 0;
        const totalQueries = Object.keys(queries).length;

        for (const [key, query] of Object.entries(queries)) {
            db.get(query, [userId], (err, row) => {
                if (err) return next(err);
                stats[key] = row.count || 0;
                completed++;
                if (completed === totalQueries) {
                    stats.adherence_rate = stats.assigned_cars > 0 ? Math.round((stats.uploaded_videos / stats.assigned_cars) * 100) : 0;
                    res.json(stats);
                }
            });
        }
    });

    // GET ALL VIDEO ASSIGNMENTS FOR YARD MANAGER'S HUBS
    router.get('/video-assignments', (req, res, next) => {
        const query = `
            SELECT 
              ca.reg_no, ca.hub_location, cr.user_email as ground_worker, 
              cr.submission_date, cr.audit_status, cr.id as report_id,
              CASE 
                WHEN cr.id IS NOT NULL THEN 'Uploaded'
                ELSE 'Pending'
              END as status
            FROM car_assignments ca
            JOIN hub_assignments ha ON ca.hub_location = (SELECT name FROM hubs WHERE id = ha.hub_id)
            LEFT JOIN cleaning_reports cr ON ca.reg_no = cr.reg_no AND ca.hub_location = cr.hub_location
            WHERE ha.user_id = ? AND ha.role = 'yard_manager'
            ORDER BY cr.submission_date DESC, ca.assigned_at DESC`;
        db.all(query, [req.session.userId], (err, rows) => {
            if (err) return next(err);
            res.json(rows);
        });
    });

    // GET UPLOADED VIDEOS FOR YARD MANAGER'S HUBS
    router.get('/manager-videos', (req, res, next) => {
        const query = `
            SELECT cr.id, cr.reg_no, cr.user_email as ground_worker, cr.submission_date, cr.audit_status, cr.audit_rating
            FROM cleaning_reports cr
            JOIN hub_assignments ha ON cr.hub_location = (SELECT name FROM hubs WHERE id = ha.hub_id)
            WHERE ha.user_id = ? AND ha.role = 'yard_manager'
            ORDER BY cr.submission_date DESC`;
        db.all(query, [req.session.userId], (err, rows) => {
            if (err) return next(err);
            res.json(rows);
        });
    });

    return router;
};