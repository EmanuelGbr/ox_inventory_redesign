(() => {
  const isBrowser = typeof window.invokeNative === 'undefined';
  const state = {
    locale: {},
    items: {},
    imagePath: 'nui://ox_inventory/web/images',
    leftInventory: emptyInv('player', 'player', 50),
    rightInventory: emptyInv('other', 'other', 50),
    additionalMetadata: [],
    itemAmount: 0,
    visible: isBrowser,
    contextItem: null,
    dragging: null,
  };

  const ui = {
    app: document.getElementById('app'),
    leftGrid: document.getElementById('left-grid'),
    rightGrid: document.getElementById('right-grid'),
    leftTitle: document.getElementById('left-title'),
    rightTitle: document.getElementById('right-title'),
    leftWeight: document.getElementById('left-weight'),
    rightWeight: document.getElementById('right-weight'),
    amount: document.getElementById('amount'),
    useBtn: document.getElementById('use-btn'),
    giveBtn: document.getElementById('give-btn'),
    closeBtn: document.getElementById('close-btn'),
    tooltip: document.getElementById('tooltip'),
    context: document.getElementById('context'),
    hotbar: document.getElementById('hotbar'),
  };

  ui.amount.addEventListener('input', () => {
    state.itemAmount = Math.max(0, Math.floor(Number(ui.amount.value) || 0));
    ui.amount.value = String(state.itemAmount);
  });
  ui.closeBtn.addEventListener('click', () => fetchNui('exit'));
  ui.useBtn.addEventListener('click', () => state.contextItem && fetchNui('useItem', state.contextItem.slot));
  ui.giveBtn.addEventListener('click', () => state.contextItem && fetchNui('giveItem', { slot: state.contextItem.slot, count: state.itemAmount }));

  window.addEventListener('message', (event) => {
    const { action, data } = event.data || {};
    if (!action) return;
    if (action === 'init') {
      state.locale = data.locale || {};
      state.items = data.items || {};
      state.imagePath = data.imagepath || state.imagePath;
      if (data.leftInventory) state.leftInventory = normalizeInventory(data.leftInventory);
      renderAll();
      return;
    }
    if (action === 'setupInventory') {
      if (data.leftInventory) state.leftInventory = normalizeInventory(data.leftInventory);
      if (data.rightInventory) state.rightInventory = normalizeInventory(data.rightInventory);
      state.visible = true;
      renderAll();
      return;
    }
    if (action === 'setInventoryVisible') {
      state.visible = !!data;
      renderVisibility();
      return;
    }
    if (action === 'closeInventory') {
      state.visible = false;
      closeContext();
      closeTooltip();
      renderVisibility();
      return;
    }
    if (action === 'refreshSlots') {
      applyRefresh(data || {});
      renderAll();
      return;
    }
    if (action === 'displayMetadata') {
      state.additionalMetadata = [...state.additionalMetadata, ...(data || [])];
      return;
    }
    if (action === 'toggleHotbar') {
      ui.hotbar.classList.toggle('hidden');
      renderHotbar();
    }
  });

  document.addEventListener('click', (e) => {
    if (!ui.context.contains(e.target)) closeContext();
  });

  fetchNui('uiLoaded', {});
  if (isBrowser) setupDemo();

  function renderAll() {
    renderVisibility();
    renderPanel('left', state.leftInventory);
    renderPanel('right', state.rightInventory);
    renderHotbar();
  }

  function renderVisibility() {
    ui.app.classList.toggle('hidden', !state.visible);
  }

  function renderPanel(side, inv) {
    const grid = side === 'left' ? ui.leftGrid : ui.rightGrid;
    const title = side === 'left' ? ui.leftTitle : ui.rightTitle;
    const weight = side === 'left' ? ui.leftWeight : ui.rightWeight;
    title.textContent = inv.label || inv.id || side;
    weight.textContent = formatWeight(inv.weight || 0, inv.maxWeight || 0);

    const fragment = document.createDocumentFragment();
    for (let i = 1; i <= (inv.slots || 0); i++) {
      const slotData = inv.items[i - 1] || { slot: i };
      fragment.appendChild(createSlot(slotData, inv));
    }
    grid.innerHTML = '';
    grid.appendChild(fragment);
  }

  function renderHotbar() {
    const fragment = document.createDocumentFragment();
    for (let i = 1; i <= 5; i++) {
      const slot = state.leftInventory.items[i - 1] || { slot: i };
      const el = createSlot(slot, state.leftInventory);
      fragment.appendChild(el);
    }
    ui.hotbar.innerHTML = '';
    ui.hotbar.appendChild(fragment);
  }

  function createSlot(slot, inventory) {
    const hasItem = !!slot?.name;
    const itemDef = hasItem ? state.items[slot.name] || {} : {};
    const slotEl = document.createElement('div');
    slotEl.className = 'slot';
    slotEl.dataset.slot = String(slot.slot || 0);
    slotEl.dataset.type = inventory.type;
    slotEl.draggable = hasItem;

    if (hasItem) {
      const img = document.createElement('img');
      const customUrl = slot.metadata && slot.metadata.imageurl;
      img.src = customUrl || `${state.imagePath}/${slot.name}.png`;
      img.onerror = () => (img.style.display = 'none');
      slotEl.appendChild(img);

      const top = document.createElement('div');
      top.className = 'top';
      top.innerHTML = `<span>${weightLabel(slot.weight)}</span><span>${(slot.count || 0).toLocaleString('en-US')}x</span>`;
      slotEl.appendChild(top);

      if (slot.durability !== undefined && inventory.type !== 'shop') {
        const d = document.createElement('div');
        d.className = 'durability';
        d.innerHTML = `<i style="width:${Math.max(0, Math.min(100, slot.durability))}%"></i>`;
        slotEl.appendChild(d);
      }

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = (slot.metadata && slot.metadata.label) || itemDef.label || slot.name;
      slotEl.appendChild(name);
    }

    slotEl.addEventListener('dragstart', () => {
      state.dragging = { fromType: inventory.type, fromSlot: slot.slot, slot };
    });
    slotEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      slotEl.classList.add('drag-over');
    });
    slotEl.addEventListener('dragleave', () => slotEl.classList.remove('drag-over'));
    slotEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      slotEl.classList.remove('drag-over');
      if (!state.dragging) return;
      const payload = {
        fromSlot: state.dragging.fromSlot,
        toSlot: slot.slot,
        fromType: state.dragging.fromType,
        toType: inventory.type,
        count: state.itemAmount > 0 ? state.itemAmount : state.dragging.slot.count || 1,
      };
      const fromType = state.dragging.fromType;
      state.dragging = null;
      if (fromType === 'shop') {
        await fetchNui('buyItem', payload);
      } else if (fromType === 'crafting') {
        await fetchNui('craftItem', payload);
      } else {
        await fetchNui('swapItems', payload);
      }
    });

    slotEl.addEventListener('mouseenter', (e) => hasItem && openTooltip(slot, inventory, e));
    slotEl.addEventListener('mousemove', (e) => positionFloating(ui.tooltip, e.clientX + 16, e.clientY + 12));
    slotEl.addEventListener('mouseleave', closeTooltip);

    slotEl.addEventListener('click', (e) => {
      state.contextItem = slot;
      if (!hasItem) return;
      if (e.ctrlKey && inventory.type !== 'shop' && inventory.type !== 'crafting') {
        fetchNui('swapItems', {
          fromSlot: slot.slot,
          toSlot: 0,
          fromType: inventory.type,
          toType: 'newdrop',
          count: state.itemAmount > 0 ? state.itemAmount : slot.count || 1,
        });
      }
      if (e.altKey && inventory.type === 'player') fetchNui('useItem', slot.slot);
    });

    slotEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!hasItem || inventory.type !== 'player') return;
      state.contextItem = slot;
      openContext(slot, e.clientX, e.clientY);
    });

    return slotEl;
  }

  function openTooltip(slot, inventory, e) {
    const item = state.items[slot.name] || {};
    const meta = Object.entries(slot.metadata || {}).slice(0, 10).map(([k, v]) => `<div><b>${k}</b>: ${String(v)}</div>`).join('');
    ui.tooltip.innerHTML = `
      <div><b>${(slot.metadata && slot.metadata.label) || item.label || slot.name}</b></div>
      <div>${item.description || ''}</div>
      <div>Inventory: ${inventory.label || inventory.id}</div>
      <div>Weight: ${weightLabel(slot.weight)}</div>
      ${meta}
    `;
    ui.tooltip.classList.remove('hidden');
    positionFloating(ui.tooltip, e.clientX + 16, e.clientY + 12);
  }

  function closeTooltip() { ui.tooltip.classList.add('hidden'); }

  function openContext(slot, x, y) {
    const buttons = [
      { label: state.locale.ui_use || 'Use', action: () => fetchNui('useItem', slot.slot) },
      { label: state.locale.ui_give || 'Give', action: () => fetchNui('giveItem', { slot: slot.slot, count: state.itemAmount }) },
      { label: state.locale.ui_drop || 'Drop', action: () => fetchNui('swapItems', { fromSlot: slot.slot, toSlot: 0, fromType: 'player', toType: 'newdrop', count: state.itemAmount || slot.count || 1 }) },
    ];
    if (slot.metadata && slot.metadata.ammo > 0) buttons.push({ label: state.locale.ui_remove_ammo || 'Remove ammo', action: () => fetchNui('removeAmmo', slot.slot) });
    if (slot.metadata && Array.isArray(slot.metadata.components)) {
      slot.metadata.components.forEach((component) => {
        buttons.push({ label: `${state.locale.ui_removeattachments || 'Remove'}: ${component}`, action: () => fetchNui('removeComponent', { component, slot: slot.slot }) });
      });
    }
    const customButtons = (((state.items[slot.name] || {}).buttons) || []);
    customButtons.forEach((entry, index) => buttons.push({ label: entry.label || `Action ${index + 1}`, action: () => fetchNui('useButton', { id: index + 1, slot: slot.slot }) }));

    ui.context.innerHTML = '';
    buttons.forEach((button) => {
      const el = document.createElement('button');
      el.textContent = button.label;
      el.onclick = () => { button.action(); closeContext(); };
      ui.context.appendChild(el);
    });
    ui.context.classList.remove('hidden');
    positionFloating(ui.context, x, y);
  }

  function closeContext() { ui.context.classList.add('hidden'); }

  function applyRefresh(payload) {
    if (payload.items) {
      const updates = Array.isArray(payload.items) ? payload.items : [payload.items];
      updates.forEach((entry) => {
        if (!entry || !entry.item || !entry.item.slot) return;
        const inv = pickInventory(entry.inventory);
        inv.items[entry.item.slot - 1] = entry.item;
      });
    }
    if (payload.weightData) {
      const inv = pickById(payload.weightData.inventoryId);
      if (inv) inv.maxWeight = payload.weightData.maxWeight;
    }
    if (payload.slotsData) {
      const inv = pickById(payload.slotsData.inventoryId);
      if (inv) inv.slots = payload.slotsData.slots;
    }
    if (payload.itemCount) {
      Object.entries(payload.itemCount).forEach(([name, count]) => {
        if (!state.items[name]) state.items[name] = { label: name, count: 0 };
        state.items[name].count = (state.items[name].count || 0) + Number(count || 0);
      });
    }
  }

  function pickInventory(invType) {
    if (invType && invType !== 'player' && invType !== state.leftInventory.id) return state.rightInventory;
    return state.leftInventory;
  }

  function pickById(id) {
    if (state.leftInventory.id === id) return state.leftInventory;
    if (state.rightInventory.id === id) return state.rightInventory;
    return null;
  }

  function normalizeInventory(inv) {
    const copy = { ...emptyInv(inv.id, inv.type, inv.slots), ...inv };
    copy.items = new Array(copy.slots).fill(null).map((_, idx) => ({ slot: idx + 1 }));
    (inv.items || []).forEach((item) => {
      if (item && item.slot) copy.items[item.slot - 1] = item;
    });
    return copy;
  }

  function emptyInv(id, type, slots) { return { id, type, slots, weight: 0, maxWeight: 0, label: id, items: [] }; }
  function weightLabel(weight) { return weight >= 1000 ? `${(weight / 1000).toFixed(2)}kg` : `${weight || 0}g`; }
  function formatWeight(weight, maxWeight) { return `${weightLabel(weight)} / ${weightLabel(maxWeight)}`; }

  function positionFloating(element, x, y) {
    element.style.left = `${Math.min(window.innerWidth - element.offsetWidth - 8, x)}px`;
    element.style.top = `${Math.min(window.innerHeight - element.offsetHeight - 8, y)}px`;
  }

  async function fetchNui(eventName, data) {
    if (isBrowser) return null;
    const resourceName = window.GetParentResourceName ? window.GetParentResourceName() : 'ox_inventory';
    const response = await fetch(`https://${resourceName}/${eventName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(data),
    });
    try { return await response.json(); } catch { return null; }
  }

  function setupDemo() {
    state.visible = true;
    state.locale = { ui_use: 'Use', ui_give: 'Give', ui_drop: 'Drop', ui_close: 'Close' };
    state.items = {
      water: { label: 'Water', description: 'Hydration item' },
      burger: { label: 'Burger', description: 'Food item' },
      lockpick: { label: 'Lockpick', description: 'Simple lockpick' },
      bandage: { label: 'Bandage', description: 'Heals small wounds' },
    };
    state.leftInventory = normalizeInventory({
      id: 'player', type: 'player', label: 'Preview Player', slots: 30, weight: 4200, maxWeight: 15000,
      items: [
        { slot: 1, name: 'water', count: 5, weight: 2500 },
        { slot: 2, name: 'burger', count: 2, weight: 600 },
        { slot: 3, name: 'bandage', count: 4, weight: 400, durability: 85 },
      ],
    });
    state.rightInventory = normalizeInventory({
      id: 'shop', type: 'shop', label: 'Preview Shop', slots: 20, weight: 0, maxWeight: 0,
      items: [
        { slot: 1, name: 'lockpick', count: 1, weight: 100, price: 300, currency: 'money' },
        { slot: 2, name: 'water', count: 1, weight: 500, price: 20, currency: 'money' },
      ],
    });
    renderAll();
    ui.hotbar.classList.remove('hidden');
  }
})();
