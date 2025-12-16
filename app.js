const express = require("express");
const path = require("path");
const bodyParser = require('body-parser');
const session = require('express-session');

const app = express();
app.use(express.json());

const hubspotRouter = require('./webhooks/routes/hubspot')
const rentmanRouter = require('./webhooks/routes/rentman');
const logger = require("./logger");

app.use(bodyParser.json());
app.use(session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: true
}));

app.use(express.static(path.join(process.cwd(), "public")));

let USERS;
try {
    USERS = JSON.parse(process.env.USERS || '[]');
} catch (err) {
    console.error('Kunne ikke parse USERS fra .env:', err);
    USERS = [];
}

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const user = USERS.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: "Ugyldigt login" });
    req.session.user = { username };
    res.json({ success: true });
});

const authMiddleware = (req, res, next) => {
    if (req.session.user) return next();
    return res.redirect("/login.html");
};

app.get("/me", (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Ikke logget ind" });
    res.json({ username: req.session.user.username });
});

app.get("/", authMiddleware, (req, res) => {
    res.sendFile(path.join(process.cwd(), "protected", "index.html"));
});

app.use('/hubspot', hubspotRouter)
app.use('/rentman', rentmanRouter)

app.listen(8080, () => console.log("Webhook API kører på port 8080"));

