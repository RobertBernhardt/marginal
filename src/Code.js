/**
 * Google Apps Script Entry Point for Telegram Webhook
 */

function doGet(e) {
  const type = e.parameter.type || 'new';
  const taskId = e.parameter.taskId || '';
  const open = e.parameter.open || 'false';
  
  let template = 'NewTaskForm';
  if (type === 'log') template = 'LogTaskForm';
  
  const html = HtmlService.createTemplateFromFile(template);
  return html.evaluate()
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setTitle('Marginal Tasker')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // this is the key
}

function doPost(e) {
  LoggerService.log("GAS_ENTRY", "Request received", e.postData.contents);
  
  let update;
  try {
    update = JSON.parse(e.postData.contents);
    
    // log specifically if web_app_data exists
    if (update.message && update.message.web_app_data) {
      LoggerService.log("WEB_APP_DATA", "Data received", update.message.web_app_data.data);
    }

  } catch (err) {
    LoggerService.log("GAS_ERROR_PARSE", err.toString());
    return ContentService.createTextOutput("OK");
  }

  try {
    const props = PropertiesService.getScriptProperties();

    if (update.message) {
      const chatId = update.message.chat.id.toString();
      const text = update.message.text ? update.message.text.toLowerCase().trim() : "";

      let authorizedId = props.getProperty('AUTHORIZED_CHAT_ID');
      
      if (!authorizedId && (text === "/start" || text === "start")) {
        props.setProperty('AUTHORIZED_CHAT_ID', chatId);
        authorizedId = chatId;
        TelegramService.sendMessage(chatId, "<b>Auth Successful!</b> You are now the master of this bot.");
      }
      
      if (authorizedId && chatId !== authorizedId) {
        TelegramService.sendMessage(chatId, "Unauthorized user.");
      } else if (update.message.web_app_data) {
          const data = JSON.parse(update.message.web_app_data.data);
          if (data.type === 'log') {
              const result = TaskService.processLogForm(data);
              TelegramService.sendMessage(chatId, result);
              if (data.finished) {
                  const next = TaskService.findNextTask();
                  if (next) TelegramService.sendTaskCard(chatId, next, "CONGRATS! NEXT UP");
              }
          } else {
              LoggerService.log("DATA_RECEIVED", "Processing new task", data);
              const result = TaskService.addTaskFromObject(data);
              TelegramService.sendMessage(chatId, result);
              
              // Immediately show the next task to keep the loop going
              const nextTask = TaskService.findNextTask();
              if (nextTask) {
                TelegramService.sendTaskCard(chatId, nextTask, "CONGRATS! NEXT UP");
              }
          }
      } else if (text === "/start" || text === "help") {
        TelegramService.sendNewTaskForm(chatId); // This sends the keyboard as well
        TelegramService.sendMessage(chatId, "<b>Welcome!</b>\n- 🎯 <i>next</i>: Show top task.\n- 🆕 Add tasks via keyboard button.\n- 📊 <i>summary</i>: See today's value.");
      } else if (text === "next" || text === "continue") {
        const task = TaskService.findNextTask();
        if (!task) {
          TelegramService.sendMessage(chatId, "No active tasks.");
        } else {
          TelegramService.sendTaskCard(chatId, task, "PICKED");
        }
      } else if (text === "summary") {
        TaskService.syncAllTasks();
        TelegramService.sendDailySummary(chatId);
      } else if (text === "new") {
        TelegramService.sendNewTaskForm(chatId);
      }
    } else if (update.callback_query) {
      handleCallbackQuery(update.callback_query);
    }
  } catch (error) {
    LoggerService.log("GAS_ERROR_EXEC", error.toString());
    if (update && update.message) {
      TelegramService.sendMessage(update.message.chat.id.toString(), "⚠️ <b>Error:</b> " + error.toString());
    }
  }
  
  // mandatory for GAS web apps
  return ContentService.createTextOutput("OK");
}

/**
 * Manually reset the authentication if needed.
 */
function resetAuth() {
  PropertiesService.getScriptProperties().deleteProperty('AUTHORIZED_CHAT_ID');
  console.log("Auth cleared. Send /start to your bot now.");
}

/**
 * Handle button clicks from Inline Keyboard.
 */
function handleCallbackQuery(query) {
  const chatId = query.message.chat.id.toString();
  const callbackId = query.id;
  const data = query.data;

  if (data.startsWith("log_")) {
    const parts = data.split("_");
    const taskId = parts[1];
    const durationMin = parseFloat(parts[2]);
    const sessionValue = TaskService.logWork(taskId, durationMin * 60, 0, null);
    
    TelegramService.answerCallback(callbackId, "Logged " + durationMin + "m! ✅");
    TelegramService.sendMessage(chatId, "<b>Nice!</b> You created " + (sessionValue || 0).toFixed(2) + " € in value. ✨");
  } else if (data.startsWith("skip_")) {
    const taskId = data.split("_")[1];
    TaskService.resetTaskScore(taskId);
    TaskService.boostAllActiveTasks(taskId);
    TelegramService.answerCallback(callbackId, "Skipped!");
    TelegramService.sendMessage(chatId, "Task skipped. Global priority increased for others.");

    const next = TaskService.findNextTask();
    if (next) TelegramService.sendTaskCard(chatId, next, "NEXT UP");
  } else if (data.startsWith("kill_")) {
    const taskId = data.split("_")[1];
    TaskService.killSpecificTask(taskId);
    TelegramService.answerCallback(callbackId, "Killed!");
    TelegramService.sendMessage(chatId, "Task killed.");

    const next = TaskService.findNextTask();
    if (next) TelegramService.sendTaskCard(chatId, next, "NEXT UP");
  }
}

/**
 * Custom /log command handler (can be called from doPost)
 */
// ... Add simple parser if needed

/**
 * Use this to set up your triggers. 
 * NOTE: setWebhook() is NOT called here because you use a Cloudflare proxy.
 */
function setupSystem() {
  createTriggers();
  SpreadsheetApp.getUi().alert("✅ Triggers created! NOTE: Webhook registration skipped. Ensure your Cloudflare Worker is pointing to this script's /exec URL.");
}

function createTriggers() {
  // Delete existing triggers to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));

  // 6-hour cleanup trigger
  ScriptApp.newTrigger("runPeriodicCleanup")
      .timeBased()
      .everyHours(6)
      .create();

  // Daily summary trigger (e.g., at midnight)
  ScriptApp.newTrigger("runDailySummary")
      .timeBased()
      .atHour(23)
      .everyDays(1)
      .create();
}

/**
 * DANGER: Use this only if you want to bypass your Cloudflare proxy.
 */
function setWebhook() {
  const url = "https://api.telegram.org/bot" + CONFIG.TELEGRAM_TOKEN + "/setWebhook?url=" + ScriptApp.getService().getUrl();
  const res = UrlFetchApp.fetch(url);
  Logger.log(res.getContentText());
  SpreadsheetApp.getUi().alert("⚠️ Webhook updated directly to GAS. This may break your Cloudflare proxy!");
}

/**
 * Triggered when the spreadsheet is opened.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 Marginal Tasker')
      .addItem('Sync All Marginal Values', 'TaskService.syncAllTasks')
      .addItem('Reset / Clear Auth Lock', 'resetAuth')
      .addItem('Update Triggers (Safe)', 'setupSystem')
      .addItem('⚠️ EMERGENCY: Update Webhook (GAS ONLY)', 'setWebhook')
      .addSeparator()
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
