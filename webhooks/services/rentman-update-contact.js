const pool = require('../../db');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config();

const HUBSPOT_TOKEN = process.env.HUBSPOT_API_TOKEN;
const HUBSPOT_ENDPOINT = "https://api.hubapi.com/crm/v3/objects/";
const HUBSPOT_ENDPOINT_v4 = "https://api.hubapi.com/crm/v4/objects/";

const RENTMAN_API_BASE = "https://api.rentman.net";
const RENTMAN_API_TOKEN = process.env.RENTMAN_ACCESS_TOKEN;

// Hjælpefunktion til at hente fra Rentman
async function rentmanGetFromEndpoint(endpoint) {
    const url = `${RENTMAN_API_BASE}${endpoint}`;
    const response = await fetch(url, {
        headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${RENTMAN_API_TOKEN}`,
        },
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error fra Rentman: ${response.status}, ${errText}`);
    }

    const output = await response.json();
    return output.data; // Returnerer kun data
}

// Opret virksomhed i HubSpot
async function hubspotCreateCompany(data) {
    const url = `${HUBSPOT_ENDPOINT}companies`;
    const body = {
        "properties": {
            name: data.displayname,
            cvrnummer: data.VAT_code,
            type: "Andet"
        }
    };
    const response = await fetch(url, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        let errJson;

        try {
            errJson = JSON.parse(errText);
        } catch (e) {
            errJson = null;
        }

        if (response.status === 400 && errJson?.category === "VALIDATION_ERROR") {
            const match = errJson.message.match(/(\d+) already has that value/);
            if (match) {
                const existingCompanyId = match[1];
                console.log(`Virksomhed med ID ${existingCompanyId} har allerede denne værdi.`);
                return existingCompanyId;
            } else {
                console.warn("Kunne ikke finde eksisterende virksomhed ID i fejlmeddelelsen:", errJson.message);
            }
        } else {
            throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
        }
    }

    const output = await response.json();
    return output.id;
}

