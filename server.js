const path = require("path");
const dns = require("node:dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const crypto = require("crypto");

const Url = require("./models/Url");

const app = express();
const projectDir = process.env.NETLIFY
    ? path.resolve(__dirname, "../..")
    : __dirname;

app.set("views", path.join(projectDir, "views"));
app.use(express.static(path.join(projectDir, "public")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Connect to MongoDB
async function connectDB() {
    if (mongoose.connection.readyState === 1) {
        return;
    }

    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is missing from environment variables");
    }

    await mongoose.connect(process.env.MONGO_URI);
}

// Homepage
app.get("/", (req, res) => {
    res.render("index");
});

// Shorten a URL
app.post("/shorten", async (req, res) => {
    try {
        await connectDB();

        const originalUrl = req.body.originalUrl;

        if (!originalUrl) {
            return res.status(400).send("Please enter a URL.");
        }

        let parsedUrl;

        try {
            parsedUrl = new URL(originalUrl);
        } catch {
            return res.status(400).send("Please enter a valid URL.");
        }

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            return res.status(400).send("Only HTTP and HTTPS URLs are allowed.");
        }

        // Generate a unique short code
        let shortCode;
        let existingUrl;

        do {
            shortCode = crypto.randomBytes(5).toString("hex");

            existingUrl = await Url.findOne({ shortCode });
        } while (existingUrl);

        const newUrl = new Url({
            originalUrl: parsedUrl.href,
            shortCode
        });

        await newUrl.save();

        // Use the configured public domain when deployed
        const siteUrl = (
            process.env.SITE_URL ||
            `${req.protocol}://${req.get("host")}`
        ).replace(/\/$/, "");

        const shortUrl = `${siteUrl}/${shortCode}`;

        res.render("result", {
            shortUrl,
            originalUrl: parsedUrl.href
        });

    } catch (error) {
        console.error("URL shortening error:", error);
        res.status(500).send("Something went wrong while shortening your URL.");
    }
});

// Redirect using a short code
app.get("/:shortCode", async (req, res) => {
    try {
        await connectDB();

        const url = await Url.findOne({
            shortCode: req.params.shortCode
        });

        if (!url) {
            return res.status(404).send("Short link not found.");
        }

        url.clicks += 1;
        await url.save();

        res.redirect(url.originalUrl);

    } catch (error) {
        console.error("Redirect error:", error);
        res.status(500).send("Unable to open this short link.");
    }
});

module.exports = app;

// Local development server
if (require.main === module) {
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log(`TheBuild Link running at http://localhost:${PORT}`);
    });
}
