# Temporary UniFi Badges pilot

This standalone Home Assistant integration can run alongside badge printing. It uses regular UniFi users named Contractor 1, Contractor #1, Visitor 1, and so on. For the pilot, prepare a spare user with its card and recurring access policy, then deactivate it in UniFi. Use a Home Assistant administrator account to issue badges.

1. In Home Assistant, open Settings > Marketplace, choose Add from link, and enter the GitHub repository URL. Open Temporary UniFi Badges and install it. For a manual install, copy the repository's custom_components folder into the Home Assistant configuration directory.
2. Add this to configuration.yaml. Use the local UniFi Access API origin, typically HTTPS on port 12445.

   ```yaml
   temporary_unifi_badges:
     url: https://unifi.example.local:12445
     token: !secret temporary_unifi_badges_token
   ```

   Add temporary_unifi_badges_token to secrets.yaml using an Access API token with User & Group edit permission. Certificate verification defaults to on. For a pilot with a self-signed controller certificate you can set verify_ssl: false under temporary_unifi_badges on a trusted connection.
3. Restart Home Assistant. Under Settings > Dashboards > Resources, add /temporary_unifi_badges/dialog.js as a JavaScript module. If Resources is hidden, enable Advanced Mode in your profile.
4. Paste dashboard.yaml into a manual card in the dashboard, then reload the dashboard.

Check the popup finds the spare badge and defaults to the current day in Home Assistant's timezone. Confirm that the badge opens only the intended doors during its normal schedule. To test expiration, issue it shortly before local midnight and check its UniFi status and a physical reader shortly after midnight. Repeat across a Home Assistant restart. If Home Assistant is stopped at midnight, check that it deactivates the badge after startup. To end a pilot early, deactivate the spare user in UniFi.

The integration saves the deadline before activation. It checks for overdue deadlines at startup and every 15 seconds, verifies the controller's status after each write, and retries failed revocations with a persistent notification. A failed or interrupted activation is also queued for revocation. Each badge requires an inactive UniFi user and no outstanding managed activation. The final date is inclusive. The cutoff is midnight at the start of the following day in Home Assistant's timezone.

The controller must accept status writes on its regular-user API. Test this version with a spare badge before wider use. A controller acknowledgment does not prove every door hub has received the update. If HA, the controller, or a door hub is offline, the badge can remain usable until the revocation reaches the hub. Before removing the integration or changing its controller, manually deactivate currently issued badges.
