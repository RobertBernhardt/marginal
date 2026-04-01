/**
 * Telegram UI Components and API Interactions
 */
const TelegramService = {
  /**
   * Universal message sender.
   */
  sendMessage: function(chatId, text, replyMarkup = null) {
    const url = "https://api.telegram.org/bot" + CONFIG.TELEGRAM_TOKEN + "/sendMessage";
    const payload = {
      "chat_id": chatId,
      "text": text,
      "parse_mode": "HTML"
    };
    if (replyMarkup) {
        payload["reply_markup"] = JSON.stringify(replyMarkup);
    }
    return UrlFetchApp.fetch(url, {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload)
    });
  },

  /**
   * Answer a callback query (for buttons).
   */
  answerCallback: function(callbackId, text = "Processed!") {
    const url = "https://api.telegram.org/bot" + CONFIG.TELEGRAM_TOKEN + "/answerCallbackQuery";
    UrlFetchApp.fetch(url, {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify({ "callback_query_id": callbackId, "text": text })
    });
  },

  /**
   * Constructs a card (message) for a task instruction.
   */
  sendTaskCard: function(chatId, task) {
    const text = "<b>🚀 NEXT TASK: " + task['Name'] + "</b>\n\n" +
                 "<i>Focus on this task now.</i>\n" +
                 "━━━━━━━━━━━━━━━━━━━━\n" +
                 "<b>Estimate:</b> " + (task['DurationMin'] || 0) + " min\n" +
                 "<b>Current Score:</b> " + (parseFloat(task['Score']) || 1).toFixed(1);
    
    const replyMarkup = {
      "inline_keyboard": [
        [
          { "text": "✅ Log 15m", "callback_data": "log_" + task['ID'] + "_15" },
          { "text": "✅ Log 30m", "callback_data": "log_" + task['ID'] + "_30" }
        ],
        [
          { "text": "✅ Log 60m", "callback_data": "log_" + task['ID'] + "_60" },
          { "text": "🖊️ Custom Log", "callback_data": "custom_" + task['ID'] }
        ]
      ]
    };
    return this.sendMessage(chatId, text, replyMarkup);
  },

  /**
   * Sends daily performance summary.
   */
  sendDailySummary: function(chatId) {
    const ss = getSpreadsheet();
    const statsSheet = ss.getSheetByName(CONFIG.SHEETS.STATS);
    const data = statsSheet.getDataRange().getValues();
    const dailyStats = data.slice(1).map(r => ({ date: new Date(r[0]), value: parseFloat(r[1]) || 0 }));
    const todayVal = dailyStats.length > 0 ? dailyStats[dailyStats.length - 1].value : 0;

    const text = "<b>📊 DAILY PERFORMANCE REPORT</b>\n" +
                 "━━━━━━━━━━━━━━━━━━━━\n" +
                 "<b>Total Value Created:</b> " + todayVal.toFixed(2) + " €\n\n" +
                 (todayVal > 50 ? "<i>Excellent work! You are on fire.</i> 🔥" : "<i>Keep it up!</i>");
    return this.sendMessage(chatId, text);
  }
};
