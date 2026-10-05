/* =====================================================================
   COMPONENTS — toasts, interim recipient select
   ===================================================================== */
document.addEventListener("alpine:init", () => {
  Alpine.store("toasts", {
    items: [],
    seq: 0,
    push(message, type = "success", timeout = 4500) {
      const id = ++this.seq;
      this.items.push({ id, message, type });
      setTimeout(() => this.dismiss(id), timeout);
    },
    dismiss(id) {
      this.items = this.items.filter((t) => t.id !== id);
    },
  });
});
const toast = (message, type) => Alpine.store("toasts").push(message, type);

// Third-party widget instances and timers live outside Alpine's reactive state.
let composerDatePicker = null;
let composerTimePicker = null;
let retryPicker = null;
let draftTimer = null;
let pickerClosedAt = 0;
const notePickerClosed = () => (pickerClosedAt = Date.now());
let confirmResolve = null;

/* =====================================================================
   PAGE — app (auth, routing, messages, modals)
   ===================================================================== */
document.addEventListener("alpine:init", () => {
  Alpine.data("app", () => ({
    TZ_LABEL,
    navItems: [
      { route: "messages", label: "Messages", icon: "message-square" },
      { route: "contacts", label: "Contacts", icon: "book" },
      { route: "templates", label: "Templates", icon: "file-text" },
    ],
    mobileNavItems: [
      { route: "messages", label: "Messages", icon: "message-square" },
      { route: "contacts", label: "Contacts", icon: "users" },
      { route: "templates", label: "Templates", icon: "bookmark" },
    ],
    statusTabs: [
      { value: "", label: "All" },
      { value: "scheduled", label: "Scheduled" },
      { value: "sent", label: "Sent" },
      { value: "failed", label: "Failed" },
    ],
    pickerFilters: [
      { value: "all", label: "All" },
      { value: "favorites", label: "Favorites" },
      { value: "groups", label: "Groups" },
      { value: "people", label: "People" },
    ],
    toolbar: [
      { key: "bold", label: "Bold (Ctrl+B)", icon: "bold" },
      { key: "italic", label: "Italic (Ctrl+I)", icon: "italic" },
      { key: "strike", label: "Strikethrough", icon: "strike" },
      { key: "code", label: "Monospace", icon: "code" },
      { key: "d1", divider: true, small: false },
      { key: "quote", label: "Quote", icon: "quote", small: false },
      { key: "ul", label: "Bulleted list", icon: "list" },
      { key: "ol", label: "Numbered list", icon: "list-ordered", small: false },
      { key: "d2", divider: true, small: false },
    ],
    presets: [
      { key: "hour", label: "In 1 hour" },
      { key: "tomorrow", label: "Tomorrow 09:00" },
      { key: "monday", label: "Monday 09:00" },
    ],
    retryOptions: [
      { value: "now", label: "Send now", hint: "Retry immediately.", icon: "zap" },
      { value: "later", label: "Schedule for later", hint: "Pick a new send time.", icon: "clock" },
    ],

    // ---- state ----
    booting: true,
    authed: false,
    username: "",
    defaultNumbers: [],
    login: { username: "", password: "", error: "", loading: false },
    route: "messages",
    now: nowTs(),
    contacts: [],
    templates: [],

    all: [],
    list: [],
    status: "",
    search: "",
    page: 1,
    pageSize: 10,
    loading: false,
    loadError: "",
    loadedOnce: false,
    loadSeq: 0,

    detail: null,
    retry: { open: false, id: null, content: "", failure: "", mode: "now", time: "", error: "", loading: false },
    composer: {
      open: false,
      recipients: [],
      query: "",
      content: "",
      date: "",
      time: "",
      preset: null,
      errors: {},
      loading: false,
      saveNew: true,
      saveTemplate: false,
      showPreview: false,
      savedAt: 0,
    },
    picker: { open: false, filter: "all", active: 0 },
    emojiOpen: false,
    templateMenuOpen: false,
    drawerOpen: false,
    mobileSearch: false,
    contactFilter: "all",
    contactSearch: "",
    templateSearch: "",
    contactForm: { open: false, id: null, name: "", number: "", group: "", favorite: false, errors: {} },
    templateForm: { open: false, id: null, name: "", content: "", errors: {} },
    confirm: { open: false, title: "", body: "", confirmLabel: "Confirm", danger: false },

    // ---- lifecycle ----
    async init() {
      this.readHash();
      window.addEventListener("hashchange", () => this.readHash());
      setInterval(() => (this.now = nowTs()), 30000);
      this.loadLocal();
      window.addEventListener("storage", () => this.loadLocal());

      this.$nextTick(() => {
        composerDatePicker = flatpickr("#composerDate", {
          dateFormat: "D, j M Y",
          static: true,
          disableMobile: true,
          minDate: jktTodayLocal(),
          onOpen: (_, __, fp) => fp.set("minDate", jktTodayLocal()),
          onChange: (dates) => this.onComposerDate(dates[0]),
          onClose: notePickerClosed,
        });
        composerTimePicker = flatpickr("#composerTime", {
          enableTime: true,
          noCalendar: true,
          dateFormat: "H:i",
          time_24hr: true,
          minuteIncrement: 1,
          defaultHour: 9,
          defaultMinute: 0,
          static: true,
          disableMobile: true,
          onChange: (_, str) => this.onComposerTime(str),
          onClose: notePickerClosed,
        });
        retryPicker = initDatePicker(document.getElementById("retryTime"), (v) => (this.retry.time = v));
      });
      for (const key of ["composer.recipients", "composer.content", "composer.date", "composer.time"]) {
        this.$watch(key, () => this.queueDraft());
      }

      const token = LS.raw("web_client_token");
      if (!token) {
        this.booting = false;
        return;
      }
      try {
        const res = await api.check(token);
        this.onAuthed(token, res.data);
      } catch (e) {
        if (e.status === 401) this.clearAuth();
        else toast(e.message, "error");
      } finally {
        this.booting = false;
      }
    },

    loadLocal() {
      this.contacts = LS.json("wa_contacts", []);
      this.templates = LS.json("wa_templates", []);
    },

    // ---- auth ----
    async submitLogin() {
      const l = this.login;
      l.error = "";
      if (!l.username || !l.password) {
        l.error = "Enter your username and password.";
        return;
      }
      l.loading = true;
      const token = utf8ToBase64(`${l.username}:${l.password}`);
      try {
        const res = await api.check(token);
        l.password = "";
        this.onAuthed(token, res.data);
      } catch (e) {
        l.error = e.status === 401 ? "Invalid username or password." : e.message;
      } finally {
        l.loading = false;
      }
    },

    onAuthed(token, data) {
      api.token = token;
      this.username = usernameFromToken(token);
      this.defaultNumbers = data?.default_numbers || [];
      LS.set("web_client_token", token);
      LS.set("web_client_default_numbers", this.defaultNumbers);
      this.authed = true;
      this.refresh();
    },

    clearAuth() {
      api.token = "";
      LS.set("web_client_token", "");
      LS.set("web_client_default_numbers", "[]");
    },

    logout(expired = false) {
      this.clearAuth();
      this.authed = false;
      this.closeAll();
      this.all = [];
      this.list = [];
      this.loadedOnce = false;
      if (expired) toast("Your login has expired. Please log in again.", "info");
    },

    handleError(e, fallback) {
      if (e.status === 401) return this.logout(true);
      toast(e.message || fallback, "error");
    },

    // ---- routing & keyboard ----
    readHash() {
      this.drawerOpen = false;
      const r = location.hash.replace(/^#\/?/, "");
      this.route = ["messages", "contacts", "templates"].includes(r) ? r : "messages";
    },

    routeLabel() {
      return this.navItems.find((n) => n.route === this.route)?.label || "Messages";
    },
    fabLabel() {
      return { contacts: "New contact", templates: "New template" }[this.route] || "New message";
    },
    fabAction() {
      if (this.route === "contacts") this.openContactForm();
      else if (this.route === "templates") this.openTemplateForm();
      else this.openComposer();
    },
    toggleMobileSearch() {
      this.mobileSearch = !this.mobileSearch;
      if (!this.mobileSearch) return;
      const ref = { messages: "search", contacts: "contactSearchInput", templates: "templateSearchInput" }[this.route];
      this.$nextTick(() => this.$refs[ref]?.focus());
    },
    recipientSummary(m) {
      const first = this.displayRecipient(m.recipient_numbers[0]);
      return m.recipient_numbers.length > 1 ? `${first}, +${m.recipient_numbers.length - 1}` : first;
    },

    navCount(route) {
      if (route === "contacts") return this.contacts.length;
      if (route === "templates") return this.templates.length;
      return 0;
    },

    anyModalOpen() {
      return this.composer.open || this.retry.open || !!this.detail || this.contactForm.open || this.templateForm.open || this.confirm.open;
    },

    closeAll() {
      if (this.confirm.open) this.resolveConfirm(false);
      this.retry.open = false;
      this.detail = null;
      this.composer.open = false;
      this.contactForm.open = false;
      this.templateForm.open = false;
    },

    onKey(e) {
      if (!this.authed) return;
      if (e.key === "Escape") {
        if (document.querySelector(".flatpickr-calendar.open") || Date.now() - pickerClosedAt < 50) return;
        if (this.confirm.open) this.resolveConfirm(false);
        else if (this.drawerOpen) this.drawerOpen = false;
        else if (this.templateMenuOpen) this.templateMenuOpen = false;
        else if (this.emojiOpen) this.emojiOpen = false;
        else if (this.picker.open) this.picker.open = false;
        else if (this.contactForm.open) this.contactForm.open = false;
        else if (this.templateForm.open) this.templateForm.open = false;
        else if (this.retry.open) this.closeRetry();
        else if (this.detail) this.closeDetail();
        else if (this.composer.open) this.closeComposer();
        return;
      }
      const typing = e.target.closest?.("input, textarea, select, [contenteditable], emoji-picker");
      if (typing || e.ctrlKey || e.metaKey || e.altKey || this.anyModalOpen()) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        this.openComposer();
      } else if (e.key === "/") {
        e.preventDefault();
        location.hash = "#/messages";
        this.$nextTick(() => this.$refs.search?.focus());
      }
    },

    // ---- messages ----
    async refresh() {
      const seq = ++this.loadSeq;
      this.loading = true;
      this.loadError = "";
      try {
        const [allRes, listRes] = await Promise.all([
          api.messages(""),
          this.status ? api.messages(this.status) : null,
        ]);
        if (seq !== this.loadSeq) return;
        this.all = sortMessages(allRes.data || []);
        this.list = listRes ? sortMessages(listRes.data || []) : this.all;
        this.loadedOnce = true;
        if (this.page > this.pageCount()) this.page = this.pageCount();
      } catch (e) {
        if (seq !== this.loadSeq) return;
        if (e.status === 401) return this.logout(true);
        this.loadError = e.message;
      } finally {
        if (seq === this.loadSeq) this.loading = false;
      }
    },

    setStatus(value) {
      location.hash = "#/messages";
      if (this.status === value && this.list.length) return;
      this.status = value;
      this.page = 1;
      this.list = [];
      this.refresh();
    },

    counts() {
      const c = { all: this.all.length, scheduled: 0, sent: 0, failed: 0 };
      for (const m of this.all) if (m.status in c) c[m.status]++;
      return c;
    },

    nextScheduled() {
      let next = null;
      for (const m of this.all) {
        if (m.status === "scheduled" && (!next || m.scheduled_sending_at < next.scheduled_sending_at)) next = m;
      }
      return next;
    },

    lastSentAt() {
      let last = 0;
      for (const m of this.all) if (m.sent_at && m.sent_at > last) last = m.sent_at;
      return last;
    },

    sessionExpiredCount() {
      return this.all.filter((m) => m.status === "failed" && failureLabel(m.reason) === "Session expired").length;
    },

    filtered() {
      const q = this.search.trim().toLowerCase();
      if (!q) return this.list;
      return this.list.filter(
        (m) =>
          m.content.toLowerCase().includes(q) ||
          m.recipient_numbers.some((r) => r.toLowerCase().includes(q) || this.displayRecipient(r).toLowerCase().includes(q))
      );
    },

    pageCount() {
      return Math.max(1, Math.ceil(this.filtered().length / this.pageSize));
    },
    paged() {
      const start = (this.page - 1) * this.pageSize;
      return this.filtered().slice(start, start + this.pageSize);
    },
    rangeFrom() {
      return (this.page - 1) * this.pageSize + 1;
    },
    rangeTo() {
      return Math.min(this.page * this.pageSize, this.filtered().length);
    },

    emptyText() {
      if (this.search) return `No messages match “${this.search.trim()}”.`;
      return {
        "": "No messages yet. Schedule your first one.",
        scheduled: "Nothing is scheduled right now.",
        sent: "No messages have been sent yet.",
        failed: "No failed messages. Everything went out.",
      }[this.status];
    },

    // ---- display helpers ----
    icon,
    fmtDate,
    fmtTime,
    fmtWhen,
    fmtWhenCompact,
    fmtFull,
    fmtUtc,
    capitalize,
    plural,
    oneLine,
    initialOf,
    isGroup,
    failureLabel,
    retriedLabel,
    renderWhatsApp,
    plainWhatsApp,

    rel(ts) {
      return fmtRelative(ts, this.now);
    },
    fmtShortIn(ts) {
      return fmtShortIn(ts, this.now);
    },
    sendTimeOf(m) {
      return m.status === "sent" && m.sent_at ? m.sent_at : m.scheduled_sending_at;
    },
    sendSummary(ts) {
      return `Sends ${fmtFull(ts)} · ${fmtRelative(ts, this.now)} · ${fmtUtc(ts)}`;
    },
    statusLabel(s) {
      return { scheduled: "Scheduled", sent: "Sent", failed: "Failed" }[s] || capitalize(s);
    },
    badgeClass(s) {
      return { scheduled: "badge-scheduled", sent: "badge-sent", failed: "badge-failed" }[s] || "";
    },
    failureLine(m) {
      return [failureLabel(m.reason), retriedLabel(m.retried_count)].filter(Boolean).join(" · ");
    },
    // Group icon for groups, person icon until the contact has a real name.
    avatarIcon(jid) {
      if (isGroup(jid)) return "users";
      const c = this.contacts.find((x) => x.jid === jid);
      return c?.name && !/^\+?\d/.test(c.name) ? "" : "user";
    },
    displayRecipient(jid) {
      if (!jid) return "";
      const c = this.contacts.find((x) => x.jid === jid);
      if (c?.name) return c.name;
      const id = jid.split("@")[0];
      if (isGroup(jid)) return `Group …${id.slice(-4)}`;
      return /^\d+$/.test(id) ? formatPhone(id) : jid;
    },
    copyText(text, done) {
      if (!navigator.clipboard) return toast("Copy isn't available here. Select the text and copy it manually.", "error");
      navigator.clipboard.writeText(text).then(
        () => toast(done, "info"),
        () => toast("Couldn't copy. Select the text and copy it manually.", "error")
      );
    },

    // ---- detail ----
    openDetail(m) {
      this.detail = m;
    },
    closeDetail() {
      this.detail = null;
    },
    duplicate(m) {
      this.detail = null;
      this.openComposer({ content: m.content, recipients: m.recipient_numbers });
    },

    // ---- retry ----
    openRetry(m) {
      this.detail = null;
      Object.assign(this.retry, {
        open: true,
        id: m.id,
        content: m.content,
        failure: this.failureLine(m),
        mode: "now",
        time: "",
        error: "",
        loading: false,
      });
      retryPicker?.clear();
    },
    closeRetry() {
      this.retry.open = false;
    },
    retryToDetail() {
      const m = this.all.find((x) => x.id === this.retry.id) || this.list.find((x) => x.id === this.retry.id);
      this.closeRetry();
      if (m) this.openDetail(m);
    },
    retryTs() {
      const ts = parseJakartaInput(this.retry.time);
      return isNaN(ts) ? 0 : ts;
    },
    async submitRetry() {
      const r = this.retry;
      r.error = "";
      let ts = nowTs();
      if (r.mode === "later") {
        ts = parseJakartaInput(r.time);
        if (!r.time) return (r.error = "Pick a new send time.");
        if (isNaN(ts)) return (r.error = "Pick a valid date and time.");
        if (ts < nowTs() - 60) return (r.error = "This time has already passed. Pick a time in the future.");
      }
      r.loading = true;
      try {
        await api.retry(r.id, ts);
        toast(r.mode === "later" ? `Retry scheduled for ${fmtWhen(ts)} (GMT+7).` : "Retry queued. The message will be sent shortly.");
        this.closeRetry();
        await this.refresh();
      } catch (e) {
        this.handleError(e, "Couldn't retry the message.");
      } finally {
        r.loading = false;
      }
    },

    // ---- confirm dialog ----
    askConfirm(opts) {
      confirmResolve?.(false);
      return new Promise((resolve) => {
        confirmResolve = resolve;
        Object.assign(this.confirm, { open: true, title: "", body: "", confirmLabel: "Confirm", danger: false, ...opts });
      });
    },
    resolveConfirm(value) {
      this.confirm.open = false;
      const resolve = confirmResolve;
      confirmResolve = null;
      resolve?.(value);
    },

    // ---- contacts page ----
    contactCount(filter) {
      return this.contacts.filter((c) => this.pickerMatchesFilter(c, filter)).length;
    },
    filteredContacts() {
      const q = this.contactSearch.trim().toLowerCase();
      const digits = q.replace(/\D/g, "");
      return this.contacts
        .filter((c) => this.pickerMatchesFilter(c, this.contactFilter))
        .filter(
          (c) =>
            !q ||
            c.name.toLowerCase().includes(q) ||
            (c.group || "").toLowerCase().includes(q) ||
            c.jid.includes(q) ||
            (digits.length >= 3 && c.jid.includes(digits.startsWith("0") ? "62" + digits.slice(1) : digits))
        )
        .sort((a, b) => !!b.favorite - !!a.favorite || a.name.localeCompare(b.name));
    },
    contactEmptyText() {
      if (this.contactSearch) return `No contacts match “${this.contactSearch.trim()}”.`;
      if (this.contactFilter === "favorites") return "No favorites yet. Star a contact to pin it here and in the composer.";
      if (this.contactFilter === "groups") return "No WhatsApp groups saved yet.";
      if (this.contactFilter === "people") return "No people saved yet.";
      return "No contacts yet. Save the numbers and groups you send to most.";
    },
    contactGroups() {
      return [...new Set(this.contacts.map((c) => (c.group || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    },
    openContactForm(c = null) {
      Object.assign(this.contactForm, {
        open: true,
        id: c?.id || null,
        name: c?.name || "",
        number: c ? this.subtitleFor(c.jid) : "",
        group: c?.group || "",
        favorite: !!c?.favorite,
        errors: {},
      });
      this.$nextTick(() => setTimeout(() => this.$refs.contactName?.focus(), 50));
    },
    checkContactNumber() {
      const f = this.contactForm;
      if (!f.number.trim()) return;
      const n = normalizeRecipient(f.number);
      if (!n.ok) return (f.errors.number = n.error);
      const dup = this.contacts.find((c) => c.jid === n.jid && c.id !== f.id);
      if (dup) f.errors.number = `This number is already saved as “${dup.name}”.`;
    },
    submitContactForm() {
      const f = this.contactForm;
      const errors = {};
      const name = f.name.trim();
      if (!name) errors.name = "Enter a name, e.g. “Rina (Lab)”.";
      const n = normalizeRecipient(f.number);
      if (!n.ok) errors.number = n.error;
      else {
        const dup = this.contacts.find((c) => c.jid === n.jid && c.id !== f.id);
        if (dup) errors.number = `This number is already saved as “${dup.name}”.`;
      }
      f.errors = errors;
      if (Object.keys(errors).length) return;

      const fields = { name, jid: n.jid, group: f.group.trim(), favorite: f.favorite };
      if (f.id) {
        this.contacts = this.contacts.map((c) => (c.id === f.id ? { ...c, ...fields, updatedAt: nowTs() } : c));
      } else {
        this.contacts = [...this.contacts, { id: uid(), ...fields, createdAt: nowTs() }];
      }
      saveContacts(this.contacts);
      toast(f.id ? `Contact “${name}” updated.` : `Contact “${name}” saved.`);
      f.open = false;
    },
    async deleteContact(c) {
      const ok = await this.askConfirm({
        title: "Delete contact?",
        body: `“${c.name}” will be removed from this browser. Messages already scheduled are not affected.`,
        confirmLabel: "Delete contact",
        danger: true,
      });
      if (!ok) return;
      this.contacts = this.contacts.filter((x) => x.id !== c.id);
      saveContacts(this.contacts);
      toast(`Contact “${c.name}” deleted.`, "info");
    },
    // Adds the contact to the current draft instead of replacing it.
    messageContact(c) {
      this.openComposer();
      this.addRecipient(c.jid);
    },

    // ---- templates page ----
    filteredTemplates() {
      const q = this.templateSearch.trim().toLowerCase();
      return this.templates
        .filter((t) => !q || t.name.toLowerCase().includes(q) || t.content.toLowerCase().includes(q))
        .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    },
    openTemplateForm(t = null) {
      Object.assign(this.templateForm, { open: true, id: t?.id || null, name: t?.name || "", content: t?.content || "", errors: {} });
      this.$nextTick(() => setTimeout(() => this.$refs.templateName?.focus(), 50));
    },
    templateNameTaken(name, exceptId = null) {
      const key = name.trim().toLowerCase();
      return this.templates.some((t) => t.name.trim().toLowerCase() === key && t.id !== exceptId);
    },
    submitTemplateForm() {
      const f = this.templateForm;
      const errors = {};
      const name = f.name.trim();
      if (!name) errors.name = "Give the template a short name, e.g. “Weekly sync reminder”.";
      else if (this.templateNameTaken(name, f.id)) errors.name = `A template named “${name}” already exists. Pick another name.`;
      if (!f.content.trim()) errors.content = "Write the message this template should insert.";
      f.errors = errors;
      if (Object.keys(errors).length) return;

      const now = nowTs();
      if (f.id) {
        this.templates = this.templates.map((t) => (t.id === f.id ? { ...t, name, content: f.content, updatedAt: now } : t));
      } else {
        this.templates = [...this.templates, { id: uid(), name, content: f.content, createdAt: now, updatedAt: now }];
      }
      saveTemplates(this.templates);
      toast(f.id ? `Template “${name}” updated.` : `Template “${name}” saved.`);
      f.open = false;
    },
    async deleteTemplate(t) {
      const ok = await this.askConfirm({
        title: "Delete template?",
        body: `“${t.name}” will be removed from this browser. Messages already scheduled are not affected.`,
        confirmLabel: "Delete template",
        danger: true,
      });
      if (!ok) return;
      this.templates = this.templates.filter((x) => x.id !== t.id);
      saveTemplates(this.templates);
      toast(`Template “${t.name}” deleted.`, "info");
    },
    // Opens the composer (keeping draft recipients and time) with the template text.
    async useTemplate(t) {
      const draft = LS.json("wa_draft", null);
      if (draft?.content?.trim() && draft.content !== t.content) {
        const ok = await this.askConfirm({
          title: "Replace draft message?",
          body: `Your draft already has a message. Replace it with “${t.name}”? Recipients and send time stay as they are.`,
          confirmLabel: "Replace message",
        });
        if (!ok) return;
      }
      this.openComposer();
      this.composer.content = t.content;
    },
    // Composer "Insert template": fills an empty editor, otherwise inserts at the cursor.
    insertTemplate(t) {
      this.templateMenuOpen = false;
      if (!this.composer.content.trim()) {
        this.composer.content = t.content;
        this.$nextTick(() => this.$refs.editor?.focus());
      } else {
        const ta = this.$refs.editor;
        const before = ta.value.slice(0, ta.selectionStart);
        this.insertText((before && !before.endsWith("\n") ? "\n" : "") + t.content);
      }
      delete this.composer.errors.content;
    },
    saveTemplateFromMessage(content) {
      const first = oneLine(plainWhatsApp(content.split("\n").find((l) => l.trim()) || "Message"));
      const base = first.length > 40 ? first.slice(0, 39).trimEnd() + "…" : first;
      let name = base;
      for (let i = 2; this.templateNameTaken(name); i++) name = `${base} (${i})`;
      const now = nowTs();
      this.templates = [...this.templates, { id: uid(), name, content, createdAt: now, updatedAt: now }];
      saveTemplates(this.templates);
      return name;
    },

    // ---- picker: recent recipients from message history ----
    recentRecipients() {
      const seen = new Set();
      for (const m of [...this.all].sort((a, b) => b.created_at - a.created_at)) {
        for (const jid of m.recipient_numbers) seen.add(jid);
        if (seen.size >= 8) break;
      }
      return [...seen].slice(0, 8);
    },

    // ---- composer: open / close / draft ----
    openComposer(prefill = null) {
      const draft = prefill ? null : LS.json("wa_draft", null);
      const src = prefill || draft || {};
      clearTimeout(draftTimer);
      Object.assign(this.composer, {
        open: true,
        recipients: [...(src.recipients || [])],
        query: "",
        content: src.content || "",
        date: draft?.date || "",
        time: draft?.time || "",
        preset: null,
        errors: {},
        loading: false,
        saveNew: true,
        saveTemplate: false,
        showPreview: false,
        savedAt: draft?.savedAt || 0,
      });
      this.picker.open = false;
      this.templateMenuOpen = false;
      this.picker.filter = "all";
      this.emojiOpen = false;
      this.$nextTick(() => {
        this.syncTimePickers();
        if (!isSmall()) setTimeout(() => (this.composer.recipients.length ? this.$refs.editor : this.$refs.recipientInput)?.focus(), 50);
      });
    },
    closeComposer() {
      if (draftTimer) {
        clearTimeout(draftTimer);
        this.saveDraft();
      }
      this.composer.open = false;
      this.picker.open = false;
      this.emojiOpen = false;
      this.templateMenuOpen = false;
    },
    queueDraft() {
      if (!this.composer.open || this.composer.loading) return;
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => this.saveDraft(), 600);
    },
    saveDraft() {
      draftTimer = null;
      const c = this.composer;
      if (!c.recipients.length && !c.content.trim() && !c.date) {
        LS.remove("wa_draft");
        c.savedAt = 0;
        return;
      }
      c.savedAt = nowTs();
      LS.set("wa_draft", { recipients: c.recipients, content: c.content, date: c.date, time: c.time, savedAt: c.savedAt });
    },
    async discardDraft() {
      const ok = await this.askConfirm({
        title: "Discard draft?",
        body: "The recipients, message and send time in this draft will be cleared.",
        confirmLabel: "Discard draft",
        danger: true,
      });
      if (!ok) return;
      clearTimeout(draftTimer);
      draftTimer = null;
      LS.remove("wa_draft");
      Object.assign(this.composer, { recipients: [], query: "", content: "", date: "", time: "", preset: null, errors: {}, savedAt: 0 });
      this.syncTimePickers();
      toast("Draft discarded.", "info");
    },

    // ---- composer: recipients ----
    addRecipient(jid) {
      if (!this.composer.recipients.includes(jid)) this.composer.recipients.push(jid);
      delete this.composer.errors.recipients;
    },
    removeRecipient(jid) {
      this.composer.recipients = this.composer.recipients.filter((r) => r !== jid);
    },
    toggleRecipient(jid) {
      this.composer.recipients.includes(jid) ? this.removeRecipient(jid) : this.addRecipient(jid);
    },
    // Turn typed text (one or more numbers) into chips; invalid parts stay
    // in the input with an error that says how to fix them.
    commitQuery() {
      const c = this.composer;
      const parts = c.query.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
      const rejected = [];
      let error = "";
      for (const p of parts) {
        const n = normalizeRecipient(p);
        if (n.ok) this.addRecipient(n.jid);
        else {
          rejected.push(p);
          error ||= n.error;
        }
      }
      c.query = rejected.join(", ");
      if (error) c.errors.recipients = error;
      return !error;
    },
    onRecipientKey(e) {
      if (e.ctrlKey || e.metaKey) return;
      const c = this.composer;
      const opts = this.pickerOptions();
      if (e.key === "Enter" || e.key === "," || e.key === ";") {
        e.preventDefault();
        const opt = this.picker.open ? opts[this.picker.active] : null;
        if (opt && (c.query.trim() || e.key === "Enter")) this.chooseOption(opt);
        else if (c.query.trim()) this.commitQuery();
      } else if (e.key === "Backspace" && !c.query && c.recipients.length) {
        c.recipients.pop();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.picker.open = true;
        if (!opts.length) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        this.picker.active = (this.picker.active + step + opts.length) % opts.length;
      } else if (e.key === "Escape" && this.picker.open) {
        e.stopPropagation();
        this.picker.open = false;
      }
    },
    onRecipientFocus() {
      this.picker.open = true;
      if (isSmall()) {
        this.picker.filter = "all";
        this.$nextTick(() => this.$refs.sheetSearch?.focus());
      }
    },
    closePicker() {
      if (this.composer.query.trim()) this.commitQuery();
      this.picker.open = false;
    },
    pickerSections() {
      const opts = this.pickerOptions();
      const sections = [
        { label: "Add number", items: opts.filter((o) => o.isNew) },
        { label: "Favorites", items: opts.filter((o) => !o.isNew && o.favorite) },
        { label: "Groups", items: opts.filter((o) => !o.isNew && !o.favorite && o.tag !== "Recent" && isGroup(o.jid)) },
        { label: "People", items: opts.filter((o) => !o.isNew && !o.favorite && o.tag !== "Recent" && !isGroup(o.jid)) },
        { label: "Recent", items: opts.filter((o) => o.tag === "Recent") },
      ];
      return sections.filter((sec) => sec.items.length);
    },
    onRecipientBlur() {
      if (isSmall()) return;
      this.picker.open = false;
      if (this.composer.query.trim()) this.commitQuery();
    },
    onRecipientPaste(e) {
      const text = e.clipboardData?.getData("text") || "";
      if (!/[,;\n]/.test(text)) return;
      e.preventDefault();
      this.composer.query += text;
      this.commitQuery();
    },
    chooseOption(opt) {
      if (opt.isNew) this.addRecipient(opt.jid);
      else this.toggleRecipient(opt.jid);
      this.composer.query = "";
      this.picker.active = 0;
    },

    // ---- composer: contact picker ----
    subtitleFor(jid) {
      return isGroup(jid) ? jid : formatPhone(jid.split("@")[0]);
    },
    pickerEntries() {
      const out = this.contacts.map((c) => ({
        key: "c:" + c.id,
        contactId: c.id,
        jid: c.jid,
        title: c.name || this.displayRecipient(c.jid),
        subtitle: this.subtitleFor(c.jid),
        favorite: !!c.favorite,
        tag: "",
      }));
      for (const jid of this.defaultNumbers) {
        if (!this.contacts.some((c) => c.jid === jid)) {
          out.push({ key: "d:" + jid, jid, title: this.displayRecipient(jid), subtitle: isGroup(jid) ? jid : "Default number", favorite: false, tag: "Default" });
        }
      }
      for (const jid of this.recentRecipients()) {
        if (!out.some((e) => e.jid === jid)) {
          out.push({ key: "r:" + jid, jid, title: this.displayRecipient(jid), subtitle: isGroup(jid) ? jid : "Recent recipient", favorite: false, tag: "Recent" });
        }
      }
      return out.sort((a, b) => b.favorite - a.favorite || a.title.localeCompare(b.title));
    },
    pickerMatchesFilter(entry, filter) {
      if (filter === "favorites") return entry.favorite;
      if (filter === "groups") return isGroup(entry.jid);
      if (filter === "people") return !isGroup(entry.jid);
      return true;
    },
    pickerCount(filter) {
      return this.pickerEntries().filter((e) => this.pickerMatchesFilter(e, filter)).length;
    },
    pickerOptions() {
      const q = this.composer.query.trim().toLowerCase();
      let digits = q.replace(/\D/g, "");
      if (digits.startsWith("0")) digits = "62" + digits.slice(1);
      const options = this.pickerEntries().filter(
        (e) =>
          this.pickerMatchesFilter(e, this.picker.filter) &&
          (!q || e.title.toLowerCase().includes(q) || e.jid.toLowerCase().includes(q) || (digits.length >= 3 && e.jid.includes(digits)))
      );
      const typed = q && !/[,;]/.test(q) ? normalizeRecipient(q) : null;
      if (typed?.ok && !this.pickerEntries().some((e) => e.jid === typed.jid)) {
        options.unshift({
          key: "new:" + typed.jid,
          isNew: true,
          jid: typed.jid,
          title: "Add " + this.displayRecipient(typed.jid),
          subtitle: "Press Enter to add this number",
        });
      }
      return options;
    },
    favorites() {
      return this.contacts.filter((c) => c.favorite);
    },
    toggleFavorite(id) {
      this.contacts = this.contacts.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c));
      saveContacts(this.contacts);
    },
    unsavedRecipients() {
      return this.composer.recipients.filter((j) => !this.contacts.some((c) => c.jid === j) && !this.defaultNumbers.includes(j));
    },
    saveNewRecipients() {
      const fresh = this.unsavedRecipients().map((jid) => ({
        id: uid(),
        name: this.displayRecipient(jid),
        jid,
        group: "",
        favorite: false,
        createdAt: nowTs(),
      }));
      if (!fresh.length) return 0;
      this.contacts = [...this.contacts, ...fresh];
      saveContacts(this.contacts);
      return fresh.length;
    },
    starIcon(filled, size = 16) {
      return icon("star", size, filled ? { fill: "currentColor" } : {});
    },

    // ---- composer: editor ----
    onEditorKey(e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "b" || k === "i") {
        e.preventDefault();
        this.applyTool(k === "b" ? "bold" : "italic");
      }
    },
    applyTool(key) {
      const wrap = { bold: "*", italic: "_", strike: "~", code: "```" }[key];
      if (wrap) this.wrapSelection(wrap);
      else this.prefixLines(key);
    },
    // Replace a range in the textarea through the browser's editing
    // pipeline so Ctrl+Z still works; fall back to setRangeText.
    replaceRange(from, to, text, selStart, selEnd) {
      const ta = this.$refs.editor;
      ta.focus();
      ta.setSelectionRange(from, to);
      let done = false;
      try {
        done = document.execCommand("insertText", false, text);
      } catch {}
      if (!done || ta.value.slice(from, from + text.length) !== text) {
        ta.setRangeText(text, from, to, "end");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
      ta.setSelectionRange(selStart, selEnd);
    },
    wrapSelection(marker) {
      const ta = this.$refs.editor;
      const v = ta.value;
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      const n = marker.length;
      if (s >= n && v.slice(s - n, s) === marker && v.slice(e, e + n) === marker) {
        this.replaceRange(s - n, e + n, v.slice(s, e), s - n, e - n);
        return;
      }
      const inner = v.slice(s, e);
      this.replaceRange(s, e, marker + inner + marker, s + n, s + n + inner.length);
    },
    prefixLines(key) {
      const ta = this.$refs.editor;
      const v = ta.value;
      const s = ta.selectionStart;
      let e = ta.selectionEnd;
      if (e > s && v[e - 1] === "\n") e--;
      const start = v.lastIndexOf("\n", s - 1) + 1;
      let end = v.indexOf("\n", e);
      if (end === -1) end = v.length;
      const lines = v.slice(start, end).split("\n");
      const own = { quote: /^> ?/, ul: /^[-*] /, ol: /^\d+\. / }[key];
      const any = /^(> ?|[-*] |\d+\. )/;
      const text = lines.every((l) => own.test(l))
        ? lines.map((l) => l.replace(own, "")).join("\n")
        : lines.map((l, i) => ({ quote: "> ", ul: "- ", ol: `${i + 1}. ` }[key] + l.replace(any, ""))).join("\n");
      this.replaceRange(start, end, text, start, start + text.length);
    },
    insertText(str) {
      const ta = this.$refs.editor;
      const s = ta.selectionStart;
      this.replaceRange(s, ta.selectionEnd, str, s + str.length, s + str.length);
    },

    // ---- composer: send time ----
    composerTs() {
      const ts = parseJakartaInput(`${this.composer.date} ${this.composer.time}`);
      return isNaN(ts) ? 0 : ts;
    },
    syncTimePickers() {
      const c = this.composer;
      if (c.date) composerDatePicker?.setDate(c.date, false, "Y-m-d");
      else composerDatePicker?.clear(false);
      if (c.time) composerTimePicker?.setDate(c.time, false, "H:i");
      else composerTimePicker?.clear(false);
    },
    onComposerDate(d) {
      const c = this.composer;
      c.date = d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "";
      if (c.date && !c.time) {
        c.time = "09:00";
        composerTimePicker?.setDate(c.time, false, "H:i");
      }
      c.preset = null;
      delete c.errors.time;
    },
    onComposerTime(str) {
      const c = this.composer;
      c.time = str;
      if (str && !c.date) {
        c.date = toJakartaInput(nowTs()).slice(0, 10);
        composerDatePicker?.setDate(c.date, false, "Y-m-d");
      }
      c.preset = null;
      delete c.errors.time;
    },
    applyPreset(key) {
      const s = toJakartaInput(presetTs(key));
      Object.assign(this.composer, { date: s.slice(0, 10), time: s.slice(11), preset: key });
      delete this.composer.errors.time;
      this.syncTimePickers();
    },

    // ---- composer: submit ----
    async submitComposer() {
      const c = this.composer;
      if (c.loading) return;
      if (c.query.trim()) this.commitQuery();

      const errors = {};
      if (c.errors.recipients) errors.recipients = c.errors.recipients;
      else if (!c.recipients.length) errors.recipients = "Add at least one recipient: pick a contact or type a number with country code.";

      if (!c.content.trim()) errors.content = "Write a message before scheduling.";

      const ts = this.composerTs();
      if (!c.date || !c.time) errors.time = "Pick a send date and time, or use a quick option.";
      else if (!ts) errors.time = "Pick a valid date and time.";
      else if (ts < nowTs() - 60) errors.time = "This time has already passed. Pick a time in the future.";

      c.errors = errors;
      if (Object.keys(errors).length) return;

      c.loading = true;
      clearTimeout(draftTimer);
      try {
        await api.schedule({ recipient_numbers: [...c.recipients], content: c.content, scheduled_sending_at: ts });
        const saved = c.saveNew ? this.saveNewRecipients() : 0;
        const templateName = c.saveTemplate ? this.saveTemplateFromMessage(c.content) : "";
        LS.remove("wa_draft");
        c.savedAt = 0;
        toast(
          `Message scheduled for ${fmtWhen(ts)} (GMT+7).` +
            (saved ? ` ${plural(saved, "contact", "contacts")} saved.` : "") +
            (templateName ? ` Saved as template “${templateName}”.` : "")
        );
        c.loading = false;
        this.composer.open = false;
        this.picker.open = false;
        this.emojiOpen = false;
        await this.refresh();
      } catch (e) {
        this.handleError(e, "Couldn't schedule the message.");
      } finally {
        c.loading = false;
      }
    },
  }));
});

function sortMessages(messages) {
  return [...messages].sort((a, b) => b.scheduled_sending_at - a.scheduled_sending_at);
}
