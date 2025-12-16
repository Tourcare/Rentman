const loginBtn = document.querySelector('#loginBtn');
const statusText = document.querySelector('#status')

const loginInputs = document.querySelectorAll("#username, #password");

loginInputs.forEach(input => {
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault(); 
            loginBtn.click();
        }
    });
});

// Din eksisterende login-funktion
loginBtn.addEventListener("click", async () => {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    if (!username || !password) {
        statusText.textContent = "Udfyld begge felter!"
        loginBtn.style.display = 'none';

        await setTimeout(() => {
            loginBtn.style.display = ''
            statusText.textContent = ""
        }, 3000)
        loginBtn.disabled = false
        return
    }
    loginBtn.disabled = true
    try {
        const res = await fetch("/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (res.ok) {
            window.location.href = "/";
        } else {
            statusText.textContent = data.error;
            loginBtn.style.display = 'none';

            await setTimeout(() => {
                loginBtn.style.display = ''
                statusText.textContent = ""
            }, 3000)
            loginBtn.disabled = false
            return
        }
        
    } catch {

        statusText.textContent = "Serverfejl. Kontakt Sylle"
        loginBtn.style.display = 'none';

        await setTimeout(() => {
            loginBtn.style.display = ''
            statusText.textContent = ""
        }, 3000)
        loginBtn.disabled = false
        return

    } finally {
        loginBtn.disabled = false;
    }
});
