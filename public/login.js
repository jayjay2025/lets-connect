document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (data.success) {
            window.location.href = data.redirectUrl;
        } else {
            alert(data.message);
        }
    } catch (error) {
        console.error('Login Error:', error);
        alert('Something went wrong. Is the server running?');
    }
});