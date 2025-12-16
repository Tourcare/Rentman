let user;
const statusList = document.querySelector('#user-list');
const userInfo = document.querySelector('.user-info');

const syncProjectAndSubBtn = document.querySelector('#SyncProjectAndSubBtn');
const syncCompanyAndContacts = document.querySelector('#syncCompanyAndContacts')
const crossCheckData = document.querySelector('#crossCheckData')
const buttons = document.querySelectorAll('button')
const statusText = document.querySelector('#status');

window.addEventListener("DOMContentLoaded", async () => {
    const userDisplay = document.getElementById("loggedInUser");

    try {
        const res = await fetch("/me");
        if (!res.ok) {
            window.location.href = "/login.html";
            return;
        }
        const data = await res.json();
        user = data.username;
        userDisplay.innerText = `Logget ind som: ${data.username}`;
    } catch (err) {
        userDisplay.innerText = "Fejl ved hentning af brugerinfo";
    }
});

function updateStatus(info, clear) {
    const newInfoElement = document.createElement('li');
    const now = new Date();
    const statusTime = `${now.getHours()}.${now.getMinutes()}.${now.getSeconds()}`;
    if (clear) while (statusList.firstChild) statusList.removeChild(statusList.firstChild);
    newInfoElement.innerHTML = `${statusTime} | ${info}`;
    statusList.appendChild(newInfoElement);
}

// Enter på inputfelter
const inputs = document.querySelectorAll("#userName, #startTime, #endTime");
inputs.forEach(input => input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        createBtn.click();
    }
}));
buttons.forEach(b => {
    b.addEventListener("click", async (e) => {
        const clickedBtn = e.target
        userInfo.style.display = 'block';
        buttons.forEach(button => {
            button.style.background = "red";
            button.disabled = true;
            button.title = title = "Sync er startet, vente venligst"
            button.textContent = "Vent venligst"
        })
        
    })
})

