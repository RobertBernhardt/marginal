/**
 * Google Apps Script Entry Point for Telegram Webhook
 */

function doPost(e) {
  const update = JSON.parse(e.postData.contents);
  
  if (update.message) {
    const chatId = update.message.chat.id.toString();
    const text = update.message.text ? update.message.text.toLowerCase().trim() : "";

    // Security: Capture first user as authorized, then reject all others
    let authorizedId = PropertiesService.getScriptProperties().getProperty('AUTHORIZED_CHAT_ID');
    if (!authorizedId && text === "/start") {
      PropertiesService.getScriptProperties().setProperty('AUTHORIZED_CHAT_ID', chatId);
      authorizedId = chatId;
      TelegramService.sendMessage(chatId, "<b>Welcome!</b> You are now the authorized user of this bot.");
    }
    
    if (chatId !== authorizedId) {
      return TelegramService.sendMessage(chatId, "Unauthorized user. Access denied.");
    }

    // Re-sync stats on each request
    TaskService.syncAllTasks();

    if (text === "/start" || text === "help") {
      TelegramService.sendMessage(chatId, "<b>Welcome to Marginal Tasker!</b>\n\nCommands:\n- 🎯 <i>next</i>: Get your highest-priority task.\n- 📊 <i>summary</i>: See your daily performance.");
    } else if (text === "next") {
      const task = TaskService.findNextTask();
      if (!task) return TelegramService.sendMessage(chatId, "No active tasks found in your sheet! 📭");
      
      // Update score in sheet
      TaskService.markTaskAsChosen(task.ID);
      return TelegramService.sendTaskCard(chatId, task);
    } else if (text === "summary") {
      return TelegramService.sendDailySummary(chatId);
    } else if (text.startsWith("/")) {
      // Handle simple commands like /log_taskid_min
      // ... possibly for expert use
    }
  } else if (update.callback_query) {
    handleCallbackQuery(update.callback_query);
  }
}

/**
 * Handle button clicks from Inline Keyboard.
 */
function handleCallbackQuery(query) {
  const chatId = query.message.chat.id;
  const callbackId = query.id;
  const data = query.data;

  // Pattern: log_[taskId]_[min]
  if (data.startsWith("log_")) {
    const parts = data.split("_");
    const taskId = parts[1];
    const durationMin = parseFloat(parts[2]);

    // Perform the logic: log work and reset score
    // ... we default remaining time to 0 in this quick-log case
    const sessionValue = TaskService.logWork(taskId, durationMin * 60, 0, null);
    
    TelegramService.answerCallback(callbackId, "Logged " + durationMin + "m! ✅");
    TelegramService.sendMessage(chatId, "<b>Nice!</b> You created " + (sessionValue || 0).toFixed(2) + " € in value. ✨");
  } else if (data.startsWith("custom_")) {
    const taskId = data.split("_")[1];
    TelegramService.sendMessage(chatId, "To log custom time, please type:\n\n<code>/log " + taskId + " [min_worked] [min_remains] [new_val]</code>");
  }
}

/**
 * Custom /log command handler (can be called from doPost)
 */
// ... Add simple parser if needed

/**
 * Use this to register your webhook with Telegram.
 */
function setWebhook() {
  const url = "https://api.telegram.org/bot" + CONFIG.TELEGRAM_TOKEN + "/setWebhook?url=" + ScriptApp.getService().getUrl();
  const res = UrlFetchApp.fetch(url);
  Logger.log(res.getContentText());
}

/**
 * Triggered when the spreadsheet is opened.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 Marginal Tasker')
      .addItem('Sync All Marginal Values', 'TaskService.syncAllTasks')
      .addItem('Register Telegram Bot (Setup)', 'setWebhook')
      .addItem('Run Cleanup Test', 'runPeriodicCleanup')
      .addItem('Run Daily Summary Test', 'runDailySummary')
      .addToUi();
}

function runPeriodicCleanup() {
    console.log("Running 6-hour cleanup...");
    TaskService.killLowUtilityTasks();
}

function runDailySummary() {
    const authId = PropertiesService.getScriptProperties().getProperty('AUTHORIZED_CHAT_ID');
    if (!authId) return console.log("Missing authorized chatId for summary.");

    console.log("Generating daily stats...");
    const ss = getSpreadsheet();
    // ... logic for log/stats same as before ...

    // Actually update the sheet
    const logSheet = ss.getSheetByName(CONFIG.SHEETS.LOG);
    const statsSheet = ss.getSheetByName(CONFIG.SHEETS.STATS);
    const logs = logSheet.getDataRange().getValues();
    const today = new Date().toDateString();
    let totalValue = 0;
    for (let i = 1; i < logs.length; i++) {
        if (logs[i][0] && new Date(logs[i][0]).toDateString() === today) {
            totalValue += parseFloat(logs[i][5]) || 0;
        }
    }
    statsSheet.appendRow([ new Date(), totalValue ]);
    
    // Automatically send to Telegram too!
    TelegramService.sendDailySummary(authId);
}
