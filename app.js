(() => {
  "use strict";

  // Configuración de IndexedDB, fondo inicial y nombres de turnos.
  const STORAGE_KEY = "grano-pos-v1";
  const DATABASE_NAME = "grano-pos";
  const DATABASE_VERSION = 1;
  const STORE_NAME = "pos-state";
  const STATE_RECORD_ID = "current";
  const DEFAULT_OPENING_CASH = 500;
  const SHIFT_NAMES = ["Mañana", "Tarde", "Noche"];
  const money = value => new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(value);
  const localDate = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  // Elimina acentos y pasa a minúsculas para que la búsqueda sea más flexible.
  const normalize = value => value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");

  // Referencias a elementos HTML que la aplicación usa o actualiza.
  const elements = {
    dateLabel: document.getElementById("current-date"),
    cashierModal: document.getElementById("cashier-modal"),
    cashierForm: document.getElementById("cashier-form"),
    cashierNameInput: document.getElementById("new-cashier"),
    openingCashInput: document.getElementById("new-opening-cash"),
    cashierError: document.getElementById("cashier-error"),
    cashierModalTitle: document.getElementById("cashier-modal-title"),
    cashierModalDescription: document.getElementById("cashier-modal-description"),
    cashierName: document.getElementById("cashier-name"),
    cashierAvatar: document.getElementById("cashier-avatar"),
    cashierRole: document.getElementById("cashier-role"),
    shiftStatus: document.getElementById("shift-status"),
    shiftLabel: document.getElementById("shift-label"),
    search: document.getElementById("product-search"),
    categories: [...document.querySelectorAll(".category-pill")],
    products: [...document.querySelectorAll(".product-card")],
    productCount: document.getElementById("product-count"),
    ticketItems: document.getElementById("ticket-items"),
    ticketNumber: document.getElementById("ticket-number"),
    ticketCashier: document.getElementById("ticket-cashier"),
    subtotal: document.getElementById("subtotal"),
    total: document.getElementById("sale-total"),
    cashReceived: document.getElementById("cash-received"),
    cashChange: document.getElementById("cash-change"),
    cashDetails: document.getElementById("cash-details"),
    chargeButton: document.getElementById("charge-sale"),
    newSaleButton: document.getElementById("new-sale"),
    paymentRadios: [...document.querySelectorAll('input[name="payment"]')],
    ticketFootnote: document.getElementById("ticket-footnote"),
    dailySales: document.getElementById("daily-sales"),
    dailyOrders: document.getElementById("daily-orders"),
    averageTicket: document.getElementById("average-ticket"),
    openingCash: document.getElementById("opening-cash"),
    cashSales: document.getElementById("cash-sales"),
    cardSales: document.getElementById("card-sales"),
    transferSales: document.getElementById("transfer-sales"),
    expectedCash: document.getElementById("expected-cash"),
    cashoutStatus: document.getElementById("cashout-status"),
    closeShiftButton: document.getElementById("close-shift"),
    storageStatus: document.getElementById("storage-status"),
    storageSummary: document.getElementById("storage-summary"),
    cutModal: document.getElementById("cut-modal"),
    cutForm: document.getElementById("cut-form"),
    cutDescription: document.getElementById("cut-description"),
    cutOpening: document.getElementById("cut-opening"),
    cutCashSales: document.getElementById("cut-cash-sales"),
    cutExpected: document.getElementById("cut-expected"),
    cutCard: document.getElementById("cut-card"),
    cutTransfer: document.getElementById("cut-transfer"),
    countedCash: document.getElementById("counted-cash"),
    cutDifference: document.getElementById("cut-difference"),
    cutError: document.getElementById("cut-error"),
    toast: document.getElementById("pos-toast")
  };

  let needsStorageMigration = false;
  let databasePromise;
  let writeQueue = Promise.resolve();
  let state = emptyState();
  let ticket = new Map(state.draft.items.map(item => [item.id, item]));
  let selectedCategory = "Todos";
  let selectedPayment = state.draft.paymentMethod;
  let saleInProgress = false;
  let toastTimer;
  let dateRefreshTimer;
  elements.cashReceived.value = state.draft.cashReceived;
  elements.paymentRadios.forEach(input => {
    input.checked = input.value === selectedPayment;
  });

  // Crea el borrador vacío que se conserva mientras se prepara una venta.
  function emptyDraft() {
    return { items: [], paymentMethod: "cash", cashReceived: "" };
  }

  // Crea el estado vacío que se usa cuando no hay información guardada.
  function emptyState() {
    return {
      version: 2,
      businessDate: localDate(),
      nextShiftIndex: 0,
      activeShift: null,
      previousCashier: "",
      nextSaleNumber: 1,
      sales: [],
      cuts: [],
      draft: emptyDraft()
    };
  }

  // Comprueba el formato del ticket pendiente antes de volver a dibujarlo.
  function isValidDraft(draft) {
    return Boolean(
      draft &&
      Array.isArray(draft.items) &&
      ["cash", "card", "transfer"].includes(draft.paymentMethod) &&
      typeof draft.cashReceived === "string" &&
      draft.items.every(item =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.description === "string" &&
        typeof item.category === "string" &&
        Number.isFinite(item.price) &&
        item.price >= 0 &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0
      )
    );
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("Este navegador no es compatible con IndexedDB."));
        return;
      }

      const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("No se pudo abrir IndexedDB."));
      request.onblocked = () => reject(new Error("IndexedDB está bloqueada por otra pestaña abierta."));
    });
  }

  function readDatabaseState(database) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(STATE_RECORD_ID);
      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => reject(request.error || new Error("No se pudieron leer los datos de IndexedDB."));
      transaction.onabort = () => reject(transaction.error || new Error("Se canceló la lectura de IndexedDB."));
    });
  }

  function writeDatabaseState(database, nextState) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ id: STATE_RECORD_ID, value: nextState });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("No se pudieron guardar los datos en IndexedDB."));
      transaction.onabort = () => reject(transaction.error || new Error("Se canceló el guardado en IndexedDB."));
    });
  }

  // Valida y actualiza el formato persistido antes de mostrarlo.
  function restoreState(parsed) {
    if (
      ![1, 2].includes(parsed?.version) ||
      !Array.isArray(parsed.sales) ||
      !Array.isArray(parsed.cuts) ||
      !Number.isInteger(parsed.nextShiftIndex) ||
      parsed.nextShiftIndex < 0 ||
      parsed.nextShiftIndex > 2
    ) {
      throw new Error("El formato de los datos guardados no es válido.");
    }

    const restored = { ...emptyState(), ...parsed, version: 2 };
    if (!isValidDraft(restored.draft)) {
      console.warn("El ticket pendiente guardado no es válido y se iniciará uno vacío.");
      restored.draft = emptyDraft();
    }
    if (parsed.version === 1) {
      needsStorageMigration = true;
      if (restored.activeShift && Number(restored.activeShift.openingCash) === 0) {
        restored.activeShift.openingCash = DEFAULT_OPENING_CASH;
      }
    }
    if (!restored.activeShift && restored.businessDate < localDate()) {
      restored.businessDate = localDate();
      restored.nextShiftIndex = 0;
      restored.previousCashier = "";
    }
    return restored;
  }

  // Guarda una instantánea en orden para evitar que escrituras rápidas se pisen.
  async function saveState() {
    const snapshot = JSON.parse(JSON.stringify(state));
    const write = writeQueue.then(async () => {
      const database = await databasePromise;
      await writeDatabaseState(database, snapshot);
    });
    writeQueue = write.catch(() => {});

    try {
      await write;
      return true;
    } catch (error) {
      console.error("No se pudieron guardar los datos del punto de venta.", error);
      showToast("No se pudo guardar en IndexedDB. Revisa el almacenamiento disponible.");
      return false;
    }
  }

  // Guarda el ticket pendiente, el método de pago y el efectivo ingresado.
  async function saveDraft() {
    state.draft = {
      items: [...ticket.values()],
      paymentMethod: selectedPayment,
      cashReceived: elements.cashReceived.value
    };
    return await saveState();
  }

  // Muestra un aviso temporal en la pantalla.
  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.remove("d-none");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.add("d-none"), 3200);
  }

  // Usa el componente Modal de Bootstrap para gestionar foco y fondo.
  function setModalVisible(modal, visible) {
    const modalInstance = bootstrap.Modal.getOrCreateInstance(modal);
    if (visible) {
      modal.addEventListener("shown.bs.modal", () => {
        modal.querySelector("[data-autofocus]")?.focus();
      }, { once: true });
      modalInstance.show();
    } else {
      modalInstance.hide();
    }
  }

  // Consulta las ventas del turno y suma importes por método de pago.
  function currentShiftSales() {
    if (!state.activeShift) return [];
    return state.sales.filter(sale => sale.shiftId === state.activeShift.id);
  }

  function totalsFor(sales) {
    return sales.reduce((totals, sale) => {
      totals[sale.paymentMethod] += sale.total;
      totals.count += 1;
      totals.amount += sale.total;
      return totals;
    }, { cash: 0, card: 0, transfer: 0, count: 0, amount: 0 });
  }

  // Bloquea los controles de venta cuando no hay un turno abierto.
  function setLocked(locked) {
    elements.products.forEach(button => { button.disabled = locked; });
    elements.search.disabled = locked;
    elements.categories.forEach(button => { button.disabled = locked; });
    elements.chargeButton.disabled = locked || ticket.size === 0;
    elements.closeShiftButton.disabled = locked;
    elements.newSaleButton.disabled = locked;
    elements.paymentRadios.forEach(input => { input.disabled = locked; });
    elements.cashReceived.disabled = locked;
  }

  // Actualiza el cajero, el turno y los resúmenes de ventas visibles.
  function updateShiftInterface() {
    const shift = state.activeShift;
    const isOpen = Boolean(shift);
    elements.cashierName.textContent = shift?.cashier || "Sin cajero";
    elements.cashierAvatar.textContent = shift
      ? shift.cashier.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("es-MX")
      : "?";
    elements.cashierRole.textContent = shift ? "Cajero/a activo/a" : "Sesión cerrada";
    elements.shiftStatus.textContent = isOpen ? "Turno abierto" : "Caja cerrada";
    elements.shiftLabel.textContent = isOpen
      ? `Caja 01 · Turno ${SHIFT_NAMES[shift.shiftIndex]}`
      : "Caja 01 · Cafetería";
    elements.cashoutStatus.textContent = isOpen ? "Abierto" : "Cerrado";
    elements.shiftStatus.classList.toggle("text-bg-success", isOpen);
    elements.shiftStatus.classList.toggle("text-bg-secondary", !isOpen);
    elements.cashoutStatus.classList.toggle("text-bg-success", isOpen);
    elements.cashoutStatus.classList.toggle("text-bg-secondary", !isOpen);
    elements.ticketCashier.textContent = shift ? `Atiende ${shift.cashier}` : "Inicia sesión para vender";
    elements.ticketFootnote.textContent = isOpen
      ? `Turno ${SHIFT_NAMES[shift.shiftIndex]} · ${shift.cashier}`
      : "Inicia un turno para comenzar a vender.";

    const shiftTotals = totalsFor(currentShiftSales());
    const openingCash = shift?.openingCash || 0;
    const dailyTotals = totalsFor(state.sales.filter(sale => sale.date === state.businessDate));
    elements.openingCash.textContent = money(openingCash);
    elements.cashSales.textContent = money(shiftTotals.cash);
    elements.cardSales.textContent = money(shiftTotals.card);
    elements.transferSales.textContent = money(shiftTotals.transfer);
    elements.expectedCash.textContent = money(openingCash + shiftTotals.cash);
    elements.dailySales.textContent = money(dailyTotals.amount);
    elements.dailyOrders.textContent = String(dailyTotals.count);
    elements.averageTicket.textContent = money(dailyTotals.count ? dailyTotals.amount / dailyTotals.count : 0);
    elements.storageSummary.textContent =
      `${state.sales.length} venta(s) y ${state.cuts.length} corte(s) guardados en IndexedDB.`;
    setLocked(!isOpen);
  }

  // Muestra la fecha local en español y la actualiza al cambiar el día.
  function updateDateLabel() {
    const now = new Date();
    const formattedDate = new Intl.DateTimeFormat("es-MX", {
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(now);

    elements.dateLabel.textContent = formattedDate
      .replace(",", " ·")
      .toLocaleUpperCase("es-MX");

    window.clearTimeout(dateRefreshTimer);
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    dateRefreshTimer = window.setTimeout(
      updateDateLabel,
      tomorrow.getTime() - now.getTime() + 100
    );
  }

  // Pide el nombre del cajero y el fondo de caja al iniciar un turno.
  function openCashierModal() {
    const shiftName = SHIFT_NAMES[state.nextShiftIndex];
    elements.cashierModalTitle.textContent = `Inicia turno ${shiftName.toLocaleLowerCase("es-MX")}`;
    elements.cashierModalDescription.textContent = state.previousCashier
      ? `El corte anterior está listo. Ingresa un cajero distinto a ${state.previousCashier} para recibir la caja.`
      : `Ingresa el usuario que iniciará el turno ${shiftName.toLocaleLowerCase("es-MX")}.`;
    elements.cashierError.textContent = "";
    elements.openingCashInput.value = String(DEFAULT_OPENING_CASH);
    setModalVisible(elements.cashierModal, true);
    elements.cashierNameInput.focus();
  }

  // Lee nombre, descripción, precio y categoría directamente de la tarjeta.
  function getProductFromCard(card) {
    const name = card.querySelector(".product-copy strong").textContent.trim();
    const description = card.querySelector(".product-copy small").textContent.trim();
    return {
      id: name,
      name,
      description,
      price: Number(card.dataset.price),
      category: card.dataset.category
    };
  }

  // Filtra el catálogo por texto y por la categoría seleccionada.
  function renderCatalog() {
    const query = normalize(elements.search.value);
    elements.productCount.textContent = String(elements.products.length);
    elements.products.forEach(card => {
      const product = getProductFromCard(card);
      const matchesCategory = selectedCategory === "Todos" || product.category === selectedCategory;
      const matchesQuery = normalize(`${product.name} ${product.description} ${product.category}`).includes(query);
      card.closest(".product-item").hidden = !(matchesCategory && matchesQuery);
    });

    elements.categories.forEach(button => {
      const active = button.dataset.category === selectedCategory;
      button.classList.toggle("current", active);
      button.classList.toggle("btn-primary", active);
      button.classList.toggle("btn-outline-primary", !active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  // Calcula el total del ticket usando el precio y la cantidad de cada producto.
  function getTicketTotal() {
    return [...ticket.values()].reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  // Dibuja los productos del ticket y actualiza los importes.
  function renderTicket() {
    const items = [...ticket.values()];
    elements.ticketItems.replaceChildren();

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "empty-ticket text-secondary text-center py-3";
      empty.textContent = "Tu ticket está vacío. Agrega algo rico ♡";
      elements.ticketItems.append(empty);
    } else {
      items.forEach(item => {
        const row = document.createElement("div");
        row.className = "ticket-item row align-items-start border-bottom py-2 g-2";
        row.innerHTML = `
          <span class="item-qty col-auto badge text-bg-secondary">${item.quantity}×</span>
          <div class="item-description col">
            <strong class="d-block"></strong><small class="d-block text-secondary">${money(item.price)} c/u</small>
            <span class="quantity-controls d-flex flex-wrap gap-1 mt-2">
              <button class="btn btn-sm btn-outline-secondary" type="button" data-ticket-action="decrease" aria-label="Quitar una unidad">−</button>
              <button class="btn btn-sm btn-outline-secondary" type="button" data-ticket-action="increase" aria-label="Agregar una unidad">+</button>
              <button class="btn btn-sm btn-outline-danger" type="button" data-ticket-action="remove" aria-label="Eliminar producto">Quitar</button>
            </span>
          </div>
          <strong class="item-price col-auto">${money(item.price * item.quantity)}</strong>`;
        row.querySelector(".item-description strong").textContent = item.name;
        row.querySelector('[data-ticket-action="decrease"]').dataset.productId = item.id;
        row.querySelector('[data-ticket-action="increase"]').dataset.productId = item.id;
        row.querySelector('[data-ticket-action="remove"]').dataset.productId = item.id;
        elements.ticketItems.append(row);
      });
    }

    const total = getTicketTotal();
    elements.subtotal.textContent = money(total);
    elements.total.textContent = money(total);
    elements.chargeButton.textContent = `Cobrar ${money(total)} →`;
    elements.ticketNumber.textContent = `#${String(state.nextSaleNumber).padStart(4, "0")}`;
    elements.chargeButton.disabled = !state.activeShift || total <= 0;
    updatePaymentInterface();
  }

  // Actualiza el cambio y permite cobrar solo cuando el pago alcanza el total.
  function updatePaymentInterface() {
    const total = getTicketTotal();
    const received = Number(elements.cashReceived.value) || 0;
    const isCash = selectedPayment === "cash";
    elements.cashDetails.hidden = !isCash;
    elements.cashChange.textContent = money(Math.max(0, received - total));
    elements.paymentRadios.forEach(input => {
      input.closest(".payment-choice").classList.toggle("active", input.checked);
    });
    elements.chargeButton.disabled =
      !state.activeShift || total <= 0 || (isCash && received < total);
  }

  // Calcula el efectivo esperado y la diferencia durante el corte.
  function updateCashCutPreview() {
    if (!state.activeShift) return;
    const totals = totalsFor(currentShiftSales());
    const expected = state.activeShift.openingCash + totals.cash;
    elements.cutOpening.textContent = money(state.activeShift.openingCash);
    elements.cutCashSales.textContent = money(totals.cash);
    elements.cutExpected.textContent = money(expected);
    elements.cutCard.textContent = money(totals.card);
    elements.cutTransfer.textContent = money(totals.transfer);
    const difference = (Number(elements.countedCash.value) || 0) - expected;
    const sign = difference > 0 ? "+" : difference < 0 ? "−" : "";
    elements.cutDifference.textContent = `${sign}${money(Math.abs(difference))}`;
    elements.cutDifference.classList.toggle("text-danger", difference < 0);
    elements.cutDifference.classList.toggle("text-success", difference > 0);
  }

  // Abre el diálogo de corte, siempre que no haya una venta pendiente.
  function openCutModal() {
    if (!state.activeShift) return;
    if (ticket.size) {
      showToast("Cobra o cancela el ticket antes de cerrar el turno.");
      return;
    }
    const shift = state.activeShift;
    elements.cutDescription.textContent =
      `Turno ${SHIFT_NAMES[shift.shiftIndex]} de ${shift.cashier}. Cuenta el efectivo antes de confirmar el corte.`;
    elements.cutError.textContent = "";
    elements.countedCash.value = "";
    updateCashCutPreview();
    setModalVisible(elements.cutModal, true);
    elements.countedCash.focus();
  }

  // Eventos del catálogo y los botones para ajustar el ticket.
  elements.products.forEach(card => {
    card.addEventListener("click", async () => {
      if (!state.activeShift) return;
      const product = getProductFromCard(card);
      const item = ticket.get(product.id);
      ticket.set(product.id, { ...product, quantity: (item?.quantity || 0) + 1 });
      await saveDraft();
      renderTicket();
    });
  });

  elements.ticketItems.addEventListener("click", async event => {
    const button = event.target.closest("[data-ticket-action]");
    if (!button) return;
    const item = ticket.get(button.dataset.productId);
    if (!item) return;

    if (button.dataset.ticketAction === "increase") item.quantity += 1;
    if (button.dataset.ticketAction === "decrease") item.quantity -= 1;
    if (button.dataset.ticketAction === "remove" || item.quantity <= 0) {
      ticket.delete(button.dataset.productId);
    } else {
      ticket.set(button.dataset.productId, item);
    }
    await saveDraft();
    renderTicket();
  });

  // Eventos de búsqueda, filtro de categoría y método de pago.
  elements.search.addEventListener("input", renderCatalog);
  elements.categories.forEach(button => button.addEventListener("click", () => {
    selectedCategory = button.dataset.category;
    renderCatalog();
  }));
  elements.paymentRadios.forEach(input => input.addEventListener("change", async () => {
    selectedPayment = input.value;
    updatePaymentInterface();
    await saveDraft();
  }));
  elements.cashReceived.addEventListener("input", async () => {
    updatePaymentInterface();
    await saveDraft();
  });

  // Valida y guarda una venta; si falla el guardado conserva el ticket.
  elements.chargeButton.addEventListener("click", async () => {
    if (saleInProgress) return;
    const total = getTicketTotal();
    const received = Number(elements.cashReceived.value) || 0;
    if (!state.activeShift || total <= 0) {
      showToast("Inicia un turno y agrega productos antes de cobrar.");
      return;
    }
    if (selectedPayment === "cash" && received < total) {
      showToast("El efectivo recibido no alcanza para cubrir el total.");
      elements.cashReceived.focus();
      return;
    }

    saleInProgress = true;
    setLocked(true);
    const sale = {
      id: state.nextSaleNumber,
      date: state.businessDate,
      shiftId: state.activeShift.id,
      shiftIndex: state.activeShift.shiftIndex,
      cashier: state.activeShift.cashier,
      createdAt: new Date().toISOString(),
      paymentMethod: selectedPayment,
      total,
      cashReceived: selectedPayment === "cash" ? received : null,
      change: selectedPayment === "cash" ? received - total : 0,
      items: [...ticket.values()].map(item => ({
        productId: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        lineTotal: item.price * item.quantity
      }))
    };

    state.sales.push(sale);
    state.nextSaleNumber += 1;
    const previousDraft = state.draft;
    state.draft = {
      items: [],
      paymentMethod: selectedPayment,
      cashReceived: ""
    };
    if (!await saveState()) {
      state.sales.pop();
      state.nextSaleNumber -= 1;
      state.draft = previousDraft;
      saleInProgress = false;
      updateShiftInterface();
      renderTicket();
      return;
    }
    saleInProgress = false;
    ticket.clear();
    elements.cashReceived.value = "";
    renderTicket();
    updateShiftInterface();
    showToast(`Venta ${String(sale.id).padStart(4, "0")} guardada. Cambio: ${money(sale.change)}.`);
  });

  // Permite limpiar el ticket o iniciar el proceso de corte de caja.
  elements.newSaleButton.addEventListener("click", () => {
    if (!state.activeShift) return;
    if (ticket.size && !window.confirm("¿Deseas descartar los productos del ticket actual?")) return;
    ticket.clear();
    elements.cashReceived.value = "";
    renderTicket();
  });

  elements.closeShiftButton.addEventListener("click", openCutModal);
  document.getElementById("cancel-cut").addEventListener("click", () => setModalVisible(elements.cutModal, false));
  elements.countedCash.addEventListener("input", updateCashCutPreview);

  elements.cutForm.addEventListener("submit", async event => {
    event.preventDefault();
    const shift = state.activeShift;
    if (!shift) return;
    if (ticket.size) {
      elements.cutError.textContent = "Primero debes completar o cancelar el ticket actual.";
      return;
    }

    const rawCount = elements.countedCash.value.trim();
    const countedCash = Number(rawCount);
    if (!rawCount || !Number.isFinite(countedCash) || countedCash < 0) {
      elements.cutError.textContent = "Ingresa el efectivo contado. Puede ser $0.00.";
      elements.countedCash.focus();
      return;
    }

    const previousState = JSON.stringify(state);
    const sales = currentShiftSales();
    const totals = totalsFor(sales);
    const expectedCash = shift.openingCash + totals.cash;
    const cut = {
      id: `cut-${shift.id}`,
      shiftId: shift.id,
      date: shift.date,
      shiftIndex: shift.shiftIndex,
      shiftName: SHIFT_NAMES[shift.shiftIndex],
      cashier: shift.cashier,
      openedAt: shift.openedAt,
      closedAt: new Date().toISOString(),
      openingCash: shift.openingCash,
      cashSales: totals.cash,
      cardSales: totals.card,
      transferSales: totals.transfer,
      expectedCash,
      countedCash,
      difference: countedCash - expectedCash,
      saleCount: totals.count,
      totalSales: totals.amount
    };

    state.cuts.push(cut);
    state.previousCashier = shift.cashier;
    if (shift.shiftIndex === SHIFT_NAMES.length - 1) {
      const nextDate = new Date(`${state.businessDate}T12:00:00`);
      nextDate.setDate(nextDate.getDate() + 1);
      state.businessDate = localDate(nextDate);
      state.nextShiftIndex = 0;
    } else {
      state.nextShiftIndex = shift.shiftIndex + 1;
    }
    state.activeShift = null;
    if (!await saveState()) {
      state = JSON.parse(previousState);
      updateShiftInterface();
      return;
    }
    setModalVisible(elements.cutModal, false);
    updateShiftInterface();
    showToast(`Corte guardado. Diferencia: ${money(cut.difference)}.`);
    openCashierModal();
  });

  // Valida el nuevo cajero y guarda la apertura del siguiente turno.
  elements.cashierForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (state.activeShift) return;

    const cashier = elements.cashierNameInput.value.trim();
    const openingCash = Number(elements.openingCashInput.value);
    if (!cashier) {
      elements.cashierError.textContent = "Escribe el nombre del cajero que recibe la caja.";
      elements.cashierNameInput.focus();
      return;
    }
    if (!Number.isFinite(openingCash) || openingCash < 0) {
      elements.cashierError.textContent = "El fondo inicial debe ser un monto válido igual o mayor a cero.";
      elements.openingCashInput.focus();
      return;
    }
    if (state.previousCashier && normalize(cashier) === normalize(state.previousCashier)) {
      elements.cashierError.textContent = "Para el cambio de turno debe iniciar sesión un cajero distinto.";
      elements.cashierNameInput.focus();
      return;
    }

    state.activeShift = {
      id: `${state.businessDate}-shift-${state.nextShiftIndex + 1}-${Date.now()}`,
      date: state.businessDate,
      shiftIndex: state.nextShiftIndex,
      cashier,
      openingCash,
      openedAt: new Date().toISOString()
    };
    const openedShift = state.activeShift;
    const previousCashier = state.previousCashier;
    state.previousCashier = "";
    elements.cashierForm.reset();
    if (!await saveState()) {
      state.activeShift = null;
      state.previousCashier = previousCashier;
      elements.cashierError.textContent = "No se pudo guardar el turno. Verifica el almacenamiento e inténtalo de nuevo.";
      return;
    }
    setModalVisible(elements.cashierModal, false);
    updateShiftInterface();
    renderTicket();
    showToast(`¡Hola, ${cashier}! Turno ${SHIFT_NAMES[openedShift.shiftIndex]} iniciado.`);
  });

  // Escape no permite cerrar el diálogo obligatorio de inicio de turno.
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && elements.cashierModal.classList.contains("show")) {
      event.preventDefault();
      showToast("Inicia sesión para usar la caja.");
    }
  });

  async function initializeStorage() {
    elements.storageStatus.textContent = "Conectando";
    elements.storageSummary.textContent = "Conectando con la base de datos local...";
    setLocked(true);

    try {
      databasePromise = openDatabase();
      const database = await databasePromise;
      const storedState = await readDatabaseState(database);
      let migrateLegacyState = false;

      if (storedState) {
        state = restoreState(storedState);
      } else {
        let legacyData = null;
        try {
          legacyData = localStorage.getItem(STORAGE_KEY);
        } catch (error) {
          console.warn("No se pudieron consultar datos heredados de localStorage.", error);
        }
        if (legacyData) {
          state = restoreState(JSON.parse(legacyData));
          migrateLegacyState = true;
        } else {
          state = emptyState();
        }
      }

      if (needsStorageMigration || migrateLegacyState) {
        if (!await saveState()) {
          throw new Error("No se pudieron migrar los datos existentes a IndexedDB.");
        }
      }

      needsStorageMigration = false;
      ticket = new Map(state.draft.items.map(item => [item.id, item]));
      selectedPayment = state.draft.paymentMethod;
      elements.cashReceived.value = state.draft.cashReceived;
      elements.paymentRadios.forEach(input => {
        input.checked = input.value === selectedPayment;
      });
      elements.storageStatus.textContent = "IndexedDB";
      elements.storageStatus.className = "badge text-bg-success";
      updateDateLabel();
      renderCatalog();
      renderTicket();
      updateShiftInterface();
      if (!state.activeShift) openCashierModal();
    } catch (error) {
      console.error("No se pudo iniciar el almacenamiento del punto de venta.", error);
      elements.storageStatus.textContent = "Error";
      elements.storageStatus.className = "badge text-bg-danger";
      elements.storageSummary.textContent =
        "IndexedDB no está disponible. La caja permanece bloqueada para proteger los datos.";
      window.alert(`No se pudo iniciar la base de datos local: ${error.message}`);
    }
  }

  // Mantiene actualizada la fecha local aunque la pestaña vuelva del segundo plano.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateDateLabel();
  });
  initializeStorage();
})();