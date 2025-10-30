const express = require("express");
const { text } = require('body-parser');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config();

const pool = require('../../db');

const { hubspotDealGetFromEndpoint, rentmanPostRentalRequest, rentmanDelRentalRequest } = require('../services/hubspot-deal');

const router = express.Router();
router.use(express.json());

// STATUS FRA I GÅR! DEN LOGGEDE IKKE NOGEN DEAL. TJEK EVT. ALLE BERAK; PUNKTER.

router.post("/", async (req, res) => {
    const events = req.body;
    let whatHappend = false;
    console.log(events)
    console.log("Hubspot webhook modtaget!")
    res.status(200).send("OK");
    for (const event of events) {

        if (event.subscriptionType === "object.creation") {
            console.log("Oprettelse modtaget")
            if (event.objectTypeId === "0-3") { // DEAL OPRETTET
                const deal = await hubspotDealGetFromEndpoint(event.objectTypeId, event.objectId);
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

                                if (!rentman) { break; }

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
                if (event.propertyName === "slut_projekt_period") {

                }


            }


        } else if (event.subscriptionType === "object.deletion") {
            console.log("Det er delete")

            if (event.objectTypeId === "0-3") {
                let request;
                try {
                    [request] = await pool.execute(
                        'SELECT * FROM synced_request WHERE hubspot_deal_id = ?',
                        [event.objectId]
                    );
                } catch (err) {
                    console.log(`Fejl! ${err}`);
                }

                if (request?.[0]?.rentman_request_id) {
                    await rentmanDelRentalRequest(request[0].rentman_request_id);
                    console.log("Rental request slettet");
                } else {
                    console.log("Kunne ikke finde rental request i Rentman");
                }
            }

        }
    };


});

module.exports = router