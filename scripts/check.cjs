// src/engine/money.ts
var rub = (n) => Math.round(n * 100);
function splitEvenly(total, n) {
  const base = Math.floor(total / n);
  let rest = total - base * n;
  return Array.from({ length: n }, () => {
    const extra = rest > 0 ? 1 : 0;
    rest -= extra;
    return base + extra;
  });
}

// src/engine/classify.ts
var dateOf = (s) => /* @__PURE__ */ new Date(s + "T12:00:00");
var daysBetween = (a, b) => Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 864e5);
var ddmm = (iso2) => iso2.slice(8, 10) + "." + iso2.slice(5, 7);
var CATEGORY_RULES = [
  [/пятёрочка|продукт|рынок|магнит|лента|вкусвилл/i, "groceries"],
  [/ресторан|кафе|бар|ужин|обед|кофейня/i, "restaurants"],
  [/метро|такси|проездн|транспорт|бензин/i, "transport"],
  [/техник|электрон|ноутбук|телефон/i, "electronics"],
  [/аптек|клиник|врач|здоров/i, "health"],
  [/кино|театр|подписк|развлеч/i, "entertainment"],
  [/аренда|жкх|быт|дом/i, "home"],
  [/комисси/i, "fees"],
  [/связь|интернет|услуг/i, "services"]
];
function suggestCategory(description) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(description)) return cat;
  return "uncategorized";
}
var SELF = "\u042F";
function classify(raws2, accounts, manual, decisions) {
  const txs = [...raws2].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.id.localeCompare(b.id));
  const ownAccountIds = new Set(accounts.filter((a) => a.ownConfirmed).map((a) => a.id));
  const accById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const cashId = accounts.find((a) => a.kind === "cash")?.id ?? "cash";
  const events2 = [];
  const questions2 = [];
  const receivables2 = [];
  const movements2 = [];
  const used = /* @__PURE__ */ new Set();
  const mv = (t) => {
    const m = {
      id: "m_" + t.id,
      rawId: t.id,
      accountId: t.accountId,
      date: t.bookingDate,
      signedAmountMinor: t.signedAmountMinor,
      origin: "import"
    };
    movements2.push(m);
    return m;
  };
  const expenseEffect = (date, amountMinor, category) => ({ date, measure: "expense", amountMinor, category });
  const incomeEffect = (date, amountMinor) => ({ date, measure: "income", amountMinor });
  for (const out of txs) {
    if (used.has(out.id) || out.signedAmountMinor >= 0) continue;
    if (out.bankType !== "transfer") continue;
    const ref = out.counterpartyAccountRef;
    if (!ref || !ownAccountIds.has(ref)) continue;
    const mates = txs.filter((t) => !used.has(t.id) && t.accountId === ref && t.signedAmountMinor === -out.signedAmountMinor && Math.abs(daysBetween(out.bookingDate, t.bookingDate)) <= 3);
    used.add(out.id);
    const mate = mates.length === 1 ? mates[0] : void 0;
    if (mate) used.add(mate.id);
    events2.push({
      id: "e_" + out.id,
      kind: "OWN_TRANSFER",
      date: out.bookingDate,
      title: "\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u0441\u0435\u0431\u0435 \u2192 " + (accById[ref]?.name ?? ref),
      movements: mate ? [mv(out), mv(mate)] : [mv(out)],
      effects: [],
      resolutionStatus: "confirmed",
      resolutionSource: "rule",
      coverageStatus: mate ? "complete" : "missing_counterpart",
      explanation: mate ? "\u0414\u0432\u0435 \u0437\u0430\u043F\u0438\u0441\u0438 \u0432\u044B\u043F\u0438\u0441\u043E\u043A \u0441\u043A\u043B\u0435\u0435\u043D\u044B \u0432 \u043E\u0434\u043D\u0443 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044E: \u0441\u0432\u043E\u0438 \u0441\u0447\u0435\u0442\u0430, \u0440\u0430\u0432\u043D\u044B\u0435 \u0432\u0441\u0442\u0440\u0435\u0447\u043D\u044B\u0435 \u0441\u0443\u043C\u043C\u044B, \u0440\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u044E\u0442 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435. \u041D\u0438 \u0440\u0430\u0441\u0445\u043E\u0434, \u043D\u0438 \u0434\u043E\u0445\u043E\u0434." : "\u0421\u0447\u0451\u0442 \u043F\u043E\u043B\u0443\u0447\u0430\u0442\u0435\u043B\u044F \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D \u043A\u0430\u043A \u0441\u0432\u043E\u0439, \u043D\u043E \u0432\u0442\u043E\u0440\u0430\u044F \u0432\u044B\u043F\u0438\u0441\u043A\u0430 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u0430. \u041E\u043F\u0435\u0440\u0430\u0446\u0438\u044F \u0443\u0447\u0442\u0435\u043D\u0430 \u043A\u0430\u043A \u043F\u0435\u0440\u0435\u0432\u043E\u0434, \u043D\u0435 \u043A\u0430\u043A \u0440\u0430\u0441\u0445\u043E\u0434."
    });
  }
  for (const t of txs) {
    if (used.has(t.id) || t.bankType !== "cash_withdrawal") continue;
    used.add(t.id);
    const bankMv = mv(t);
    const derived = {
      id: "m_" + t.id + "_cash",
      accountId: cashId,
      date: t.bookingDate,
      signedAmountMinor: -t.signedAmountMinor,
      origin: "derived_cash"
    };
    movements2.push(derived);
    events2.push({
      id: "e_" + t.id,
      kind: "CASH_WITHDRAWAL",
      date: t.bookingDate,
      title: "\u0421\u043D\u044F\u0442\u0438\u0435 \u043D\u0430\u043B\u0438\u0447\u043D\u044B\u0445",
      movements: [bankMv, derived],
      effects: [],
      resolutionStatus: "confirmed",
      resolutionSource: "bank_type",
      coverageStatus: "complete",
      explanation: "\u0414\u0435\u043D\u044C\u0433\u0438 \u043F\u0435\u0440\u0435\u043B\u043E\u0436\u0435\u043D\u044B \u0432 \u043D\u0430\u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u043E\u0448\u0435\u043B\u0451\u043A, \u0430 \u043D\u0435 \u043F\u043E\u0442\u0440\u0430\u0447\u0435\u043D\u044B. \u0420\u0430\u0441\u0445\u043E\u0434 \u0432\u043E\u0437\u043D\u0438\u043A\u043D\u0435\u0442 \u043F\u0440\u0438 \u043F\u043E\u043A\u0443\u043F\u043A\u0435 \u0437\u0430 \u043D\u0430\u043B\u0438\u0447\u043D\u044B\u0435."
    });
  }
  for (const t of txs) {
    if (used.has(t.id) || t.bankType !== "salary") continue;
    used.add(t.id);
    events2.push({
      id: "e_" + t.id,
      kind: "INCOME",
      date: t.bookingDate,
      title: t.description,
      movements: [mv(t)],
      effects: [incomeEffect(t.bookingDate, t.signedAmountMinor)],
      resolutionStatus: "confirmed",
      resolutionSource: "bank_type",
      coverageStatus: "complete",
      counterparty: t.counterparty,
      explanation: "\u0411\u0430\u043D\u043A \u043E\u0442\u043C\u0435\u0442\u0438\u043B \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044E \u043A\u0430\u043A \u0437\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u0435 \u0437\u0430\u0440\u0430\u0431\u043E\u0442\u043D\u043E\u0439 \u043F\u043B\u0430\u0442\u044B."
    });
  }
  const sharedPurchases = [];
  for (const t of txs) {
    if (used.has(t.id) || t.bankType !== "purchase") continue;
    used.add(t.id);
    const total = -t.signedAmountMinor;
    const cat = suggestCategory(t.description);
    const qid = "q_shared_" + t.id;
    const splitDecision = decisions[qid];
    if (splitDecision && splitDecision.startsWith("split")) {
      const n = Number(splitDecision.slice("split".length)) || 2;
      const parts = splitEvenly(total, n);
      const shares = parts.map((amountMinor, i) => ({
        name: i === 0 ? SELF : "\u0414\u0440\u0443\u0433 " + i,
        isSelf: i === 0,
        amountMinor,
        settledMinor: 0
      }));
      const ev = {
        id: "e_" + t.id,
        kind: "SHARED_PURCHASE",
        date: t.bookingDate,
        title: t.description,
        movements: [mv(t)],
        effects: [expenseEffect(t.bookingDate, parts[0], cat)],
        resolutionStatus: "confirmed",
        resolutionSource: "user",
        coverageStatus: "complete",
        category: cat,
        shares,
        explanation: "\u0412\u044B \u043F\u043B\u0430\u0442\u0438\u043B\u0438 \u0437\u0430 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u044E \u0438\u0437 " + n + " \u0447\u0435\u043B\u043E\u0432\u0435\u043A. \u0412 \u0440\u0430\u0441\u0445\u043E\u0434\u044B \u043F\u043E\u043F\u0430\u043B\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0430\u0448\u0430 \u0434\u043E\u043B\u044F " + (parts[0] / 100).toLocaleString("ru-RU") + " \u20BD. \u041E\u0441\u0442\u0430\u043B\u044C\u043D\u044B\u0435 \u0434\u043E\u043B\u0438 \u2014 \u0437\u0430\u0434\u043E\u043B\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u044C \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432, \u043D\u0435 \u0432\u0430\u0448 \u0440\u0430\u0441\u0445\u043E\u0434."
      };
      events2.push(ev);
      sharedPurchases.push({ event: ev, tx: t });
      shares.filter((s) => !s.isSelf).forEach((s, i) => receivables2.push({
        id: "rc_" + t.id + "_" + i,
        originEventId: ev.id,
        participant: s.name,
        originalMinor: s.amountMinor,
        settledMinor: 0,
        createdDate: t.bookingDate
      }));
      continue;
    }
    events2.push({
      id: "e_" + t.id,
      kind: "EXPENSE",
      date: t.bookingDate,
      title: t.description,
      movements: [mv(t)],
      effects: [expenseEffect(t.bookingDate, total, cat)],
      resolutionStatus: "confirmed",
      resolutionSource: "bank_type",
      coverageStatus: "complete",
      category: cat,
      explanation: "\u0411\u0430\u043D\u043A \u043E\u0442\u043C\u0435\u0442\u0438\u043B \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044E \u043A\u0430\u043A \u043F\u043E\u043A\u0443\u043F\u043A\u0443. \u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0430 \u043F\u043E \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044E \u043F\u0440\u043E\u0434\u0430\u0432\u0446\u0430."
    });
  }
  const loans = [];
  for (const t of txs) {
    if (used.has(t.id) || t.signedAmountMinor >= 0) continue;
    used.add(t.id);
    const amount = -t.signedAmountMinor;
    const qid = "q_meaning_" + t.id;
    const decision = decisions[qid];
    const who = t.counterparty ?? "\u043F\u043E\u043B\u0443\u0447\u0430\u0442\u0435\u043B\u044C";
    if (decision === "loan_issued") {
      const ev = {
        id: "e_" + t.id,
        kind: "LOAN_ISSUED",
        date: t.bookingDate,
        title: "\u0414\u0430\u043B \u0432 \u0434\u043E\u043B\u0433 \xB7 " + who,
        movements: [mv(t)],
        effects: [],
        resolutionStatus: "confirmed",
        resolutionSource: "user",
        coverageStatus: "complete",
        counterparty: who,
        explanation: "\u0412\u044B \u043E\u0442\u043C\u0435\u0442\u0438\u043B\u0438 \u043F\u0435\u0440\u0435\u0432\u043E\u0434 \u043A\u0430\u043A \u0432\u044B\u0434\u0430\u043D\u043D\u044B\u0439 \u0434\u043E\u043B\u0433. \u042D\u0442\u043E \u0434\u0435\u0431\u0438\u0442\u043E\u0440\u0441\u043A\u0430\u044F \u0437\u0430\u0434\u043E\u043B\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u044C, \u0430 \u043D\u0435 \u0440\u0430\u0441\u0445\u043E\u0434: \u0434\u0435\u043D\u044C\u0433\u0438 \u0432\u044B \u0436\u0434\u0451\u0442\u0435 \u043E\u0431\u0440\u0430\u0442\u043D\u043E."
      };
      events2.push(ev);
      const rc = {
        id: "rc_" + t.id,
        originEventId: ev.id,
        participant: who,
        originalMinor: amount,
        settledMinor: 0,
        createdDate: t.bookingDate
      };
      receivables2.push(rc);
      loans.push({ event: ev, tx: t, receivable: rc });
      continue;
    }
    if (decision === "expense") {
      const cat = suggestCategory(t.description);
      events2.push({
        id: "e_" + t.id,
        kind: "EXPENSE",
        date: t.bookingDate,
        title: t.description,
        movements: [mv(t)],
        effects: [expenseEffect(t.bookingDate, amount, cat)],
        resolutionStatus: "confirmed",
        resolutionSource: "user",
        coverageStatus: "complete",
        category: cat,
        counterparty: who,
        explanation: "\u0412\u044B \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u043B\u0438, \u0447\u0442\u043E \u044D\u0442\u043E \u043E\u0431\u044B\u0447\u043D\u044B\u0439 \u0440\u0430\u0441\u0445\u043E\u0434."
      });
      continue;
    }
    events2.push({
      id: "e_" + t.id,
      kind: "UNRESOLVED",
      date: t.bookingDate,
      title: t.description,
      movements: [mv(t)],
      effects: [],
      resolutionStatus: "unresolved",
      resolutionSource: "rule",
      coverageStatus: "complete",
      counterparty: t.counterparty,
      explanation: "\u0418\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0439 \u043F\u0435\u0440\u0435\u0432\u043E\u0434 \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0443. \u041F\u043E\u043A\u0430 \u0441\u043C\u044B\u0441\u043B \u043D\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D, \u0434\u0435\u043D\u044C\u0433\u0438 \u0443\u0447\u0442\u0435\u043D\u044B \u043A\u0430\u043A \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0435, \u043D\u043E \u0432 \u0440\u0430\u0441\u0445\u043E\u0434\u044B \u043D\u0435 \u043F\u043E\u043F\u0430\u043B\u0438 \u2014 \u0438\u043D\u0430\u0447\u0435 \u0438\u0442\u043E\u0433 \u0431\u044B\u043B \u0431\u044B \u0437\u0430\u0432\u044B\u0448\u0435\u043D."
    });
    questions2.push({
      id: qid,
      type: "economic_meaning",
      title: "\u0427\u0442\u043E \u043E\u0437\u043D\u0430\u0447\u0430\u0435\u0442 \u043F\u0435\u0440\u0435\u0432\u043E\u0434 " + (amount / 100).toLocaleString("ru-RU") + " \u20BD?",
      body: ddmm(t.bookingDate) + " \xB7 " + t.description + (t.counterparty ? " \xB7 " + t.counterparty : ""),
      relatedIds: [t.id],
      impactMinor: amount,
      changesTotals: true,
      options: [
        { id: "loan_issued", label: "\u0414\u0430\u043B \u0432 \u0434\u043E\u043B\u0433", hint: who, effectNote: "\u0440\u0430\u0441\u0445\u043E\u0434\u044B \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u044F\u0442\u0441\u044F, \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0434\u043E\u043B\u0433" },
        { id: "expense", label: "\u042D\u0442\u043E \u043C\u043E\u0439 \u0440\u0430\u0441\u0445\u043E\u0434", effectNote: "\u0440\u0430\u0441\u0445\u043E\u0434\u044B \u0432\u044B\u0440\u0430\u0441\u0442\u0443\u0442 \u043D\u0430 " + (amount / 100).toLocaleString("ru-RU") + " \u20BD" },
        { id: "later", label: "\u041F\u043E\u0437\u0436\u0435", effectNote: "\u043E\u0441\u0442\u0430\u043D\u0435\u0442\u0441\u044F \u043D\u0435\u0440\u0430\u0437\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u043C" }
      ]
    });
  }
  for (const t of txs) {
    if (used.has(t.id) || t.bankType !== "refund") continue;
    used.add(t.id);
    const amount = t.signedAmountMinor;
    const base = t.description.replace(/,\s*возврат\s*$/i, "").trim().toLowerCase();
    const origin = events2.find((e) => (e.kind === "EXPENSE" || e.kind === "SHARED_PURCHASE") && e.title.toLowerCase().startsWith(base) && daysBetween(e.date, t.bookingDate) >= 0 && daysBetween(e.date, t.bookingDate) <= 60 && (e.effects[0]?.amountMinor ?? 0) >= amount);
    const qid = "q_refund_" + t.id;
    const decision = decisions[qid];
    if (decision && decision.startsWith("link_") && origin) {
      const cat = origin.category ?? "uncategorized";
      events2.push({
        id: "e_" + t.id,
        kind: "PURCHASE_REFUND",
        date: t.bookingDate,
        title: "\u0412\u043E\u0437\u0432\u0440\u0430\u0442 \xB7 " + origin.title,
        movements: [mv(t)],
        effects: [expenseEffect(t.bookingDate, -amount, cat)],
        resolutionStatus: "confirmed",
        resolutionSource: "user",
        coverageStatus: "complete",
        category: cat,
        linkedEventId: origin.id,
        explanation: "\u0412\u043E\u0437\u0432\u0440\u0430\u0442 \u043F\u043E\u043A\u0443\u043F\u043A\u0438 \u043E\u0442 " + ddmm(origin.date) + ". \u042D\u0442\u043E \u043D\u0435 \u0434\u043E\u0445\u043E\u0434: \u0440\u0430\u0441\u0445\u043E\u0434\u044B \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u044E\u0442\u0441\u044F \u043D\u0430 \u0434\u0430\u0442\u0443 \u0432\u043E\u0437\u0432\u0440\u0430\u0442\u0430, \u0432 \u0442\u043E\u0439 \u0436\u0435 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438. \u041F\u0440\u043E\u0448\u043B\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434 \u043D\u0435 \u043F\u0435\u0440\u0435\u043F\u0438\u0441\u044B\u0432\u0430\u0435\u0442\u0441\u044F."
      });
      continue;
    }
    if (decision === "income") {
      events2.push({
        id: "e_" + t.id,
        kind: "INCOME",
        date: t.bookingDate,
        title: t.description,
        movements: [mv(t)],
        effects: [incomeEffect(t.bookingDate, amount)],
        resolutionStatus: "confirmed",
        resolutionSource: "user",
        coverageStatus: "complete",
        explanation: "\u0412\u044B \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u043B\u0438, \u0447\u0442\u043E \u044D\u0442\u043E \u0434\u043E\u0445\u043E\u0434."
      });
      continue;
    }
    events2.push({
      id: "e_" + t.id,
      kind: "UNRESOLVED",
      date: t.bookingDate,
      title: t.description,
      movements: [mv(t)],
      effects: [],
      resolutionStatus: "unresolved",
      resolutionSource: "rule",
      coverageStatus: "complete",
      explanation: "\u0411\u0430\u043D\u043A \u043F\u043E\u043C\u0435\u0442\u0438\u043B \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u0435 \u043A\u0430\u043A \u0432\u043E\u0437\u0432\u0440\u0430\u0442, \u043D\u043E \u0441\u0432\u044F\u0437\u044C \u0441 \u043F\u043E\u043A\u0443\u043F\u043A\u043E\u0439 \u043D\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430. \u0414\u043E\u0445\u043E\u0434\u043E\u043C \u0442\u0430\u043A\u043E\u0435 \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u0435 \u043D\u0435 \u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F."
    });
    questions2.push({
      id: qid,
      type: "refund_link",
      title: "\u042D\u0442\u043E \u0432\u043E\u0437\u0432\u0440\u0430\u0442 \u043F\u043E\u043A\u0443\u043F\u043A\u0438?",
      body: (amount / 100).toLocaleString("ru-RU") + " \u20BD \u043E\u0442 " + ddmm(t.bookingDate) + (origin ? " \xB7 \u043F\u043E\u0445\u043E\u0436\u0435 \u043D\u0430 \u043F\u043E\u043A\u0443\u043F\u043A\u0443 \xAB" + origin.title + "\xBB \u043E\u0442 " + ddmm(origin.date) : ""),
      relatedIds: [t.id],
      impactMinor: amount,
      changesTotals: true,
      options: [
        ...origin ? [{
          id: "link_" + origin.id,
          label: "\u0414\u0430, \u0432\u043E\u0437\u0432\u0440\u0430\u0442 \u043F\u043E\u043A\u0443\u043F\u043A\u0438 \u043E\u0442 " + ddmm(origin.date),
          effectNote: "\u0440\u0430\u0441\u0445\u043E\u0434\u044B \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u0442\u0441\u044F \u043D\u0430 " + (amount / 100).toLocaleString("ru-RU") + " \u20BD"
        }] : [],
        { id: "income", label: "\u041D\u0435\u0442, \u044D\u0442\u043E \u0434\u043E\u0445\u043E\u0434", effectNote: "\u0434\u043E\u0445\u043E\u0434\u044B \u0432\u044B\u0440\u0430\u0441\u0442\u0443\u0442" },
        { id: "later", label: "\u041F\u043E\u0437\u0436\u0435", effectNote: "\u043E\u0441\u0442\u0430\u043D\u0435\u0442\u0441\u044F \u043D\u0435\u0440\u0430\u0437\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u043C" }
      ]
    });
  }
  const openLoans = () => loans.filter((l) => l.receivable.settledMinor < l.receivable.originalMinor);
  for (const t of txs) {
    if (used.has(t.id) || t.signedAmountMinor <= 0) continue;
    used.add(t.id);
    const amount = t.signedAmountMinor;
    const who = t.counterparty;
    const qid = "q_incoming_" + t.id;
    const decision = decisions[qid];
    const loan = openLoans().find((l) => who && l.receivable.participant === who && daysBetween(l.tx.bookingDate, t.bookingDate) >= 0 && amount <= l.receivable.originalMinor - l.receivable.settledMinor);
    const shared = sharedPurchases.find((sp) => who && sp.event.shares?.some((s) => s.name === who && s.settledMinor < s.amountMinor) && daysBetween(sp.tx.bookingDate, t.bookingDate) >= 0);
    if (decision === "settle" && loan) {
      loan.receivable.settledMinor += amount;
      const left = loan.receivable.originalMinor - loan.receivable.settledMinor;
      events2.push({
        id: "e_" + t.id,
        kind: "LOAN_REPAYMENT",
        date: t.bookingDate,
        title: "\u0412\u043E\u0437\u0432\u0440\u0430\u0442 \u0434\u043E\u043B\u0433\u0430 \xB7 " + who,
        movements: [mv(t)],
        effects: [],
        resolutionStatus: "confirmed",
        resolutionSource: "user",
        coverageStatus: "complete",
        counterparty: who,
        linkedEventId: loan.event.id,
        explanation: left > 0 ? "\u0427\u0430\u0441\u0442\u0438\u0447\u043D\u044B\u0439 \u0432\u043E\u0437\u0432\u0440\u0430\u0442 \u0434\u043E\u043B\u0433\u0430 \u043E\u0442 " + ddmm(loan.tx.bookingDate) + ". \u041E\u0441\u0442\u0430\u0442\u043E\u043A " + (left / 100).toLocaleString("ru-RU") + " \u20BD. \u0414\u043E\u0445\u043E\u0434\u043E\u043C \u043D\u0435 \u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F." : "\u0414\u043E\u043B\u0433 \u043E\u0442 " + ddmm(loan.tx.bookingDate) + " \u0437\u0430\u043A\u0440\u044B\u0442 \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E. \u0414\u043E\u0445\u043E\u0434\u043E\u043C \u043D\u0435 \u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F."
      });
      continue;
    }
    if (decision === "reimburse" && shared) {
      const share = shared.event.shares.find((s) => s.name === who);
      share.settledMinor += amount;
      const rc = receivables2.find((r) => r.originEventId === shared.event.id && r.participant === who);
      if (rc) rc.settledMinor += amount;
      events2.push({
        id: "e_" + t.id,
        kind: "REIMBURSEMENT",
        date: t.bookingDate,
        title: "\u0414\u043E\u043B\u044F \xB7 " + who,
        movements: [mv(t)],
        effects: [],
        resolutionStatus: "confirmed",
        resolutionSource: "user",
        coverageStatus: "complete",
        counterparty: who,
        linkedEventId: shared.event.id,
        explanation: "\u041A\u043E\u043C\u043F\u0435\u043D\u0441\u0430\u0446\u0438\u044F \u0434\u043E\u043B\u0438 \u0437\u0430 \xAB" + shared.event.title + "\xBB. \u041D\u0438 \u0434\u043E\u0445\u043E\u0434, \u043D\u0438 \u0443\u043C\u0435\u043D\u044C\u0448\u0435\u043D\u0438\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u0430: \u0432\u0430\u0448 \u0440\u0430\u0441\u0445\u043E\u0434 \u0443\u0436\u0435 \u0440\u0430\u0432\u0435\u043D \u0432\u0430\u0448\u0435\u0439 \u0434\u043E\u043B\u0435, \u0430 \u044D\u0442\u043E \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u0435 \u0433\u0430\u0441\u0438\u0442 \u0447\u0443\u0436\u0443\u044E \u0437\u0430\u0434\u043E\u043B\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u044C."
      });
      continue;
    }
    if (decision === "income") {
      events2.push({
        id: "e_" + t.id,
        kind: "INCOME",
        date: t.bookingDate,
        title: t.description,
        movements: [mv(t)],
        effects: [incomeEffect(t.bookingDate, amount)],
        resolutionStatus: "confirmed",
        resolutionSource: "user",
        coverageStatus: "complete",
        counterparty: who,
        explanation: "\u0412\u044B \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u043B\u0438, \u0447\u0442\u043E \u044D\u0442\u043E \u0434\u043E\u0445\u043E\u0434."
      });
      continue;
    }
    events2.push({
      id: "e_" + t.id,
      kind: "UNRESOLVED",
      date: t.bookingDate,
      title: t.description,
      movements: [mv(t)],
      effects: [],
      resolutionStatus: "unresolved",
      resolutionSource: "rule",
      coverageStatus: "complete",
      counterparty: who,
      explanation: "\u0412\u0445\u043E\u0434\u044F\u0449\u0438\u0439 \u043F\u0435\u0440\u0435\u0432\u043E\u0434 \u0431\u0435\u0437 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D\u043D\u043E\u0433\u043E \u043E\u0441\u043D\u043E\u0432\u0430\u043D\u0438\u044F. \u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u0441\u0447\u0438\u0442\u0430\u0442\u044C \u0435\u0433\u043E \u0434\u043E\u0445\u043E\u0434\u043E\u043C \u043D\u0435\u043B\u044C\u0437\u044F: \u044D\u0442\u043E \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u0432\u043E\u0437\u0432\u0440\u0430\u0442 \u0434\u043E\u043B\u0433\u0430 \u0438\u043B\u0438 \u043A\u043E\u043C\u043F\u0435\u043D\u0441\u0430\u0446\u0438\u044F \u0434\u043E\u043B\u0438."
    });
    const options = [
      ...shared ? [{
        id: "reimburse",
        label: "\u0412\u0435\u0440\u043D\u0443\u043B\u0438 \u043C\u043E\u044E \u0434\u043E\u043B\u044E",
        hint: shared.event.title,
        effectNote: "\u0438\u0442\u043E\u0433\u0438 \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u044F\u0442\u0441\u044F, \u0434\u043E\u043B\u0433 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0430 \u0437\u0430\u043A\u0440\u043E\u0435\u0442\u0441\u044F"
      }] : [],
      ...loan ? [{
        id: "settle",
        label: "\u0412\u043E\u0437\u0432\u0440\u0430\u0442 \u0434\u043E\u043B\u0433\u0430",
        hint: who,
        effectNote: "\u0438\u0442\u043E\u0433\u0438 \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u044F\u0442\u0441\u044F, \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u0434\u043E\u043B\u0433\u0430 \u0443\u043C\u0435\u043D\u044C\u0448\u0438\u0442\u0441\u044F"
      }] : [],
      { id: "income", label: "\u042D\u0442\u043E \u0434\u043E\u0445\u043E\u0434", effectNote: "\u0434\u043E\u0445\u043E\u0434\u044B \u0432\u044B\u0440\u0430\u0441\u0442\u0443\u0442 \u043D\u0430 " + (amount / 100).toLocaleString("ru-RU") + " \u20BD" },
      { id: "later", label: "\u041F\u043E\u0437\u0436\u0435", effectNote: "\u043E\u0441\u0442\u0430\u043D\u0435\u0442\u0441\u044F \u043D\u0435\u0440\u0430\u0437\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u043C" }
    ];
    questions2.push({
      id: qid,
      type: loan || shared ? "settlement_group" : "economic_meaning",
      title: loan || shared ? "\u042D\u0442\u043E \u043F\u043E\u0433\u0430\u0448\u0435\u043D\u0438\u0435? " + (amount / 100).toLocaleString("ru-RU") + " \u20BD" : "\u0427\u0442\u043E \u043E\u0437\u043D\u0430\u0447\u0430\u0435\u0442 \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u0435 " + (amount / 100).toLocaleString("ru-RU") + " \u20BD?",
      body: ddmm(t.bookingDate) + " \xB7 " + t.description,
      relatedIds: [t.id],
      impactMinor: amount,
      impactIsVolume: Boolean(loan || shared),
      changesTotals: !(loan || shared),
      options
    });
  }
  for (const m of manual) {
    const amount = -m.amountMinor;
    const mov = {
      id: "m_" + m.id,
      accountId: m.accountId,
      date: m.date,
      signedAmountMinor: m.amountMinor,
      origin: "manual"
    };
    movements2.push(mov);
    events2.push({
      id: "e_" + m.id,
      kind: "EXPENSE",
      date: m.date,
      title: m.description,
      movements: [mov],
      effects: [expenseEffect(m.date, amount, m.category)],
      resolutionStatus: "confirmed",
      resolutionSource: "user",
      coverageStatus: "complete",
      category: m.category,
      explanation: "\u041F\u043E\u043A\u0443\u043F\u043A\u0430 \u0437\u0430 \u043D\u0430\u043B\u0438\u0447\u043D\u044B\u0435, \u0432\u043D\u0435\u0441\u0435\u043D\u0430 \u0432\u0440\u0443\u0447\u043D\u0443\u044E. \u0411\u0430\u043D\u043A\u043E\u0432\u0441\u043A\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u0438 \u0434\u043B\u044F \u043D\u0435\u0451 \u043D\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442."
    });
  }
  for (const ev of events2) {
    if (ev.kind !== "EXPENSE" || !ev.effects[0]) continue;
    if (ev.category !== "restaurants") continue;
    if (ev.effects[0].amountMinor < 3e5) continue;
    const qid = "q_shared_" + (ev.movements[0]?.rawId ?? ev.id);
    if (decisions[qid]) continue;
    const total = ev.effects[0].amountMinor;
    questions2.push({
      id: qid,
      type: "economic_meaning",
      title: "\u0412\u044B \u043F\u043B\u0430\u0442\u0438\u043B\u0438 \u0437\u0430 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u044E?",
      body: ddmm(ev.date) + " \xB7 " + ev.title + " \xB7 " + (total / 100).toLocaleString("ru-RU") + " \u20BD",
      relatedIds: [ev.id],
      impactMinor: total - Math.floor(total / 5),
      changesTotals: true,
      options: [
        { id: "split5", label: "\u0414\u0430, \u043D\u0430 \u043F\u044F\u0442\u0435\u0440\u044B\u0445 \u043F\u043E\u0440\u043E\u0432\u043D\u0443", effectNote: "\u0432 \u0440\u0430\u0441\u0445\u043E\u0434\u044B \u043F\u043E\u043F\u0430\u0434\u0451\u0442 " + (Math.floor(total / 5) / 100).toLocaleString("ru-RU") + " \u20BD" },
        { id: "split2", label: "\u0414\u0430, \u043F\u043E\u043F\u043E\u043B\u0430\u043C", effectNote: "\u0432 \u0440\u0430\u0441\u0445\u043E\u0434\u044B \u043F\u043E\u043F\u0430\u0434\u0451\u0442 " + (Math.floor(total / 2) / 100).toLocaleString("ru-RU") + " \u20BD" },
        { id: "no", label: "\u041D\u0435\u0442, \u043F\u043B\u0430\u0442\u0438\u043B \u0442\u043E\u043B\u044C\u043A\u043E \u0437\u0430 \u0441\u0435\u0431\u044F", effectNote: "\u0440\u0430\u0441\u0445\u043E\u0434\u044B \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u044F\u0442\u0441\u044F" }
      ]
    });
  }
  questions2.sort((a, b) => Number(b.changesTotals) - Number(a.changesTotals) || Math.abs(b.impactMinor) - Math.abs(a.impactMinor) || b.relatedIds.length - a.relatedIds.length || a.id.localeCompare(b.id));
  events2.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { events: events2, questions: questions2, receivables: receivables2, movements: movements2 };
}
var DEMO_DECISIONS = {
  q_meaning_S07: "loan_issued",
  q_incoming_S08: "settle",
  q_incoming_S09: "settle",
  q_shared_S10: "split5",
  q_incoming_S11: "reimburse",
  q_incoming_S12: "reimburse",
  q_incoming_S13: "reimburse",
  q_incoming_S14: "reimburse",
  q_refund_S17: "link_e_S16"
  // S15 намеренно оставлен неразобранным
};

