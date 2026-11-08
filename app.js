(() => {
  "use strict";

  // Configuración: clave del almacenamiento, fondo inicial y nombres de turnos.
  const STORAGE_KEY = "grano-pos-v1";
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
  let state = loadState();
  let ticket = new Map();
  let selectedCategory = "Todos";
  let selectedPayment = "cash";
  let toastTimer;
  let dateRefreshTimer;

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
      cuts: []
    };
  }

  // Recupera los datos y actualiza el formato anterior si fuera necesario.
  function loadState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return emptyState();
      const parsed = JSON.parse(stored);
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
    } catch (error) {
      console.error("No se pudieron leer los datos guardados del punto de venta.", error);
      window.alert("No se pudieron leer los datos guardados. Se iniciará una caja nueva; el historial anterior sigue en el almacenamiento del navegador.");
      return emptyState();
    }
  }

  // Guarda ventas y turnos localmente en este navegador.
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.error("No se pudieron guardar los datos del punto de venta.", error);
      showToast("No se pudo guardar en este navegador. Revisa el almacenamiento disponible.");
      return false;
    }
  }

  // Muestra un aviso temporal en la pantalla.
  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 3200);
  }

  // Abre o cierra un diálogo y bloquea el desplazamiento del fondo.
  function setModalVisible(modal, visible) {
    modal.hidden = !visible;
    document.body.classList.toggle("modal-open", visible);
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
    elements.cashoutStatus.classList.toggle("closed", !isOpen);
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
      `${state.sales.length} venta(s) y ${state.cuts.length} corte(s) guardados en este navegador.`;
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
    elements.products.forEach(card => {
      const product = getProductFromCard(card);
      const matchesCategory = selectedCategory === "Todos" || product.category === selectedCategory;
      const matchesQuery = normalize(`${product.name} ${product.description} ${product.category}`).includes(query);
      card.closest(".col").hidden = !(matchesCategory && matchesQuery);
    });

    elements.categories.forEach(button => {
      const active = button.dataset.category === selectedCategory;
      button.classList.toggle("current", active);
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
      empty.className = "empty-ticket";
      empty.textContent = "Tu ticket está vacío. Agrega algo rico ♡";
      elements.ticketItems.append(empty);
    } else {
      items.forEach(item => {
        const row = document.createElement("div");
        row.className = "ticket-item";
        row.innerHTML = `
          <span class="item-qty">${item.quantity}×</span>
          <div class="item-description">
            <strong></strong><small>${money(item.price)} c/u</small>
            <span class="quantity-controls">
              <button type="button" data-ticket-action="decrease" aria-label="Quitar una unidad">−</button>
              <button type="button" data-ticket-action="increase" aria-label="Agregar una unidad">+</button>
              <button type="button" data-ticket-action="remove" aria-label="Eliminar producto">Quitar</button>
            </span>
          </div>
          <strong class="item-price">${money(item.price * item.quantity)}</strong>`;
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
    elements.chargeButton.firstChild.textContent = `Cobrar ${money(total)} `;
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
    elements.cutDifference.classList.toggle("shortage", difference < 0);
    elements.cutDifference.classList.toggle("surplus", difference > 0);
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
    card.addEventListener("click", () => {
      if (!state.activeShift) return;
      const product = getProductFromCard(card);
      const item = ticket.get(product.id);
      ticket.set(product.id, { ...product, quantity: (item?.quantity || 0) + 1 });
      renderTicket();
    });
  });

  elements.ticketItems.addEventListener("click", event => {
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
    renderTicket();
  });

  // Eventos de búsqueda, filtro de categoría y método de pago.
  elements.search.addEventListener("input", renderCatalog);
  elements.categories.forEach(button => button.addEventListener("click", () => {
    selectedCategory = button.dataset.category;
    if (needsStorageMigration) saveState();
    renderCatalog();
  }));
  elements.paymentRadios.forEach(input => input.addEventListener("change", () => {
    selectedPayment = input.value;
    updatePaymentInterface();
  }));
  elements.cashReceived.addEventListener("input", updatePaymentInterface);

  // Valida y guarda una venta; si falla el guardado conserva el ticket.
  elements.chargeButton.addEventListener("click", () => {
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
    if (!saveState()) {
      state.sales.pop();
      state.nextSaleNumber -= 1;
      return;
    }
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

  elements.cutForm.addEventListener("submit", event => {
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
    if (!saveState()) {
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
  elements.cashierForm.addEventListener("submit", event => {
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
    if (!saveState()) {
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

  // Escape cancela el corte, pero no permite omitir el inicio de sesión.
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !elements.cashierModal.hidden) {
      event.preventDefault();
      showToast("Inicia sesión para usar la caja.");
    } else if (event.key === "Escape" && !elements.cutModal.hidden) {
      setModalVisible(elements.cutModal, false);
    }
  });

  // Dibuja la pantalla inicial y mantiene actualizada la fecha local.
  updateDateLabel();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateDateLabel();
  });
  renderCatalog();
  renderTicket();
  updateShiftInterface();
  if (!state.activeShift) openCashierModal();
})();