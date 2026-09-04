// The lobby does one thing: name yourself, get a game, go to it.

const form = document.getElementById('create');
const nameField = document.getElementById('name');
const button = form.querySelector('button');
const error = document.getElementById('error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  error.textContent = '';
  try {
    const response = await fetch('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=' + encodeURIComponent(nameField.value),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'could not create the game');
    // The token is what makes this browser that colour's player from now on.
    localStorage.setItem('avgo:' + data.id, data.token);
    location.href = '/g/' + data.id;
  } catch (failure) {
    error.textContent = failure.message;
    button.disabled = false;
  }
});
