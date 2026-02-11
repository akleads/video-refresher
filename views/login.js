// Login view with password authentication

import { apiCall, setToken } from '../lib/api.js';

export function renderLogin(params) {
  const container = document.getElementById('view-login');
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  // Create outer page wrapper for vertical centering
  const loginPage = document.createElement('div');
  loginPage.className = 'login-page';

  // Create login card
  const loginCard = document.createElement('div');
  loginCard.className = 'login-card';

  // Heading
  const heading = document.createElement('h1');
  heading.className = 'login-heading';
  heading.textContent = 'Video Refresher';
  loginCard.appendChild(heading);

  // Tagline
  const tagline = document.createElement('p');
  tagline.className = 'login-tagline';
  tagline.textContent = 'Fresh variations for your video ads, instantly.';
  loginCard.appendChild(tagline);

  // Expired session message
  if (params.expired === '1') {
    const expiredMsg = document.createElement('div');
    expiredMsg.className = 'login-error';
    expiredMsg.textContent = 'Session expired. Please log in again.';
    loginCard.appendChild(expiredMsg);
  }

  // Error message container (hidden by default)
  const errorDiv = document.createElement('div');
  errorDiv.className = 'login-error';
  errorDiv.style.display = 'none';
  loginCard.appendChild(errorDiv);

  // Create form
  const form = document.createElement('form');

  // Password input
  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.className = 'login-input';
  passwordInput.required = true;
  passwordInput.autofocus = true;
  passwordInput.placeholder = 'Password';
  form.appendChild(passwordInput);

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'login-submit';
  submitBtn.textContent = 'Log In';
  form.appendChild(submitBtn);

  // Form submit handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const password = passwordInput.value;

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in...';
    errorDiv.style.display = 'none';

    try {
      const response = await apiCall('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await response.json();
      setToken(data.token);
      window.location.hash = '#upload';

    } catch (err) {
      // Re-enable button
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log In';

      // Show appropriate error message
      if (err.message.includes('401')) {
        errorDiv.textContent = 'Invalid password';
      } else if (err.message === 'Session expired') {
        // Already handled by apiCall redirect
        return;
      } else {
        errorDiv.textContent = 'Network error. Please try again.';
      }

      errorDiv.style.display = 'block';
      passwordInput.value = '';
      passwordInput.focus();
    }
  });

  loginCard.appendChild(form);
  loginPage.appendChild(loginCard);
  container.appendChild(loginPage);
}
