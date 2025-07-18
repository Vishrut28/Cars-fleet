const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const router = express.Router();

const CLIENT_ID = '284150378430-p1c7c213dtj12mnmmmr349i7m0mievlj.apps.googleusercontent.com';
const client = new OAuth2Client(CLIENT_ID);

module.exports = (pool) => {
    router.post('/google-auth', async (req, res, next) => {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'No token provided' });
        try {
            const ticket = await client.verifyIdToken({ idToken: token, audience: CLIENT_ID });
            const { email } = ticket.getPayload();
            
            let result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            let user = result.rows[0];
            let role = 'ground';

            if (!user) {
                result = await pool.query('INSERT INTO users (email, role) VALUES ($1, $2) RETURNING *', [email, role]);
                user = result.rows[0];
            }
            
            role = user.role;
            req.session.userId = user.id;
            req.session.email = email;
            req.session.role = role;
            res.json({ role });

        } catch (e) {
            next(e);
        }
    });

    router.get('/user-info', (req, res) => {
        if (req.session && req.session.userId) {
            res.json({ email: req.session.email, role: req.session.role });
        } else {
            res.status(401).json({ error: 'Not authenticated' });
        }
    });

    router.post('/logout', (req, res) => {
        req.session.destroy((err) => {
            if (err) return res.status(500).json({ error: 'Could not log out.' });
            res.clearCookie('connect.sid').json({ message: 'Logged out successfully' });
        });
    });

    return router;
};