// hubspot.js
const express = require("express");
const { text } = require('body-parser');
const dotenv = require('dotenv');

const pool = require('../../db');

const { handleHubSpotDealWebhook } = require('../services/hubspot-deal');
const { handleHubSpotContactWebhook } = require('../services/hubspot-contact');

const router = express.Router();
router.use(express.json());

function filterWebhooks(events) {
    if (!events || events.length === 0) return [];
    if (events[0].changeSource === "AUTO_ASSOCIATE_BY_DOMAIN") return false;

    if (events[0].subscriptionType === "object.associationChange") {
        const objectId1 = events[0].fromObjectId;
        const objectId2 = events[0].toObjectId;
        const ids = [objectId1, objectId2];

        const allMatch = events.every(event =>
            ids.includes(event.fromObjectId) && ids.includes(event.toObjectId)
        );

        if (allMatch) {
            return [events[0]]
        } else {
            return events
        }
    }

    const firstObjectId = events[0].objectId;
    const allSameObjectId = events.every(event => event.objectId === firstObjectId);

    let allSameChange;
    if (events?.[0]?.propertyName) {
        const firstObjectChange = events[0].propertyName
        allSameChange = events.every(event => event.propertyName === firstObjectChange);
    }

    if (!allSameObjectId) {
        return events;
    }

    if (allSameChange) {
        const changeEvent = events.find(event => event.subscriptionType === 'object.propertyChange');
        if (changeEvent) {
            return changeEvent ? [changeEvent] : events;
        } else {
            return events
        }
    }

    const creationEvent = events.find(event => event.subscriptionType === 'object.creation');
    if (creationEvent) {
        return creationEvent ? [creationEvent] : events;
    } else {
        return events
    }

}


router.post("/", async (req, res) => {
    const events = req.body;
    
    res.status(200).send("OK");
    if (events[0].changeSource === "INTEGRATION" || events[0].changeSource === "API") {
        console.log('Kald fra integration. Stopper ved roden')
        return;
    }
    // Håndter deal events
    const dealEvents = events.filter(event => event.objectTypeId === "0-3");
    if (dealEvents.length > 0) {
        //console.log(events)
        await handleHubSpotDealWebhook(dealEvents);
    }

    // Håndter contact events (companies og contacts)
    console.log(events);
    
    let contactEvents;
    contactEvents = contactEvents = events.filter(event => event.objectTypeId === "0-1" || event.objectTypeId === "0-2");
    if (events[0].subscriptionType === "object.associationChange") contactEvents = true

    if (contactEvents.length > 0 || contactEvents) {
        const filtered = filterWebhooks(events);
        if (filtered) {
            //console.log(filtered);
            await handleHubSpotContactWebhook(filtered);
        }
    }
});

module.exports = router;