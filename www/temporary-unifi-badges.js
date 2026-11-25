const domain = "temporary_unifi_badges";

window.addEventListener("ll-custom", async (event) => {
  const kind = event.detail?.temporary_unifi_badges;
  if (!["contractor", "visitor"].includes(kind)) return;
  if (document.querySelector("dialog[data-temporary-badges]")) return;
  const hass = document.querySelector("home-assistant")?.hass;
  const dialog = document.createElement("dialog");
  dialog.dataset.temporaryBadges = "";
  dialog.setAttribute("aria-labelledby", "temporary-badges-title");
  dialog.innerHTML = `
    <style>
      dialog[data-temporary-badges] { width: min(27rem, calc(100% - 3rem)); box-sizing:border-box;
        border:0; border-radius:16px; padding:24px; color:var(--primary-text-color);
        background:var(--card-background-color, white); font:inherit; }
      dialog[data-temporary-badges]::backdrop { background:#0008; }
      dialog[data-temporary-badges] label { display:grid; gap:8px; }
      dialog[data-temporary-badges] :is(input,select,button) { font:inherit; padding:8px; }
      dialog[data-temporary-badges] footer { display:flex; gap:8px; justify-content:flex-end; margin-top:20px; }
    </style>
    <h2 id="temporary-badges-title"></h2>
    <form>
      <div id="badge-fields"></div>
      <p role="status" aria-live="polite"></p>
      <footer><button type="button" id="close">Cancel</button>
      <button type="button" id="back" hidden>Back</button>
      <button type="submit" hidden>Next</button></footer>
    </form>`;
  document.body.append(dialog);
  const title = dialog.querySelector("h2");
  title.textContent = `Activate ${kind === "contractor" ? "Contractor" : "Visitor"} Badge`;
  const form = dialog.querySelector("form");
  const fields = dialog.querySelector("#badge-fields");
  const message = dialog.querySelector("[role=status]");
  const close = dialog.querySelector("#close");
  const back = dialog.querySelector("#back");
  const submit = dialog.querySelector("[type=submit]");
  let busy = false;
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("cancel", (e) => { if (busy) e.preventDefault(); });
  close.onclick = () => dialog.close();
  dialog.showModal();

  message.textContent = "Loading badges from UniFi…";
  try {
    const {badges, today} = await hass.callWS({type: domain + "/list", kind});
    if (!dialog.open) return;
    if (!badges.length) {
      message.textContent = "No matching badges found in UniFi.";
      return;
    }
    const select = document.createElement("select");
    select.required = true;
    select.add(new Option("Select a badge", ""));
    for (const badge of badges) select.add(new Option(badge.name, badge.id));
    const day = document.createElement("input");
    day.type = "date";
    day.required = true;
    day.min = today;
    day.value = today;

    function field(caption, input) {
      const label = document.createElement("label");
      label.append(caption, input);
      fields.replaceChildren(label);
      input.focus();
    }

    function chooseBadge() {
      field("Badge", select);
      back.hidden = true;
      submit.textContent = "Next";
      submit.hidden = false;
      message.textContent = "";
    }

    back.onclick = chooseBadge;
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      if (fields.contains(select)) {
        field("Last valid day", day);
        message.textContent = select.selectedOptions[0].text + " · Access follows its UniFi schedule.";
        back.hidden = false;
        submit.textContent = "Activate";
        return;
      }
      busy = true;
      close.disabled = back.disabled = submit.disabled = day.disabled = true;
      message.textContent = "Activating badge…";
      try {
        const result = await hass.callWS({
          type: domain + "/activate", kind, user_id: select.value, last_day: day.value,
        });
        fields.replaceChildren();
        message.textContent = `${result.name} activated through ${day.value}.`;
        submit.hidden = back.hidden = true;
        close.textContent = "Done";
      } catch (err) {
        message.textContent = err?.message || "Activation could not be confirmed.";
      } finally {
        busy = false;
        close.disabled = back.disabled = submit.disabled = day.disabled = false;
        if (submit.hidden) close.focus();
      }
    };
    chooseBadge();
  } catch (err) {
    message.textContent = err?.message || "Could not load UniFi badges.";
  }
});