// Link kontakt til virksomhed i HubSpot
async function hubspotLinkContact(contact, company) {
    const url = `${HUBSPOT_ENDPOINT_v4}contacts/${contact}/associations/companies/${company}`;
    const body = [{
        "associationCategory": "HUBSPOT_DEFINED",
        "associationTypeId": 1
    }];
    const response = await fetch(url, {
        method: "PUT",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    return true;
}

// Opret kontaktperson i HubSpot
async function hubspotCreateContact(data, companyID) {
    const url = `${HUBSPOT_ENDPOINT}contacts`;
    let email = data.email ? data.email.trim().replace(/\s+/g, '') : '';
    if (email) {
        const [localPart, domainPart] = email.split('@');
        if (domainPart && !/\.[a-zA-Z]{2,}$/.test(domainPart)) {
            email = `${localPart}@${domainPart}.dk`;
        }
    }

    const body = {
        "properties": {
            email: email,
            lastname: `${data.firstname || ''}`,
            firstname: `${data.lastname || ''}`
        },
        "associations": [{
            "to": {
                "id": companyID.toString()
            },
            "types": [{
                "associationCategory": "HUBSPOT_DEFINED",
                "associationTypeId": 1
            }]
        }]
    };
    const response = await fetch(url, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        let errJson;

        try {
            errJson = JSON.parse(errText);
        } catch (e) {
            errJson = null;
        }

        if (response.status === 409 && errJson) {
            const match = errJson.message.match(/Existing ID:\s*(\d+)/);
            if (match) {
                const existingId = match[1];
                console.log(`Kontakt findes allerede i HubSpot med ID: ${existingId}`);
                await hubspotLinkContact(existingId, companyID);
                return existingId;
            } else {
                console.warn("Kunne ikke finde Existing ID i fejlbeskeden:", errJson.message);
                return null;
            }
        }
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    return output.id;
}

// Opdater virksomhed i HubSpot
async function hubspotUpdateCompany(id, data) {
    const url = `${HUBSPOT_ENDPOINT}companies/${id}`;
    const body = {
        "properties": {
            name: data.displayname,
            cvrnummer: data.VAT_code
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
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    console.log(`Virksomhed ${id} opdateret i HubSpot`);
}

// Opdater kontaktperson i HubSpot
async function hubspotUpdateContact(id, data) {
    const url = `${HUBSPOT_ENDPOINT}contacts/${id}`;
    let email = data.email ? data.email.trim().replace(/\s+/g, '') : '';
    if (email) {
        const [localPart, domainPart] = email.split('@');
        if (domainPart && !/\.[a-zA-Z]{2,}$/.test(domainPart)) {
            email = `${localPart}@${domainPart}.dk`;
        }
    }

    const body = {
        "properties": {
            email: email,
            lastname: `${data.firstname || ''}`,
            firstname: `${data.lastname || ''}`
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
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    console.log(`Kontaktperson ${id} opdateret i HubSpot`);
}

// Tilføj association mellem kontakt og virksomhed
async function hubspotUpdateContactAssociation(contactId, companyId) {
    const url = `${HUBSPOT_ENDPOINT}contacts/${contactId}/associations/companies/${companyId}/1`;
    const response = await fetch(url, {
        method: "PUT",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    console.log(`Association mellem kontakt ${contactId} og virksomhed ${companyId} tilføjet`);
}

// Slet virksomhed i HubSpot
async function hubspotDeleteCompany(id) {
    const url = `${HUBSPOT_ENDPOINT}companies/${id}`;
    const response = await fetch(url, {
        method: "DELETE",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    console.log(`Virksomhed ${id} slettet i HubSpot`);
}

// Slet association mellem kontakt og virksomhed
async function hubspotDeleteContactAssociation(contactId, companyId) {
    const url = `${HUBSPOT_ENDPOINT}contacts/${contactId}/associations/companies/${companyId}/1`;
    const response = await fetch(url, {
        method: "DELETE",
        headers: {
            'Content-Type': 'application/json',
            "Accept": "application/json",
            "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    console.log(`Association mellem kontakt ${contactId} og virksomhed ${companyId} slettet`);
}

// Funktion til at håndtere create for Contact eller ContactPerson
async function createContact(webhook) {
    const item = webhook.items[0];
    const itemType = webhook.itemType;

    if (itemType === 'Contact') {
        // Hent contact data fra Rentman
        const contactData = await rentmanGetFromEndpoint(item.ref);

        console.log(`Opretter virksomhed: ${contactData.displayname}`);
        const companyId = await hubspotCreateCompany(contactData);

        // Indsæt i DB
        await pool.query(
            'INSERT INTO synced_companies (name, rentman_id, hubspot_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), hubspot_id=VALUES(hubspot_id)',
            [contactData.displayname, contactData.id, companyId]
        );

        console.log(`Virksomhed oprettet med HubSpot ID: ${companyId}`);

    } else if (itemType === 'ContactPerson') {
        // Hent contactperson data fra Rentman
        const personData = await rentmanGetFromEndpoint(item.ref);

        // Find parent (virksomhed) ID med retry
        const parentId = item.parent?.id;
        if (!parentId) {
            console.warn('Ingen parent fundet for ContactPerson');
            return;
        }

        let companyId;
        for (let i = 0; i < 3; i++) {
            const [companyRows] = await pool.execute('SELECT hubspot_id FROM synced_companies WHERE rentman_id = ?', [parentId]);
            if (companyRows[0]) {
                companyId = companyRows[0].hubspot_id;
                break;
            }
            console.log(`Virksomhed ikke fundet endnu for rentman_id ${parentId}. Venter og prøver igen...`);
            await new Promise(r => setTimeout(r, 5000)); // Vent 3 sek
        }

        if (!companyId) {
            console.warn(`STOPPER Fandt stadig ingen virksomhed for rentman_id ${parentId}`);
            return;
        }

        console.log(`Opretter kontaktperson: ${personData.displayname}`);
        const personId = await hubspotCreateContact(personData, companyId);

        if (personId) {
            // Indsæt i DB
            await pool.query(
                'INSERT INTO synced_contacts (name, rentman_id, hubspot_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), hubspot_id=VALUES(hubspot_id)',
                [personData.displayname, personData.id, personId]
            );

            console.log(`Kontaktperson oprettet med HubSpot ID: ${personId}`);
        }

    } else {
        console.warn(`Ukendt itemType: ${itemType}`);
    }
}

// Funktion til at håndtere update for Contact eller ContactPerson
async function updateContact(webhook) {
    const item = webhook.items[0];
    const itemType = webhook.itemType;

    if (itemType === 'Contact') {
        // Hent opdateret contact data fra Rentman
        const contactData = await rentmanGetFromEndpoint(item.ref);

        // Find eksisterende HubSpot ID fra DB
        const [companyRows] = await pool.execute('SELECT hubspot_id FROM synced_companies WHERE rentman_id = ?', [contactData.id]);
        if (!companyRows[0]) {
            console.warn(`Ingen virksomhed fundet i DB for rentman_id ${contactData.id}`);
            return;
        }
        const companyId = companyRows[0].hubspot_id;

        console.log(`Opdaterer virksomhed: ${contactData.displayname}`);
        await hubspotUpdateCompany(companyId, contactData);

        // Opdater DB
        await pool.query(
            'UPDATE synced_companies SET name = ? WHERE rentman_id = ?',
            [contactData.displayname, contactData.id]
        );

    } else if (itemType === 'ContactPerson') {
        // Hent opdateret contactperson data fra Rentman
        const personData = await rentmanGetFromEndpoint(item.ref);

        // Find eksisterende HubSpot ID fra DB
        const [contactRows] = await pool.execute('SELECT hubspot_id FROM synced_contacts WHERE rentman_id = ?', [personData.id]);
        if (!contactRows[0]) {
            console.warn(`Ingen kontaktperson fundet i DB for rentman_id ${personData.id}`);
            return;
        }
        const personId = contactRows[0].hubspot_id;

        console.log(`Opdaterer kontaktperson: ${personData.displayname}`);
        await hubspotUpdateContact(personId, personData);

        // Tjek hvis parent (virksomhed) er ændret
        const newParentId = item.parent?.id;
        if (newParentId) {
            const [newCompanyRows] = await pool.execute('SELECT hubspot_id FROM synced_companies WHERE rentman_id = ?', [newParentId]);
            if (newCompanyRows[0]) {
                const newCompanyId = newCompanyRows[0].hubspot_id;
                await hubspotUpdateContactAssociation(personId, newCompanyId);
            }
        }

        // Opdater DB
        await pool.query(
            'UPDATE synced_contacts SET name = ? WHERE rentman_id = ?',
            [personData.displayname, personData.id]
        );

    } else {
        console.warn(`Ukendt itemType: ${itemType}`);
    }
}

// Funktion til at håndtere delete for Contact eller ContactPerson
async function deleteContact(webhook) {
    const items = webhook.items;
    const itemType = webhook.itemType;

    if (itemType === 'Contact') {
        for (item of items) {
            // Find HubSpot ID for virksomheden
            const [companyRows] = await pool.execute('SELECT hubspot_id FROM synced_companies WHERE rentman_id = ?', [item]);
            if (!companyRows[0]) {
                console.warn(`Ingen virksomhed fundet i DB for rentman_id ${item}`);
                return;
            }
            const companyId = companyRows[0].hubspot_id;

            // Slet virksomheden i HubSpot
            console.log(`Sletter virksomhed: ${companyId}`);
            await hubspotDeleteCompany(companyId);

            // Slet fra DB (kontaktpersoner forbliver, men associationer fjernes automatisk ved sletning af virksomhed)
            await pool.query('DELETE FROM synced_companies WHERE rentman_id = ?', [item]);
        }


    } else if (itemType === 'ContactPerson') {

        for (item of items) {
            // Find HubSpot ID for kontaktpersonen

            const [contactRows] = await pool.execute('SELECT hubspot_id FROM synced_contacts WHERE rentman_id = ?', [item]);
            if (!contactRows[0]) {
                console.warn(`Ingen kontaktperson fundet i DB for rentman_id ${item}`);
                return;
            }
            const personId = contactRows[0].hubspot_id;

            // Find tilknyttet virksomhed (parent)
            const parentId = item.parent?.id;
            if (parentId) {
                const [companyRows] = await pool.execute('SELECT hubspot_id FROM synced_companies WHERE rentman_id = ?', [parentId]);
                if (companyRows[0]) {
                    const companyId = companyRows[0].hubspot_id;
                    // Fjern association
                    console.log(`Fjerner association mellem kontaktperson ${personId} og virksomhed ${companyId}`);
                    await hubspotDeleteContactAssociation(personId, companyId);
                }
            }

            // Slet ikke kontaktpersonen, kun fra DB
            await pool.query('DELETE FROM synced_contacts WHERE rentman_id = ?', [item]);
        }


    } else {
        console.warn(`Ukendt itemType: ${itemType}`);
    }
}

module.exports = { createContact, updateContact, deleteContact };
