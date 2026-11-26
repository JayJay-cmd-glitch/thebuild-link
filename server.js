const fs = require("fs");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");

require("dotenv").config();

const Url = require("./models/Url");
const app = express();

// When Netlify bundles this file into netlify/functions/api.js, __dirname
// points at the functions folder, while `included_files` (views/**, public/**)
// are placed at the function's task root. Resolve the folder that actually exists.
function resolveDir(name) {
    const candidates = [
        path.join(__dirname, name),
        path.join(__dirname, "..", "..", name),
        process.env.LAMBDA_TASK_ROOT && path.join(process.env.LAMBDA_TASK_ROOT, name),
        path.join(process.cwd(), name)
    ].filter(Boolean);

    return candidates.find((dir) => fs.existsSync(dir)) || candidates[0];
}

app.set("view engine", "ejs");
app.set("views", resolveDir("views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(resolveDir("public")));

// Reuse one MongoDB connection across warm Netlify function invocations.
let dbConnectionPromise = null;

async function connectDB() {
    if (mongoose.connection.readyState === 1) return;

    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is missing from environment variables");
    }

    if (!dbConnectionPromise) {
        dbConnectionPromise = mongoose.connect(process.env.MONGO_URI, {
            // Small pool is appropriate for a low-traffic serverless app.
            maxPoolSize: 5,
            minPoolSize: 0,
            maxIdleTimeMS: 20000,
            // Fail before Netlify's 30-second function limit.
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000
        }).catch((error) => {
            dbConnectionPromise = null;
            throw error;
        });
    }

    await dbConnectionPromise;
}

// Serve the homepage without waiting for MongoDB.
// This keeps the public site available even while the database is reconnecting.
app.get("/", (req, res) => {
    res.render("index");
});

app.post("/shorten", async (req, res) => {
    try {
        await connectDB();

        let originalUrl = req.body.originalUrl;
        if (!originalUrl) {
            return res.status(400).send("Please enter a URL.");
        }

        originalUrl = originalUrl.trim();

        let parsedUrl;
        try {
            parsedUrl = new URL(originalUrl);
        } catch {
            return res.status(400).send("Please enter a valid URL.");
        }

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            return res.status(400).send("Only HTTP and HTTPS URLs are allowed.");
        }

        const shortCode = crypto.randomBytes(5).toString("hex");
        await new Url({ originalUrl, shortCode }).save();

        const siteUrl = (
            process.env.SITE_URL || `${req.protocol}://${req.get("host")}`
        ).replace(/\/$/, "");

        res.render("result", {
            originalUrl,
            shortUrl: `${siteUrl}/${shortCode}`,
            shortCode
        });
    } catch (error) {
        console.error("URL shortening error:", error);
        res.status(503).send("The database is temporarily unavailable. Please try again shortly.");
    }
});

app.get("/:shortCode", async (req, res) => {
    try {
        await connectDB();

        const url = await Url.findOne({ shortCode: req.params.shortCode });
        if (!url) {
            return res.status(404).send("Shortened URL not found.");
        }

        url.clicks += 1;
        await url.save();
        return res.redirect(url.originalUrl);
    } catch (error) {
        console.error("Redirect error:", error);
        return res.status(503).send("The database is temporarily unavailable. Please try again shortly.");
    }
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    connectDB()
        .then(() => {
            app.listen(PORT, () => {
                console.log(`TheBuild Link running on port ${PORT}`);
            });
        })
        .catch((error) => {
            console.error("MongoDB connection error:", error);
            process.exit(1);
        });
}
