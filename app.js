const express = require("express");

const app = express();
app.use(express.json());

const hubspotRouter = require('./webhooks/routes/hubspot')
const rentmanRouter = require('./webhooks/routes/rentman');
const logger = require("./logger");

app.use('/hubspot', hubspotRouter)
app.use('/rentman', rentmanRouter)

app.listen(8080, () => console.log("Webhook API kører på port 8080"));

