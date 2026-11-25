"""Temporary access for reusable UniFi badges."""

import asyncio
from datetime import date, datetime, time, timedelta, timezone
import logging
import re
from urllib.parse import quote

import aiohttp
import voluptuous as vol
from homeassistant.components import persistent_notification, websocket_api
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt

DOMAIN = "temporary_unifi_badges"
LOGGER = logging.getLogger(__name__)
KIND = vol.In(["contractor", "visitor"])
NAME = re.compile(r"(contractor|visitor)\s+#?([1-9][0-9]*)", re.I)


class ControllerError(Exception):
    """The controller could not confirm the operation."""


def badge_name(user):
    name = " ".join(user.get(key) or "" for key in ("first_name", "last_name"))
    return NAME.fullmatch(name.strip())


async def async_setup(hass, config):
    """Initialize the badge manager and recover persisted deadlines."""
    if DOMAIN not in config:
        return True
    settings = vol.Schema({
        vol.Required("url"): vol.All(str, vol.Match(r"^https://[^/]+/?$")),
        vol.Required("token"): vol.All(str, vol.Length(min=1)),
        vol.Optional("verify_ssl", default=True): bool,
    })(config[DOMAIN])
    session = async_get_clientsession(hass, verify_ssl=settings["verify_ssl"])
    store = Store(hass, 1, DOMAIN, atomic_writes=True)
    leases = await store.async_load() or {}
    lock = asyncio.Lock()
    base = settings["url"].rstrip("/") + "/api/v1/developer/users"
    headers = {"Authorization": "Bearer " + settings["token"]}

    async def request(method, suffix="", **kwargs):
        try:
            async with session.request(
                method, base + suffix, headers=headers, allow_redirects=False,
                timeout=aiohttp.ClientTimeout(total=10), **kwargs
            ) as response:
                if response.status != 200:
                    raise ControllerError(f"UniFi returned HTTP {response.status}.")
                body = await response.json()
                if body.get("code") != "SUCCESS":
                    raise ControllerError("UniFi rejected the request.")
                return body
        except (aiohttp.ClientError, TimeoutError, ValueError) as err:
            raise ControllerError("Could not confirm the operation with UniFi.") from err

    async def list_badges(kind):
        matches = {}
        seen = set()
        for page in range(1, 1001):
            body = await request("GET", params={"page_num": page, "page_size": 25})
            users = body["data"]
            for user in users:
                if user["id"] in seen:
                    raise ControllerError("The UniFi user list changed. Reopen the popup.")
                seen.add(user["id"])
                match = badge_name(user)
                if match and match[1].lower() == kind:
                    number = int(match[2])
                    if number in matches:
                        raise ControllerError(f"Duplicate {kind} badge number {number} in UniFi.")
                    matches[number] = {"id": user["id"], "name": f"{kind.title()} {number}"}
            if len(seen) >= body.get("pagination", {}).get("total", len(seen)):
                return [matches[number] for number in sorted(matches)]
            if not users:
                break
        raise ControllerError("Could not read the complete UniFi user list.")

    async def set_status(suffix, status):
        await request("PUT", suffix, json={"status": status})
        if (await request("GET", suffix))["data"].get("status") != status:
            raise ControllerError("UniFi did not confirm the badge status.")

    async def expire(_now=None):
        if lock.locked():
            return
        async with lock:
            for user_id, lease in list(leases.items()):
                if not lease["pending"] and lease["deadline"] > dt.utcnow().timestamp():
                    continue
                notification = f"{DOMAIN}_{user_id}"
                try:
                    await set_status("/" + quote(user_id, safe=""), "DEACTIVATED")
                    updated = dict(leases)
                    del updated[user_id]
                    await store.async_save(updated)
                    del leases[user_id]
                except Exception:
                    LOGGER.exception("Badge revocation pending for %s", lease["name"])
                    persistent_notification.async_create(
                        hass, f"UniFi has not confirmed revocation for {lease['name']}. "
                        "Home Assistant will retry.",
                        title="UniFi badge revocation pending", notification_id=notification,
                    )
                else:
                    persistent_notification.async_dismiss(hass, notification)

    @websocket_api.websocket_command({
        vol.Required("type"): DOMAIN + "/list",
        vol.Required("kind"): KIND,
    })
    @websocket_api.require_admin
    @websocket_api.async_response
    async def ws_list(hass, connection, msg):
        try:
            badges = await list_badges(msg["kind"])
        except ControllerError as err:
            connection.send_error(msg["id"], "unifi_error", str(err))
            return
        connection.send_result(msg["id"], {"badges": badges, "today": dt.now().date().isoformat()})

    @websocket_api.websocket_command({
        vol.Required("type"): DOMAIN + "/activate",
        vol.Required("kind"): KIND,
        vol.Required("user_id"): str,
        vol.Required("last_day"): str,
    })
    @websocket_api.require_admin
    @websocket_api.async_response
    async def ws_activate(hass, connection, msg):
        try:
            last_day = date.fromisoformat(msg["last_day"])
            deadline = datetime.combine(
                last_day + timedelta(days=1), time.min, tzinfo=dt.DEFAULT_TIME_ZONE
            ).astimezone(timezone.utc).timestamp()
        except (ValueError, OverflowError):
            connection.send_error(msg["id"], "invalid_date", "Choose a valid date.")
            return

        user_id = msg["user_id"]
        suffix = "/" + quote(user_id, safe="")
        try:
            async with lock:
                badges = await list_badges(msg["kind"])
                badge = next((item for item in badges if item["id"] == user_id), None)
                if badge is None:
                    raise ControllerError("This badge is no longer in the UniFi badge list.")
                user = (await request("GET", suffix))["data"]
                if user.get("status") != "DEACTIVATED" or user_id in leases:
                    raise ControllerError("This badge must be inactive with no pending revocation.")
                if deadline <= dt.utcnow().timestamp():
                    raise ControllerError("Choose today or a future date.")
                lease = {"name": badge["name"], "deadline": deadline, "pending": True}
                await store.async_save({**leases, user_id: lease})
                leases[user_id] = lease
                await set_status(suffix, "ACTIVE")
                if deadline <= dt.utcnow().timestamp():
                    raise ControllerError("The deadline passed during activation.")
                confirmed = {**lease, "pending": False}
                await store.async_save({**leases, user_id: confirmed})
                leases[user_id] = confirmed
        except ControllerError as err:
            await expire()
            connection.send_error(msg["id"], "unifi_error", str(err))
            return
        except OSError:
            await expire()
            connection.send_error(msg["id"], "storage_error", "Could not save the badge deadline.")
            return
        connection.send_result(msg["id"], {"name": badge["name"]})

    websocket_api.async_register_command(hass, ws_list)
    websocket_api.async_register_command(hass, ws_activate)
    async_track_time_interval(hass, expire, timedelta(seconds=15))
    hass.async_create_task(expire())
    return True
