const express = require('express');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const db = {
    execute: async (query, params = []) => {
        let index = 1;
        const formattedQuery = query.replace(/\?/g, () => `$${index++}`);
        const result = await pool.query(formattedQuery, params);
        return [result.rows, result];
    }
};
// --- EMAIL SETUP ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'jnw2024@jagmail.southalabama.edu',
        pass: 'fsdl fljb nsda qwzk'
    }
});

const signup = async (req, res) => {
    try {
        const { fullName, email, password, role, clubName, category, description, sponsor, moderator } = req.body;

        const [rows] = await db.execute(
            'INSERT INTO users (full_name, email, password_hash, user_role) VALUES (?, ?, ?, ?) RETURNING user_id',
            [fullName || "Unknown", email, password, role]
        );

        const userId = rows[0].user_id;

        if (role === 'club_admin') {
            await db.execute(
                `INSERT INTO clubs 
                (admin_id, club_name, category, club_description, faculty_sponsor, moderator_name, is_approved) 
                VALUES (?, ?, ?, ?, ?, ?, 0)`,
                [userId, clubName || "Unnamed Club", category || "General", description || "", sponsor || "", moderator || ""]
            );

            // Send notification to Super Admin
            const mailOptions = {
                from: '"Let\'s Connect System" <jnw2024@jagmail.southalabama.edu>',
                to: 'jnw2024@jagmail.southalabama.edu',
                subject: 'New Club Request: ' + clubName,
                text: `A new club is waiting for your approval.\n\nClub: ${clubName}\nSponsor: ${sponsor}\nModerator: ${moderator}`
            };
            transporter.sendMail(mailOptions);

            return res.send(`<script>alert("Request submitted! Pending approval."); window.location.href = "/login.html";</script>`);
        }

        res.send(`<script>alert("Student account created!"); window.location.href = "/login.html";</script>`);
    } catch (error) {
        console.error("Signup Error:", error);
        res.status(500).send("Registration failed.");
    }
};

const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);

        if (users.length === 0 || users[0].password_hash !== password) {
            return res.status(401).json({ success: false, message: "Invalid credentials." });
        }

        const user = users[0];

        if (user.user_role === 'club_admin') {
            const [clubStatus] = await db.execute('SELECT is_approved FROM clubs WHERE admin_id = ?', [user.user_id]);
            if (clubStatus.length > 0 && clubStatus[0].is_approved === 0) {
                return res.status(403).json({ success: false, message: "Club pending approval." });
            }
        }

        req.session.user = { id: user.user_id, user_role: user.user_role, email: user.email, full_name: user.full_name };

        let path = '/';
        if (user.user_role === 'club_admin') path = '/club/dashboard';
        if (user.user_role === 'super_admin') path = '/admin/dashboard';

        res.json({ success: true, redirectUrl: path });
    } catch (error) {
        res.status(500).json({ success: false });
    }
};
const multer = require('multer');
const fs = require('fs');

const uploadDir = './public/uploads';
if(!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage});

const app = express();

//--- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: 'south-alabama-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000} // 24 hours
}));

app.set('view engine', 'ejs');

const checkSuperAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.user_role === 'super_admin') {
        next();
    } else {
        res.status(403).send("Access Denied: You are not the Creator.");
    }
};

// --- Routes --

// Signup (authController.js)
app.post('/signup', signup);
app.post('/login', login);

// Super Admin Dashboard (EJS)
app.get('/admin/dashboard', checkSuperAdmin, async (req, res) => {
    try {
        const [pendingClubs] = await db.execute(
            'SELECT * FROM clubs WHERE is_approved = 0'
        );
        res.render('superadmin_dashboard', { clubs: pendingClubs });
    } catch (error) {
        res.status(500).send("Error loading dashboard.");
    }
});

// Approve Club Action
app.post('/admin/approve/:id', checkSuperAdmin, async (req,res) => {
    try {
        const [rows] = await db.execute(`
            SELECT u.email, c.club_name
            FROM clubs c
            JOIN users u ON c.admin_id = u.user_id
            WHERE c.club_id = ?`,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).send("Club or Admin not found.");
        }

        const adminEmail = rows[0].email;
        const clubName = rows[0].club_name;

        await db.execute('UPDATE clubs SET is_approved = 1 WHERE club_id = ?', [req.params.id]);

        const mailOptions = {
            from: 'jnw2024@jagmail.southalabama.edu',
            to: adminEmail,
            subject: `Approved: ${clubName} is now live!`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #bf0028;">
                    <h2 style="color: #bf0028;">Welcome to Let's Connect!</h2>
                    <p>Your club <strong>${clubName}</strong> has been approved by the Super Admin.</p>
                    <p>You can now log in to your dashboard to share updates with students.</p>
                    <br>
                    <a href="/login.html"
                        style="background: #bf0028; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                        Login to Dashboard
                    </a>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);

        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error("Approval/Email Error:", error);
        res.status(500).send("Approval failed.");
    }
});

