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

const router = express.Router();
router.use(express.json());

async function hubspotGetFromEndpoint(type, id) {
    let paramter = ""
    if (type === "0-3") {
        parameter = "?properties=dealname,usage_period,slut_projekt_period&associations=companies,contacts"
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



async function rentmanPostRentalRequest(data, contact) {
    const url = `${RENTMAN_API_BASE}/projectrequests`;

    let body;

    const end = new Date(data.properties.usage_period)
    const start = new Date(data.properties.slut_projekt_period)

    if (contact) {
        body = {
            "name": data.properties.dealname,
            "planperiod_end": end,
            "planperiod_start": start,
            "linked_contact": `/contacts/${contact}`
        }
    } else {
        body = {
            "name": data.properties.dealname,
            "planperiod_end": end,
            "planperiod_start": start
        }
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RENTMAN_API_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    console.log(output)
    return output
}

async function rentmanCheckRentalRequest(id) {
    const url = `${RENTMAN_API_BASE}/projectrequests/${id}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${RENTMAN_API_TOKEN}`,
            },
        });

        const text = await response.text();

        if (!response.ok) {
            // Tjek om det er en "not found"-fejl
            if (text.includes('not found') || response.status === 404) {
                return false;
            }
            throw new Error(`HTTP error! status: ${response.status}, message: ${text}`);
        }

        // Prøv at parse JSON
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }

    } catch (err) {
        console.error("Fejl ved check af RentalRequest:", err);
        throw err;
    }
}


// STATUS FRA I GÅR! DEN LOGGEDE IKKE NOGEN DEAL. TJEK EVT. ALLE BERAK; PUNKTER.

router.post("/", async (req, res) => {
    const events = req.body;
    let whatHappend = false;
    console.log(events)
    console.log("Hubspot webhook modtaget!")
    for (const event of events) {

        if (event.subscriptionType === "object.creation") {
            console.log("Oprettelse modtaget")
            if (event.objectTypeId === "0-3") { // DEAL OPRETTET
                const deal = await hubspotGetFromEndpoint(event.objectTypeId, event.objectId);
                console.log("Oprettelse af deal modtaget!")

                console.log(`Deal har navn: ${deal.properties.dealname}`)

                if (deal.properties.usage_period && deal.properties.slut_projekt_period) {
                    console.log(`${deal.properties.dealname} har en projektperiode`)
                    if (deal.associations.companies) {
                        console.log(`${deal.properties.dealname} har tilknyttet virksomhed`)

                        const results = deal.associations.companies.results
                        for (const result of results) {
                            if (result.type === "deal_to_company") {

                                if (whatHappend) { break; }

                                let [company] = await pool.execute('SELECT * FROM synced_companies WHERE hubspot_id = ?', [result.id])

                                if (!company[0]) {
                                    [company] = await pool.execute('SELECT * FROM synced_companies WHERE name = ?', ["Mangler Virksomhed"])
                                }

                                let rentman;
                                rentman = await rentmanPostRentalRequest(deal, company[0].rentman_id)

                                await pool.query(
                                    'INSERT INTO synced_request (rentman_request_id, hubspot_deal_id, synced_companies_id) VALUES (?, ?, ?)',
                                    [rentman.data.id, event.objectId, company[0].id]
                                );

                                whatHappend = true;
                                break;
                            }
                        }

                    }

                    if (!whatHappend) {
                        let rentman;
                        rentman = await rentmanPostRentalRequest(deal)

                        await pool.query(
                            'INSERT INTO synced_request (rentman_request_id, hubspot_deal_id) VALUES (?, ?)',
                            [rentman.data.id, event.objectId]
                        );
                        whatHappend = true;
                        break;

                    } else {
                        break;
                    }

                } else {
                    break;
                }

            } else {
                break;
            }


        } else if (event.subscriptionType === "object.propertyChange") {
            console.log("Det er change")
            if (event.objectTypeId === "0-3") {
                console.log("Det er deal")
                const deal = await hubspotGetFromEndpoint(event.objectTypeId, event.objectId);
                if (deal.properties.usage_period && deal.properties.slut_projekt_period) {
                    console.log("Har en projektperiode!")
                } else {
                    console.log("Mangler projektperiode!")
                }
            }
        }
    };


    res.status(200).send("OK");
});

module.exports = router