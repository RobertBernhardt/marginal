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
  }
};
