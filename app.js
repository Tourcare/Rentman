const express = require("express");

const app = express();
app.use(express.json());

app.post("/", async (req, res) => {
    const event = req.body;
    console.log("Webhook modtaget:", event);

    res.status(200).send("OK");
});


app.listen(8080, () => console.log("Webhook API kører på port 8080"));