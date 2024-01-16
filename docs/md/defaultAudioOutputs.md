# Default audio devices

Advantages:

-   You can select AirPlay devices as default audio devices and let the Apple TV play the audio at the same time, unlike with the Apple TVs stock abilities.
-   You can select any AirPlay 2 device instead of only HomePods, unlike with the Apple TVs stock abilities.

## Setup

**Assumptions:**

-   The MAC address of your Apple TV is **AA:BB:CC:DD:EE:FF** (you can get it from the logs)

**Steps:**

1.  Connect to all audio outputs that should be the default on your Apple TV.

    <img src="https://raw.githubusercontent.com/maxileith/homebridge-appletv-enhanced/develop/docs/img/selectAudioOutputsAppleTV.jpg" width=280/>

2.  Execute `` ./appletv-enhanced/.venv/bin/atvremote --id AA:BB:CC:DD:EE:FF --airplay-credentials `cat ./appletv-enhanced/AABBCCDDEEFF/credentials.txt` output_devices `` in your homebridge storage directory, e.g. `/var/lib/homebridge`. You can get the path of the homebridge storage directory from the "System Information" tile on your Homebridge dashboard.
    -   The output looks like the following:
        ```logs
        Device: Wohnzimmer (AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE), Device: Schlafzimmer (11111111-2222-3333-4444-555555555555), Device: Badezimmer (00:11:22:33:44:55)
        ```
3.  Look at the output of Step #2 and extract the IDs: `AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE`, `11111111-2222-3333-4444-555555555555` and `00:11:22:33:44:55`
4.  Then add these IDs to the default audio outputs settings in the basic settings. If you do have multiple Apple TVs, it is recommended to use a [device specific settings override](https://github.com/maxileith/homebridge-appletv-enhanced/blob/develop/docs/md/deviceSpecificOverrides.md).

    <img src="https://raw.githubusercontent.com/maxileith/homebridge-appletv-enhanced/develop/docs/img/defaultAudioOutputsSettings.png" width=460/>

5.  Restart the plugin.
