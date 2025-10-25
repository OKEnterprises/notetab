// Load current theme preference
async function loadThemePreference() {
  try {
    const result = await browser.storage.local.get('theme');
    const theme = result.theme || 'system';

    // Set the radio button
    const radio = document.querySelector(`input[value="${theme}"]`);
    if (radio) {
      radio.checked = true;
    }
  } catch (error) {
    console.error('Error loading theme preference:', error);
  }
}

// Save theme preference
async function saveThemePreference(theme) {
  try {
    await browser.storage.local.set({ theme });
  } catch (error) {
    console.error('Error saving theme preference:', error);
  }
}

// Listen for theme changes
document.querySelectorAll('input[name="theme"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    saveThemePreference(e.target.value);
  });
});

// Initialize
loadThemePreference();
