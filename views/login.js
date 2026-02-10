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
  // TODO: migrate to CSS class
  formWrapper.style.cssText = 'max-width: 400px; margin: var(--spacing-3xl) auto; padding: var(--spacing-xl); text-align: center;';

  // App title
  const title = document.createElement('h1');
  title.textContent = 'Video Refresher';
  formWrapper.appendChild(title);

  // Subtitle
  const subtitle = document.createElement('p');
  subtitle.textContent = 'Enter the shared password to continue';
  subtitle.style.color = 'var(--color-text-secondary)';
  subtitle.style.marginBottom = 'var(--spacing-xl)';
  formWrapper.appendChild(subtitle);

  // Expired session message
  if (params.expired === '1') {
    const expiredMsg = document.createElement('div');
    expiredMsg.className = 'error-message';
    expiredMsg.textContent = 'Your session has expired. Please log in again.';
    // TODO: migrate to CSS class
    expiredMsg.style.cssText = 'background: var(--color-error-bg); color: var(--color-error-text); padding: var(--spacing-base); border-radius: var(--radius-sm); margin-bottom: var(--spacing-base);';
    formWrapper.appendChild(expiredMsg);
  }

  // Error message container (hidden by default)
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  // TODO: migrate to CSS class
  errorDiv.style.cssText = 'background: var(--color-error-bg); color: var(--color-error-text); padding: var(--spacing-base); border-radius: var(--radius-sm); margin-bottom: var(--spacing-base); display: none;';
  formWrapper.appendChild(errorDiv);

  // Create form
  const form = document.createElement('form');

  // Password input
  const inputWrapper = document.createElement('div');
  inputWrapper.style.marginBottom = 'var(--spacing-base)';

  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.required = true;
  passwordInput.autofocus = true;
  passwordInput.placeholder = 'Password';
  // TODO: migrate to CSS class
  passwordInput.style.cssText = 'width: 100%; padding: var(--spacing-md); font-size: var(--font-size-base); border: 1px solid var(--color-input-border); border-radius: var(--radius-sm); background: var(--color-input-bg); color: var(--color-input-text);';
  inputWrapper.appendChild(passwordInput);
  form.appendChild(inputWrapper);

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.textContent = 'Log In';
  // TODO: migrate to CSS class
  submitBtn.style.cssText = 'width: 100%; padding: var(--spacing-md); font-size: var(--font-size-base); background: var(--color-accent); color: var(--color-gray-50); border: none; border-radius: var(--radius-sm); cursor: pointer;';
  submitBtn.addEventListener('mouseenter', () => {
    if (!submitBtn.disabled) {
      submitBtn.style.background = 'var(--color-accent-hover)';
    }
  });
  submitBtn.addEventListener('mouseleave', () => {
    if (!submitBtn.disabled) {
      submitBtn.style.background = 'var(--color-accent)';
    }
  });
  form.appendChild(submitBtn);

  // Form submit handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const password = passwordInput.value;

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.style.background = 'var(--color-gray-600)';
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
      submitBtn.style.background = 'var(--color-accent)';
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
