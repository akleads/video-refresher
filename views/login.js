// Login view with password authentication

import { apiCall, setToken } from '../lib/api.js';

export function renderLogin(params) {
  const container = document.getElementById('view-login');
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  // Create centered login form
  const formWrapper = document.createElement('div');
  formWrapper.className = 'login-wrapper';
  formWrapper.style.cssText = 'max-width: 400px; margin: 4rem auto; padding: 2rem; text-align: center;';

  // App title
  const title = document.createElement('h1');
  title.textContent = 'Video Refresher';
  formWrapper.appendChild(title);

  // Subtitle
  const subtitle = document.createElement('p');
  subtitle.textContent = 'Enter the shared password to continue';
  subtitle.style.color = '#666';
  subtitle.style.marginBottom = '2rem';
  formWrapper.appendChild(subtitle);

  // Expired session message
  if (params.expired === '1') {
    const expiredMsg = document.createElement('div');
    expiredMsg.className = 'error-message';
    expiredMsg.textContent = 'Your session has expired. Please log in again.';
    expiredMsg.style.cssText = 'background: #fee; color: #c33; padding: 1rem; border-radius: 4px; margin-bottom: 1rem;';
    formWrapper.appendChild(expiredMsg);
  }

  // Error message container (hidden by default)
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.style.cssText = 'background: #fee; color: #c33; padding: 1rem; border-radius: 4px; margin-bottom: 1rem; display: none;';
  formWrapper.appendChild(errorDiv);

  // Create form
  const form = document.createElement('form');

  // Password input
  const inputWrapper = document.createElement('div');
  inputWrapper.style.marginBottom = '1rem';

  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.required = true;
  passwordInput.autofocus = true;
  passwordInput.placeholder = 'Password';
  passwordInput.style.cssText = 'width: 100%; padding: 0.75rem; font-size: 1rem; border: 1px solid #ccc; border-radius: 4px;';
  inputWrapper.appendChild(passwordInput);
  form.appendChild(inputWrapper);

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.textContent = 'Log In';
  submitBtn.style.cssText = 'width: 100%; padding: 0.75rem; font-size: 1rem; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer;';
  submitBtn.addEventListener('mouseenter', () => {
    if (!submitBtn.disabled) {
      submitBtn.style.background = '#0052a3';
    }
  });
  submitBtn.addEventListener('mouseleave', () => {
    if (!submitBtn.disabled) {
      submitBtn.style.background = '#0066cc';
    }
  });
  form.appendChild(submitBtn);

  // Form submit handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const password = passwordInput.value;

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.style.background = '#ccc';
    submitBtn.style.cursor = 'not-allowed';
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
      submitBtn.style.background = '#0066cc';
      submitBtn.style.cursor = 'pointer';
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

  formWrapper.appendChild(form);
  container.appendChild(formWrapper);
}
