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

async function hubspotUpdateDeal(deal, hidden, startPlanning, slutPlanning) {
    let url = `${HUBSPOT_ENDPOINT}0-3/${deal}`
    const body = {
        properties: {
            hidden_rentman_request: hidden,
        }
    };

    if (startPlanning) body.properties.start_planning_period = startPlanning
    if (slutPlanning) body.properties.slut_planning_period = slutPlanning

    if (hidden) body.properties.opret_i_rentam_request = "Ja"
    if (!hidden) body.properties.opret_i_rentam_request = "Nej"

    const response = await fetch(url, {
        method: "PATCH",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        console.warn(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

}

async function hubspotUpdateRentmanLink(deal, rentmanid, type) {
    let url = `${HUBSPOT_ENDPOINT}0-3/${deal}`
    let link
    if (type == "request") link = `https://tourcare2.rentmanapp.com/#/requests/${rentmanid}/details`

    const body = {
        properties: {
            rentman_projekt: link,
        }
    };

    const response = await fetch(url, {
        method: "PATCH",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        console.warn(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

}

async function rentmanPostRentalRequest(data, contact) {
    const url = `${RENTMAN_API_BASE}/projectrequests`;

    function previousWeekday(date) {
        const d = new Date(date);
        do {
            d.setDate(d.getDate() - 1);
        } while (d.getDay() === 0 || d.getDay() === 6);

        d.setHours(13, 0, 0, 0); // 14:00
        return d;
    }

    function nextWeekday(date) {
        const d = new Date(date);
        do {
            d.setDate(d.getDate() + 1);
        } while (d.getDay() === 0 || d.getDay() === 6);

        d.setHours(11, 0, 0, 0); // 12:00
        return d;
    }

    const start = new Date(data.properties.usage_period);
    const end = new Date(data.properties.slut_projekt_period);

    const planningPeriodStart = previousWeekday(start);
    const planningPeriodEnd = nextWeekday(end);

    const body = {
        name: data.properties.dealname,
        usageperiod_end: end,
        usageperiod_start: start,
        planperiod_end: planningPeriodEnd,
        planperiod_start: planningPeriodStart,
    };


    if (contact) body.linked_contact = `/contacts/${contact}`

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

    const output = {
        rentman: JSON.parse(text),
        startPeriod: planningPeriodStart,
        slutPeriod: planningPeriodEnd
    }

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

async function objectCreation(event) {
    const deal = await hubspotDealGetFromEndpoint(event.objectTypeId, event.objectId);
    if (!deal) return true;

    console.log(`Deal har navn: ${deal.properties.dealname}`);
    await hubspotUpdateDeal(deal.id, true)

    if (deal.properties.usage_period && deal.properties.slut_projekt_period) {
        console.log(`${deal.properties.dealname} har en projektperiode`);
        let whatHappened = false;

        if (deal?.associations?.companies) {
            console.log(`${deal.properties.dealname} har tilknyttet virksomhed`);

            const results = deal.associations.companies.results;
            for (const result of results) {
                if (result.type === "deal_to_company") {
                    if (whatHappened) return false;

                    let [company] = await pool.execute('SELECT * FROM synced_companies WHERE hubspot_id = ?', [result.id]);

                    if (!company[0]) {
                        [company] = await pool.execute('SELECT * FROM synced_companies WHERE name = ?', ["Mangler Virksomhed"]);
                    }

                    const requestData = await rentmanPostRentalRequest(deal, company[0]?.rentman_id);
                    if (!requestData) return false;

                    const rentman = requestData.rentman

                    await hubspotUpdateDeal(deal.id, true, requestData.startPeriod, requestData.slutPeriod)
                    await hubspotUpdateRentmanLink(deal.id, rentman.data.id, "request")
                    await pool.query(
                        'INSERT INTO synced_request (rentman_request_id, hubspot_deal_id, synced_companies_id) VALUES (?, ?, ?)',
                        [rentman.data.id, event.objectId, company[0]?.id]
                    );

                    return false;
                }
            }
        } else {
            const requestData = await rentmanPostRentalRequest(deal);
            if (!requestData) return false;
            const rentman = requestData.rentman
            await hubspotUpdateDeal(deal.id, true, requestData.startPeriod, requestData.slutPeriod)
            await pool.query(
                'INSERT INTO synced_request (rentman_request_id, hubspot_deal_id) VALUES (?, ?)',
                [rentman.data.id, event.objectId]
            );
        }
    }
}

async function handleHubSpotDealWebhook(events) {
    for (const event of events) {
        if (event.changeSource === "INTEGRATION") continue;

        if (event.subscriptionType === "object.creation") {
            console.log("Oprettelse af deal modtaget");
            const statusObject = await objectCreation(event)
            if (statusObject) continue;
            if (!statusObject) break;

        } else if (event.subscriptionType === "object.propertyChange") {
            // Håndter property ændringer hvis nødvendigt
            if (event.propertyName === "opret_i_rentam_request") {
                if (event.propertyValue === "Prøv Igen") {

                    const [request] = await pool.execute('SELECT * FROM synced_request WHERE hubspot_deal_id = ?', [event.objectId]);
                    const [deal] = await pool.execute('SELECT * FROM synced_deals WHERE hubspot_project_id = ?', [event.objectId]);
                    if (!request[0]?.rentman_request_id && !deal[0]?.id) {
                        const statusObject = await objectCreation(event)
                        if (statusObject) continue;
                        if (!statusObject) break;
                    } else {
                        await hubspotUpdateDeal(event.objectId, true)
                    }


                }
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