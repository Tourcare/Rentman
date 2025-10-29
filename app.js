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


async function hubspotGetFromEndpoint(type, id) {
    let paramter = ""
    if (type === "0-3") {
        parameter = "?properties=dealname,usage_period,slut_projekt_period"
    }
    const url = `${HUBSPOT_ENDPOINT}${type}/${id}${parameter}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    return output
}


app.post("/hubspot", async (req, res) => {
    const event = req.body;
    console.log(event)
    if (event[0].subscriptionType === "object.creation") {
        console.log("Det er creation")
        if (event[0].objectTypeId === "0-3") {
            console.log("Det er deal")
            const deal = await hubspotGetFromEndpoint(event[0].objectTypeId, event[0].objectId);
            if (deal.properties.usage_period && deal.properties.slut_projekt_period) {
                console.log("Har en projektperiode!")
            } else {
                console.log("Mangler projektperiode!")
            }
        }
    } else if (event[0].subscriptionType === "object.propertyChange") {
        console.log("Det er change")
        if (event[0].objectTypeId === "0-3") {
            console.log("Det er deal")
            const deal = await hubspotGetFromEndpoint(event[0].objectTypeId, event[0].objectId);
            if (deal.properties.usage_period && deal.properties.slut_projekt_period) {
                console.log("Har en projektperiode!")
            } else {
                console.log("Mangler projektperiode!")
            }
        }
    }

    res.status(200).send("OK");
});

app.listen(8080, () => console.log("Webhook API kører på port 8080"));