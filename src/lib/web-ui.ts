export function renderWebAppHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Amex Tools</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #111418;
        --panel: #181d23;
        --panel-alt: #0f1317;
        --border: #2a313b;
        --text: #eef2f7;
        --muted: #9aa8b8;
        --accent: #3bc8ff;
        --accent-soft: rgba(59, 200, 255, 0.14);
        --success: #3ddc97;
        --warning: #ffd84d;
        --danger: #ff7878;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        background: linear-gradient(180deg, #0b0e12 0%, #111418 100%);
        color: var(--text);
      }
      button, input, select {
        font: inherit;
      }
      .app {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto auto 1fr;
      }
      .topbar {
        padding: 20px 24px 12px;
        border-bottom: 1px solid var(--border);
        background: rgba(10, 13, 17, 0.9);
        backdrop-filter: blur(8px);
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .title {
        margin: 0 0 6px;
        font-size: 28px;
        color: var(--accent);
      }
      .subtitle {
        margin: 0;
        color: var(--muted);
      }
      .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        padding: 16px 24px;
        border-bottom: 1px solid var(--border);
        background: rgba(16, 20, 25, 0.92);
      }
      .controls button, .controls input, .controls select {
        background: var(--panel);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px 12px;
      }
      .actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
      }
      .toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--muted);
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--panel);
      }
      .toggle input {
        margin: 0;
      }
      .controls button {
        cursor: pointer;
      }
      .controls button.primary {
        background: linear-gradient(180deg, #123247 0%, #0e2536 100%);
        border-color: #5dd7ff;
        color: #dff7ff;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
      }
      .statusbar {
        padding: 0 24px 16px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
      }
      .status-card {
        padding: 12px 14px;
        border: 1px solid var(--border);
        border-radius: 16px;
        background: rgba(20, 25, 31, 0.94);
        min-width: 0;
      }
      .status-label {
        font-size: 11px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .status-value {
        margin-top: 6px;
        color: var(--text);
        font-size: 15px;
        line-height: 1.35;
        word-break: break-word;
      }
      .tabs {
        display: flex;
        gap: 8px;
      }
      .tab {
        cursor: pointer;
        padding: 9px 12px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--panel);
        color: var(--muted);
      }
      .tab.active {
        color: var(--accent);
        border-color: var(--accent);
        background: var(--accent-soft);
      }
      .content {
        display: grid;
        grid-template-columns: 360px 1fr;
        gap: 16px;
        padding: 16px 24px 24px;
      }
      .panel {
        background: rgba(20, 25, 31, 0.94);
        border: 1px solid var(--border);
        border-radius: 18px;
        overflow: hidden;
        min-height: 0;
      }
      .panel-header {
        padding: 14px 16px;
        border-bottom: 1px solid var(--border);
        background: rgba(13, 17, 22, 0.95);
      }
      .panel-title {
        margin: 0;
        font-size: 16px;
      }
      .panel-subtitle {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 13px;
      }
      .list {
        overflow: auto;
        max-height: calc(100vh - 260px);
      }
      .item {
        width: 100%;
        text-align: left;
        border: 0;
        border-bottom: 1px solid var(--border);
        background: transparent;
        color: var(--text);
        padding: 14px 16px;
        cursor: pointer;
      }
      .item:hover, .item.active {
        background: rgba(59, 200, 255, 0.08);
      }
      .item-title {
        font-size: 15px;
      }
      .item-title.supplementary {
        padding-left: 18px;
      }
      .item-meta {
        margin-top: 4px;
        color: var(--muted);
        font-size: 12px;
      }
      .item-meta.supplementary {
        padding-left: 18px;
      }
      .detail {
        padding: 18px;
        display: grid;
        gap: 16px;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 10px;
      }
      .metric {
        border: 1px solid var(--border);
        background: var(--panel-alt);
        border-radius: 14px;
        padding: 12px;
      }
      .metric-label {
        font-size: 12px;
        color: var(--muted);
      }
      .metric-value {
        margin-top: 6px;
        font-size: 24px;
      }
      .rows {
        display: grid;
        gap: 8px;
      }
      .row {
        border: 1px solid var(--border);
        background: var(--panel-alt);
        border-radius: 14px;
        padding: 12px;
      }
      .rowline {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .tag {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid var(--border);
        font-size: 12px;
      }
      .tag.success { color: var(--success); border-color: rgba(61, 220, 151, 0.35); }
      .tag.warning { color: var(--warning); border-color: rgba(255, 216, 77, 0.35); }
      .tag.danger { color: var(--danger); border-color: rgba(255, 120, 120, 0.35); }
      .tag.neutral { color: var(--muted); border-color: rgba(154, 168, 184, 0.35); }
      .toolbar {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .activity {
        border: 1px solid var(--border);
        background: var(--panel-alt);
        border-radius: 14px;
        padding: 12px;
        min-height: 120px;
      }
      .activity-line {
        margin: 0 0 6px;
        white-space: pre-wrap;
      }
      .activity-line.success { color: var(--success); }
      .activity-line.error { color: var(--danger); }
      .activity-line.info { color: var(--muted); }
      .empty {
        color: var(--muted);
        padding: 24px;
      }
      @media (max-width: 980px) {
        .content {
          grid-template-columns: 1fr;
        }
        .list {
          max-height: 320px;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <div class="topbar">
        <h1 class="title">Amex Tools</h1>
        <p class="subtitle">A local browser workspace for syncing Amex cards, benefits, and offers, reviewing cached account data, and enrolling offers without using the terminal UI.</p>
      </div>
      <div class="controls">
        <div class="tabs" id="tabs"></div>
        <div class="actions">
          <button class="primary" id="sync-button">Sync</button>
          <input id="search-input" placeholder="Search cards, benefits, offers" />
          <select id="offer-filter">
            <option value="all">Offers: all</option>
            <option value="eligible">Offers: eligible</option>
            <option value="enrolled">Offers: enrolled</option>
            <option value="other">Offers: other</option>
          </select>
          <label class="toggle" id="members-canceled-toggle">
            <input type="checkbox" id="show-canceled-members" />
            <span>Show canceled cards</span>
          </label>
        </div>
      </div>
      <div class="statusbar">
        <div class="status-card">
          <div class="status-label">Cache</div>
          <div class="status-value" id="cache-status">Loading cache...</div>
        </div>
        <div class="status-card">
          <div class="status-label">Action</div>
          <div class="status-value" id="action-status">Idle</div>
        </div>
      </div>
      <div class="content">
        <div class="panel">
          <div class="panel-header">
            <h2 class="panel-title" id="list-title">Loading...</h2>
            <p class="panel-subtitle" id="list-subtitle"></p>
          </div>
          <div class="list" id="list"></div>
        </div>
        <div class="panel">
          <div class="detail" id="detail"></div>
        </div>
      </div>
    </div>
    <script>
      const state = {
        activeTab: 'offers',
        search: '',
        offerFilter: 'all',
        showCanceledMembers: false,
        syncPending: false,
        bundle: null,
        selectedId: null,
        selectedCards: new Set(),
        activity: [],
      };

      const tabs = [
        { id: 'members', label: 'Members' },
        { id: 'benefits', label: 'Benefits' },
        { id: 'offers', label: 'Offers' },
      ];

      const ui = {
        tabs: document.getElementById('tabs'),
        list: document.getElementById('list'),
        detail: document.getElementById('detail'),
        listTitle: document.getElementById('list-title'),
        listSubtitle: document.getElementById('list-subtitle'),
        cacheStatus: document.getElementById('cache-status'),
        actionStatus: document.getElementById('action-status'),
        syncButton: document.getElementById('sync-button'),
        searchInput: document.getElementById('search-input'),
        offerFilter: document.getElementById('offer-filter'),
        showCanceledMembers: document.getElementById('show-canceled-members'),
        membersCanceledToggle: document.getElementById('members-canceled-toggle'),
      };

      function setActionStatus(text) {
        ui.actionStatus.textContent = text;
      }

      function setCacheStatus() {
        if (!state.bundle) {
          ui.cacheStatus.textContent = 'No cached data';
          return;
        }
        const synced = [state.bundle.cards?.syncedAt, state.bundle.benefits?.syncedAt, state.bundle.offers?.syncedAt]
          .filter(Boolean)
          .sort()
          .at(-1);
        ui.cacheStatus.textContent = synced ? 'Cache synced: ' + synced : 'Cache loaded';
      }

      function addActivity(tone, text) {
        state.activity = [...state.activity, { tone, text }].slice(-10);
      }

      async function request(path, init) {
        const response = await fetch(path, {
          headers: { 'content-type': 'application/json' },
          ...init,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Request failed');
        }
        return payload;
      }

      async function loadBundle() {
        setActionStatus('Loading cache...');
        const payload = await request('/api/bundle');
        state.bundle = payload.bundle;
        setCacheStatus();
        ensureSelection();
        render();
        setActionStatus('Ready');
      }

      async function syncData() {
        state.syncPending = true;
        ui.syncButton.disabled = true;
        ui.syncButton.textContent = 'Syncing...';
        setActionStatus('Syncing...');
        addActivity('info', 'Starting sync...');
        render();
        try {
          const payload = await request('/api/sync', { method: 'POST' });
          state.bundle = payload.bundle;
          setCacheStatus();
          addActivity('success', payload.message || 'Sync completed.');
          ensureSelection();
          render();
          setActionStatus('Sync complete');
        } catch (error) {
          addActivity('error', error instanceof Error ? error.message : String(error));
          render();
          setActionStatus('Sync failed');
        } finally {
          state.syncPending = false;
          ui.syncButton.disabled = false;
          ui.syncButton.textContent = 'Sync';
        }
      }

      async function enrollOffer(mode) {
        const offer = getSelectedOfferGroup();
        if (!offer) {
          return;
        }
        const selectedRows = offer.rows.filter((row) => state.selectedCards.has(row.cardId + ':' + row.last4));
        const body =
          mode === 'selected'
            ? {
                offerId: offer.id,
                cardLast4s: selectedRows.map((row) => row.last4),
              }
            : {
                offerId: offer.id,
                allCards: true,
              };
        if (mode === 'selected' && selectedRows.length === 0) {
          addActivity('error', 'No eligible cards selected.');
          render();
          return;
        }

        setActionStatus('Enrolling offer...');
        addActivity('info', 'Starting enrollment for ' + offer.title + '...');
        render();
        try {
          const payload = await request('/api/enroll/offer', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          state.bundle = payload.bundle;
          state.selectedCards.clear();
          ensureSelection(offer.id);
          addActivity('success', payload.message);
          for (const result of payload.results) {
            addActivity(result.statusPurpose === 'SUCCESS' ? 'success' : 'error', (result.last4 || result.accountNumberProxy) + ' | ' + result.cardName + ' | ' + result.statusMessage);
          }
          setCacheStatus();
          render();
          setActionStatus('Enrollment complete');
        } catch (error) {
          addActivity('error', error instanceof Error ? error.message : String(error));
          render();
          setActionStatus('Enrollment failed');
        }
      }

      async function enrollAllOffers() {
        setActionStatus('Enrolling all offers...');
        addActivity('info', 'Starting all eligible offers enrollment...');
        render();
        try {
          const payload = await request('/api/enroll/all-offers', {
            method: 'POST',
            body: JSON.stringify({}),
          });
          state.bundle = payload.bundle;
          ensureSelection();
          addActivity('success', payload.message);
          render();
          setCacheStatus();
          setActionStatus('Bulk enrollment complete');
        } catch (error) {
          addActivity('error', error instanceof Error ? error.message : String(error));
          render();
          setActionStatus('Bulk enrollment failed');
        }
      }

      function normalizeStatus(status) {
        return String(status || 'UNKNOWN').toUpperCase();
      }

      function flattenCards(cards) {
        return (cards || []).flatMap((card) => {
          const primaryLast4 = card.last4 || 'N/A';
          const items = [{
            id: card.id,
            name: card.name,
            last4: primaryLast4,
            status: card.status || 'Unknown',
            relationship: card.metadata?.relationship || 'BASIC',
            member: card.metadata?.profile?.embossed_name || card.metadata?.profile?.first_name || 'Unknown',
            isSupplementary: false,
            primaryLast4: null,
            primaryName: null,
            supplementaryCount: Array.isArray(card.metadata?.supplementaryAccounts) ? card.metadata.supplementaryAccounts.length : 0,
          }];
          const supplementary = Array.isArray(card.metadata?.supplementaryAccounts) ? card.metadata.supplementaryAccounts : [];
          for (const supp of supplementary) {
            items.push({
              id: supp.id || crypto.randomUUID(),
              name: supp.name || 'Supplementary Card',
              last4: supp.last4 || 'N/A',
              status: Array.isArray(supp.status) ? supp.status.join(', ') : (supp.status || 'Unknown'),
              relationship: 'SUPP',
              member: supp.embossedName || 'Unknown',
              isSupplementary: true,
              primaryLast4,
              primaryName: card.name,
              supplementaryCount: 0,
            });
          }
          return items;
        });
      }

      function groupBenefits(benefits) {
        const map = new Map();
        for (const benefit of benefits || []) {
          const key = benefit.id + '::' + benefit.title;
          if (!map.has(key)) {
            map.set(key, { id: benefit.id, title: benefit.title, description: benefit.description, rows: [] });
          }
          map.get(key).rows.push(benefit);
        }
        return Array.from(map.values());
      }

      function groupOffers(offers) {
        const map = new Map();
        for (const offer of offers || []) {
          const status = normalizeStatus(offer.metadata?.status);
          if (state.offerFilter !== 'all' && ((state.offerFilter === 'other' && (status === 'ELIGIBLE' || status === 'ENROLLED')) || (state.offerFilter !== 'other' && state.offerFilter.toUpperCase() !== status))) {
            continue;
          }
          if (state.search) {
            const haystack = [offer.title, offer.description, offer.metadata?.cardName, offer.metadata?.last4, offer.metadata?.sourceId].filter(Boolean).join(' ').toLowerCase();
            if (!haystack.includes(state.search)) {
              continue;
            }
          }
          if (!map.has(offer.id)) {
            map.set(offer.id, { id: offer.id, title: offer.title, description: offer.description, rows: [] });
          }
          map.get(offer.id).rows.push(offer);
        }
        return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
      }

      function getListItems() {
        if (!state.bundle) return [];
        if (state.activeTab === 'members') {
          return flattenCards(state.bundle.cards?.items).filter((card) => {
            if (!state.showCanceledMembers && String(card.status).toLowerCase().includes('canceled')) {
              return false;
            }
            if (!state.search) return true;
            return [card.name, card.last4, card.member, card.status, card.primaryLast4, card.primaryName].filter(Boolean).join(' ').toLowerCase().includes(state.search);
          });
        }
        if (state.activeTab === 'benefits') {
          return groupBenefits(state.bundle.benefits?.items).filter((group) => {
            if (!state.search) return true;
            return [group.title, group.description].filter(Boolean).join(' ').toLowerCase().includes(state.search);
          });
        }
        return groupOffers(state.bundle.offers?.items);
      }

      function ensureSelection(preferredId) {
        const items = getListItems();
        if (items.length === 0) {
          state.selectedId = null;
          return;
        }
        if (preferredId && items.some((item) => item.id === preferredId)) {
          state.selectedId = preferredId;
          return;
        }
        if (state.selectedId && items.some((item) => item.id === state.selectedId)) {
          return;
        }
        state.selectedId = items[0].id;
      }

      function getSelectedItem() {
        return getListItems().find((item) => item.id === state.selectedId) || null;
      }

      function getSelectedOfferGroup() {
        if (state.activeTab !== 'offers') return null;
        return getSelectedItem();
      }

      function offerCounts(group) {
        const counts = { total: group.rows.length, eligible: 0, enrolled: 0, other: 0 };
        for (const row of group.rows) {
          const status = normalizeStatus(row.metadata?.status);
          if (status === 'ELIGIBLE') counts.eligible += 1;
          else if (status === 'ENROLLED') counts.enrolled += 1;
          else counts.other += 1;
        }
        return counts;
      }

      function renderTabs() {
        ui.tabs.innerHTML = '';
        for (const tab of tabs) {
          const button = document.createElement('button');
          button.className = 'tab' + (tab.id === state.activeTab ? ' active' : '');
          button.textContent = tab.label;
          button.onclick = () => {
            state.activeTab = tab.id;
            ensureSelection();
            render();
          };
          ui.tabs.appendChild(button);
        }
      }

      function renderList() {
        const items = getListItems();
        ui.list.innerHTML = '';
        if (state.activeTab === 'members') {
          ui.listTitle.textContent = 'Members';
          ui.listSubtitle.textContent = items.length + ' card entries';
        } else if (state.activeTab === 'benefits') {
          ui.listTitle.textContent = 'Benefits';
          ui.listSubtitle.textContent = items.length + ' grouped benefits';
        } else {
          ui.listTitle.textContent = 'Offers';
          ui.listSubtitle.textContent = items.length + ' grouped offers';
        }

        if (items.length === 0) {
          ui.list.innerHTML = '<div class="empty">No items matched the current cache and filters.</div>';
          return;
        }

        for (const item of items) {
          const button = document.createElement('button');
          button.className = 'item' + (item.id === state.selectedId ? ' active' : '');
          if (state.activeTab === 'members') {
            const titleClass = item.isSupplementary ? 'item-title supplementary' : 'item-title';
            const metaClass = item.isSupplementary ? 'item-meta supplementary' : 'item-meta';
            const roleTag = item.isSupplementary ? '<span class="tag neutral">Supplementary</span>' : '<span class="tag neutral">Primary</span>';
            const relation = item.isSupplementary && item.primaryLast4
              ? ' · Primary ' + item.primaryLast4
              : (item.supplementaryCount > 0 ? ' · ' + item.supplementaryCount + ' supp card(s)' : '');
            button.innerHTML = '<div class="' + titleClass + '">' + (item.isSupplementary ? '↳ ' : '') + item.name + ' ' + roleTag + '</div><div class="' + metaClass + '">' + item.last4 + ' · ' + item.member + ' · ' + item.status + relation + '</div>';
          } else if (state.activeTab === 'benefits') {
            button.innerHTML = '<div class="item-title">' + item.title + '</div><div class="item-meta">' + item.rows.length + ' card entries</div>';
          } else {
            const counts = offerCounts(item);
            button.innerHTML = '<div class="item-title">' + item.title + '</div><div class="item-meta">Eligible ' + counts.eligible + ' · Enrolled ' + counts.enrolled + '</div>';
          }
          button.onclick = () => {
            state.selectedId = item.id;
            render();
          };
          ui.list.appendChild(button);
        }
      }

      function renderDetail() {
        const item = getSelectedItem();
        if (!item) {
          ui.detail.innerHTML = '<div class="empty">Nothing selected.</div>';
          return;
        }

        if (state.activeTab === 'members') {
          ui.detail.innerHTML = '<h2>' + item.name + '</h2>' +
            '<div class="summary-grid">' +
            metric('Last 4', item.last4) +
            metric('Member', item.member) +
            metric('Relationship', item.relationship) +
            metric('Status', item.status) +
            '</div>' +
            '<div class="summary-grid">' +
            metric('Card Type', item.isSupplementary ? 'Supplementary' : 'Primary') +
            metric('Primary Card', item.primaryLast4 ? (item.primaryName + ' · ' + item.primaryLast4) : item.last4) +
            metric('Supplementary Cards', item.isSupplementary ? '0' : String(item.supplementaryCount || 0)) +
            '</div>';
          return;
        }

        if (state.activeTab === 'benefits') {
          ui.detail.innerHTML = '<h2>' + item.title + '</h2>' +
            (item.description ? '<p>' + item.description + '</p>' : '') +
            '<div class="rows">' +
            item.rows.map((row) => '<div class="row"><div class="rowline"><strong>' + (row.metadata?.last4 || 'N/A') + '</strong><span>' + (row.metadata?.cardName || 'Unknown Card') + '</span><span class="tag ' + benefitTagClass(row.metadata?.status) + '">' + (row.metadata?.status || 'Unknown') + '</span></div></div>').join('') +
            '</div>';
          return;
        }

        const counts = offerCounts(item);
        ui.detail.innerHTML = '<h2>' + item.title + '</h2>' +
          '<p>' + (item.description || '') + '</p>' +
          '<div class="summary-grid">' +
          metric('Offer ID', item.id) +
          metric('Eligible', String(counts.eligible)) +
          metric('Enrolled', String(counts.enrolled)) +
          metric('Other', String(counts.other)) +
          '</div>' +
          '<div class="toolbar">' +
            '<button id="enroll-selected">Enroll selected cards</button>' +
            '<button id="enroll-all-cards">Enroll all eligible cards for this offer</button>' +
            '<button id="enroll-all-offers">Enroll all eligible offers</button>' +
          '</div>' +
          '<div class="rows">' +
            item.rows.map((row) => {
              const status = normalizeStatus(row.metadata?.status);
              const selectable = status === 'ELIGIBLE';
              const key = row.cardId + ':' + (row.metadata?.last4 || 'N/A');
              return '<label class="row"><div class="rowline">' +
                '<input type="checkbox" ' + (!selectable ? 'disabled ' : '') + (state.selectedCards.has(key) ? 'checked ' : '') + 'data-key="' + key + '">' +
                '<strong>' + (row.metadata?.last4 || 'N/A') + '</strong>' +
                '<span>' + (row.metadata?.cardName || 'Unknown Card') + '</span>' +
                '<span class="tag ' + offerTagClass(status) + '">' + status + '</span>' +
                (row.expiresAt ? '<span>' + row.expiresAt + '</span>' : '') +
              '</div></label>';
            }).join('') +
          '</div>' +
          '<div class="activity">' +
            '<div class="activity-line info">Activity</div>' +
            state.activity.map((entry) => '<div class="activity-line ' + entry.tone + '">' + entry.text + '</div>').join('') +
          '</div>';

        ui.detail.querySelectorAll('input[type="checkbox"][data-key]').forEach((input) => {
          input.addEventListener('change', (event) => {
            const key = event.target.getAttribute('data-key');
            if (!key) return;
            if (event.target.checked) state.selectedCards.add(key);
            else state.selectedCards.delete(key);
          });
        });
        document.getElementById('enroll-selected').onclick = () => enrollOffer('selected');
        document.getElementById('enroll-all-cards').onclick = () => enrollOffer('all-cards');
        document.getElementById('enroll-all-offers').onclick = () => enrollAllOffers();
      }

      function metric(label, value) {
        return '<div class="metric"><div class="metric-label">' + label + '</div><div class="metric-value">' + value + '</div></div>';
      }

      function benefitTagClass(status) {
        const normalized = String(status || '').toUpperCase();
        if (normalized.includes('ACHIEVED') || normalized.includes('COMPLETED')) return 'success';
        if (normalized.includes('IN_PROGRESS')) return 'warning';
        return '';
      }

      function offerTagClass(status) {
        if (status === 'ENROLLED') return 'success';
        if (status === 'ELIGIBLE') return 'warning';
        return 'danger';
      }

      function render() {
        ui.offerFilter.style.display = state.activeTab === 'offers' ? '' : 'none';
        ui.membersCanceledToggle.style.display = state.activeTab === 'members' ? '' : 'none';
        ui.searchInput.placeholder =
          state.activeTab === 'members'
            ? 'Search cards...'
            : state.activeTab === 'benefits'
              ? 'Search benefits...'
              : 'Search offers...';
        ui.syncButton.textContent = state.syncPending ? 'Syncing...' : 'Sync';
        ui.syncButton.disabled = state.syncPending;
        renderTabs();
        renderList();
        renderDetail();
      }

      ui.syncButton.addEventListener('click', syncData);
      ui.searchInput.addEventListener('input', (event) => {
        state.search = event.target.value.trim().toLowerCase();
        ensureSelection();
        render();
      });
      ui.offerFilter.addEventListener('change', (event) => {
        state.offerFilter = event.target.value;
        ensureSelection();
        render();
      });
      ui.showCanceledMembers.addEventListener('change', (event) => {
        state.showCanceledMembers = event.target.checked;
        ensureSelection();
        render();
      });

      loadBundle().catch((error) => {
        setActionStatus('Failed to load');
        ui.detail.innerHTML = '<div class="empty">' + (error instanceof Error ? error.message : String(error)) + '</div>';
      });
    </script>
  </body>
</html>`;
}
