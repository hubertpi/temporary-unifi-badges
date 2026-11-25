const DOMAIN = "temporary_unifi_badges";

class BadgeKiosk extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({mode: "open"});
  }

  set hass(value) {
    this.connection = value;
    if (!this.root.firstChild) this.home();
  }

  screen(title) {
    this.root.innerHTML = `<style>
      :host { display:grid; min-height:100%; place-items:center; background:var(--primary-background-color);
        color:var(--primary-text-color); font:inherit; }
      main { width:min(90%, 40rem); margin:2rem auto; }
      h1 { font-size:clamp(1.4rem,3vw,2rem); }
      button,input { font:inherit; color:inherit; background:var(--card-background-color);
        border:1px solid var(--divider-color); border-radius:12px; min-height:48px; }
      button { cursor:pointer; padding:.5rem; }
      .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(100px,1fr)); gap:12px; }
      .badge-grid { display:flex; flex-wrap:wrap; justify-content:center; gap:12px; }
      .badge-grid button { flex:0 0 100px; box-sizing:border-box; }
      .home { grid-template-columns:1fr 1fr; }
      .home button { min-height:clamp(110px,22vh,240px); font-size:clamp(1.1rem,4vw,2rem); }
      .month { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
      .days { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:4px; text-align:center; }
      .days button { padding:.15rem; }
      button[aria-pressed="true"] { background:var(--primary-color); color:var(--text-primary-color,white); }
      button:disabled { opacity:.45; cursor:default; }
      footer { display:flex; flex-wrap:wrap; gap:10px; margin-top:1rem; }
      label { display:grid; gap:6px; margin-top:1rem; }
    </style><main></main>`;
    const main = this.root.querySelector("main");
    if (title) this.text(main, "h1", title);
    return main;
  }

  text(parent, tag, value) {
    const node = document.createElement(tag);
    node.textContent = value;
    parent.append(node);
    return node;
  }

  button(parent, text, action) {
    const node = this.text(parent, "button", text);
    node.type = "button";
    node.onclick = action;
    return node;
  }

  home() {
    const main = this.screen();
    const buttons = this.text(main, "div", "");
    buttons.className = "grid home";
    for (const [label, kind] of [["Visitor", "visitor"], ["Contractor", "contractor"]]) {
      this.button(buttons, label, () => this.badges(label, kind));
    }
  }

  async badges(label, kind) {
    const main = this.screen("Choose a " + label.toLowerCase() + " badge");
    const status = this.text(main, "p", "Loading badges from UniFi…");
    status.setAttribute("role", "status");
    const buttons = this.text(main, "div", "");
    buttons.className = "badge-grid";
    const footer = this.text(main, "footer", "");
    this.button(footer, "Back", () => this.home());
    try {
      const {badges, today} = await this.connection.callWS({type: DOMAIN + "/list", kind});
      if (!main.isConnected) return;
      status.textContent = badges.length ? "" : "No matching badges found in UniFi.";
      for (const badge of badges) {
        this.button(buttons, badge.name.split(/\s+/).pop(), () => this.calendar(label, kind, badge, today));
      }
    } catch (error) {
      status.textContent = error?.message || "Could not load badges.";
      this.button(footer, "Try again", () => this.badges(label, kind));
    }
  }

  async calendar(label, kind, badge, today) {
    const loading = this.screen(badge.name);
    this.text(loading, "p", "Checking current badge status…");
    this.button(loading, "Back", () => this.badges(label, kind));
    let details;
    try {
      details = await this.connection.callWS({type: DOMAIN + "/details", kind, user_id: badge.id});
    } catch (error) {
      this.text(loading, "p", error?.message || "Could not check badge status.");
      return;
    }
    if (!loading.isConnected) return;
    const active = details.status === "ACTIVE";
    const main = this.screen(badge.name);
    if (details.pending) {
      this.text(main, "p", "Deactivation pending.");
    } else if (active) {
      this.text(main, "p", details.last_day
        ? "Active through " + details.last_day + "."
        : "Active in UniFi · No expiration set by Home Assistant.");
    }
    const month = this.text(main, "div", "");
    month.className = "month";
    const prev = this.button(month, "‹", () => move(-1));
    prev.setAttribute("aria-label", "Previous month");
    const heading = this.text(month, "strong", "");
    const next = this.button(month, "›", () => move(1));
    next.setAttribute("aria-label", "Next month");
    const grid = this.text(main, "div", "");
    grid.className = "days";
    const field = this.text(main, "label", "Last valid day");
    const input = document.createElement("input");
    input.type = "date";
    input.min = today;
    input.value = details.last_day && details.last_day >= today ? details.last_day : today;
    input.required = true;
    field.append(input);
    const status = this.text(main, "p", "");
    status.setAttribute("role", "status");
    const actions = this.text(main, "footer", "");
    const back = this.button(actions, "Back", () => this.badges(label, kind));
    const activate = this.button(actions, active ? "Update expiration" : "Activate", async () => {
      if (!input.reportValidity()) return;
      activate.disabled = back.disabled = input.disabled = true;
      if (deactivate) deactivate.disabled = true;
      month.inert = grid.inert = true;
      status.textContent = active ? "Updating expiration…" : "Activating badge…";
      try {
        const result = await this.connection.callWS({
          type: DOMAIN + "/activate", kind, user_id: badge.id, last_day: input.value,
          update_expiration: active,
        });
        const done = this.screen(result.name + (active ? " expiration updated" : " activated"));
        this.text(done, "p", "Valid through " + input.value + ".");
        this.button(done, "Done", () => this.home()).focus();
        setTimeout(() => { if (done.isConnected) this.home(); }, 8000);
      } catch (error) {
        status.textContent = error?.message || "Activation could not be confirmed.";
      } finally {
        activate.disabled = back.disabled = input.disabled = false;
        if (deactivate) deactivate.disabled = false;
        month.inert = grid.inert = false;
      }
    });

    activate.disabled = details.pending || !["ACTIVE", "DEACTIVATED"].includes(details.status);
    const deactivate = active && !details.pending ? this.button(actions, "Deactivate now", async () => {
      if (!window.confirm("Deactivate " + badge.name + " now?")) return;
      activate.disabled = deactivate.disabled = back.disabled = input.disabled = true;
      month.inert = grid.inert = true;
      status.textContent = "Deactivating badge…";
      try {
        const result = await this.connection.callWS({
          type: DOMAIN + "/deactivate", kind, user_id: badge.id,
        });
        const done = this.screen(result.name + (result.pending ? " deactivation pending" : " deactivated"));
        this.button(done, "Done", () => this.home()).focus();
      } catch (error) {
        status.textContent = error?.message || "Deactivation could not be confirmed.";
        activate.disabled = deactivate.disabled = back.disabled = input.disabled = false;
        month.inert = grid.inert = false;
      }
    }) : null;

    let shown = new Date(input.value.slice(0, 7) + "-01T12:00:00");
    function move(offset) {
      shown.setMonth(shown.getMonth() + offset);
      draw();
    }
    const draw = () => {
      heading.textContent = shown.toLocaleDateString(undefined, {month:"long", year:"numeric"});
      prev.disabled = shown.getFullYear() * 12 + shown.getMonth() <=
        Number(today.slice(0,4)) * 12 + Number(today.slice(5,7)) - 1;
      grid.replaceChildren();
      for (const name of ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]) this.text(grid, "span", name);
      for (let i = 0; i < shown.getDay(); i++) this.text(grid, "span", "");
      const year = shown.getFullYear(), monthNumber = shown.getMonth() + 1;
      const days = new Date(year, monthNumber, 0).getDate();
      for (let day = 1; day <= days; day++) {
        const iso = [year, String(monthNumber).padStart(2,"0"), String(day).padStart(2,"0")].join("-");
        const button = this.button(grid, String(day), () => { input.value = iso; draw(); });
        button.disabled = iso < today;
        button.setAttribute("aria-pressed", String(iso === input.value));
        button.setAttribute("aria-label", iso);
      }
    };
    input.onchange = () => {
      if (input.validity.valid) shown = new Date(input.value.slice(0, 7) + "-01T12:00:00");
      draw();
    };
    draw();
  }
}

customElements.define("temporary-unifi-badges-kiosk", BadgeKiosk);