// src/data/demo.ts
var DEMO_TODAY = "2026-09-30";
var ACCOUNTS = [
  { id: "main", name: "\u041E\u0441\u043D\u043E\u0432\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430", kind: "bank", ownConfirmed: true, color: "#CCFF00" },
  { id: "second", name: "\u0412\u0442\u043E\u0440\u0430\u044F \u043A\u0430\u0440\u0442\u0430", kind: "bank", ownConfirmed: true, color: "#8FE388" },
  { id: "market", name: "\u041A\u0430\u0440\u0442\u0430 \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0430", kind: "bank", ownConfirmed: true, color: "#5ED3A0" },
  {
    id: "cash",
    name: "\u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435",
    kind: "cash",
    ownConfirmed: true,
    color: "#AAAAAA",
    openingBalanceMinor: 0,
    openingBalanceDate: "2026-09-01"
  }
];
var sep = (day) => "2026-09-" + String(day).padStart(2, "0");
var tx = (id, accountId, bookingDate, amountRub, description, bankType, counterparty, counterpartyAccountRef) => ({
  id,
  accountId,
  bookingDate,
  signedAmountMinor: rub(amountRub),
  description,
  bankType,
  counterparty,
  counterpartyAccountRef
});
function buildDemoTransactions() {
  const out = [];
  for (let day = 1; day <= 30; day++) {
    out.push(tx(
      "B" + String(day).padStart(3, "0"),
      "main",
      sep(day),
      -100,
      "\u041F\u044F\u0442\u0451\u0440\u043E\u0447\u043A\u0430, \u043F\u0440\u043E\u0434\u0443\u043A\u0442\u044B",
      "purchase"
    ));
  }
  const incomeDays = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29];
  incomeDays.forEach((day, i) => {
    out.push(tx(
      "B" + String(31 + i),
      "main",
      sep(day),
      1e3,
      "\u041E\u041E\u041E \u0420\u043E\u043C\u0430\u0448\u043A\u0430, \u0432\u044B\u043F\u043B\u0430\u0442\u0430",
      "salary",
      "\u041E\u041E\u041E \u0420\u043E\u043C\u0430\u0448\u043A\u0430"
    ));
  });
  const transportDays = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30];
  transportDays.forEach((day, i) => {
    out.push(tx(
      "B" + String(41 + i),
      "main",
      sep(day),
      -200,
      "\u041C\u0435\u0442\u0440\u043E, \u043F\u0440\u043E\u0435\u0437\u0434\u043D\u043E\u0439",
      "purchase"
    ));
  });
  out.push(
    // S1. Перевод между своими картами
    tx("S01", "main", sep(3), -1e4, "\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043D\u0430 \u0441\u0432\u043E\u044E \u043A\u0430\u0440\u0442\u0443", "transfer", "\u0412\u0442\u043E\u0440\u0430\u044F \u043A\u0430\u0440\u0442\u0430", "second"),
    tx("S02", "second", sep(3), 1e4, "\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u0441\u043E \u0441\u0432\u043E\u0435\u0433\u043E \u0441\u0447\u0451\u0442\u0430", "transfer", "\u041E\u0441\u043D\u043E\u0432\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430", "main"),
    // S2. Карта маркетплейса
    tx("S03", "main", sep(4), -6e3, "\u041F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 \u043A\u0430\u0440\u0442\u044B \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0430", "transfer", "\u041A\u0430\u0440\u0442\u0430 \u043C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0430", "market"),
    tx("S04", "market", sep(4), 6e3, "\u041F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 \u0441\u043E \u0441\u0432\u043E\u0435\u0433\u043E \u0441\u0447\u0451\u0442\u0430", "transfer", "\u041E\u0441\u043D\u043E\u0432\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430", "main"),
    tx("S05", "market", sep(5), -2e3, "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441, \u043F\u0440\u043E\u0434\u0443\u043A\u0442\u044B", "purchase"),
    tx("S06", "market", sep(6), -3500, "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441, \u0442\u0435\u0445\u043D\u0438\u043A\u0430", "purchase"),
    // S3. Долг и два возврата
    tx("S07", "main", sep(7), -3e3, "\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u0410\u043B\u0435\u043A\u0441\u0435\u044E", "transfer", "\u0410\u043B\u0435\u043A\u0441\u0435\u0439"),
    tx("S08", "main", sep(14), 1500, "\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043E\u0442 \u0410\u043B\u0435\u043A\u0441\u0435\u044F", "transfer", "\u0410\u043B\u0435\u043A\u0441\u0435\u0439"),
    tx("S09", "main", sep(21), 1500, "\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043E\u0442 \u0410\u043B\u0435\u043A\u0441\u0435\u044F", "transfer", "\u0410\u043B\u0435\u043A\u0441\u0435\u0439"),
    // S4. Ресторан на пятерых
    tx("S10", "main", sep(10), -8e3, "\u0420\u0435\u0441\u0442\u043E\u0440\u0430\u043D \u0412\u0435\u0440\u0430\u043D\u0434\u0430", "purchase"),
    tx("S11", "main", sep(11), 1600, "\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043E\u0442 \u0414\u0440\u0443\u0433 1, \u0437\u0430 \u0443\u0436\u0438\u043D", "transfer", "\u0414\u0440\u0443\u0433 1"),
    tx("S12", "main", sep(12), 1600, "\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043E\u0442 \u0414\u0440\u0443\u0433 2, \u0437\u0430 \u0443\u0436\u0438\u043D", "transfer", "\u0414\u0440\u0443\u0433 2"),
    tx("S13", "main", sep(13), 1600, "\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043E\u0442 \u0414\u0440\u0443\u0433 3, \u0437\u0430 \u0443\u0436\u0438\u043D", "transfer", "\u0414\u0440\u0443\u0433 3"),
    tx("S14", "main", sep(14), 1600, "\u041F\u0435\u0440\u0435\u0432\u043E\u0434 \u043E\u0442 \u0414\u0440\u0443\u0433 4, \u0437\u0430 \u0443\u0436\u0438\u043D", "transfer", "\u0414\u0440\u0443\u0433 4"),
    // S5. 500 ₽ «за обед» без долга
    tx("S15", "main", sep(15), 500, "\u041F\u0435\u0440\u0435\u0432\u043E\u0434, \u0437\u0430 \u043E\u0431\u0435\u0434", "transfer"),
    // S6. Покупка в августе и возврат в сентябре
    tx("S16", "main", "2026-08-28", -4200, "\u041C\u0430\u0433\u0430\u0437\u0438\u043D \u0442\u0435\u0445\u043D\u0438\u043A\u0438", "purchase"),
    tx("S17", "main", sep(16), 4200, "\u041C\u0430\u0433\u0430\u0437\u0438\u043D \u0442\u0435\u0445\u043D\u0438\u043A\u0438, \u0432\u043E\u0437\u0432\u0440\u0430\u0442", "refund"),
    // S7. Снятие наличных
    tx("S18", "main", sep(17), -5e3, "\u0421\u043D\u044F\u0442\u0438\u0435 \u0432 \u0431\u0430\u043D\u043A\u043E\u043C\u0430\u0442\u0435", "cash_withdrawal"),
    // Дополнительный доход
    tx("S20", "main", sep(25), 12e3, "\u041E\u041E\u041E \u0420\u043E\u043C\u0430\u0448\u043A\u0430, \u0432\u044B\u043F\u043B\u0430\u0442\u0430", "salary", "\u041E\u041E\u041E \u0420\u043E\u043C\u0430\u0448\u043A\u0430")
  );
  return out;
}
var MANUAL_CASH_PURCHASE = {
  id: "S19",
  accountId: "cash",
  date: sep(18),
  amountMinor: rub(-700),
  description: "\u0420\u044B\u043D\u043E\u043A, \u043F\u0440\u043E\u0434\u0443\u043A\u0442\u044B \u0437\u0430 \u043D\u0430\u043B\u0438\u0447\u043D\u044B\u0435",
  category: "groceries"
};