// Deny Club Action
app.post('/admin/deny/:id', checkSuperAdmin, async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT u.email, c.club_name
            FROM clubs c
            JOIN users ON c.admin_id = u.user_id
            WHERE c.club_id = ?`,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).send("Club not found.");
        }

        const adminEmail = rows[0].email;
        const clubName = rows[0].club_name;

        await db.execute('DELETE FROM clubs WHERE club_id = ?', [req.params.id]);

        const mailOptions = {
            from: 'jnw2024@jagmail.southalabama.edu',
            to: adminEmail,
            subject: `Update regarding your club request: ${clubName}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #333;">
                    <h2 style="color: #333;">Club Registration Update</h2>
                    <p>Thank you for your interest in Jags Connect.</p>
                    <p>Unfortunately, your request to register the club <strong>${clubName}</strong> has been declined at this time.</p>
                    <p>If you have questions, please contact the Student Activities office.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);

        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error("Denial Error:", error);
        res.status(500).send("Failed to deny club.");
    }
});

// Home Feed
app.get('/', async (req, res) => {
    try{
        const userId = req.session.user ? req.session.user.id : null;
        let posts;

        if (userId) {
            [posts] = await db.execute(`
                SELECT p.*, c.club_name, c.category, c.admin_id,
                (SELECT COUNT(*) FROM post_likes WHERE post_id = p.post_id) AS like_count,
                IF(m.user_id IS NOT NULL, 1, 0) AS is_connected
                FROM posts p
                JOIN clubs c ON p.club_id = c.club_id
                LEFT JOIN memberships m ON p.club_id = m.club_id AND m.user_id = ?
                WHERE c.is_approved = 1
                ORDER BY is_connected DESC, p.created_at DESC
            `, [userId]);
        } else {
            // Guest Feed: Default View
            [posts] = await db.execute(`
                SELECT p.*, c.club_name, c.category, c.admin_id,
                (SELECT COUNT(*) FROM post_likes WHERE post_id = p.post_id) AS like_count,
                0 AS is_connected
                FROM posts p
                JOIN clubs c ON p.club_id = c.club_id
                WHERE c.is_approved = 1
                ORDER BY p.created_at DESC
            `);
        }

        const [allComments] = await db.execute(`
            SELECT c.*, u.full_name
            FROM comments c
            JOIN users u ON c.user_id = u.user_id
            ORDER BY c.created_at ASC
        `);

        res.render('index', {
            posts: posts,
            comments: allComments,
            user: req.session.user || null
        });
    } catch (error) {
        console.error("Error fetching feed:", error);
        res.render('index', { posts: [], comments: [], user: null });
    }
});

// Club Admin Dashboard
app.get('/club/dashboard', async (req, res) => {
    if (!req.session.user || req.session.user.user_role !== 'club_admin') {
        return res.redirect('/login.html');
    }

    try {
        const [clubs] = await db.execute(
            'SELECT * FROM clubs WHERE admin_id = ?',
            [req.session.user.id]
        );

        if (clubs.length === 0){
            return res.send("Club not found or pending approval.");
        }

        const myClub = clubs[0];

        const [connections] = await db.execute(`
            SELECT u.full_name, u.email
            FROM users u
            JOIN memberships m ON u.user_id = m.user_id
            WHERE m.club_id = ?`,
            [myClub.club_id]
        );

        const [myPosts] = await db.execute(
            'SELECT * FROM posts WHERE club_id = ? ORDER BY created_at DESC',
            [myClub.club_id]
        );

        res.render('club_dashboard', {
            club: myClub,
            connections: connections,
            posts: myPosts,
            user: req.session.user
        });

    } catch (error) {
        console.error("Dashboard Error:", error);
        res.status(500).send("Error loading dashboard.");
    }
});

// Delete a post
app.post('/club/post/delete/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "Please log in." });
    }

    const postId = req.params.id;
    const userId = req.session.user.id;
    const userRole = req.session.user.user_role;

    try {
        let query;
        let params;

        if (userRole === 'super_admin') {
            query = `DELETE FROM posts WHERE post_id = ?`;
            params = [postId];
        } else {
            query = `
                DELETE p FROM posts p
                JOIN clubs c ON p.club_id = c.club_id
                WHERE p.post_id = ? AND c.admin_id = ?`;
                params = [postId, userId, userId];
        }

        const [result] = await db.execute(query, params);

        if (result.affectedRows > 0) {
            res.json({ success: true, message: "Post deleted successfully." });
        } else {
            res.status(403).json({ success: false, message: "You do not have persmission to delete this post." });
        }
    } catch (error) {
        console.error("Delete Error:", error);
        res.status(500).json({ success: false });
    }
});

