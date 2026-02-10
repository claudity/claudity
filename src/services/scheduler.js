const { stmts } = require('../db');

let chatModule = null;
let timer = null;

function start() {
  chatModule = require('./chat');
  timer = setInterval(tick, 30000);
  tick();
}

function stop() {
  if (timer) clearInterval(timer);
}

function tick() {
  const now = Date.now();
  const due = stmts.dueSchedules.all(now);

  for (const schedule of due) {
    stmts.updateScheduleRun.run(now, now + schedule.interval_ms, schedule.id);

    chatModule.enqueueMessage(
      schedule.agent_id,
      `[scheduled reminder] ${schedule.description}`
    ).catch(err => {
      console.log(`[scheduler] schedule ${schedule.id} failed: ${err.message}`);
    });
  }
}

module.exports = { start, stop };
