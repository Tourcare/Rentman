const dotenv = require('dotenv');

dotenv.config();

const HUBSPOT_TOKEN = process.env.HUBSPOT_API_TOKEN;
const HUBSPOT_ENDPOINT = "https://api.hubapi.com/crm/v3/objects/"
const HUBSPOT_ENDPOINT_v4 = "https://api.hubapi.com/crm/v4/objects/"

const RENTMAN_API_BASE = "https://api.rentman.net";
const RENTMAN_API_TOKEN = process.env.RENTMAN_ACCESS_TOKEN;

async function hubspotDealGetFromEndpoint(type, id) {
    let parameter = ""
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

    const text = await response.text();

    if (!response.ok) {
        if (text.includes('not found') || response.status === 404) {
            return false;
        }
        console.log(`HTTP error! status: ${response.status}, message: ${text}`);
        return false;
    }

    const output = JSON.parse(text);
    console.log(output);
    return output;
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

    const text = await response.text();

    if (!response.ok) {
        if (text.includes('not found') || response.status === 404) {
            return false;
        }
        console.log(`HTTP error! status: ${response.status}, message: ${text}`);
        return false;
    }

    const output = JSON.parse(text);
    console.log(output);
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
    console.log(output);
    return output;
}


module.exports = { hubspotDealGetFromEndpoint, rentmanPostRentalRequest, rentmanDelRentalRequest };