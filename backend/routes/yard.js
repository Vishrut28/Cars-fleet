const express = require('express');
const router = express.Router();

module.exports = (pool) => {
    router.get('/stats', async (req, res, next) => {
        const userId = req.session.userId;
        try {
            const assignedQuery = `SELECT COUNT(DISTINCT ca.id) as count FROM car_assignments ca JOIN hub_assignments ha ON ca.hub_location = (SELECT name FROM hubs WHERE id=ha.hub_id) WHERE ha.user_id = $1 AND ha.role = 'yard_manager'`;
            const uploadedQuery = `SELECT COUNT(cr.id) as count FROM cleaning_reports cr JOIN hub_assignments ha ON cr.hub_location = (SELECT name FROM hubs WHERE id=ha.hub_id) WHERE ha.user_id = $1 AND ha.role = 'yard_manager'`;
            const pendingQuery = `SELECT COUNT(cr.id) as count FROM cleaning_reports cr JOIN hub_assignments ha ON cr.hub_location = (SELECT name FROM hubs WHERE id=ha.hub_id) WHERE ha.user_id = $1 AND ha.role = 'yard_manager' AND cr.audit_status = 'pending'`;

            const [assignedResult, uploadedResult, pendingResult] = await Promise.all([
                pool.query(assignedQuery, [userId]),
                pool.query(uploadedQuery, [userId]),
                pool.query(pendingQuery, [userId])
            ]);

            const stats = {
                assigned_cars: parseInt(assignedResult.rows[0].count, 10),
                uploaded_videos: parseInt(uploadedResult.rows[0].count, 10),
                pending_audits: parseInt(pendingResult.rows[0].count, 10)
            };
            stats.adherence_rate = stats.assigned_cars > 0 ? Math.round((stats.uploaded_videos / stats.assigned_cars) * 100) : 0;
            res.json(stats);
        } catch (err) {
            next(err);
        }
    });

    router.get('/video-assignments', async (req, res, next) => {
        try {
            const query = `
                SELECT 
                  ca.reg_no, ca.hub_location, cr.user_email as ground_worker, 
                  cr.submission_date, cr.audit_status, cr.id as report_id,
                  CASE WHEN cr.id IS NOT NULL THEN 'Uploaded' ELSE 'Pending' END as status
                FROM car_assignments ca
                JOIN hub_assignments ha ON ca.hub_location = (SELECT name FROM hubs WHERE id = ha.hub_id)
                LEFT JOIN cleaning_reports cr ON ca.reg_no = cr.reg_no AND ca.hub_location = cr.hub_location
                WHERE ha.user_id = $1 AND ha.role = 'yard_manager'
                ORDER BY cr.submission_date DESC, ca.assigned_at DESC`;
            const result = await pool.query(query, [req.session.userId]);
            res.json(result.rows);
        } catch (err) {
            next(err);
        }
    });

    router.get('/manager-videos', async (req, res, next) => {
        try {
            const query = `
                SELECT cr.id, cr.reg_no, cr.user_email as ground_worker, cr.submission_date, cr.audit_status, cr.audit_rating
                FROM cleaning_reports cr
                JOIN hub_assignments ha ON cr.hub_location = (SELECT name FROM hubs WHERE id = ha.hub_id)
                WHERE ha.user_id = $1 AND ha.role = 'yard_manager'
                ORDER BY cr.submission_date DESC`;
            const result = await pool.query(query, [req.session.userId]);
            res.json(result.rows);
        } catch (err) {
            next(err);
        }
    });

    return router;
};