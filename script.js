(function () {
  'use strict';

  const STORAGE_PREFIX = 'artale_event_';
  let timerInterval = null;
  let currentEventId = null;

  // ===== Date/Time Utilities =====

  function getUTCDateKey(date) {
    const d = date || new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function getMostRecentThursday(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay();
    const diff = (day - 4 + 7) % 7;
    d.setUTCDate(d.getUTCDate() - diff);
    return d;
  }

  function getPeriodKey(taskType, date, eventStartDate) {
    const now = date || new Date();
    switch (taskType) {
      case 'daily':
        return getUTCDateKey(now);
      case 'weekly':
        return getUTCDateKey(getMostRecentThursday(now));
      case 'biweekly': {
        const start = new Date(eventStartDate + 'T00:00:00Z');
        const currentThursday = getMostRecentThursday(now);
        const diffMs = currentThursday.getTime() - start.getTime();
        const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
        const period = Math.floor(diffWeeks / 2);
        return `bw_${period}`;
      }
      case 'onetime':
        return 'once';
      default:
        return getUTCDateKey(now);
    }
  }

  function getNextDailyReset() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  }

  function getNextWeeklyReset() {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = today.getUTCDay();
    let daysUntil = (4 - day + 7) % 7;
    if (daysUntil === 0) daysUntil = 7;
    return new Date(today.getTime() + daysUntil * 24 * 60 * 60 * 1000);
  }

  function getNextBiweeklyReset(eventStartDate) {
    const start = new Date(eventStartDate + 'T00:00:00Z');
    const now = new Date();
    const currentThursday = getMostRecentThursday(now);
    const diffMs = currentThursday.getTime() - start.getTime();
    const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
    const currentPeriod = Math.floor(diffWeeks / 2);
    const nextPeriodWeek = (currentPeriod + 1) * 2;
    return new Date(start.getTime() + nextPeriodWeek * 7 * 24 * 60 * 60 * 1000);
  }

  function formatCountdown(ms) {
    if (ms <= 0) return '00:00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    if (days > 0) {
      return `${days}d ${hh}:${mm}:${ss}`;
    }
    return `${hh}:${mm}:${ss}`;
  }

  function formatResetLabel(ms) {
    if (ms <= 0) return '已重置';
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    if (days > 0) {
      return `還有${days}天${hh}:${mm}:${ss}重置`;
    }
    return `還有${hh}:${mm}:${ss}重置`;
  }

  function formatLocalTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
  }

  function getEventStatus(event) {
    const now = new Date();
    const start = new Date(event.startDate + 'T00:00:00Z');
    const end = new Date(event.endDate + 'T00:00:00Z');
    if (now < start) return 'upcoming';
    if (now >= end) return 'ended';
    return 'active';
  }

  function getEventWeekNumber(eventStartDate) {
    const start = new Date(eventStartDate + 'T00:00:00Z');
    const now = new Date();
    const currentThursday = getMostRecentThursday(now);
    const diffMs = currentThursday.getTime() - start.getTime();
    const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
    return diffWeeks + 1;
  }

  function getCardReward(task, selectedCard, eventStartDate) {
    if (!task.cardSelect) return task.reward || 0;
    const option = task.cardSelect.find(c => c.card === selectedCard);
    if (!option) return 0;
    if (option.bonusWeeks) {
      const weekNum = getEventWeekNumber(eventStartDate);
      return option.bonusWeeks.includes(weekNum) ? option.reward : 0;
    }
    return option.reward;
  }

  // ===== Helpers =====

  function findTask(event, taskId) {
    for (const type of ['daily', 'weekly', 'biweekly', 'onetime']) {
      const found = (event.tasks[type] || []).find(t => t.id === taskId);
      if (found) return found;
    }
    return null;
  }

  function getTaskUnitReward(task) {
    if (task.claims) return task.rewardPerClaim;
    if (task.cardSelect) return 1;
    return task.reward;
  }

  const PENCIL_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L3.463 11.1l-.47 1.642 1.642-.47 8.61-8.61a.25.25 0 0 0 0-.354l-1.086-1.086Z"/></svg>';

  function getSelectedEvent() {
    const saved = localStorage.getItem('artale_selected_event');
    const sorted = [...EVENTS].sort((a, b) => b.startDate.localeCompare(a.startDate));
    return sorted.find(e => e.id === saved) || sorted[0];
  }

  // ===== History Helpers =====

  function addHistoryEntry(state, type, source, amount) {
    if (!state.history) state.history = {};
    const dateKey = getUTCDateKey(new Date());
    if (!state.history[dateKey]) state.history[dateKey] = {};
    const key = type + ':' + source;
    if (state.history[dateKey][key]) {
      state.history[dateKey][key].amount += amount;
    } else {
      state.history[dateKey][key] = { type, source, amount };
    }
  }

  function removeHistoryEntry(state, type, source, amount) {
    if (!state.history) return;
    const key = type + ':' + source;
    const dates = Object.keys(state.history).sort().reverse();
    for (const dateKey of dates) {
      const dayMap = state.history[dateKey];
      if (dayMap[key]) {
        dayMap[key].amount -= amount;
        if (dayMap[key].amount <= 0) {
          delete dayMap[key];
        }
        if (Object.keys(dayMap).length === 0) delete state.history[dateKey];
        return;
      }
    }
  }

  function migrateHistoryArrayToMap(state) {
    if (!state.history) return;
    for (const dateKey in state.history) {
      const dayData = state.history[dateKey];
      if (!Array.isArray(dayData)) continue;
      const dayMap = {};
      for (const entry of dayData) {
        const key = entry.type + ':' + entry.source;
        if (dayMap[key]) {
          dayMap[key].amount += entry.amount;
        } else {
          dayMap[key] = { type: entry.type, source: entry.source, amount: entry.amount };
        }
      }
      state.history[dateKey] = dayMap;
    }
  }

  function migrateStateToHistory(event, state) {
    if (state.history && Object.keys(state.history).length > 0) return false;

    const hasOldData = Object.values(state.tasks).some(t => t.totalReward > 0) ||
      state.checkin.count > 0 ||
      Object.values(state.shop).some(v => v > 0);
    if (!hasOldData) return false;

    state.history = {};
    const dateKey = getUTCDateKey(new Date());
    state.history[dateKey] = {};

    for (const taskId in state.tasks) {
      const totalReward = state.tasks[taskId].totalReward || 0;
      if (totalReward > 0) {
        state.history[dateKey]['earn:' + taskId] = { type: 'earn', source: taskId, amount: totalReward };
      }
      delete state.tasks[taskId].totalReward;
    }

    for (const m of event.checkin.milestones) {
      if (state.checkin.count >= m.day) {
        const source = `checkin_day${m.day}`;
        state.history[dateKey]['earn:' + source] = { type: 'earn', source, amount: m.reward };
      }
    }

    for (const item of event.shop) {
      const qty = state.shop[item.id] || 0;
      if (qty > 0) {
        state.history[dateKey]['spend:' + item.id] = { type: 'spend', source: item.id, amount: qty * item.cost };
      }
    }

    if (Object.keys(state.history[dateKey]).length === 0) delete state.history[dateKey];

    return true;
  }

  // ===== Section Collapse Persistence =====

  function loadCollapsedState() {
    try {
      const raw = localStorage.getItem('artale_collapsed');
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function isSectionCollapsed(sectionKey) {
    return loadCollapsedState()[sectionKey] || false;
  }

  function toggleCollapsedState(sectionKey) {
    const state = loadCollapsedState();
    state[sectionKey] = !state[sectionKey];
    localStorage.setItem('artale_collapsed', JSON.stringify(state));
    return state[sectionKey];
  }

  // ===== State Management =====

  function getDefaultState() {
    return {
      tasks: {},
      checkin: { count: 0, lastDate: null },
      shop: {},
      history: {}
    };
  }

  function loadState(eventId) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + eventId);
      if (raw) {
        const parsed = JSON.parse(raw);
        const state = Object.assign(getDefaultState(), parsed);
        migrateHistoryArrayToMap(state);
        return state;
      }
    } catch (e) {
      console.warn('Failed to load state:', e);
    }
    return getDefaultState();
  }

  function saveState(eventId, state) {
    try {
      localStorage.setItem(STORAGE_PREFIX + eventId, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save state:', e);
    }
  }

  // ===== Business Logic =====

  function isTaskCompleted(taskId, taskType, state, eventStartDate) {
    const taskState = state.tasks[taskId];
    if (!taskState || !taskState.currentPeriod) return false;
    const currentPeriod = getPeriodKey(taskType, new Date(), eventStartDate);
    return taskState.currentPeriod === currentPeriod;
  }

  function getTaskCurrentClaims(taskId, taskType, state, eventStartDate) {
    const taskState = state.tasks[taskId];
    if (!taskState || !taskState.currentPeriod) return 0;
    const currentPeriod = getPeriodKey(taskType, new Date(), eventStartDate);
    if (taskState.currentPeriod !== currentPeriod) return 0;
    return taskState.currentClaims || 0;
  }

  function calculateTotals(event, state) {
    let totalEarned = 0;
    let totalSpent = 0;

    if (state.history) {
      for (const dateKey in state.history) {
        const dayMap = state.history[dateKey];
        for (const key in dayMap) {
          const entry = dayMap[key];
          if (entry.type === 'earn') totalEarned += entry.amount;
          else if (entry.type === 'spend') totalSpent += entry.amount;
        }
      }
    }

    return {
      earned: totalEarned,
      spent: totalSpent,
      balance: totalEarned - totalSpent
    };
  }

  function calculateMaxEarnable(event) {
    let max = 0;
    const start = new Date(event.startDate + 'T00:00:00Z');
    const end = new Date(event.endDate + 'T00:00:00Z');
    const totalDays = Math.floor((end - start) / (24 * 60 * 60 * 1000));
    const totalWeeks = Math.ceil(totalDays / 7);
    const totalBiweeks = Math.ceil(totalWeeks / 2);

    for (const type of ['daily', 'weekly', 'biweekly', 'onetime']) {
      const tasks = event.tasks[type] || [];
      for (const task of tasks) {
        let periods;
        switch (type) {
          case 'daily': periods = totalDays; break;
          case 'weekly': periods = totalWeeks; break;
          case 'biweekly': periods = totalBiweeks; break;
          case 'onetime': periods = 1; break;
        }
        if (task.cardSelect) {
          for (let w = 1; w <= totalWeeks; w++) {
            let bestReward = 0;
            for (const opt of task.cardSelect) {
              let r = opt.reward;
              if (opt.bonusWeeks && !opt.bonusWeeks.includes(w)) r = 0;
              bestReward = Math.max(bestReward, r);
            }
            max += bestReward;
          }
        } else {
          max += task.reward * periods;
        }
        if (task.streakBonus) {
          max += task.streakBonus.reward;
        }
      }
    }

    for (const m of event.checkin.milestones) {
      max += m.reward;
    }

    return max;
  }

  // ===== Rendering =====

  function renderApp() {
    const app = document.getElementById('app');
    if (!app || typeof EVENTS === 'undefined' || EVENTS.length === 0) return;

    const selected = getSelectedEvent();
    currentEventId = selected.id;
    const state = loadState(selected.id);

    if (migrateStateToHistory(selected, state)) {
      saveState(selected.id, state);
    }

    let html = renderEventSelector(selected.id);
    html += renderEventContent(selected, state);
    app.innerHTML = html;

    bindEventSelector();
    bindEventHandlers(selected, state);

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimers, 1000);
    updateTimers();
  }

  function renderEventSelector(selectedId) {
    const sorted = [...EVENTS].sort((a, b) => b.startDate.localeCompare(a.startDate));

    let tabsHtml = '';
    for (const event of sorted) {
      const isActive = event.id === selectedId;
      const status = getEventStatus(event);
      const statusText = { active: '進行中', upcoming: '即將開始', ended: '已結束' }[status];
      tabsHtml += `
        <button class="event-tab ${isActive ? 'active' : ''}" data-event-id="${event.id}">
          <span class="event-tab-name">${event.name}</span>
          <span class="event-tab-badge ${status}">${statusText}</span>
        </button>
      `;
    }

    const selected = sorted.find(e => e.id === selectedId);
    const dateInfo = `${selected.startDate.replace(/-/g, '/')} ~ ${selected.endDate.replace(/-/g, '/')} (結束日不含)`;

    return `
      <div class="event-selector-wrapper">
        <div class="event-selector">${tabsHtml}</div>
        <div class="event-dates" id="eventDates">${dateInfo}</div>
      </div>
    `;
  }

  function renderEventContent(event, state) {
    const totals = calculateTotals(event, state);

    return `
      <div class="event" data-event-id="${event.id}">
        ${renderTimeInfo(event)}
        ${renderSummary(event, state, totals)}
        ${renderCheckin(event, state)}
        ${renderTasks(event, state)}
        ${renderShop(event, state)}
        ${renderResetButton(event)}
      </div>
    `;
  }

  function renderTimeInfo(event) {
    return `
      <div class="time-info">
        <div class="current-time" id="currentTime-${event.id}">
          目前時間：${formatLocalTime(new Date())}
        </div>
        <div class="reset-timers">
          <div class="reset-item">
            <span class="reset-label">每日重置</span>
            <span class="reset-countdown" id="dailyReset-${event.id}">--:--:--</span>
          </div>
          <div class="reset-item">
            <span class="reset-label">每週重置 (四)</span>
            <span class="reset-countdown" id="weeklyReset-${event.id}">--:--:--</span>
          </div>
          <div class="reset-item">
            <span class="reset-label">雙週重置</span>
            <span class="reset-countdown" id="biweeklyReset-${event.id}">--:--:--</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderSummary(event, state, totals) {
    const maxEarnable = calculateMaxEarnable(event);
    const remaining = maxEarnable - totals.earned;
    const totalShopCost = event.shop.reduce((sum, item) => sum + item.cost * item.maxQty, 0);
    return `
      <div class="summary">
        <div class="summary-card earned" data-filter="earn" data-event="${event.id}">
          <span class="summary-value" id="totalEarned-${event.id}">${totals.earned}</span>
          <span class="summary-label">已獲得 ${event.currency}</span>
          <span class="summary-subtitle" id="earnedSubtitle-${event.id}">活動結束前還可以獲得: ${remaining} 個${event.currency}</span>
        </div>
        <div class="summary-card spent" data-filter="spend" data-event="${event.id}">
          <span class="summary-value" id="totalSpent-${event.id}">${totals.spent}</span>
          <span class="summary-label">已使用 ${event.currency}</span>
          <span class="summary-subtitle">買完商店道具需要: ${totalShopCost} 個${event.currency}</span>
        </div>
        <div class="summary-card balance">
          <span class="summary-value" id="balance-${event.id}">${totals.balance}</span>
          <span class="summary-label">目前持有 ${event.currency}</span>
        </div>
      </div>
    `;
  }

  function renderCheckin(event, state) {
    const count = state.checkin.count;
    const maxDays = event.checkin.maxDays;
    const todayKey = getUTCDateKey(new Date());
    const checkedInToday = state.checkin.lastDate === todayKey;
    const pct = Math.min((count / maxDays) * 100, 100);

    let milestonesHtml = '';
    let markersHtml = '';
    for (const m of event.checkin.milestones) {
      const reached = count >= m.day;
      const pos = (m.day / maxDays) * 100;
      milestonesHtml += `
        <div class="milestone-item ${reached ? 'reached' : ''}">
          <span class="milestone-check">${reached ? '&#10003;' : '&#9675;'}</span>
          <span>第${m.day}天：+${m.reward} ${event.currency}</span>
        </div>
      `;
      markersHtml += `<div class="milestone-marker ${reached ? 'reached' : ''}" style="left: ${pos}%" title="第${m.day}天"></div>`;
    }

    let btnHtml;
    if (checkedInToday) {
      btnHtml = `
        <span style="color: var(--success); font-weight: 600;">&#10003; 今日已簽到</span>
        <button class="btn-checkin-undo" id="checkinUndo-${event.id}">取消</button>
      `;
    } else if (count >= maxDays) {
      btnHtml = `<span style="color: var(--success); font-weight: 600;">&#10003; 簽到完成</span>`;
    } else {
      btnHtml = `<button class="btn-checkin" id="checkinBtn-${event.id}">今日簽到</button>`;
    }

    const checkinCollapsed = isSectionCollapsed(`checkin-${event.id}`);
    const doneLabel = checkedInToday
      ? '<span class="section-done-label">本日已完成</span>'
      : '';

    return `
      <div class="section" id="checkinSection-${event.id}">
        <div class="section-header${checkedInToday ? ' section-header-done' : ''}" data-section="checkin-${event.id}">
          <h3>每日簽到</h3>
          ${doneLabel}
          <span class="toggle-icon${checkinCollapsed ? ' collapsed' : ''}" id="toggleIcon-checkin-${event.id}">&#9660;</span>
        </div>
        <div class="section-body${checkinCollapsed ? ' collapsed' : ''}" id="sectionBody-checkin-${event.id}">
          <div class="checkin-status" id="checkinStatus-${event.id}">
            <div class="checkin-text-group">
              <span class="checkin-text">已簽到 <strong>${count}</strong> / ${maxDays} 天</span>
              <button class="btn-edit-past btn-edit-past-checkin" id="editCheckin-${event.id}" title="編輯簽到紀錄">${PENCIL_SVG}</button>
            </div>
            <div>${btnHtml}</div>
          </div>
          <div class="checkin-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${pct}%"></div>
              <div class="milestone-markers">${markersHtml}</div>
            </div>
          </div>
          <div class="milestone-list">${milestonesHtml}</div>
        </div>
      </div>
    `;
  }

  function renderTasks(event, state) {
    const typeLabels = {
      daily: '每日任務',
      weekly: '每週任務',
      biweekly: '每2週任務',
      onetime: '一次性任務'
    };

    let groupsHtml = '';
    for (const type of ['daily', 'weekly', 'biweekly', 'onetime']) {
      const tasks = event.tasks[type];
      if (!tasks || tasks.length === 0) continue;

      let tasksHtml = '';
      for (const task of tasks) {
        if (task.claims) {
          // Multi-claim task: +/- UI
          tasksHtml += renderMultiClaimTask(event, state, task, type);
        } else {
          // Single checkbox task
          tasksHtml += renderCheckboxTask(event, state, task, type);
        }
      }

      const countdownId = type !== 'onetime' ? `taskGroupReset-${event.id}-${type}` : null;
      const countdownHtml = countdownId
        ? `<span class="task-group-countdown" id="${countdownId}"></span>`
        : '';

      groupsHtml += `
        <div class="task-group">
          <div class="task-group-header">
            <span>${typeLabels[type]}</span>
            <div class="task-group-header-right">
              ${countdownHtml}
              <span class="task-group-npc-label">任務NPC</span>
              <span class="task-group-edit-label">補登</span>
            </div>
          </div>
          ${tasksHtml}
        </div>
      `;
    }

    const tasksCollapsed = isSectionCollapsed(`tasks-${event.id}`);

    return `
      <div class="section" id="tasksSection-${event.id}">
        <div class="section-header" data-section="tasks-${event.id}">
          <h3>任務列表</h3>
          <span class="toggle-icon${tasksCollapsed ? ' collapsed' : ''}" id="toggleIcon-tasks-${event.id}">&#9660;</span>
        </div>
        <div class="section-body${tasksCollapsed ? ' collapsed' : ''}" id="sectionBody-tasks-${event.id}">
          ${groupsHtml}
        </div>
      </div>
    `;
  }

  function renderCheckboxTask(event, state, task, type) {
    const completed = isTaskCompleted(task.id, type, state, event.startDate);
    const taskState = state.tasks[task.id];

    let rewardHtml;
    let cardSelectHtml = '';
    let cardInfoHtml = '';
    let extraClass = '';

    if (task.cardSelect) {
      const selectedCard = (taskState && taskState.selectedCard) || task.cardSelect[0].card;
      const reward = getCardReward(task, selectedCard, event.startDate);
      const selectedOption = task.cardSelect.find(c => c.card === selectedCard);

      let options = '';
      for (const opt of task.cardSelect) {
        options += `<option value="${opt.card}" ${selectedCard === opt.card ? 'selected' : ''}>${opt.label}</option>`;
      }
      cardSelectHtml = `<select class="card-select" data-event="${event.id}" data-task="${task.id}" data-type="${type}">${options}</select>`;

      if (reward > 0) {
        rewardHtml = `<span class="task-reward">+${reward} ${event.currency}</span>`;
      } else if (selectedOption && selectedOption.altRewardLabel) {
        rewardHtml = `<span class="task-reward task-reward-alt">${selectedOption.altRewardLabel}</span>`;
      } else {
        rewardHtml = `<span class="task-reward">+0 ${event.currency}</span>`;
      }

      const card5 = task.cardSelect.find(c => c.bonusWeeks);
      if (card5) {
        extraClass = ' has-card-info';
        const weekNum = getEventWeekNumber(event.startDate);
        const isBonusWeek = card5.bonusWeeks.includes(weekNum);
        const bonusWeeksLabel = card5.bonusWeeks.join('/');
        const allWeeks = Array.from({ length: 6 }, (_, i) => i + 1);
        const nonBonusWeeks = allWeeks.filter(w => !card5.bonusWeeks.includes(w));

        cardInfoHtml = `
          <div class="card-info${isBonusWeek ? ' bonus-week' : ''}">
            <span>${card5.label}：第${bonusWeeksLabel}週 +${card5.reward}${event.currency} ｜ 第${nonBonusWeeks.join('/')}週 ${card5.altRewardLabel}</span>
            <span class="card-info-week">目前第${weekNum}週</span>
          </div>
        `;
      }
    } else if (task.variable && completed) {
      const currentReward = (taskState && taskState.currentReward) || task.reward;
      let options = '';
      for (let i = task.minReward; i <= task.reward; i++) {
        options += `<option value="${i}" ${currentReward === i ? 'selected' : ''}>${i}</option>`;
      }
      rewardHtml = `
        <span class="task-reward">+</span>
        <select class="task-reward-select" data-event="${event.id}" data-task="${task.id}" data-type="${type}">${options}</select>
        <span class="task-reward">${event.currency}</span>
      `;
    } else if (task.variable) {
      rewardHtml = `<span class="task-reward">+${task.minReward}~${task.reward} ${event.currency}</span>`;
    } else {
      rewardHtml = `<span class="task-reward">+${task.reward} ${event.currency}</span>`;
    }

    return `
      <div class="task-row">
        <div class="task-row-content">
          <div class="task-item${extraClass} ${completed ? 'completed' : ''}" id="taskItem-${event.id}-${task.id}">
            <input type="checkbox" class="task-checkbox"
              id="task-${event.id}-${task.id}"
              data-event="${event.id}"
              data-task="${task.id}"
              data-type="${type}"
              ${task.cardSelect ? 'data-card-select="true"' : `data-reward="${task.reward}" data-min-reward="${task.minReward || task.reward}" data-variable="${!!task.variable}"`}
              ${completed ? 'checked' : ''}>
            <div class="task-info">
              <span class="task-name">${task.name}</span>
              <span class="task-note">${task.note || ''}</span>
            </div>
            ${cardSelectHtml}
            ${rewardHtml}
            ${task.npc ? `<span class="task-npc">${task.npc}</span>` : ''}
          </div>
          ${cardInfoHtml}
        </div>
        <div class="task-row-edit">
          <button class="btn-edit-past" data-event="${event.id}" data-task="${task.id}" data-type="${type}" title="編輯過去紀錄">${PENCIL_SVG}</button>
        </div>
      </div>
    `;
  }

  function renderMultiClaimTask(event, state, task, type) {
    const claims = getTaskCurrentClaims(task.id, type, state, event.startDate);
    const maxClaims = task.claims;
    const isFullyDone = claims >= maxClaims;
    const isPartial = claims > 0 && !isFullyDone;

    let statusClass = '';
    if (isFullyDone) statusClass = 'completed';
    else if (isPartial) statusClass = 'partial';

    let bonusHtml = '';
    let hasBonus = '';
    if (task.streakBonus) {
      hasBonus = ' has-streak-bonus';
      const taskState = state.tasks[task.id];
      const weeksDone = (taskState && taskState.bonusWeeksCounted) ? taskState.bonusWeeksCounted.length : 0;
      const target = task.streakBonus.targetWeeks;
      const bonusClaimed = weeksDone >= target;
      bonusHtml = `
        <div class="streak-bonus${bonusClaimed ? ' claimed' : ''}">
          <span>完成${weeksDone}/${target}週額外獎勵${bonusClaimed ? ' ✓' : ''}</span>
          <span>+${task.streakBonus.reward} ${event.currency}</span>
        </div>
      `;
    }

    return `
      <div class="task-row">
        <div class="task-row-content">
          <div class="task-item${hasBonus} ${statusClass}" id="taskItem-${event.id}-${task.id}">
            <div class="task-claims-control">
              <button class="qty-btn task-qty-btn" data-event="${event.id}" data-task="${task.id}" data-type="${type}" data-action="minus" ${claims <= 0 ? 'disabled' : ''}>-</button>
              <span class="qty-display" id="taskQty-${event.id}-${task.id}">${claims}/${maxClaims}</span>
              <button class="qty-btn task-qty-btn" data-event="${event.id}" data-task="${task.id}" data-type="${type}" data-action="plus" ${claims >= maxClaims ? 'disabled' : ''}>+</button>
            </div>
            <div class="task-info">
              <span class="task-name">${task.name}</span>
              <span class="task-note">${task.note || ''}</span>
            </div>
            <span class="task-reward">+${claims * task.rewardPerClaim}/${task.reward} ${event.currency}</span>
            ${task.npc ? `<span class="task-npc">${task.npc}</span>` : ''}
          </div>
          ${bonusHtml}
        </div>
        <div class="task-row-edit">
          <button class="btn-edit-past" data-event="${event.id}" data-task="${task.id}" data-type="${type}" title="編輯過去紀錄">${PENCIL_SVG}</button>
        </div>
      </div>
    `;
  }

  function renderShop(event, state) {
    let itemsHtml = '';
    for (const item of event.shop) {
      const qty = state.shop[item.id] || 0;
      const totalCost = qty * item.cost;
      const isPurchased = qty > 0;

      let controlHtml;
      if (item.maxQty === 1) {
        controlHtml = `
          <input type="checkbox" class="shop-checkbox"
            id="shop-${event.id}-${item.id}"
            data-event="${event.id}"
            data-item="${item.id}"
            data-cost="${item.cost}"
            data-max="1"
            ${qty > 0 ? 'checked' : ''}>
        `;
      } else {
        controlHtml = `
          <button class="qty-btn" data-event="${event.id}" data-item="${item.id}" data-action="minus" ${qty <= 0 ? 'disabled' : ''}>-</button>
          <span class="qty-display" id="shopQty-${event.id}-${item.id}">${qty}/${item.maxQty}</span>
          <button class="qty-btn" data-event="${event.id}" data-item="${item.id}" data-action="plus" ${qty >= item.maxQty ? 'disabled' : ''}>+</button>
          <button class="qty-btn shop-max-btn" data-event="${event.id}" data-item="${item.id}" ${qty >= item.maxQty ? 'disabled' : ''}>MAX</button>
        `;
      }

      itemsHtml += `
        <div class="shop-item ${isPurchased ? 'purchased' : ''}" id="shopItem-${event.id}-${item.id}">
          <div class="shop-info">
            <span class="shop-name">${item.name}</span>
            <span class="shop-cost">${item.cost} ${event.currency} / 個 ${item.note ? '・' + item.note : ''}</span>
          </div>
          <div class="shop-controls">
            ${controlHtml}
          </div>
          <span class="shop-total-cost" id="shopCost-${event.id}-${item.id}">${totalCost > 0 ? '-' + totalCost : ''}</span>
        </div>
      `;
    }

    const shopCollapsed = isSectionCollapsed(`shop-${event.id}`);

    return `
      <div class="section" id="shopSection-${event.id}">
        <div class="section-header" data-section="shop-${event.id}">
          <h3>${event.currency}商店</h3>
          <span class="toggle-icon${shopCollapsed ? ' collapsed' : ''}" id="toggleIcon-shop-${event.id}">&#9660;</span>
        </div>
        <div class="section-body${shopCollapsed ? ' collapsed' : ''}" id="sectionBody-shop-${event.id}">
          ${itemsHtml}
        </div>
      </div>
    `;
  }

  function renderResetButton(event) {
    return `
      <div class="reset-section">
        <button class="btn-reset" id="resetBtn-${event.id}">重置所有資料</button>
      </div>
    `;
  }

  // ===== Summary Update (without full re-render) =====

  function updateSummaryDisplay(event, state) {
    const totals = calculateTotals(event, state);
    const earnedEl = document.getElementById(`totalEarned-${event.id}`);
    const spentEl = document.getElementById(`totalSpent-${event.id}`);
    const balanceEl = document.getElementById(`balance-${event.id}`);
    if (earnedEl) earnedEl.textContent = totals.earned;
    if (spentEl) spentEl.textContent = totals.spent;
    if (balanceEl) balanceEl.textContent = totals.balance;

    const subtitleEl = document.getElementById(`earnedSubtitle-${event.id}`);
    if (subtitleEl) {
      const maxEarnable = calculateMaxEarnable(event);
      const remaining = maxEarnable - totals.earned;
      subtitleEl.textContent = `活動結束前還可以獲得: ${remaining} 個${event.currency}`;
    }
  }

  // ===== Event Handlers =====

  function bindEventSelector() {
    document.querySelectorAll('.event-tab').forEach(tab => {
      tab.addEventListener('click', function () {
        const eventId = this.dataset.eventId;
        if (eventId === currentEventId) return;
        localStorage.setItem('artale_selected_event', eventId);
        renderApp();
      });
    });
  }

  function bindEventHandlers(event, state) {
    // Section toggle (collapsible) with persistence
    document.querySelectorAll(`[data-section]`).forEach(header => {
      const sectionKey = header.dataset.section;
      if (!sectionKey.endsWith(event.id)) return;
      header.addEventListener('click', function () {
        toggleCollapsedState(sectionKey);
        const body = document.getElementById(`sectionBody-${sectionKey}`);
        const icon = document.getElementById(`toggleIcon-${sectionKey}`);
        if (body) body.classList.toggle('collapsed');
        if (icon) icon.classList.toggle('collapsed');
      });
    });

    // Check-in button
    const checkinBtn = document.getElementById(`checkinBtn-${event.id}`);
    if (checkinBtn) {
      checkinBtn.addEventListener('click', function () {
        handleCheckin(event, state);
      });
    }

    // Check-in undo button
    const checkinUndo = document.getElementById(`checkinUndo-${event.id}`);
    if (checkinUndo) {
      checkinUndo.addEventListener('click', function () {
        handleCheckinUndo(event, state);
      });
    }

    // Task checkboxes
    document.querySelectorAll(`.task-checkbox[data-event="${event.id}"]`).forEach(cb => {
      cb.addEventListener('change', function () {
        handleTaskToggle(event, state, this);
      });
    });

    // Variable reward selects
    document.querySelectorAll(`.task-reward-select[data-event="${event.id}"]`).forEach(sel => {
      sel.addEventListener('change', function () {
        handleRewardChange(event, state, this);
      });
    });

    // Card select dropdowns
    document.querySelectorAll(`.card-select[data-event="${event.id}"]`).forEach(sel => {
      sel.addEventListener('change', function () {
        handleCardChange(event, state, this);
      });
    });

    // Task +/- buttons (multi-claim)
    document.querySelectorAll(`.task-qty-btn[data-event="${event.id}"]`).forEach(btn => {
      btn.addEventListener('click', function () {
        handleTaskQty(event, state, this);
      });
    });

    // Edit past record buttons (tasks)
    document.querySelectorAll(`.btn-edit-past[data-task][data-event="${event.id}"]`).forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        showEditPastModal(event, state, this.dataset.task);
      });
    });

    // Edit past record button (check-in)
    const editCheckinBtn = document.getElementById(`editCheckin-${event.id}`);
    if (editCheckinBtn) {
      editCheckinBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        showEditCheckinModal(event, state);
      });
    }

    // Shop checkboxes (for maxQty=1 items)
    document.querySelectorAll(`.shop-checkbox[data-event="${event.id}"]`).forEach(cb => {
      cb.addEventListener('change', function () {
        handleShopCheckbox(event, state, this);
      });
    });

    // Shop +/- buttons
    document.querySelectorAll(`.qty-btn[data-event="${event.id}"]:not(.task-qty-btn):not(.shop-max-btn)`).forEach(btn => {
      btn.addEventListener('click', function () {
        handleShopQty(event, state, this);
      });
    });

    // Shop MAX buttons
    document.querySelectorAll(`.shop-max-btn[data-event="${event.id}"]`).forEach(btn => {
      btn.addEventListener('click', function () {
        handleShopMax(event, state, this);
      });
    });

    // Summary card click handlers (history modal)
    document.querySelectorAll(`.summary-card[data-filter][data-event="${event.id}"]`).forEach(card => {
      card.addEventListener('click', function () {
        showHistoryModal(event, state, this.dataset.filter);
      });
    });

    // Reset button
    const resetBtn = document.getElementById(`resetBtn-${event.id}`);
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (confirm('確定要重置所有資料嗎？此操作無法復原。')) {
          localStorage.removeItem(STORAGE_PREFIX + event.id);
          renderApp();
        }
      });
    }
  }

  function handleCheckin(event, state) {
    const todayKey = getUTCDateKey(new Date());
    if (state.checkin.lastDate === todayKey) return;
    if (state.checkin.count >= event.checkin.maxDays) return;

    state.checkin.count++;
    state.checkin.lastDate = todayKey;

    for (const m of event.checkin.milestones) {
      if (state.checkin.count >= m.day && state.checkin.count - 1 < m.day) {
        addHistoryEntry(state, 'earn', `checkin_day${m.day}`, m.reward);
      }
    }

    saveState(event.id, state);
    rerenderCheckin(event, state);
    updateSummaryDisplay(event, state);
  }

  function handleCheckinUndo(event, state) {
    const todayKey = getUTCDateKey(new Date());
    if (state.checkin.lastDate !== todayKey) return;

    for (const m of event.checkin.milestones) {
      if (state.checkin.count >= m.day && state.checkin.count - 1 < m.day) {
        removeHistoryEntry(state, 'earn', `checkin_day${m.day}`, m.reward);
      }
    }

    state.checkin.count = Math.max(0, state.checkin.count - 1);
    state.checkin.lastDate = null;
    saveState(event.id, state);
    rerenderCheckin(event, state);
    updateSummaryDisplay(event, state);
  }

  function rerenderCheckin(event, state) {
    const section = document.getElementById(`checkinSection-${event.id}`);
    if (!section) return;

    const temp = document.createElement('div');
    temp.innerHTML = renderCheckin(event, state);
    const newSection = temp.firstElementChild;

    section.replaceWith(newSection);

    const checkinBtn = document.getElementById(`checkinBtn-${event.id}`);
    if (checkinBtn) {
      checkinBtn.addEventListener('click', function () {
        handleCheckin(event, state);
      });
    }
    const checkinUndo = document.getElementById(`checkinUndo-${event.id}`);
    if (checkinUndo) {
      checkinUndo.addEventListener('click', function () {
        handleCheckinUndo(event, state);
      });
    }
    const header = newSection.querySelector('.section-header');
    if (header) {
      header.addEventListener('click', function () {
        const sectionKey = this.dataset.section;
        toggleCollapsedState(sectionKey);
        const body = document.getElementById(`sectionBody-${sectionKey}`);
        const icon = document.getElementById(`toggleIcon-${sectionKey}`);
        if (body) body.classList.toggle('collapsed');
        if (icon) icon.classList.toggle('collapsed');
      });
    }
    const editCheckinBtn = document.getElementById(`editCheckin-${event.id}`);
    if (editCheckinBtn) {
      editCheckinBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        showEditCheckinModal(event, state);
      });
    }
  }

  function handleTaskToggle(event, state, checkbox) {
    const taskId = checkbox.dataset.task;
    const taskType = checkbox.dataset.type;
    const isCardSelect = checkbox.dataset.cardSelect === 'true';
    const isVariable = checkbox.dataset.variable === 'true';
    const maxReward = parseInt(checkbox.dataset.reward);

    if (!state.tasks[taskId]) {
      state.tasks[taskId] = { currentPeriod: null, currentReward: 0 };
    }

    const taskState = state.tasks[taskId];
    const periodKey = getPeriodKey(taskType, new Date(), event.startDate);
    const taskDef = findTask(event, taskId);

    if (checkbox.checked) {
      if (isCardSelect && taskDef && taskDef.cardSelect) {
        const selectedCard = taskState.selectedCard || taskDef.cardSelect[0].card;
        const reward = getCardReward(taskDef, selectedCard, event.startDate);
        taskState.currentPeriod = periodKey;
        taskState.currentReward = reward;
        taskState.selectedCard = selectedCard;
        if (reward > 0) {
          addHistoryEntry(state, 'earn', taskId, reward);
        }
      } else {
        const reward = maxReward;
        taskState.currentPeriod = periodKey;
        taskState.currentReward = reward;
        addHistoryEntry(state, 'earn', taskId, reward);
      }
    } else {
      if (taskState.currentReward > 0) {
        removeHistoryEntry(state, 'earn', taskId, taskState.currentReward);
      }
      taskState.currentPeriod = null;
      taskState.currentReward = 0;
    }

    saveState(event.id, state);

    if (isVariable || isCardSelect) {
      rerenderTasks(event, state);
    } else {
      const taskItem = document.getElementById(`taskItem-${event.id}-${taskId}`);
      if (taskItem) {
        taskItem.classList.toggle('completed', checkbox.checked);
      }
    }

    updateSummaryDisplay(event, state);
  }

  function handleTaskQty(event, state, button) {
    const taskId = button.dataset.task;
    const taskType = button.dataset.type;
    const action = button.dataset.action;

    const task = findTask(event, taskId);
    if (!task || !task.claims) return;

    const periodKey = getPeriodKey(taskType, new Date(), event.startDate);

    if (!state.tasks[taskId]) {
      state.tasks[taskId] = { currentPeriod: null, currentReward: 0, currentClaims: 0 };
    }

    const taskState = state.tasks[taskId];
    const inCurrentPeriod = taskState.currentPeriod === periodKey;
    let claims = inCurrentPeriod ? (taskState.currentClaims || 0) : 0;

    if (action === 'plus' && claims < task.claims) {
      claims++;
      addHistoryEntry(state, 'earn', taskId, task.rewardPerClaim);
    } else if (action === 'minus' && claims > 0) {
      claims--;
      removeHistoryEntry(state, 'earn', taskId, task.rewardPerClaim);
    } else {
      return;
    }

    if (task.streakBonus) {
      if (!taskState.bonusWeeksCounted) taskState.bonusWeeksCounted = [];
      const weekPeriod = getPeriodKey('weekly', new Date(), event.startDate);
      const wasAtTarget = taskState.bonusWeeksCounted.length >= task.streakBonus.targetWeeks;

      if (claims >= task.claims && !taskState.bonusWeeksCounted.includes(weekPeriod)) {
        taskState.bonusWeeksCounted.push(weekPeriod);
      } else if (claims < task.claims) {
        const idx = taskState.bonusWeeksCounted.indexOf(weekPeriod);
        if (idx !== -1) taskState.bonusWeeksCounted.splice(idx, 1);
      }

      const isAtTarget = taskState.bonusWeeksCounted.length >= task.streakBonus.targetWeeks;
      if (!wasAtTarget && isAtTarget) {
        addHistoryEntry(state, 'earn', taskId + '_streakbonus', task.streakBonus.reward);
      } else if (wasAtTarget && !isAtTarget) {
        removeHistoryEntry(state, 'earn', taskId + '_streakbonus', task.streakBonus.reward);
      }
    }

    taskState.currentPeriod = claims > 0 ? periodKey : null;
    taskState.currentClaims = claims;
    taskState.currentReward = claims * task.rewardPerClaim;

    saveState(event.id, state);
    rerenderTasks(event, state);
    updateSummaryDisplay(event, state);
  }

  function rerenderTasks(event, state) {
    const section = document.getElementById(`tasksSection-${event.id}`);
    if (!section) return;

    const temp = document.createElement('div');
    temp.innerHTML = renderTasks(event, state);
    const newSection = temp.firstElementChild;

    section.replaceWith(newSection);

    const header = newSection.querySelector('.section-header');
    if (header) {
      header.addEventListener('click', function () {
        const sectionKey = this.dataset.section;
        toggleCollapsedState(sectionKey);
        const body = document.getElementById(`sectionBody-${sectionKey}`);
        const icon = document.getElementById(`toggleIcon-${sectionKey}`);
        if (body) body.classList.toggle('collapsed');
        if (icon) icon.classList.toggle('collapsed');
      });
    }

    newSection.querySelectorAll(`.task-checkbox[data-event="${event.id}"]`).forEach(cb => {
      cb.addEventListener('change', function () {
        handleTaskToggle(event, state, this);
      });
    });

    newSection.querySelectorAll(`.task-reward-select[data-event="${event.id}"]`).forEach(sel => {
      sel.addEventListener('change', function () {
        handleRewardChange(event, state, this);
      });
    });

    newSection.querySelectorAll(`.card-select[data-event="${event.id}"]`).forEach(sel => {
      sel.addEventListener('change', function () {
        handleCardChange(event, state, this);
      });
    });

    newSection.querySelectorAll(`.task-qty-btn[data-event="${event.id}"]`).forEach(btn => {
      btn.addEventListener('click', function () {
        handleTaskQty(event, state, this);
      });
    });

    newSection.querySelectorAll(`.btn-edit-past[data-task][data-event="${event.id}"]`).forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        showEditPastModal(event, state, this.dataset.task);
      });
    });

    // Immediately populate countdown text so it doesn't flash empty
    const now = new Date();
    const groupResetMap = {
      daily: getNextDailyReset(),
      weekly: getNextWeeklyReset(),
      biweekly: getNextBiweeklyReset(event.startDate)
    };
    for (const type in groupResetMap) {
      const el = document.getElementById(`taskGroupReset-${event.id}-${type}`);
      if (el) {
        el.textContent = formatResetLabel(groupResetMap[type].getTime() - now.getTime());
      }
    }
  }

  function handleRewardChange(event, state, select) {
    const taskId = select.dataset.task;
    const newReward = parseInt(select.value);
    const taskState = state.tasks[taskId];

    if (!taskState) return;

    const oldReward = taskState.currentReward || 0;
    removeHistoryEntry(state, 'earn', taskId, oldReward);
    addHistoryEntry(state, 'earn', taskId, newReward);
    taskState.currentReward = newReward;

    saveState(event.id, state);
    updateSummaryDisplay(event, state);
  }

  function handleCardChange(event, state, select) {
    const taskId = select.dataset.task;
    const taskType = select.dataset.type;
    const newCard = parseInt(select.value);
    const taskDef = findTask(event, taskId);

    if (!state.tasks[taskId]) {
      state.tasks[taskId] = { currentPeriod: null, currentReward: 0 };
    }

    const taskState = state.tasks[taskId];
    taskState.selectedCard = newCard;

    const completed = isTaskCompleted(taskId, taskType, state, event.startDate);
    if (completed && taskDef) {
      const oldReward = taskState.currentReward || 0;
      const newReward = getCardReward(taskDef, newCard, event.startDate);

      if (oldReward > 0) {
        removeHistoryEntry(state, 'earn', taskId, oldReward);
      }
      if (newReward > 0) {
        addHistoryEntry(state, 'earn', taskId, newReward);
      }
      taskState.currentReward = newReward;
    }

    saveState(event.id, state);
    rerenderTasks(event, state);
    updateSummaryDisplay(event, state);
  }

  function handleShopCheckbox(event, state, checkbox) {
    const itemId = checkbox.dataset.item;
    const item = event.shop.find(i => i.id === itemId);
    if (!item) return;

    if (checkbox.checked) {
      state.shop[itemId] = 1;
      addHistoryEntry(state, 'spend', itemId, item.cost);
    } else {
      state.shop[itemId] = 0;
      removeHistoryEntry(state, 'spend', itemId, item.cost);
    }
    saveState(event.id, state);

    const shopItem = document.getElementById(`shopItem-${event.id}-${itemId}`);
    if (shopItem) shopItem.classList.toggle('purchased', checkbox.checked);

    const costEl = document.getElementById(`shopCost-${event.id}-${itemId}`);
    if (costEl) {
      const total = (state.shop[itemId] || 0) * item.cost;
      costEl.textContent = total > 0 ? '-' + total : '';
    }

    updateSummaryDisplay(event, state);
  }

  function handleShopQty(event, state, button) {
    const itemId = button.dataset.item;
    const action = button.dataset.action;
    const item = event.shop.find(i => i.id === itemId);
    if (!item) return;

    let qty = state.shop[itemId] || 0;
    if (action === 'plus' && qty < item.maxQty) {
      qty++;
      addHistoryEntry(state, 'spend', itemId, item.cost);
    } else if (action === 'minus' && qty > 0) {
      qty--;
      removeHistoryEntry(state, 'spend', itemId, item.cost);
    }
    state.shop[itemId] = qty;
    saveState(event.id, state);

    const qtyEl = document.getElementById(`shopQty-${event.id}-${itemId}`);
    if (qtyEl) qtyEl.textContent = `${qty}/${item.maxQty}`;

    const costEl = document.getElementById(`shopCost-${event.id}-${itemId}`);
    if (costEl) {
      const total = qty * item.cost;
      costEl.textContent = total > 0 ? '-' + total : '';
    }

    const shopItem = document.getElementById(`shopItem-${event.id}-${itemId}`);
    if (shopItem) shopItem.classList.toggle('purchased', qty > 0);

    const parent = button.closest('.shop-controls');
    if (parent) {
      const minusBtn = parent.querySelector('[data-action="minus"]');
      const plusBtn = parent.querySelector('[data-action="plus"]');
      const maxBtn = parent.querySelector('.shop-max-btn');
      if (minusBtn) minusBtn.disabled = qty <= 0;
      if (plusBtn) plusBtn.disabled = qty >= item.maxQty;
      if (maxBtn) maxBtn.disabled = qty >= item.maxQty;
    }

    updateSummaryDisplay(event, state);
  }

  function handleShopMax(event, state, button) {
    const itemId = button.dataset.item;
    const item = event.shop.find(i => i.id === itemId);
    if (!item) return;

    const currentQty = state.shop[itemId] || 0;
    const toAdd = item.maxQty - currentQty;
    if (toAdd <= 0) return;

    for (let i = 0; i < toAdd; i++) {
      addHistoryEntry(state, 'spend', itemId, item.cost);
    }
    state.shop[itemId] = item.maxQty;
    saveState(event.id, state);

    const qtyEl = document.getElementById(`shopQty-${event.id}-${itemId}`);
    if (qtyEl) qtyEl.textContent = `${item.maxQty}/${item.maxQty}`;

    const costEl = document.getElementById(`shopCost-${event.id}-${itemId}`);
    if (costEl) {
      const total = item.maxQty * item.cost;
      costEl.textContent = total > 0 ? '-' + total : '';
    }

    const shopItem = document.getElementById(`shopItem-${event.id}-${itemId}`);
    if (shopItem) shopItem.classList.add('purchased');

    const parent = button.closest('.shop-controls');
    if (parent) {
      const minusBtn = parent.querySelector('[data-action="minus"]');
      const plusBtn = parent.querySelector('[data-action="plus"]');
      if (minusBtn) minusBtn.disabled = false;
      if (plusBtn) plusBtn.disabled = true;
      button.disabled = true;
    }

    updateSummaryDisplay(event, state);
  }

  // ===== History Modal =====

  function resolveSourceName(event, source) {
    if (source.endsWith('_past')) {
      const baseId = source.replace('_past', '');
      const task = findTask(event, baseId);
      if (task) return task.name;
    }
    if (source.endsWith('_streakbonus')) {
      const baseId = source.replace('_streakbonus', '');
      const task = findTask(event, baseId);
      if (task) return task.name + ' (額外獎勵)';
    }
    if (source.endsWith('_bonus')) {
      const baseId = source.replace('_bonus', '');
      const task = findTask(event, baseId);
      if (task) return task.name + ' (額外獎勵)';
    }
    const task = findTask(event, source);
    if (task) return task.name;
    const shopItem = event.shop.find(i => i.id === source);
    if (shopItem) return shopItem.name;
    if (source.startsWith('checkin_day')) {
      const day = source.replace('checkin_day', '');
      return `簽到第${day}天獎勵`;
    }
    return source;
  }

  function showHistoryModal(event, state, filterType) {
    const dates = Object.keys(state.history || {}).sort().reverse();
    const title = filterType === 'earn'
      ? `已獲得 ${event.currency} 明細`
      : `已使用 ${event.currency} 明細`;
    const sign = filterType === 'earn' ? '+' : '-';

    let bodyHtml = '';

    for (const dateKey of dates) {
      const dayMap = state.history[dateKey] || {};
      const entries = Object.values(dayMap).filter(e => e.type === filterType);
      if (entries.length === 0) continue;

      const dayTotal = entries.reduce((sum, e) => sum + e.amount, 0);

      let entriesHtml = '';
      for (const entry of entries) {
        const name = resolveSourceName(event, entry.source);
        const isManual = entry.source.endsWith('_past');
        const manualTag = isManual ? '<span class="history-manual-tag">手動補登</span>' : '';
        entriesHtml += `<div class="history-entry${isManual ? ' history-entry-manual' : ''}"><span>${name}${manualTag}</span><span>${sign}${entry.amount}</span></div>`;
      }

      bodyHtml += `
        <div class="history-day">
          <div class="history-day-header">
            <span>${dateKey}</span>
            <span>${sign}${dayTotal} ${event.currency}</span>
          </div>
          ${entriesHtml}
        </div>
      `;
    }

    if (!bodyHtml) {
      bodyHtml = '<div class="history-empty">尚無記錄</div>';
    }

    const modal = document.createElement('div');
    modal.className = `history-overlay history-${filterType}`;
    modal.id = 'historyModal';
    modal.innerHTML = `
      <div class="history-modal">
        <div class="history-modal-header">
          <h3>${title}</h3>
          <button class="history-close" id="historyClose">&times;</button>
        </div>
        <div class="history-modal-body">${bodyHtml}</div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeHistoryModal();
    });
    document.getElementById('historyClose').addEventListener('click', closeHistoryModal);
  }

  function closeHistoryModal() {
    const modal = document.getElementById('historyModal');
    if (modal) modal.remove();
  }

  // ===== Edit Past Records =====

  function showEditPastModal(event, state, taskId) {
    const task = findTask(event, taskId);
    if (!task) return;

    const unitReward = getTaskUnitReward(task);
    if (!state.tasks[taskId]) {
      state.tasks[taskId] = { currentPeriod: null, currentReward: 0 };
    }
    const pastReward = state.tasks[taskId].pastReward || 0;

    const modal = document.createElement('div');
    modal.className = 'edit-past-overlay';
    modal.id = 'editPastModal';
    modal.innerHTML = `
      <div class="edit-past-modal">
        <div class="edit-past-modal-header">
          <h3>編輯過去紀錄</h3>
          <button class="edit-past-close" id="editPastClose">&times;</button>
        </div>
        <div class="edit-past-modal-body">
          <span class="edit-past-label">${task.name}</span>
          <div class="edit-past-controls">
            <button class="qty-btn" id="editPastMinus" ${pastReward <= 0 ? 'disabled' : ''}>-</button>
            <span class="edit-past-value" id="editPastValue">${pastReward}</span>
            <button class="qty-btn" id="editPastPlus">+</button>
          </div>
          <div class="edit-past-reward-info">每次 ±${unitReward} ${event.currency}</div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeEditPastModal();
    });
    document.getElementById('editPastClose').addEventListener('click', closeEditPastModal);

    document.getElementById('editPastPlus').addEventListener('click', function () {
      const ts = state.tasks[taskId];
      ts.pastReward = (ts.pastReward || 0) + unitReward;
      addHistoryEntry(state, 'earn', taskId + '_past', unitReward);
      saveState(event.id, state);
      updateEditPastDisplay(ts.pastReward);
      updateSummaryDisplay(event, state);
    });

    document.getElementById('editPastMinus').addEventListener('click', function () {
      const ts = state.tasks[taskId];
      if ((ts.pastReward || 0) <= 0) return;
      ts.pastReward = (ts.pastReward || 0) - unitReward;
      removeHistoryEntry(state, 'earn', taskId + '_past', unitReward);
      saveState(event.id, state);
      updateEditPastDisplay(ts.pastReward);
      updateSummaryDisplay(event, state);
    });
  }

  function updateEditPastDisplay(pastReward) {
    const valueEl = document.getElementById('editPastValue');
    const minusBtn = document.getElementById('editPastMinus');
    if (valueEl) valueEl.textContent = pastReward;
    if (minusBtn) minusBtn.disabled = pastReward <= 0;
  }

  function showEditCheckinModal(event, state) {
    const count = state.checkin.count;
    const maxDays = event.checkin.maxDays;

    const start = new Date(event.startDate + 'T00:00:00Z');
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const daysSinceStart = Math.floor((now - start) / dayMs) + 1;
    const theoreticalMax = Math.min(daysSinceStart, maxDays);

    const modal = document.createElement('div');
    modal.className = 'edit-past-overlay';
    modal.id = 'editPastModal';
    modal.innerHTML = `
      <div class="edit-past-modal">
        <div class="edit-past-modal-header">
          <h3>編輯簽到紀錄</h3>
          <button class="edit-past-close" id="editPastClose">&times;</button>
        </div>
        <div class="edit-past-modal-body">
          <span class="edit-past-label">調整已簽到天數</span>
          <div class="edit-past-controls">
            <button class="qty-btn" id="editCheckinMinus" ${count <= 0 ? 'disabled' : ''}>-</button>
            <span class="edit-past-value" id="editCheckinValue">${count} / ${maxDays}</span>
            <button class="qty-btn" id="editCheckinPlus" ${count >= theoreticalMax ? 'disabled' : ''}>+</button>
          </div>
          <div class="edit-past-reward-info">最多可簽到 ${theoreticalMax} 天（活動已開始 ${daysSinceStart} 天）</div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    function onClose() {
      closeEditPastModal();
      rerenderCheckin(event, state);
    }

    modal.addEventListener('click', function (e) {
      if (e.target === modal) onClose();
    });
    document.getElementById('editPastClose').addEventListener('click', onClose);

    document.getElementById('editCheckinPlus').addEventListener('click', function () {
      if (state.checkin.count >= theoreticalMax) return;
      state.checkin.count++;
      for (const m of event.checkin.milestones) {
        if (state.checkin.count >= m.day && state.checkin.count - 1 < m.day) {
          addHistoryEntry(state, 'earn', 'checkin_day' + m.day, m.reward);
        }
      }
      saveState(event.id, state);
      updateEditCheckinDisplay(state.checkin.count, maxDays, theoreticalMax);
      updateSummaryDisplay(event, state);
    });

    document.getElementById('editCheckinMinus').addEventListener('click', function () {
      if (state.checkin.count <= 0) return;
      for (const m of event.checkin.milestones) {
        if (state.checkin.count >= m.day && state.checkin.count - 1 < m.day) {
          removeHistoryEntry(state, 'earn', 'checkin_day' + m.day, m.reward);
        }
      }
      state.checkin.count--;
      saveState(event.id, state);
      updateEditCheckinDisplay(state.checkin.count, maxDays, theoreticalMax);
      updateSummaryDisplay(event, state);
    });
  }

  function updateEditCheckinDisplay(count, maxDays, theoreticalMax) {
    const valueEl = document.getElementById('editCheckinValue');
    const minusBtn = document.getElementById('editCheckinMinus');
    const plusBtn = document.getElementById('editCheckinPlus');
    if (valueEl) valueEl.textContent = count + ' / ' + maxDays;
    if (minusBtn) minusBtn.disabled = count <= 0;
    if (plusBtn) plusBtn.disabled = count >= theoreticalMax;
  }

  function closeEditPastModal() {
    const modal = document.getElementById('editPastModal');
    if (modal) modal.remove();
  }

  // ===== Timers =====

  let lastDailyPeriod = null;
  let lastWeeklyPeriod = null;

  function updateTimers() {
    const now = new Date();

    for (const event of EVENTS) {
      const timeEl = document.getElementById(`currentTime-${event.id}`);
      if (timeEl) timeEl.textContent = `目前時間：${formatLocalTime(now)}`;

      const nextDaily = getNextDailyReset();
      const nextWeekly = getNextWeeklyReset();
      const nextBiweekly = getNextBiweeklyReset(event.startDate);

      const dailyEl = document.getElementById(`dailyReset-${event.id}`);
      if (dailyEl) dailyEl.textContent = formatCountdown(nextDaily.getTime() - now.getTime());

      const weeklyEl = document.getElementById(`weeklyReset-${event.id}`);
      if (weeklyEl) weeklyEl.textContent = formatCountdown(nextWeekly.getTime() - now.getTime());

      const biweeklyEl = document.getElementById(`biweeklyReset-${event.id}`);
      if (biweeklyEl) biweeklyEl.textContent = formatCountdown(nextBiweekly.getTime() - now.getTime());

      const groupResetMap = {
        daily: nextDaily,
        weekly: nextWeekly,
        biweekly: nextBiweekly
      };
      for (const type in groupResetMap) {
        const el = document.getElementById(`taskGroupReset-${event.id}-${type}`);
        if (el) {
          el.textContent = formatResetLabel(groupResetMap[type].getTime() - now.getTime());
        }
      }
    }

    const currentDailyPeriod = getUTCDateKey(now);
    if (lastDailyPeriod && lastDailyPeriod !== currentDailyPeriod) {
      renderApp();
    }
    lastDailyPeriod = currentDailyPeriod;

    const currentWeeklyPeriod = getUTCDateKey(getMostRecentThursday(now));
    if (lastWeeklyPeriod && lastWeeklyPeriod !== currentWeeklyPeriod) {
      renderApp();
    }
    lastWeeklyPeriod = currentWeeklyPeriod;
  }

  // ===== Theme =====

  function initTheme() {
    const toggle = document.getElementById('themeToggle');
    const saved = localStorage.getItem('artale_theme');

    if (saved === 'light') {
      document.body.classList.add('light-theme');
      toggle.querySelector('.theme-icon').textContent = '\u{1F319}';
    }

    toggle.addEventListener('click', function () {
      document.body.classList.toggle('light-theme');
      const isLight = document.body.classList.contains('light-theme');
      toggle.querySelector('.theme-icon').textContent = isLight ? '\u{1F319}' : '\u2600\uFE0F';
      localStorage.setItem('artale_theme', isLight ? 'light' : 'dark');
    });
  }

  // ===== Init =====

  function init() {
    initTheme();
    renderApp();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
