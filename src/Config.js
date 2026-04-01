/**
 * Configuration module.
 * Replace with your actual Spreadsheet ID and other settings.
 */
const CONFIG = {
  // Read from Google Apps Script Properties
  TELEGRAM_TOKEN: PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN'),
  AUTHORIZED_CHAT_ID: PropertiesService.getScriptProperties().getProperty('AUTHORIZED_CHAT_ID'),
  get SPREADSHEET_ID() {
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (id) return id;
    try {
      return SpreadsheetApp.getActiveSpreadsheet().getId();
    } catch (e) {
      return null;
    }
  },
  
  WORKER_URL: 'https://marginalrob.robert-bernhardt93.workers.dev',
  SHEETS: {
    TASKS: 'Tasks',
    LOG: 'ActivityLog',
    STATS: 'Stats'
  },
  KILL_PERCENTAGE: 0.01,
  MIN_KILL_COUNT: 1
};

/**
 * Utility to save properties once during setup.
 */
function saveSecrets(token, spreadsheetId) {
  const props = PropertiesService.getScriptProperties();
  if (token) props.setProperty('TELEGRAM_TOKEN', token);
  if (spreadsheetId) props.setProperty('SPREADSHEET_ID', spreadsheetId);
}

/**
 * Returns the spreadsheet instance.
 */
function getSpreadsheet() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}
