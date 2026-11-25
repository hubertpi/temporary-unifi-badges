"""Set up Temporary UniFi Badges from the Home Assistant UI."""
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback


def settings_schema(options):
    return vol.Schema({
        vol.Optional("reader", description={"suggested_value": options.get("reader", "")}): str,
        vol.Required("test_mode", default=options.get("test_mode", True)): bool,
    })

from . import DOMAIN


class BadgeConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Reuse an existing UniFi Access installation."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return BadgeOptionsFlow()

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
                options=user_input,
            )
        return self.async_show_form(step_id="user", data_schema=settings_schema({}))


class BadgeOptionsFlow(config_entries.OptionsFlow):
    """Configure the kiosk reader and test behavior."""

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        return self.async_show_form(
            step_id="init", data_schema=settings_schema(self.config_entry.options)
        )
