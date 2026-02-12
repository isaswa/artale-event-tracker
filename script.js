(function () {
  'use strict';

  const STORAGE_PREFIX = 'artale_event_';
  let timerInterval = null;

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
    const day = d.getUTCDay(); // 0=Sun, 4=Thu
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

  // ===== State Management =====

  function getDefaultState() {
    return {
      tasks: {},
      checkin: { count: 0, lastDate: null },
      shop: {}
    };
  }

  function loadState(eventId) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + eventId);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Object.assign(getDefaultState(), parsed);
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

  function calculateTotals(event, state) {
    let totalEarned = 0;

    // From tasks
    for (const taskId in state.tasks) {
      totalEarned += state.tasks[taskId].totalReward || 0;
    }

    // From check-in milestones
    for (const milestone of event.checkin.milestones) {
      if (state.checkin.count >= milestone.day) {
        totalEarned += milestone.reward;
      }
    }

    // Total spent in shop
    let totalSpent = 0;
    for (const item of event.shop) {
      const qty = state.shop[item.id] || 0;
      totalSpent += qty * item.cost;
    }

    return {
      earned: totalEarned,
      spent: totalSpent,
      balance: totalEarned - totalSpent
    };
  }

  // ===== Rendering =====

  function renderApp() {
    const app = document.getElementById('app');
    if (!app || typeof EVENTS === 'undefined') return;

    let html = '';
    for (const event of EVENTS) {
      const state = loadState(event.id);
      html += renderEvent(event, state);
    }
    app.innerHTML = html;

    // Bind all event handlers
    for (const event of EVENTS) {
      const state = loadState(event.id);
      bindEventHandlers(event, state);
    }

    // Start countdown timer
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimers, 1000);
    updateTimers();
  }

  function renderEvent(event, state) {
    const status = getEventStatus(event);
    const statusText = { active: '進行中', upcoming: '即將開始', ended: '已結束' }[status];
    const totals = calculateTotals(event, state);

    return `
      <div class="event" data-event-id="${event.id}">
        <div class="event-header">
          <h3>${event.name}</h3>
          <div class="event-dates">${event.startDate.replace(/-/g, '/')} ~ ${event.endDate.replace(/-/g, '/')} (結束日不含)</div>
          <span class="event-status ${status}">${statusText}</span>
        </div>

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
    return `
      <div class="summary">
        <div class="summary-card earned">
          <span class="summary-value" id="totalEarned-${event.id}">${totals.earned}</span>
          <span class="summary-label">已獲得 ${event.currency}</span>
        </div>
        <div class="summary-card spent">
          <span class="summary-value" id="totalSpent-${event.id}">${totals.spent}</span>
          <span class="summary-label">已使用 ${event.currency}</span>
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

    return `
      <div class="section" id="checkinSection-${event.id}">
        <div class="section-header" data-section="checkin-${event.id}">
          <h3>每日簽到</h3>
          <span class="toggle-icon" id="toggleIcon-checkin-${event.id}">&#9660;</span>
        </div>
        <div class="section-body" id="sectionBody-checkin-${event.id}">
          <div class="checkin-status" id="checkinStatus-${event.id}">
            <span class="checkin-text">已簽到 <strong>${count}</strong> / ${maxDays} 天</span>
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
        const completed = isTaskCompleted(task.id, type, state, event.startDate);
        const taskState = state.tasks[task.id];
        const currentReward = (taskState && taskState.currentReward) || task.reward;

        let rewardHtml;
        if (task.variable && completed) {
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

        tasksHtml += `
          <div class="task-item ${completed ? 'completed' : ''}" id="taskItem-${event.id}-${task.id}">
            <input type="checkbox" class="task-checkbox"
              id="task-${event.id}-${task.id}"
              data-event="${event.id}"
              data-task="${task.id}"
              data-type="${type}"
              data-reward="${task.reward}"
              data-min-reward="${task.minReward || task.reward}"
              data-variable="${!!task.variable}"
              ${completed ? 'checked' : ''}>
            <div class="task-info">
              <span class="task-name">${task.name}</span>
              <span class="task-note">${task.note || ''}</span>
            </div>
            ${rewardHtml}
          </div>
        `;
      }

      groupsHtml += `
        <div class="task-group">
          <div class="task-group-header">${typeLabels[type]}</div>
          ${tasksHtml}
        </div>
      `;
    }

    return `
      <div class="section" id="tasksSection-${event.id}">
        <div class="section-header" data-section="tasks-${event.id}">
          <h3>任務列表</h3>
          <span class="toggle-icon" id="toggleIcon-tasks-${event.id}">&#9660;</span>
        </div>
        <div class="section-body" id="sectionBody-tasks-${event.id}">
          ${groupsHtml}
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

    return `
      <div class="section" id="shopSection-${event.id}">
        <div class="section-header" data-section="shop-${event.id}">
          <h3>${event.currency}商店</h3>
          <span class="toggle-icon" id="toggleIcon-shop-${event.id}">&#9660;</span>
        </div>
        <div class="section-body" id="sectionBody-shop-${event.id}">
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
  }

  // ===== Event Handlers =====

  function bindEventHandlers(event, state) {
    // Section toggle (collapsible)
    document.querySelectorAll(`[data-section]`).forEach(header => {
      const sectionKey = header.dataset.section;
      if (!sectionKey.endsWith(event.id)) return;
      header.addEventListener('click', function () {
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

    // Shop checkboxes (for maxQty=1 items)
    document.querySelectorAll(`.shop-checkbox[data-event="${event.id}"]`).forEach(cb => {
      cb.addEventListener('change', function () {
        handleShopCheckbox(event, state, this);
      });
    });

    // Shop +/- buttons
    document.querySelectorAll(`.qty-btn[data-event="${event.id}"]`).forEach(btn => {
      btn.addEventListener('click', function () {
        handleShopQty(event, state, this);
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
    saveState(event.id, state);
    rerenderCheckin(event, state);
    updateSummaryDisplay(event, state);
  }

  function handleCheckinUndo(event, state) {
    const todayKey = getUTCDateKey(new Date());
    if (state.checkin.lastDate !== todayKey) return;

    state.checkin.count = Math.max(0, state.checkin.count - 1);
    state.checkin.lastDate = null;
    saveState(event.id, state);
    rerenderCheckin(event, state);
    updateSummaryDisplay(event, state);
  }

  function rerenderCheckin(event, state) {
    const section = document.getElementById(`checkinSection-${event.id}`);
    if (!section) return;

    // Rebuild the checkin section content
    const temp = document.createElement('div');
    temp.innerHTML = renderCheckin(event, state);
    const newSection = temp.firstElementChild;

    section.replaceWith(newSection);

    // Re-bind handlers for this section
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
    // Re-bind section toggle
    const header = newSection.querySelector('.section-header');
    if (header) {
      header.addEventListener('click', function () {
        const sectionKey = this.dataset.section;
        const body = document.getElementById(`sectionBody-${sectionKey}`);
        const icon = document.getElementById(`toggleIcon-${sectionKey}`);
        if (body) body.classList.toggle('collapsed');
        if (icon) icon.classList.toggle('collapsed');
      });
    }
  }

  function handleTaskToggle(event, state, checkbox) {
    const taskId = checkbox.dataset.task;
    const taskType = checkbox.dataset.type;
    const isVariable = checkbox.dataset.variable === 'true';
    const maxReward = parseInt(checkbox.dataset.reward);
    const minReward = parseInt(checkbox.dataset.minReward);

    if (!state.tasks[taskId]) {
      state.tasks[taskId] = { currentPeriod: null, currentReward: 0, totalReward: 0 };
    }

    const taskState = state.tasks[taskId];
    const periodKey = getPeriodKey(taskType, new Date(), event.startDate);

    if (checkbox.checked) {
      const reward = isVariable ? maxReward : maxReward;
      taskState.currentPeriod = periodKey;
      taskState.currentReward = reward;
      taskState.totalReward = (taskState.totalReward || 0) + reward;
    } else {
      taskState.totalReward = Math.max(0, (taskState.totalReward || 0) - (taskState.currentReward || 0));
      taskState.currentPeriod = null;
      taskState.currentReward = 0;
    }

    saveState(event.id, state);

    // Update UI
    const taskItem = document.getElementById(`taskItem-${event.id}-${taskId}`);
    if (taskItem) {
      taskItem.classList.toggle('completed', checkbox.checked);
    }

    // If variable, re-render the task to show/hide the select
    if (isVariable) {
      rerenderTasks(event, state);
    }

    updateSummaryDisplay(event, state);
  }

  function rerenderTasks(event, state) {
    const section = document.getElementById(`tasksSection-${event.id}`);
    if (!section) return;

    const wasCollapsed = section.querySelector('.section-body.collapsed') !== null;

    const temp = document.createElement('div');
    temp.innerHTML = renderTasks(event, state);
    const newSection = temp.firstElementChild;

    section.replaceWith(newSection);

    if (wasCollapsed) {
      const body = newSection.querySelector('.section-body');
      const icon = newSection.querySelector('.toggle-icon');
      if (body) body.classList.add('collapsed');
      if (icon) icon.classList.add('collapsed');
    }

    // Re-bind
    const header = newSection.querySelector('.section-header');
    if (header) {
      header.addEventListener('click', function () {
        const sectionKey = this.dataset.section;
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
  }

  function handleRewardChange(event, state, select) {
    const taskId = select.dataset.task;
    const newReward = parseInt(select.value);
    const taskState = state.tasks[taskId];

    if (!taskState) return;

    const oldReward = taskState.currentReward || 0;
    taskState.totalReward = (taskState.totalReward || 0) - oldReward + newReward;
    taskState.currentReward = newReward;

    saveState(event.id, state);
    updateSummaryDisplay(event, state);
  }

  function handleShopCheckbox(event, state, checkbox) {
    const itemId = checkbox.dataset.item;
    state.shop[itemId] = checkbox.checked ? 1 : 0;
    saveState(event.id, state);

    const shopItem = document.getElementById(`shopItem-${event.id}-${itemId}`);
    if (shopItem) shopItem.classList.toggle('purchased', checkbox.checked);

    const costEl = document.getElementById(`shopCost-${event.id}-${itemId}`);
    const item = event.shop.find(i => i.id === itemId);
    if (costEl && item) {
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
    if (action === 'plus' && qty < item.maxQty) qty++;
    if (action === 'minus' && qty > 0) qty--;
    state.shop[itemId] = qty;
    saveState(event.id, state);

    // Update display
    const qtyEl = document.getElementById(`shopQty-${event.id}-${itemId}`);
    if (qtyEl) qtyEl.textContent = `${qty}/${item.maxQty}`;

    const costEl = document.getElementById(`shopCost-${event.id}-${itemId}`);
    if (costEl) {
      const total = qty * item.cost;
      costEl.textContent = total > 0 ? '-' + total : '';
    }

    const shopItem = document.getElementById(`shopItem-${event.id}-${itemId}`);
    if (shopItem) shopItem.classList.toggle('purchased', qty > 0);

    // Update +/- button states
    const parent = button.closest('.shop-controls');
    if (parent) {
      const minusBtn = parent.querySelector('[data-action="minus"]');
      const plusBtn = parent.querySelector('[data-action="plus"]');
      if (minusBtn) minusBtn.disabled = qty <= 0;
      if (plusBtn) plusBtn.disabled = qty >= item.maxQty;
    }

    updateSummaryDisplay(event, state);
  }

  // ===== Timers =====

  let lastDailyPeriod = null;
  let lastWeeklyPeriod = null;

  function updateTimers() {
    const now = new Date();

    for (const event of EVENTS) {
      // Current time
      const timeEl = document.getElementById(`currentTime-${event.id}`);
      if (timeEl) timeEl.textContent = `目前時間：${formatLocalTime(now)}`;

      // Daily countdown
      const dailyEl = document.getElementById(`dailyReset-${event.id}`);
      if (dailyEl) {
        const nextDaily = getNextDailyReset();
        dailyEl.textContent = formatCountdown(nextDaily.getTime() - now.getTime());
      }

      // Weekly countdown
      const weeklyEl = document.getElementById(`weeklyReset-${event.id}`);
      if (weeklyEl) {
        const nextWeekly = getNextWeeklyReset();
        weeklyEl.textContent = formatCountdown(nextWeekly.getTime() - now.getTime());
      }

      // Biweekly countdown
      const biweeklyEl = document.getElementById(`biweeklyReset-${event.id}`);
      if (biweeklyEl) {
        const nextBiweekly = getNextBiweeklyReset(event.startDate);
        biweeklyEl.textContent = formatCountdown(nextBiweekly.getTime() - now.getTime());
      }
    }

    // Check for period resets (auto-refresh)
    const currentDailyPeriod = getUTCDateKey(now);
    if (lastDailyPeriod && lastDailyPeriod !== currentDailyPeriod) {
      renderApp(); // Re-render to reflect reset tasks
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
