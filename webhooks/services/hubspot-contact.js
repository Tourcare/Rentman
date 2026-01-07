// hubspot-contact.js (opdateret)
const { log } = require('winston');
const pool = require('../../db');
const dotenv = require('dotenv');

dotenv.config();

const HUBSPOT_TOKEN = process.env.HUBSPOT_API_TOKEN;
const HUBSPOT_ENDPOINT = "https://api.hubapi.com/crm/v3/objects/";
const HUBSPOT_ENDPOINT_v4 = "https://api.hubapi.com/crm/v4/objects/";

const RENTMAN_API_BASE = "https://api.rentman.net";
const RENTMAN_API_TOKEN = process.env.RENTMAN_ACCESS_TOKEN;

// Hjælpefunktion til at hente fra HubSpot
async function hubspotGetFromEndpoint(type, id, query) {

    console.log(`Henter data fra HubSpot: ${HUBSPOT_ENDPOINT}${type}/${id}${query}`);
    const url = `${HUBSPOT_ENDPOINT}${type}/${id}${query}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
        }
    });

    if (response.status === 404) {
        console.warn(`Objekt ikke fundet i HubSpot: ${type}/${id}`);
        return false;
    }

    if (!response.ok) {
        const errText = await response.text();
        console.error(`Fejl ved hentning fra HubSpot: ${response.status}, ${errText}`);
        throw new Error(`HTTP error fra HubSpot: ${response.status}, ${errText}`);
    }

    const output = await response.json();
    return output;
}

// Hjælpefunktion til at hente fra Rentman
async function rentmanGetFromEndpoint(endpoint) {
    const url = `${RENTMAN_API_BASE}${endpoint}`;
    console.log(`Henter data fra Rentman: ${url}`);
    const response = await fetch(url, {
        headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${RENTMAN_API_TOKEN}`,
        },
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error(`Fejl ved hentning fra Rentman: ${response.status}, ${errText}`);
        throw new Error(`HTTP error fra Rentman: ${response.status}, ${errText}`);
    }

    const output = await response.json();
    console.log(`Hentet data fra Rentman for endpoint ${endpoint}`);
    return output.data;
}

// Opret virksomhed i Rentman
async function rentmanCreateCompany(data) {
    const url = `${RENTMAN_API_BASE}/contacts`;
    const body = {
        name: data.properties.name,
        VAT_code: data.properties.cvrnummer || ''
    };
    console.log(`Opretter virksomhed i Rentman: ${data.properties.name}`);

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
        console.error(`Fejl ved oprettelse af virksomhed i Rentman: ${response.status}, ${errText}`);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    console.log(`Virksomhed oprettet i Rentman med ID: ${output.data.id}`);
    return output.data;
}

// Opret kontaktperson i Rentman under en virksomhed
async function rentmanCreateContactPerson(data, companyRentmanId) {

    const url = `${RENTMAN_API_BASE}/contacts/${companyRentmanId}/contactpersons`;
    let email = data.properties.email ? data.properties.email.trim().replace(/\s+/g, '') : null;


    const body = {
        firstname: data.properties.firstname || '',
        lastname: data.properties.lastname || '',
    };
    if (email) {
        const [localPart, domainPart] = email.split('@');
        if (!/\.[a-zA-Z]{2,}$/.test(domainPart)) {
            email = `${localPart}@${domainPart}.dk`;
            body.email = email
        }
    }
    console.log(`Opretter kontaktperson i Rentman under virksomhed ${companyRentmanId}: ${data.properties.firstname} ${data.properties.lastname}`);

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
        console.error(`Fejl ved oprettelse af kontaktperson i Rentman: ${response.status}, ${errText}`);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    const output = await response.json();
    console.log(`Kontaktperson oprettet i Rentman med ID: ${output.data.id}`);
    return output.data;
}

// Opdater virksomhed i Rentman
async function rentmanUpdateCompany(id, data) {
    const url = `${RENTMAN_API_BASE}/contacts/${id}`;
    const body = {
        name: data.properties.name,
        VAT_code: data.properties.cvrnummer || ''
    };
    console.log(`Opdaterer virksomhed i Rentman ID: ${id}`);

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RENTMAN_API_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error(`Fejl ved opdatering af virksomhed i Rentman: ${response.status}, ${errText}`);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    console.log(`Virksomhed opdateret i Rentman ID: ${id}`);
    return true;
}

