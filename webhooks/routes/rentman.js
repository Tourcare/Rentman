const express = require("express");
const { text } = require('body-parser');
const dotenv = require('dotenv');

const pool = require('../../db');
const { rentmanCrossCheckRental } = require("../services/rentman-request");
const { syncDeal, updateDeal } = require("../services/rentman-update-deal");
const { createOrders, updateOrders } = require("../services/rentman-update-order");
const { createContact, updateContact, deleteContact } = require("../services/rentman-update-contact");

const router = express.Router();
router.use(express.json());


router.post("/", async (req, res) => {
    const event = req.body;
    console.log(event)
    res.status(200).send("OK");
    if (event?.user?.id === 235) {
        console.log('Kald fra integration')
        return;
    } else {
        if (event?.itemType === "Project") {


            if (event.eventType === "create") {
                let crossCheck = false;
                crossCheck = await rentmanCrossCheckRental(event.items[0].ref);

                if (!crossCheck) { // Ikke request
                    syncDeal(event)
                }


            } if (event.eventType === "update") {
                updateDeal(event)
            }

        } if (event?.itemType === "Subproject") {
            if (event.eventType === "create") {
                createOrders(event)

            } if (event.eventType === "update") {
                updateOrders(event)
            }

        } if (["Contact", "ContactPerson"].includes(event?.itemType)) {
            if (event.eventType === "create") {
                createContact(event)
            } if (event.eventType === "update") {
                updateContact(event)
            } if (event.eventType === "delete") {
                deleteContact(event)
            }
        }
    }


});


module.exports = router