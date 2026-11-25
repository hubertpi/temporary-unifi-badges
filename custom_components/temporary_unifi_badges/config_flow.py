"""Set up Temporary UniFi Badges from the Home Assistant UI."""
import voluptuous as vol

from homeassistant import config_entries

from . import DOMAIN


class BadgeConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Reuse an existing UniFi Access installation."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="already_configured")

        entries = [
            entry for entry in self.hass.config_entries.async_entries("unifi_access")
            if entry.disabled_by is None
        ]
        if len(entries) != 1:
            return self.async_abort(reason="missing_unifi_access")

        settings = {**entries[0].data, **entries[0].options}
        if not settings.get("host") or not settings.get("api_token"):
            return self.async_abort(reason="missing_unifi_access")
        if user_input is not None:
            return self.async_create_entry(
                title="Temporary UniFi Badges",
                data={"reuse_unifi_access": True},
            )
        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))
