const express = require("express");
const { text } = require('body-parser');

const pool = require('./db')

const app = express();
app.use(express.json());

app.post("/", async (req, res) => {
    const event = req.body;
    console.log("Webhook modtaget:", event);

    res.status(200).send("OK");
});

const hubspotRouter = require('./webhooks/routes/hubspot')
const seamRouter = require('./webhooks/routes/seam')

app.use('/hubspot', hubspotRouter)
app.use('/seam', seamRouter)

app.listen(8080, () => console.log("Webhook API kører på port 8080"));