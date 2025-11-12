// hubspot-deal.js
const dotenv = require('dotenv');

const pool = require('../../db');

const HUBSPOT_TOKEN = process.env.HUBSPOT_API_TOKEN;
const HUBSPOT_ENDPOINT = "https://api.hubapi.com/crm/v3/objects/";

const RENTMAN_API_BASE = "https://api.rentman.net";
const RENTMAN_API_TOKEN = process.env.RENTMAN_ACCESS_TOKEN;

async function hubspotDealGetFromEndpoint(type, id) {
    let parameter = "";
    if (type === "0-3") {
        parameter = "?properties=dealname,usage_period,slut_projekt_period&associations=companies,contacts";
    }
    const url = `${HUBSPOT_ENDPOINT}${type}/${id}${parameter}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
        }
    });

    const text = await response.text();

    if (!response.ok) {
        if (text.includes('not found') || response.status === 404) {
            return false;
        }
        console.log(`HTTP error! status: ${response.status}, message: ${text}`);
        return false;
    }

    const output = JSON.parse(text);
    return output;
}

async function rentmanPostRentalRequest(data, contact) {
    const url = `${RENTMAN_API_BASE}/projectrequests`;

    let body;

    const start = new Date(data.properties.usage_period);
    const end = new Date(data.properties.slut_projekt_period);

    if (contact) {
        body = {
            "name": data.properties.dealname,
            "planperiod_end": end,
            "planperiod_start": start,
            "linked_contact": `/contacts/${contact}`
        };
    } else {
        body = {
            "name": data.properties.dealname,
            "planperiod_end": end,
            "planperiod_start": start
        };
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

    const text = await response.text();

    if (!response.ok) {
        if (text.includes('not found') || response.status === 404) {
            return false;
        }
        console.log(`HTTP error! status: ${response.status}, message: ${text}`);
        return false;
    }

    const output = JSON.parse(text);
    return output;
}

async function rentmanDelRentalRequest(id) {
    const url = `${RENTMAN_API_BASE}/projectrequests/${id}`;

    const response = await fetch(url, {
        method: 'DELETE',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RENTMAN_API_TOKEN}`,
        }
    });

    const text = await response.text();

    if (!response.ok) {
        if (text.includes('not found') || response.status === 404) {
            return false;
        }
        console.log(`HTTP error! status: ${response.status}, message: ${text}`);
    }

    const output = JSON.parse(text);
    return output;
}

async function handleHubSpotDealWebhook(events) {
    for (const event of events) {
        if (event.changeSource === "INTEGRATION") continue;

        if (event.subscriptionType === "object.creation") {
            console.log("Oprettelse af deal modtaget");
            const deal = await hubspotDealGetFromEndpoint(event.objectTypeId, event.objectId);
            if (!deal) continue;

            console.log(`Deal har navn: ${deal.properties.dealname}`);

            if (deal.properties.usage_period && deal.properties.slut_projekt_period) {
                console.log(`${deal.properties.dealname} har en projektperiode`);
                let whatHappened = false;

                if (deal.associations.companies) {
                    console.log(`${deal.properties.dealname} har tilknyttet virksomhed`);

                    const results = deal.associations.companies.results;
                    for (const result of results) {
                        if (result.type === "deal_to_company") {
                            if (whatHappened) break;

                            let [company] = await pool.execute('SELECT * FROM synced_companies WHERE hubspot_id = ?', [result.id]);

                            if (!company[0]) {
                                [company] = await pool.execute('SELECT * FROM synced_companies WHERE name = ?', ["Mangler Virksomhed"]);
                            }

                            const rentman = await rentmanPostRentalRequest(deal, company[0]?.rentman_id);
                            if (!rentman) break;

                            await pool.query(
                                'INSERT INTO synced_request (rentman_request_id, hubspot_deal_id, synced_companies_id) VALUES (?, ?, ?)',
                                [rentman.data.id, event.objectId, company[0]?.id]
                            );

                            whatHappened = true;
                            break;
                        }
                    }
                }

                if (!whatHappened) {
                    const rentman = await rentmanPostRentalRequest(deal);
                    await pool.query(
                        'INSERT INTO synced_request (rentman_request_id, hubspot_deal_id) VALUES (?, ?)',
                        [rentman.data.id, event.objectId]
                    );
                }
            }

        } else if (event.subscriptionType === "object.propertyChange") {
            // Håndter property ændringer hvis nødvendigt
            if (event.propertyName === "slut_projekt_period") {
                // Implementer opdatering hvis krævet
            }

        } else if (event.subscriptionType === "object.deletion") {
            console.log("Sletning af deal modtaget");

            const [request] = await pool.execute('SELECT * FROM synced_request WHERE hubspot_deal_id = ?', [event.objectId]);

            if (request[0]?.rentman_request_id) {
                await rentmanDelRentalRequest(request[0].rentman_request_id);
                console.log("Rental request slettet");
            } else {
                console.log("Kunne ikke finde rental request i Rentman");
            }
        }
    }
}

module.exports = { handleHubSpotDealWebhook, hubspotDealGetFromEndpoint, rentmanPostRentalRequest, rentmanDelRentalRequest };