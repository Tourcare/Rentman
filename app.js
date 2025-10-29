const express = require("express");
const { text } = require('body-parser');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config();

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
};

const pool = mysql.createPool(dbConfig);

const HUBSPOT_TOKEN = process.env.HUBSPOT_API_TOKEN;
const HUBSPOT_ENDPOINT = "https://api.hubapi.com/crm/v3/objects/"
const HUBSPOT_ENDPOINT_v4 = "https://api.hubapi.com/crm/v4/objects/"

const RENTMAN_API_BASE = "https://api.rentman.net";
const RENTMAN_API_TOKEN = process.env.RENTMAN_ACCESS_TOKEN;

const app = express();
app.use(express.json());

app.post("/", async (req, res) => {
    const event = req.body;
    console.log("Webhook modtaget:", event);

    res.status(200).send("OK");
});

const hubspotRouter = require('./routes/hubspot')

app.use('/hubspot', hubspotRouter)

app.listen(8080, () => console.log("Webhook API kører på port 8080"));