// Opdater kontaktperson i Rentman
async function rentmanUpdateContactPerson(id, data) {
    const url = `${RENTMAN_API_BASE}/contactpersons/${id}`;

    let email = data.properties.email ? data.properties.email.trim().replace(/\s+/g, '') : '';
    if (email) {
        const [localPart, domainPart] = email.split('@');
        if (!/\.[a-zA-Z]{2,}$/.test(domainPart)) {
            email = `${localPart}@${domainPart}.dk`;
        }
    }

    const body = {
        firstname: data.properties.firstname || '',
        lastname: data.properties.lastname || '',

        email: email
    };
    console.log(`Opdaterer kontaktperson i Rentman ID: ${id}`);

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RENTMAN_API_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error(`Fejl ved opdatering af kontaktperson i Rentman: ${response.status}, ${errText}`);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    console.log(`Kontaktperson opdateret i Rentman ID: ${id}`);
    return true;
}

// Slet virksomhed i Rentman
async function rentmanDeleteCompany(id) {
    const url = `${RENTMAN_API_BASE}/contacts/${id}`;
    console.log(`Sletter virksomhed i Rentman ID: ${id}`);
    const response = await fetch(url, {
        method: 'DELETE',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${RENTMAN_API_TOKEN}`,
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error(`Fejl ved sletning af virksomhed i Rentman: ${response.status}, ${errText}`);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    console.log(`Virksomhed slettet i Rentman ID: ${id}`);
    return true;
}

// Slet kontaktperson i Rentman
async function rentmanDeleteContactPerson(id) {
    const url = `${RENTMAN_API_BASE}/contactpersons/${id}`;
    console.log(`Sletter kontaktperson i Rentman ID: ${id}`);
    const response = await fetch(url, {
        method: 'DELETE',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${RENTMAN_API_TOKEN}`,
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error(`Fejl ved sletning af kontaktperson i Rentman: ${response.status}, ${errText}`);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
    }

    console.log(`Kontaktperson slettet i Rentman ID: ${id}`);
    return true;
}

// Hovedfunktion til at håndtere HubSpot webhooks for contacts
async function handleHubSpotContactWebhook(events) {
    console.log(`Behandler ${events.length} events fra HubSpot webhook`);
    const ranNum = Math.floor(Math.random() * 2) + 1;
    let amn = 0
    let triggers = []
    try {

        for (const event of events) {
            amn++
            console.log(`Trigger Event:`)
            console.log(event)
            const waitTime = Math.floor(Math.random() * (2000 - 500 + 1)) + 500;
            await new Promise(r => setTimeout(r, waitTime))
            if (event.changeSource === "OBJECT_MERGE") break;
            if (event.objectId) { // Alle ikke associations

                // #########################
                // #        CONTACTS       #
                // #########################

                if (event.objectTypeId === "0-1") {
                    if (event.subscriptionType === "object.deletion") continue;
                    const contact = await hubspotGetFromEndpoint(event.objectTypeId, event.objectId, "?associations=companies")
                    if (event.subscriptionType === "object.creation") {

                        if (!contact?.associations?.companies) {
                            console.log('Fandt ingen tilknyttet virksomed');
                            continue;
                        }
                        const allCompanies = contact?.associations?.companies?.results
                        // Søger efter company id 
                        let primaryCompany;
                        for (company of allCompanies) {
                            if (company?.type === "contact_to_company") primaryCompany = company?.id
                        }
                        let dbCompany;
                        //Søger efter rentman ID
                        for (let i = 0; i < 3; i++) {
                            [dbCompany] = await pool.query('SELECT * FROM synced_companies WHERE hubspot_id = ?', [primaryCompany])

                            if (dbCompany?.[0]) break;

                            console.log(`Fandt ingen virksomhed med Hubspot ID ${primaryCompany}. Prøver igen.`);
                            await new Promise(r => setTimeout(r, 3000)); // vent 3 sek
                        }
                        const rentmanCompany = dbCompany[0].rentman_id
                        if (!rentmanCompany) {
                            console.log('STOPPER Fandt ingen virksomhed tilknyttet i Rentman.');
                            break;
                        }
                        const rentmanId = await rentmanCreateContactPerson(contact, rentmanCompany)
                        triggers.push(`${amn}: 01(contact) = object.creation (SUCCESFULD)`)
                        triggers.push(event)
                        const name = `${contact.properties.firstname || ""} ${contact.properties.lastname || ""}`
                        await pool.query(
                            'INSERT INTO synced_contacts (name, rentman_id, hubspot_id, hubspot_company_conntected) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), hubspot_id=VALUES(hubspot_id)',
                            [name, rentmanId.id, contact.id, dbCompany[0].hubspot_id]
                        );

                        console.log('Oprettede contactperson til virksomhed med id: ' + rentmanCompany);
                    } else if (event.subscriptionType === "object.propertyChange") {
                        // FINDER RENTMAN ID
                        let dbContacts;
                        for (let i = 0; i < 3; i++) {
                            [dbContacts] = await pool.query('SELECT * FROM synced_contacts WHERE hubspot_id = ?', [contact.id])

                            if (dbContacts?.[0]) break;

                            console.log(`Fandt ingen contact med Hubspot ID ${contact.id}. Prøver igen.`);
                            await new Promise(r => setTimeout(r, 3000)); // vent 3 sek
                        }
                        const rentmanContact = dbContacts[0].rentman_id
                        if (!rentmanContact) {
                            console.log('STOPPER Fandt ingen contact i Rentman.');
                            break;
                        }
                        await rentmanUpdateContactPerson(rentmanContact, contact)
                        triggers.push(`${amn}: 01(contact) = object.propertyChange (SUCCESFULD)`)
                        triggers.push(event)
                        const name = `${contact.properties.firstname || ""} ${contact.properties.lastname || ""}`
                        console.log('Opdateret kontaktperson: ' + name);
                    }


                    // #########################
                    // #        COMPANIES      #
                    // #########################

                } else if (event.objectTypeId === "0-2") {
                    if (event.subscriptionType === "object.deletion") continue;

                    const company = await hubspotGetFromEndpoint(event.objectTypeId, event.objectId, "?properties=cvrnummer,name&associations=contacts")

                    if (event.subscriptionType === "object.creation") {


                        const rentmanId = await rentmanCreateCompany(company)
                        triggers.push(`${amn}: 02(company) = object.creation (SUCCESFULD)`)
                        triggers.push(event)
                        await pool.query(
                            'INSERT INTO synced_companies (name, rentman_id, hubspot_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), hubspot_id=VALUES(hubspot_id)',
                            [company.properties.name, rentmanId.id, company.id]
                        );
                        console.log(`Oprettede virksomhed i Rentman ${company.properties.name}`);


                    } if (event.subscriptionType === "object.propertyChange") {
                        let dbCompany;

                        for (let i = 0; i < 3; i++) {
                            [dbCompany] = await pool.query('SELECT * FROM synced_companies WHERE hubspot_id = ?', [company.id])

                            if (dbCompany?.[0]) break;

                            console.log(`Fandt ingen contact med Hubspot ID ${company.id}. Prøver igen.`);
                            await new Promise(r => setTimeout(r, 3000)); // vent 3 sek
                        }
                        const rentmanCompany = dbCompany[0].rentman_id

                        if (!rentmanCompany) {
                            console.log('STOPPER Fandt ingen contact i Rentman.');
                            break;
                        }
                        await rentmanUpdateCompany(rentmanCompany, company)
                        triggers.push(`${amn}: 02(company) = object.propertyChange (SUCCESFULD)`)
                        triggers.push(event)
                        await pool.query(
                            'UPDATE synced_companies SET name = ? WHERE hubspot_id = ?', [company.properties.name, company.id]
                        )
                        console.log('Opdateret virksomhed: ' + company.properties.name);
                    }


                }




            } else { //alle associations
                let dublet = false;

                if (event.associationType === "CONTACT_TO_COMPANY" || event.associationType === "COMPANY_TO_CONTACT") {
                    const type = event.associationType.split("_TO_");
                    let company;
                    let contact;

                    // Hent company og contact baseret på association retning
                    if (type[0] === "CONTACT") {
                        company = await hubspotGetFromEndpoint("0-2", event.toObjectId, "?properties=cvrnummer,name&associations=contacts");
                        contact = await hubspotGetFromEndpoint("0-1", event.fromObjectId, "?associations=companies");
                    } else if (type[0] === "COMPANY") {
                        company = await hubspotGetFromEndpoint("0-2", event.fromObjectId, "?properties=cvrnummer,name&associations=contacts");
                        contact = await hubspotGetFromEndpoint("0-1", event.toObjectId, "?associations=companies");
                    }

                    const name = `${contact.properties.firstname || ""} ${contact.properties.lastname || ""}`;

                    // Valider at vi har både company og contact
                    if (!company) break;
                    if (!contact) break;

                    // Find company i database med retry logik
                    let dbCompany;
                    for (let i = 0; i < ranNum; i++) {
                        [dbCompany] = await pool.query('SELECT * FROM synced_companies WHERE hubspot_id = ?', [company.id]);

                        if (dbCompany?.[0]) break;

                        console.log(`Fandt ingen company med Hubspot ID ${company.id}. Prøver igen.`);
                        await new Promise(r => setTimeout(r, 3000));
                    }

                    const rentmanCompany = dbCompany?.[0]?.rentman_id;

                    if (!rentmanCompany) {
                        console.log('STOPPER Fandt ingen company i Rentman.');
                        break;
                    }

                    let dbContacts;

                    // Håndter fjernelse af association
                    if (event.associationRemoved) {
                        // Find contact i database med retry logik
                        for (let i = 0; i < 3; i++) {
                            [dbContacts] = await pool.query('SELECT * FROM synced_contacts WHERE hubspot_id = ?', [contact.id]);

                            if (dbContacts?.[0]) break;

                            console.log(`Fandt ingen contact med Hubspot ID ${contact.id}. Prøver igen.`);
                            await new Promise(r => setTimeout(r, 3000));
                        }

                        const rentmanContact = dbContacts;

                        if (!rentmanContact || !rentmanContact[0]) {
                            console.log('STOPPER Fandt ingen contact i Rentman.');
                            break;
                        }

                        // Slet contact hvis den er knyttet til den rigtige company
                        for (const sqlLine of dbContacts) {
                            if (sqlLine.hubspot_company_contected == event.toObjectId || sqlLine.hubspot_company_contected == event.fromObjectId) {
                                await rentmanDeleteContactPerson(rentmanContact);
                                await pool.query('DELETE FROM synced_contacts WHERE hubspot_id = ?', [contact.id]);
                                console.log(`Slettede kontaktperson ${name}`);
                                break;
                            }
                        }
                    }
                    // Håndter tilføjelse af association
                    else {
                        // Dobbelttjek for dubletter med retry logik
                        for (let d = 0; d < 2; d++) {
                            // Tjek om contact allerede eksisterer
                            for (let i = 0; i < ranNum + amn; i++) {
                                [dbContacts] = await pool.query('SELECT * FROM synced_contacts WHERE hubspot_id = ?', [contact.id]);
                                console.log(`Tjekker dubletter`);

                                if (dbContacts?.[0]) {
                                    console.log(`Fandt eksisterende contact med Hubspot ID ${contact.id}`);
                                    break;
                                }

                                await new Promise(r => setTimeout(r, 1000));
                            }

                            // Valider at kontakten ikke allerede er knyttet til denne company
                            if (dbContacts?.[0]) {
                                for (const rentmanContact of dbContacts) {
                                    console.log(rentmanContact);

                                    if (rentmanContact) {
                                        const hubspotId = rentmanContact?.hubspot_company_contected;
                                        const fromId = event?.fromObjectId;
                                        const toId = event?.toObjectId;

                                        if (
                                            hubspotId != null &&
                                            (String(hubspotId) === String(fromId) || String(hubspotId) === String(toId))
                                        ) {
                                            console.log('STOPPER kontaktpersonen findes allerede.');
                                            dublet = true;
                                            break;
                                        }
                                    }
                                }
                            }

                            if (dublet) break;

                            await new Promise(r => setTimeout(r, waitTime));
                        }

                        // Hvis ingen dublet, opret ny kontaktperson
                        if (dublet) break;

                        console.log(`Ingen dubletter`);
                        const rentmanId = await rentmanCreateContactPerson(contact, rentmanCompany);
                        triggers.push(`${amn}: ASSOCIATIONS createContactPerson (SUCCESFULD)`);
                        triggers.push(event);

                        await pool.query(
                            'INSERT INTO synced_contacts (name, rentman_id, hubspot_id, hubspot_company_contected) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), hubspot_id=VALUES(hubspot_id)',
                            [name, rentmanId.id, contact.id, dbCompany?.[0]?.hubspot_id]
                        );

                        console.log(`Oprettede kontaktperson ${name}`);
                    }
                }

            }


        }
        console.log(`Trigger events:`)
        triggers.forEach((trigger) => { console.log(trigger) })

    } catch (err) {
        console.log(err);
    }
}

module.exports = { handleHubSpotContactWebhook };