// Edit a post
app.post('/club/post/edit/:id', async (req, res) => {
    if (!req.session.user || req.session.user.user_role !== 'club_admin') return res.status(403).json({success: false});

    try {
        const { content } = req.body;
        await db.execute(`
            UPDATE posts p
            JOIN clubs c ON p.club_id = c.club_id
            SET p.content = ?
            WHERE p.post_id = ? AND c.admin_id = ?`,
            [content, req.params.id, req.session.user.id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// Posts
app.post('/club/post', upload.single('image'), async (req, res) => {
    if (!req.session.user || req.session.user.user_role !== 'club_admin') {
        return res.status(403).send("Unauthorized");
    }

    try {
        const { content } = req.body;
        const userId = req.session.user.id;

        const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

        const [clubs] = await db.execute('SELECT club_id FROM clubs WHERE admin_id = ?', [userId]);

        if (clubs.length > 0) {
            await db.execute(
                'INSERT INTO posts (club_id, content, image_url, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                [clubs[0].club_id, content, imageUrl]
            );

            res.send(`
                <script>
                    alert("Update posted successfully!");
                    window.location.href = "/club/dashboard";
                </script>
            `);
        }
    } catch (error) {
        console.error("Posting Error:", error);
        res.status(500).send("Failed to share update.");
    }
});

//Connect button
app.post('/club/connect/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "Please log in to connect with clubs!" });
    }

    const studentId = req.session.user.id;
    const clubId = req.params.id;

    try {
        await db.execute(
            'INSERT INTO memberships (user_id, club_id) VALUES(?, ?)',
            [studentId, clubId]
        );

        res.json({ success: true, message: "You are now connected! The club admin can now see your interest." });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json ({ success: false, message: "You are already connected to this club." });
        }
        console.error("Connection Error:", error);
        res.status(500).json({ success: false, message: "Failed to connect." });
    }
});

//Unconnect feature
app.post('/club/unconnect/:id', async(req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "Please log in first!" });
    }

    const studentId = req.session.user.id;
    const clubId = req.params.id;

    try {
        const [result] = await db.execute(
            'DELETE FROM memberships WHERE user_id = ? AND club_id = ?',
            [studentId, clubId]
        );

        if (result.affectedRows > 0) {
            res.json({ success: true, message: "Disconnected successfully." });
        } else {
            res.status(404).json({ success: false, message: "Connection not found." });
        }
    } catch (error) {
        console.error("Unconnect Error:", error);
        res.status(500).json({ success: false, message: "Failed to disconnect." });
    }
});

//Like button
app.post('/post/like/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "Log in to like posts!" });
    }

    const postId = req.params.id;
    const userId = req.session.user.id;

    try {
        const [existing] = await db.execute(
            'SELECT * FROM post_likes WHERE post_id = ? AND user_id = ?',
            [postId, userId]
        );

        if (existing.length > 0) {
            //Unlike
            await db.execute('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, userId]);
            res.json({ success: true, liked: false });
        } else {
            //Like
            await db.execute('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', [postId, userId]);
            res.json({ success: true, liked: true });
        }
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// Comment Section
app.post('/post/comment/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "Login to comment!" });
    }

    const { content } = req.body;
    const postId = req.params.id;
    const userId = req.session.user.id;

    try {
        await db.execute(
            'INSERT INTO comments (post_id, user_id, content) VALUES(?, ?, ?)',
            [postId, userId, content]
        );
        res.json({ success: true, message: "Comment added!" });
    } catch (error) {
        console.error("Comment Error:", error);
        res.status(500).json({ success: false });
    }
});

// Transfering the club admin role to another student
app.post('/club/transfer-ownership', async (req, res) => {
    const { newAdminEmail } = req.body;
    const currentAdminId = req.session.user.id;

    if (!newAdminEmail) return res.status(400).json({ success: false, message: "Email is required." });

    try {
        // This will find the student by email
        const [users] = await db.execute('SELECT user_id, user_role FROM users WHERE email = ?', [newAdminEmail]);

        if (users.length === 0) {
            return res.json({ success: false, message: "No student found with that email." });
        }

        const newAdminId = users[0].user_id;

        const [clubs] = await db.execute('SELECT club_id FROM clubs WHERE admin_id = ?', [currentAdminId]);

        if (clubs.length === 0) {
            return res.json({ success: false, message: "Transfer failed. You don't appear to own an approved club." });
        }

        const clubId = clubs[0].club_id;

        // Now it is time update the club to the new owner
        const [membership] = await db.execute(
            'SELECT * FROM memberships WHERE user_id = ? AND club_id = ?',
            [newAdminId, clubId]
        );

        if (membership.length === 0) {
            return res.json({ 
                success: false,
                message: "Transfer Denied: The new admin must be a connected member of this club first."
            });
        }

        const [result] = await db.execute(
            'UPDATE clubs SET admin_id = ? WHERE club_id = ?',
            [newAdminId, clubId]
        );

        if (result.affectedRows > 0) {
            await db.execute('UPDATE users SET user_role = "club_admin" WHERE user_id = ?', [newAdminId]);

            await db.execute('UPDATE users SET user_role = "student" WHERE user_id = ?', [currentAdminId]);

            req.session.destroy();
            return res.json({ success: true, message: "Transfer complete! You have been logged out." });
        } else {
            return res.json({ success: false, message: "Transfer failed. Do you own a club?" });
        }
    } catch (error) {
        console.error("Transfer Error:", error);
        res.status(500).json({ success: false, message: "Server error during transfer." });
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login.html');
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Let's lock in twin!`);
});
