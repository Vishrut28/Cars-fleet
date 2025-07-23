if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const { Pool } = require('pg');
const logger = require('./logger');

const app = express();
const port = process.env.PORT || 3000;

// All middleware MUST be defined before the routes
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));
app.use(express.json());
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Placeholder for the database pool
let pool;

// ** NEW HEALTH CHECK ROUTE **
// This is the first route defined. Railway will check this to see if the server is running.
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});


const requireAuth = (role = null) => (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    if (role && req.session.role !== role) {
        return res.status(403).json({ error: 'Forbidden. You do not have permission to access this resource.' });
    }
    next();
};

// Start the server IMMEDIATELY
app.listen(port, () => {
    logger.info(`🚀 Server listening on port ${port}. Initializing database connection...`);

    // NOW, create the database pool after the server is running
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });

    // Define and mount all other routes inside the listen callback
    const authRoutes = require('./routes/auth')(pool);
    const adminRoutes = require('./routes/admin')(pool);
    const auditorRoutes = require('./routes/auditor')(pool);
    const groundRoutes = require('./routes/ground')(pool);
    const yardRoutes = require('./routes/yard')(pool);
    const publicRoutes = require('./routes/public')(pool, requireAuth);

    app.use('/api/auth', authRoutes);
    app.use('/api/admin', requireAuth('admin'), adminRoutes);
    app.use('/api/auditor', requireAuth('auditor'), auditorRoutes);
    app.use('/api/ground', requireAuth('ground'), groundRoutes);
    app.use('/api/yard', requireAuth('yard_manager'), yardRoutes);
    app.use('/api', publicRoutes);

    // Central error handler must be defined LAST
    app.use((err, req, res, next) => {
        logger.error({ message: err.message, stack: err.stack, url: req.originalUrl });
        res.status(500).json({ error: 'An internal server error occurred.' });
    });

    logger.info('✅ Application is fully ready.');
});

process.on('SIGINT', async () => {
  if (pool) {
    logger.info('Closing database connection pool.');
    await pool.end();
  }
  process.exit(0);
});