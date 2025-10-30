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
    const event = req.body;
    res.status(200).send("OK");
    console.log(event)
    if (event.event_type === "lock.unlocked") {
        const connectedAccountId = event.connected_account_id || event.data?.connected_account_id;
        const deviceId = event.device_id || event.data?.device_id;
        const method = event.method || event.data?.method;
        let connectedAccount = null;
        if (connectedAccountId) {
            connectedAccount = await seam.connectedAccounts.get({
                connected_account_id: connectedAccountId,
            });
            console.log("Connected account:", connectedAccount);
        }

        // 2) Hent device/lås info
        let device = null;
        if (deviceId) {
            device = await seam.devices.get({ device_id: deviceId });
            console.log("Device info:", device);
        }

        let who = null;
        if (connectedAccount?.user_identifier) {
            who = connectedAccount.user_identifier;
        } else if (connectedAccount?.custom_metadata && connectedAccount.custom_metadata.internalUserId) {
            who = { internalId: connectedAccount.custom_metadata.internalUserId };
        } else {
            who = { note: `Unknown via Seam. method=${method}` };
        }

        console.log("Resolved opener:", who);
    }

});


module.exports = router