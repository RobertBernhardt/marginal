/**
 * Task Management Service
 */
const TaskService = {
  // column mapping to match your spreadsheet headers exactly
  COL: {
    ID: 1, NAME: 2, BEST: 3, WORST: 4, PROB: 5, DUR: 6, SCORE: 7, MV: 8, STATUS: 9, OPEN: 10
  },

  /**
   * Loads all tasks as Objects.
   */
  getTasks: function() {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.TASKS);
    const data = sheet.getDataRange().getValues();
    return data.slice(1).map((row, index) => ({
      rowIndex: index + 2,
      id: row[this.COL.ID-1],
      name: row[this.COL.NAME-1],
      best: parseFloat(row[this.COL.BEST-1]) || 0,
      worst: parseFloat(row[this.COL.WORST-1]) || 0,
      prob: parseFloat(row[this.COL.PROB-1]) || 0,
      dur: parseFloat(row[this.COL.DUR-1]) || 1, // Avoid division by zero
      score: parseFloat(row[this.COL.SCORE-1]) || 1,
      status: row[this.COL.STATUS-1],
      isOpen: row[this.COL.OPEN-1],
      mv: parseFloat(row[this.COL.MV-1]) || 0
    }));
  },

  /**
   * Calculates the current Marginal Value of a task.
   */
  calculateMV: function(task, writeToSheet = false) {
    if (isNaN(task.best) || task.dur <= 0) return 0;

    const expectedValue = (task.best * task.prob) + (task.worst * (1 - task.prob));
    const mv = expectedValue / (task.dur / 60);

    if (writeToSheet && task.rowIndex) {
        const ss = getSpreadsheet();
        const sheet = ss.getSheetByName(CONFIG.SHEETS.TASKS);
        sheet.getRange(task.rowIndex, this.COL.MV).setValue(mv);
    }
    return mv;
  },

  /**
   * Recalculates MV for all tasks and updates the sheet.
   */
  syncAllTasks: function() {
    const tasks = this.getTasks();
    tasks.forEach(t => this.calculateMV(t, true));
  },

  /**
   * Finds the active task with the highest current score.
   */
  findNextTask: function() {
    const tasks = this.getTasks().filter(t => t.status === 'Active');
    if (tasks.length === 0) return null;
    return tasks.reduce((prev, curr) => (prev.score > curr.score ? prev : curr));
  },

  /**
   * Updates task score and increases by MV.
   */
  markTaskAsChosen: function(taskId) {
    const tasks = this.getTasks();
    const task = tasks.find(t => t.id == taskId);
    if (!task) return;
    const mv = this.calculateMV(task);
    const newScore = task.score + mv;
    this.updateTaskRow(task.rowIndex, { 'SCORE': newScore });
    return task;
  },

  /**
   * Updates task score to 1 after it was worked on.
   */
  resetTaskScore: function(taskId) {
    const tasks = this.getTasks();
    const task = tasks.find(t => t.id == taskId);
    if (!task) return;
    this.updateTaskRow(task.rowIndex, { 'SCORE': 1 });
  },

  /**
   * Writes specific fields to the sheet for a specific task row.
   */
  updateTaskRow: function(rowIndex, updates) {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.TASKS);
    for (let key in updates) {
      const colIndex = this.COL[key];
      if (colIndex > 0) {
        sheet.getRange(rowIndex, colIndex).setValue(updates[key]);
      }
    }
  },

  /**
   * Logs work session to ActivityLog and updates Statistics.
   */
  logWork: function(taskId, durationSec, remainingMin, newValue) {
    const tasks = this.getTasks();
    const task = tasks.find(t => t.id == taskId);
    if (!task) return;
    const durationMin = durationSec / 60;

    const totalExpectedVal = (task.best * task.prob) + (task.worst * (1 - task.prob));
    const initialDuration = task.dur || 60;
    
    // Let's find previous work in Log
    const ss = getSpreadsheet();
    const logSheet = ss.getSheetByName(CONFIG.SHEETS.LOG);
    const logData = logSheet.getDataRange().getValues();
    let totalValueEarnedBefore = 0;
    for (let i = 1; i < logData.length; i++) {
        if (logData[i][1] == taskId) {
            totalValueEarnedBefore += parseFloat(logData[i][5]) || 0;
        }
    }

    const mvPerMin = totalExpectedVal / initialDuration;
    let sessionValue = durationMin * mvPerMin;
    
    if (totalValueEarnedBefore + sessionValue > totalExpectedVal) {
        sessionValue = Math.max(0, totalExpectedVal - totalValueEarnedBefore);
    }

    logSheet.appendRow([
        new Date(),
        taskId,
        durationMin,
        remainingMin,
        newValue,
        sessionValue
    ]);

    // Update task
    const updates = { 'SCORE': 1 };
    if (remainingMin <= 0 && !task.isOpen) {
        updates['STATUS'] = 'Done';
    }
    this.updateTaskRow(task.rowIndex, updates);
    return sessionValue;
  },

  /**
   * Boosts ALL active tasks (except the excluded one) by their individual Marginal Value.
   */
  boostAllActiveTasks: function(exceptTaskId) {
    const tasks = this.getTasks().filter(t => t.status === 'Active');
    tasks.forEach(t => {
      if (t.id != exceptTaskId) {
        const mv = this.calculateMV(t);
        this.updateTaskRow(t.rowIndex, { 'SCORE': t.score + mv });
      }
    });
  },

  /**
   * Kills bottom X% of tasks based on MV.
   */
  killLowUtilityTasks: function() {
    const tasks = this.getTasks().filter(t => t.status === 'Active');
    if (tasks.length === 0) return;

    // Calculate MV for each and sort
    tasks.forEach(t => t.calculatedMv = this.calculateMV(t));
    tasks.sort((a, b) => a.calculatedMv - b.calculatedMv);

    const killCount = Math.max(CONFIG.MIN_KILL_COUNT, Math.ceil(tasks.length * CONFIG.KILL_PERCENTAGE));
    const toKill = tasks.slice(0, killCount);

    toKill.forEach(t => {
      this.updateTaskRow(t.rowIndex, { 'STATUS': 'Killed' });
    });
    return toKill;
  },

  /**
   * Kills a specific task by ID.
   */
  killSpecificTask: function(taskId) {
    const tasks = this.getTasks();
    const task = tasks.find(t => t.id == taskId);
    if (!task) return;
    this.updateTaskRow(task.rowIndex, { 'STATUS': 'Killed' });
    this.syncAllTasks();
  },

  /**
   * Adds a new task directly from Telegram input.
   */
  addTask: function(inputStr) {
    const parts = inputStr.split(',').map(s => s.trim());
    if (parts.length < 5) return "⚠️ Format error!";

    const data = {
      name: parts[0],
      best: parts[1],
      worst: parts[2],
      prob: parts[3],
      duration: parts[4]
    };
    return this.addTaskFromObject(data);
  },

  /**
   * Adds task from a JSON object (Web App Form).
   */
  addTaskFromObject: function(data) {
    const id = Date.now().toString().slice(-6);
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.TASKS);
    
    // fix: append in the correct column order according to COL mapping
    const row = new Array(10).fill("");
    row[this.COL.ID-1] = id;
    row[this.COL.NAME-1] = data.name;
    row[this.COL.BEST-1] = parseFloat(data.best);
    row[this.COL.WORST-1] = parseFloat(data.worst);
    row[this.COL.PROB-1] = parseFloat(data.prob);
    row[this.COL.DUR-1] = parseFloat(data.duration);
    row[this.COL.SCORE-1] = 1;
    row[this.COL.STATUS-1] = "Active";
    row[this.COL.OPEN-1] = false;
    row[this.COL.MV-1] = 0;

    sheet.appendRow(row);
    this.syncAllTasks();
    return "🚀 Successfully created task: <b>" + data.name + "</b>";
  },

  /**
   * Processes data from the LogTask Web App.
   */
  processLogForm: function(data) {
    const taskId = data.taskId;
    const workedMin = parseFloat(data.worked) || 0;
    const finished = data.finished;
    
    const tasks = this.getTasks();
    const task = tasks.find(t => t.id == taskId);
    if (!task) return "Error: Task not found.";

    const sessionValue = this.logWork(taskId, workedMin * 60, 0, null);

    const updates = { 'SCORE': 1 };
    if (data.newMin) updates['WORST'] = parseFloat(data.newMin);
    if (data.newMax) updates['BEST'] = parseFloat(data.newMax);
    
    const remH = parseFloat(data.remH) || 0;
    const remM = parseFloat(data.remM) || 0;
    const totalRemMin = (remH * 60) + remM;
    if (totalRemMin > 0) updates['DUR'] = totalRemMin;
    if (finished) updates['STATUS'] = 'Done';
    
    this.updateTaskRow(task.rowIndex, updates);
    this.boostAllActiveTasks(taskId);
    this.syncAllTasks();

    return "✅ Progress logged for <b>" + task.name + "</b>.\n" +
           "🕒 Time: " + workedMin + " min\n" +
           "💎 Value generated: " + (sessionValue || 0).toFixed(2) + " €";
  }
};
