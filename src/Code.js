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
  let update;
  try {
    update = JSON.parse(e.postData.contents);
  } catch (err) {
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
              const result = TaskService.addTaskFromObject(data);
              TelegramService.sendMessage(chatId, result);
          }
      } else if (text === "/start" || text === "help") {
        TelegramService.sendMessage(chatId, "<b>Welcome!</b>\n- 🎯 <i>next</i>: Show top task.\n- 🆕 <i>new</i>: Add task via form.\n- 📊 <i>summary</i>: See today's value.");
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
    if (update && update.message) {
      TelegramService.sendMessage(update.message.chat.id.toString(), "⚠️ <b>Error:</b> " + error.toString());
    }
  }
  
  // mandatory for GAS web apps
  return ContentService.createTextOutput("OK");
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
 * Use this to register your webhook and set up your initial triggers.
 */
function setupSystem() {
  setWebhook();
  createTriggers();
  SpreadsheetApp.getUi().alert("✅ System Registered! Webhook linked and Triggers set up.");
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
      .addItem('Full System Setup (Run Me)', 'setupSystem')
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