// src/engine/analytics.ts
var iso = (x) => {
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const d = String(x.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
};
var MONTH_GEN = [
  "\u044F\u043D\u0432\u0430\u0440\u044F",
  "\u0444\u0435\u0432\u0440\u0430\u043B\u044F",
  "\u043C\u0430\u0440\u0442\u0430",
  "\u0430\u043F\u0440\u0435\u043B\u044F",
  "\u043C\u0430\u044F",
  "\u0438\u044E\u043D\u044F",
  "\u0438\u044E\u043B\u044F",
  "\u0430\u0432\u0433\u0443\u0441\u0442\u0430",
  "\u0441\u0435\u043D\u0442\u044F\u0431\u0440\u044F",
  "\u043E\u043A\u0442\u044F\u0431\u0440\u044F",
  "\u043D\u043E\u044F\u0431\u0440\u044F",
  "\u0434\u0435\u043A\u0430\u0431\u0440\u044F"
];
var MONTH_NOM = [
  "\u042F\u043D\u0432\u0430\u0440\u044C",
  "\u0424\u0435\u0432\u0440\u0430\u043B\u044C",
  "\u041C\u0430\u0440\u0442",
  "\u0410\u043F\u0440\u0435\u043B\u044C",
  "\u041C\u0430\u0439",
  "\u0418\u044E\u043D\u044C",
  "\u0418\u044E\u043B\u044C",
  "\u0410\u0432\u0433\u0443\u0441\u0442",
  "\u0421\u0435\u043D\u0442\u044F\u0431\u0440\u044C",
  "\u041E\u043A\u0442\u044F\u0431\u0440\u044C",
  "\u041D\u043E\u044F\u0431\u0440\u044C",
  "\u0414\u0435\u043A\u0430\u0431\u0440\u044C"
];
var fmtDate = (s) => {
  const x = dateOf(s);
  return x.getDate() + " " + MONTH_GEN[x.getMonth()];
};
function dayRange(anchor) {
  return { from: anchor, to: anchor, label: fmtDate(anchor) };
}
function weekRange(anchor) {
  const x = dateOf(anchor);
  const shift = (x.getDay() + 6) % 7;
  const from = new Date(x);
  from.setDate(x.getDate() - shift);
  const to = new Date(from);
  to.setDate(from.getDate() + 6);
  const label = from.getMonth() === to.getMonth() ? from.getDate() + "\u2013" + fmtDate(iso(to)) : fmtDate(iso(from)) + " \u2013 " + fmtDate(iso(to));
  return { from: iso(from), to: iso(to), label };
}
function monthRange(anchor) {
  const x = dateOf(anchor);
  const from = new Date(x.getFullYear(), x.getMonth(), 1);
  const to = new Date(x.getFullYear(), x.getMonth() + 1, 0);
  return { from: iso(from), to: iso(to), label: MONTH_NOM[x.getMonth()] + " " + x.getFullYear() };
}
function yearRange(anchor) {
  const y = dateOf(anchor).getFullYear();
  return { from: y + "-01-01", to: y + "-12-31", label: String(y) + " \u0433\u043E\u0434" };
}
function shiftRange(r, g, dir) {
  const x = dateOf(r.from);
  if (g === "day") {
    x.setDate(x.getDate() + dir);
    return dayRange(iso(x));
  }
  if (g === "week") {
    x.setDate(x.getDate() + 7 * dir);
    return weekRange(iso(x));
  }
  if (g === "month") {
    x.setMonth(x.getMonth() + dir);
    return monthRange(iso(x));
  }
  if (g === "year") {
    x.setFullYear(x.getFullYear() + dir);
    return yearRange(iso(x));
  }
  const len = Math.round((dateOf(r.to).getTime() - dateOf(r.from).getTime()) / 864e5) + 1;
  const f = dateOf(r.from);
  f.setDate(f.getDate() + len * dir);
  const t = dateOf(r.to);
  t.setDate(t.getDate() + len * dir);
  return { from: iso(f), to: iso(t), label: fmtDate(iso(f)) + " \u2013 " + fmtDate(iso(t)) };
}
function weeksOfMonth(month) {
  const out = [];
  let cur = weekRange(month.from);
  while (cur.from <= month.to) {
    const from = cur.from < month.from ? month.from : cur.from;
    const to = cur.to > month.to ? month.to : cur.to;
    out.push({ from, to, label: dateOf(from).getDate() + "\u2013" + dateOf(to).getDate() });
    cur = shiftRange(cur, "week", 1);
  }
  return out;
}
var inRange = (date, r) => date >= r.from && date <= r.to;
function expenses(events2, r) {
  let s = 0;
  for (const e of events2) for (const f of e.effects)
    if (f.measure === "expense" && inRange(f.date, r)) s += f.amountMinor;
  return s;
}
function income(events2, r) {
  let s = 0;
  for (const e of events2) for (const f of e.effects)
    if (f.measure === "income" && inRange(f.date, r)) s += f.amountMinor;
  return s;
}
function unresolvedSplit(events2, r) {
  let incoming = 0, outgoing = 0, count = 0;
  for (const e of events2) {
    if (e.resolutionStatus !== "unresolved" || !inRange(e.date, r)) continue;
    count++;
    for (const m of e.movements) {
      if (m.signedAmountMinor > 0) incoming += m.signedAmountMinor;
      else outgoing += -m.signedAmountMinor;
    }
  }
  return { incoming, outgoing, count };
}
function byCategory(events2, r) {
  const acc = {};
  for (const e of events2) for (const f of e.effects) {
    if (f.measure !== "expense" || !inRange(f.date, r)) continue;
    const c = f.category ?? "uncategorized";
    acc[c] = (acc[c] ?? 0) + f.amountMinor;
  }
  const positiveTotal = Object.values(acc).reduce((s, v) => s + Math.max(v ?? 0, 0), 0) || 1;
  return Object.entries(acc).filter(([, v]) => v !== 0).map(([category, amountMinor]) => ({
    category,
    amountMinor,
    share: Math.max(amountMinor, 0) / positiveTotal
  })).sort((a, b) => b.amountMinor - a.amountMinor);
}
function reconciliation(events2, month) {
  const weeks = weeksOfMonth(month).map((w) => ({
    range: w,
    expense: expenses(events2, w),
    income: income(events2, w)
  }));
  const weekSum = weeks.reduce((s, w) => s + w.expense, 0);
  const monthSum = expenses(events2, month);
  return { weeks, weekSum, monthSum, ok: weekSum === monthSum };
}
function accountState(movements2, accounts, upTo) {
  return accounts.map((a) => {
    const delta = movements2.filter((m) => m.accountId === a.id && m.date <= upTo).reduce((s, m) => s + m.signedAmountMinor, 0);
    const known = a.openingBalanceMinor !== void 0;
    return {
      account: a,
      changeMinor: delta,
      balanceMinor: known ? a.openingBalanceMinor + delta : null,
      balanceKnown: known
    };
  });
}
function receivableTotals(rs) {
  const open = rs.reduce((s, r) => s + Math.max(r.originalMinor - r.settledMinor, 0), 0);
  return { open, count: rs.filter((r) => r.settledMinor < r.originalMinor).length };
}

// scripts/check.ts
var raws = buildDemoTransactions();
var { events, receivables, movements, questions } = classify(
  raws,
  ACCOUNTS,
  [MANUAL_CASH_PURCHASE],
  DEMO_DECISIONS
);
var sep2 = monthRange("2026-09-15");
var aug = monthRange("2026-08-15");
var cats = Object.fromEntries(byCategory(events, sep2).map((r) => [r.category, r.amountMinor]));
var cash = accountState(movements, ACCOUNTS, DEMO_TODAY).find((s) => s.account.id === "cash");
var market = accountState(movements, ACCOUNTS, DEMO_TODAY).find((s) => s.account.id === "market");
var unres = unresolvedSplit(events, sep2);
var rec = reconciliation(events, sep2);
var checks = [
  ["\u0431\u0430\u043D\u043A\u043E\u0432\u0441\u043A\u0438\u0445 \u0437\u0430\u043F\u0438\u0441\u0435\u0439", raws.length, 69],
  ["\u0440\u0430\u0441\u0445\u043E\u0434\u044B \u0441\u0435\u043D\u0442\u044F\u0431\u0440\u044F", expenses(events, sep2), 86e4],
  ["\u0434\u043E\u0445\u043E\u0434\u044B \u0441\u0435\u043D\u0442\u044F\u0431\u0440\u044F", income(events, sep2), 22e5],
  ["\u0434\u043E\u0445\u043E\u0434\u044B \u2212 \u0440\u0430\u0441\u0445\u043E\u0434\u044B", income(events, sep2) - expenses(events, sep2), 134e4],
  ["\u043D\u0435\u0440\u0430\u0437\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u0432\u0445\u043E\u0434\u044F\u0449\u0438\u0435", unres.incoming, 5e4],
  ["\u043D\u0435\u0440\u0430\u0437\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435", unres.outgoing, 0],
  ["\u043D\u0435\u0440\u0430\u0437\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0445 \u0437\u0430\u043F\u0438\u0441\u0435\u0439", unres.count, 1],
  ["\u043F\u0440\u043E\u0434\u0443\u043A\u0442\u044B", cats.groceries ?? 0, 57e4],
  ["\u0442\u0440\u0430\u043D\u0441\u043F\u043E\u0440\u0442", cats.transport ?? 0, 2e5],
  ["\u0442\u0435\u0445\u043D\u0438\u043A\u0430", cats.electronics ?? 0, -7e4],
  ["\u043A\u0430\u0444\u0435 \u0438 \u0440\u0435\u0441\u0442\u043E\u0440\u0430\u043D\u044B", cats.restaurants ?? 0, 16e4],
  ["\u0440\u0430\u0441\u0445\u043E\u0434\u044B \u0430\u0432\u0433\u0443\u0441\u0442\u0430", expenses(events, aug), 42e4],
  ["\u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0435 \u0434\u043E\u043B\u0433\u0438", receivableTotals(receivables).open, 0],
  ["\u043D\u0430\u043B\u0438\u0447\u043D\u044B\u0435 \u043D\u0430 30.09", cash?.balanceMinor ?? -1, 43e4],
  ["\u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435 market", market?.changeMinor ?? 0, 5e4],
  ["\u0441\u0443\u043C\u043C\u0430 \u043D\u0435\u0434\u0435\u043B\u044C = \u043C\u0435\u0441\u044F\u0446", rec.weekSum, rec.monthSum]
];
var bad = 0;
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) bad++;
  console.log((ok ? "OK   " : "FAIL ") + name.padEnd(26) + String(got).padStart(10) + "  \u043E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C " + want);
}
console.log("\n\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u044B\u0435 \u0441\u0440\u0435\u0437\u044B \u0441\u0435\u043D\u0442\u044F\u0431\u0440\u044F:");
for (const w of rec.weeks) console.log("  " + w.range.label.padEnd(8) + String(w.expense / 100).padStart(8) + " \u20BD   \u0434\u043E\u0445\u043E\u0434 " + w.income / 100);
console.log("\n\u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0445 \u0432\u043E\u043F\u0440\u043E\u0441\u043E\u0432 \u043F\u0440\u0438 \u044D\u0442\u0430\u043B\u043E\u043D\u043D\u044B\u0445 \u0440\u0435\u0448\u0435\u043D\u0438\u044F\u0445: " + questions.filter((q) => !DEMO_DECISIONS[q.id]).length);
console.log(bad === 0 ? "\n\u0412\u0421\u0415 \u041A\u041E\u041D\u0422\u0420\u041E\u041B\u042C\u041D\u042B\u0415 \u0421\u0423\u041C\u041C\u042B \u0421\u041E\u0428\u041B\u0418\u0421\u042C" : "\n\u0420\u0410\u0421\u0425\u041E\u0416\u0414\u0415\u041D\u0418\u0419: " + bad);
