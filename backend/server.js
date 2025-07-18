if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const { Pool } = require('pg'); // PostgreSQL client
const logger = require('./logger');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', 
    httpOnly: true, 
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// PostgreSQL Database Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for cloud providers like Railway
  }
});

// Initialize database schema on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    logger.error('Error connecting to the database:', err);
  } else {
    logger.info(`✅ PostgreSQL Database connected at ${res.rows[0].now}`);
    require('./db-init')(pool);
  }
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

const authRoutes = require('./routes/auth')(pool);
const adminRoutes = require('./routes/admin')(pool);
const auditorRoutes = require('./routes/auditor')(pool);
const groundRoutes = require('./routes/ground')(pool);
const yardRoutes = require('./routes/yard')(pool);
const publicRoutes = require('./routes/public')(pool);

app.use('/api/auth', authRoutes);
app.use('/api/admin', requireAuth('admin'), adminRoutes);
app.use('/api/auditor', requireAuth('auditor'), auditorRoutes);
app.use('/api/ground', requireAuth('ground'), groundRoutes);
app.use('/api/yard', requireAuth('yard_manager'), yardRoutes);
app.use('/api', publicRoutes);

app.use((err, req, res, next) => {
    logger.error({ message: err.message, stack: err.stack, url: req.originalUrl });
    res.status(500).json({ error: 'An internal server error occurred.' });
});

app.listen(port, () => logger.info(`🚀 Server listening on port ${port}`));

process.on('SIGINT', async () => {
  logger.info('Closing database connection pool.');
  await pool.end();
  process.exit(0);
});