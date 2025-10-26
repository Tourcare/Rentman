const express = require("express");

const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
    const event = req.body;
    console.log("Webhook modtaget:", event);

    switch (event.action) {
        case "create_task":
            await runCreateTask(event);
            break;
        case "update_status":
            await runUpdateStatus(event);
            break;
        default:
            console.log("Ukendt action:", event.action);
    }

    res.status(200).send("OK");
});

async function runCreateTask(data) {
    console.log("Kører create_task...");
    // fx kald CRM API
}

async function runUpdateStatus(data) {
    console.log("Kører update_status...");
    // fx opdater projektstyringssystem
}

app.listen(8080, () => console.log("Webhook API kører på port 8080"));