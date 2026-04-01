/**
 * Task Management Service
 */
const TaskService = {
  /**
   * Loads all tasks as Objects.
   */
  getTasks: function() {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.TASKS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    return data.slice(1).map((row, index) => {
      const task = { rowIndex: index + 2 };
      headers.forEach((h, i) => { task[h.trim()] = row[i]; });
      return task;
    });
  },

  /**
   * Calculates the current Marginal Value of a task.
   * If writeToSheet is true, it updates the task's row.
   */
  calculateMV: function(task, writeToSheet = false) {
    const best = parseFloat(task['BestCase']);
    const worst = parseFloat(task['WorstCase']);
    const prob = parseFloat(task['ProbBest']);
    const durationMin = parseFloat(task['DurationMin']);
    
    // Validate inputs
    if (isNaN(best) || isNaN(worst) || isNaN(prob) || isNaN(durationMin) || durationMin <= 0) {
        return 0;
    }

    const expectedValue = (best * prob) + (worst * (1 - prob));
    const mv = expectedValue / (durationMin / 60);

    if (writeToSheet && task.rowIndex) {
        this.updateTaskRow(task.rowIndex, { 'MarginalValue': mv });
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
    const tasks = this.getTasks().filter(t => t['Status'] === 'Active');
    if (tasks.length === 0) return null;
    return tasks.reduce((prev, curr) => (parseFloat(prev['Score']) > parseFloat(curr['Score']) ? prev : curr));
  },

  /**
   * Updates task score and increases by MV.
   */
  markTaskAsChosen: function(taskId) {
    const tasks = this.getTasks();
    const task = tasks.find(t => t['ID'] == taskId);
    if (!task) return;
    const mv = this.calculateMV(task);
    const newScore = (parseFloat(task['Score']) || 1) + mv;
    this.updateTaskRow(task.rowIndex, { 'Score': newScore });
    return task;
  },

  /**
   * Updates task score to 1 after it was worked on.
   */
  resetTaskScore: function(taskId) {
    const tasks = this.getTasks();
    const task = tasks.find(t => t['ID'] == taskId);
    if (!task) return;
    this.updateTaskRow(task.rowIndex, { 'Score': 1 });
  },

  /**
   * Writes specific fields to the sheet for a specific task row.
   */
  updateTaskRow: function(rowIndex, updates) {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.TASKS);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (let key in updates) {
      const colIndex = headers.indexOf(key) + 1;
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
    const task = tasks.find(t => t['ID'] == taskId);
    if (!task) return;
    const durationMin = durationSec / 60;

    const best = parseFloat(task['BestCase']) || 0;
    const worst = parseFloat(task['WorstCase']) || 0;
    const prob = parseFloat(task['ProbBest']) || 0;
    const initialExpectedValue = (best * prob) + (worst * (1 - prob));
    const initialDuration = parseFloat(task['DurationMin']) || 60;
    
    // Total value created = proportional to time, capped at expected value
    // Though we also need to account for what's already created.
    // Simplifying: ValueCreated this session = (durationMin / initialDuration) * initialExpectedValue
    // Actually, user said: "maximum is the maximum expected value for the task"
    
    // Let's find previous work in Log
    const ss = getSpreadsheet();
    const logSheet = ss.getSheetByName(CONFIG.SHEETS.LOG);
    const logData = logSheet.getDataRange().getValues();
    let totalWorkedBefore = 0;
    let totalValueEarnedBefore = 0;
    for (let i = 1; i < logData.length; i++) {
        if (logData[i][1] == taskId) {
            totalWorkedBefore += parseFloat(logData[i][2]) || 0;
            totalValueEarnedBefore += parseFloat(logData[i][5]) || 0;
        }
    }

    const totalExpectedVal = (parseFloat(task['BestCase']) * parseFloat(task['ProbBest'])) + (parseFloat(task['WorstCase']) * (1 - parseFloat(task['ProbBest'])));
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
    const updates = { 'Score': 1 };
    if (remainingMin <= 0 && !task['IsOpenEnded']) {
        updates['Status'] = 'Done';
    }
    if (newValue) {
        // Technically user might want to re-evaluate best/worst. 
        // For simplicity, we'll assume newValue just updates the weight if needed
    }
    this.updateTaskRow(task.rowIndex, updates);
    return sessionValue;
  },

  /**
   * Boosts ALL active tasks (except the excluded one) by their individual Marginal Value.
   */
  boostAllActiveTasks: function(exceptTaskId) {
    const tasks = this.getTasks().filter(t => t['Status'] === 'Active');
    tasks.forEach(t => {
      if (t['ID'] != exceptTaskId) {
        const mv = this.calculateMV(t);
        const currentScore = parseFloat(t['Score']) || 1;
        this.updateTaskRow(t.rowIndex, { 'Score': currentScore + mv });
      }
    });
  },

  /**
   * Kills bottom X% of tasks based on MV.
   */
  killLowUtilityTasks: function() {
    const tasks = this.getTasks().filter(t => t['Status'] === 'Active');
    if (tasks.length === 0) return;

    // Calculate MV for each and sort
    tasks.forEach(t => t.mv = this.calculateMV(t));
    tasks.sort((a, b) => a.mv - b.mv);

    const killCount = Math.max(CONFIG.MIN_KILL_COUNT, Math.ceil(tasks.length * CONFIG.KILL_PERCENTAGE));
    const toKill = tasks.slice(0, killCount);

    toKill.forEach(t => {
      this.updateTaskRow(t.rowIndex, { 'Status': 'Killed' });
    });
    return toKill;
  },

  /**
   * Kills a specific task by ID.
   */
  killSpecificTask: function(taskId) {
    const tasks = this.getTasks();
    const task = tasks.find(t => t['ID'] == taskId);
    if (!task) return;
    this.updateTaskRow(task.rowIndex, { 'Status': 'Killed' });
    this.syncAllTasks();
  },

  /**
   * Adds a new task directly from Telegram input.
   * Syntax: [Name], [BestCase], [WorstCase], [ProbBest], [DurationMin]
   */
  addTask: function(inputStr) {
    const parts = inputStr.split(',').map(s => s.trim());
    if (parts.length < 5) {
      return "⚠️ Format error! Use: \n<code>/new Task Name, Best€, Worst€, Prob(0-1), DurationMin</code>";
    }

    const name = parts[0];
    const best = parseFloat(parts[1]);
    const worst = parseFloat(parts[2]);
    const prob = parseFloat(parts[3]);
    const duration = parseFloat(parts[4]);

    if (isNaN(best) || isNaN(worst) || isNaN(prob) || isNaN(duration)) {
      return "⚠️ One of the values is not a valid number.";
    }

    const id = Date.now().toString().slice(-6); // Simple random ID
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.TASKS);
    
    // Append to sheet
    sheet.appendRow([
        id,
        name,
        best,
        worst,
        prob,
        duration,
        1,       /* Score */
        "Active",/* Status */
        false,   /* IsOpenEnded - default */
        0        /* MV */
    ]);

    this.syncAllTasks(); // Recalculate MV immediately
    return "✅ Task '<b>" + name + "</b>' added with ID: " + id;
  },

  /**
   * Adds task from a JSON object (Web App Form).
   */
  addTaskFromObject: function(data) {
    const name = data.name;
    const best = parseFloat(data.best);
    const worst = parseFloat(data.worst);
    const prob = parseFloat(data.prob);
    const duration = parseFloat(data.duration);

    const id = Date.now().toString().slice(-6);
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.TASKS);
    
    sheet.appendRow([ id, name, best, worst, prob, duration, 1, "Active", false, 0 ]);
    this.syncAllTasks();
    return "🚀 Successfully created task: <b>" + name + "</b>";
  },

  /**
   * Processes data from the LogTask Web App.
   */
  processLogForm: function(data) {
    const taskId = data.taskId;
    const workedMin = parseFloat(data.worked) || 0;
    const finished = data.finished;
    
    const tasks = this.getTasks();
    const task = tasks.find(t => t['ID'] == taskId);
    if (!task) return "Error: Task not found.";

    // Calculate value created (reusing logic from logWork)
    const sessionValue = this.logWork(taskId, workedMin * 60, 0, null);

    // Update with new valuations if provided
    const updates = { 'Score': 1 };
    if (data.newMin) updates['WorstCase'] = parseFloat(data.newMin);
    if (data.newMax) updates['BestCase'] = parseFloat(data.newMax);
    
    const remH = parseFloat(data.remH) || 0;
    const remM = parseFloat(data.remM) || 0;
    const totalRemMin = (remH * 60) + remM;
    if (totalRemMin > 0) updates['DurationMin'] = totalRemMin;
    if (finished) updates['Status'] = 'Done';
    
    // 3. Update task
    this.updateTaskRow(task.rowIndex, updates);

    // 4. Global escalation: Boost ALL OTHER tasks
    this.boostAllActiveTasks(taskId);
    
    // 5. Final sync
    this.syncAllTasks();

    return "✅ Progress logged for <b>" + task['Name'] + "</b>.\n" +
           "🕒 Time: " + workedMin + " min\n" +
           "💎 Value generated: " + (sessionValue || 0).toFixed(2) + " €";
  }
};
