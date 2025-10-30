const express = require("express");
const { text } = require('body-parser');
const dotenv = require('dotenv');

dotenv.config();

const pool = require('../../db');

const router = express.Router();
router.use(express.json());

const { Seam } = require('seam');

const seam = new Seam({ apiKey: process.env.SEAM_API });
const acsSystemId = process.env.SEAM_ACS_SYSTEM_ID;
const accessGroupId = process.env.SEAM_ACCESS_GROUP;

router.post("/", async (req, res) => {
    const events = req.body;
    res.status(200).send("OK");
    console.log(events)
    await seam.acs.credentials.get({
        acs_credential_id: events.data.connected_account_id,
    });
});


module.exports = router