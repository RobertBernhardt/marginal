/**
 * Logging Service for Debugging
 */
const LoggerService = {
  /**
   * Logs a message to the 'Debug' sheet in the spreadsheet.
   */
  log: function(source, message, payload = "") {
    try {
      const ss = getSpreadsheet();
      const sheet = ss.getSheetByName("Debug");
      if (!sheet) return;
      
      const payloadString = (payload && typeof payload === 'object') ? JSON.stringify(payload) : payload;
      sheet.appendRow([new Date(), source, message, payloadString]);
    } catch (e) {
      console.error("LoggerService failed: " + e.toString());
    }
  }
};
