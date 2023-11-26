# homebridge-appletv-enhanced

[![mit license](https://badgen.net/badge/license/MIT/red)](https://github.com/maxileith/homebridge-appletv-enhanced/blob/master/LICENSE)
[![npm](https://img.shields.io/npm/v/homebridge-appletv-enhanced)](https://www.npmjs.com/package/homebridge-appletv-enhanced)
[![npm](https://badgen.net/npm/dt/homebridge-appletv-enhanced)](https://www.npmjs.com/package/homebridge-appletv-enhanced)
[![donate](https://badgen.net/badge/donate/paypal/91BE09)](https://www.paypal.me/maxileith/EUR)
[![PyPI pyversions](https://img.shields.io/badge/Python-3.8%20%7C%203.9%20%7C%203.10%20%7C%203.11-blue)](https://pypi.python.org/pypi/pyatv/)

[Homebridge](https://github.com/homebridge/homebridge) plugin that exposes the Apple TV to HomeKit with much richer features than the vanilla Apple TV integration of HomeKit.

This plugin automatically discovers Apple TV devices in the local network and exposes each one as a HomeKit Set-Top Box.

## Features

-   Automatically discover Apple TVs in your local network.
-   Pairing process without the need to access the command line like with other plugins.
-   Change the current App by selecting an input in HomeKit.
    -   The plugin is developed in a way that makes it possible to rename, hide or show inputs in HomeKit natively ... and safes it.
    -   You can even define own inputs based on URIs in the configuration. For instance, you can create an input to open a certain Disney+ movie or show ... or pretty much anything you can think of. Take a look at the example `config.json` ;).
-   The automation triggers that you are probably here for ...
    -   Since every Apple TV is exposed as a Set-Top Box, you can create a trigger on the power state to execute automations when turning on or off.
    -   For each media type (music, video, tv and unknown) the plugin will create a motion sensor (media types can be hidden or shown by changing the configuration).
    -   For each device state (idle, playing, loading, seeking, paused, stopped) the plugin will create a motion sensor (device states can be hidden or shown by changing the configuration).
-   A fully functional and super fast remote in the remote app of your iPhone or iPad.
    -   Remote keys can also be exposed as switches.
-   If you do not want all Apple TVs to be exposed, it is possible to blacklist them by providing the MAC-Address.
-   "Avada Kedavra" which is exposed as an input to close all apps.

## Requirements

-   Only Linux will be supported by the maintainer (although since MacOS / UNIX is similar to Linux, it should run on MacOS just fine)
-   Most recent Version of Node 20 LTS or 18 LTS
-   Python 3.8, 3.9, 3.10 or 3.11
-   Python virtual environment module `virtualenv`. (the plugin will create a virtual environment on startup and will install python dependencies in this virtual environment)
    -   On homebridge **apt-package versions >=1.20.2** the python module is installed automatically as a dependency
    -   On homebridge **apt-package versions <1.20.2** the python module `virtualenv` has to be installed manually. This won't be handled by the plugin itself.
        -   On debian-based distros: `sudo apt install python3-venv`
        -   Installation on other distros may vary
-   Apple TV Models with tvOS 15 and upwards are supported (all 4K ones and the latest HD one)
-   The access of Speakers & TVs should be either set to "Everybody" or "Anybody On the Same Network" in the Home app
-   Raspberry Pi 1, 2, 3 and Zero 1, 2 are not recommended for performance reasons. Recommended are 3B+, 4B, 5B.
-   The homebridge instance and Apple TVs need to be on the same subnet.

## Pairing

1.  Install the plugin.
2.  (optional) Enable the plugin to run as a child bridge. The benefit here is that the plugin is more isolated from other plugins, e.g. in case of a plugin crash, only the plugin will crash and not the whole homebridge.
3.  Restart the homebridge.
4.  (optional) If the plugin is running as a child bridge, the child bridge will now be exposed. You can add it to your Home App if you want to. However, there is no real benefit to it since this bridge will not expose any devices (Apple TVs will be exposed as their own bridges).
5.  The plugin will start the discovery of Apple TVs in your local network.
6.  For every discovered Apple TV you have to do the following steps:
    1. In the logs there will be a message thats says `You need to pair your Apple TV before the plugin can connect to it. Enter the PIN that is currently displayed on the device here: http://192.168.0.12:42015/` where the link http://192.168.0.12:42015 is different in your log and distinct for one Apple TV if you are connecting multiple.
    2. Open the link. A pairing page will open (see first image below).
    3. In the meantime there should already be a pairing code displayed on your Apple TV. Enter the 4-digit code into the pairing page.
    4. If the pairing page says that transmitting thr PIN was successful (see second image below), pairing was probably successful (Logs: `Paring was successful. Add it to your home in the Home app: com.apple.home://launch`). To be sure, take a look into the logs, you may have entered the PIN wrong too often or let the pairing request time out too many times (Logs: `Too many attempts. Waiting for x seconds before retrying.`). If you are requested to enter a PIN again (see first image below) you have most probably entered the wrong PIN ... the plugin will attempt a new pairing attempt. Enter the new PIN displayed on the Apple TV again.
    5. Done ... do this with all your Apple TVs.
7.  You have paired all Apple TVs (with the plugin, not with Apple Home yet).
8.  Every Apple TV is exposed as a Set-Top Box and is its own bridge. Therefore, we need to add every Apple TV seperatly to Apple Home. In order to do that, open the Home app, go to add devices > more options, then type in the pairing code from the logs (Logs: `Please add [Apple TV Wohnzimmer (2)] manually in
Home app. Setup Code: xxxx-xxxx` this is not the code that you have seen on the Apple TV display).

<img src="https://raw.githubusercontent.com/maxileith/homebridge-appletv-enhanced/main/docs/img/enterPIN.jpg" width=280/> <img src="https://raw.githubusercontent.com/maxileith/homebridge-appletv-enhanced/main/docs/img/pinTransmitted.jpg" width=280/>

## Screenshots

The screenshots speak for themselves ...

<img src="https://raw.githubusercontent.com/maxileith/homebridge-appletv-enhanced/main/docs/img/inputs.png" width=280/> <img src="https://raw.githubusercontent.com/maxileith/homebridge-appletv-enhanced/main/docs/img/sensors.png" width=280/>

## Avada Kedavra

<img src="https://raw.githubusercontent.com/maxileith/homebridge-appletv-enhanced/main/docs/img/avada-kedavra.gif" width=400/>

## Configuration

The easiest way to use this plugin is to use [homebridge-config-ui-x](https://www.npmjs.com/package/homebridge-config-ui-x).  
To configure manually, add the following to the `platforms` section of Homebridge's `config.json` after installing the plugin.

**`config.json`**

```json
{
    "name": "Apple TV Enhanced",
    "platform": "AppleTVEnhanced",
    "mediaTypes": ["music", "video", "tv", "unknown"],
    "deviceStates": [
        "idle",
        "playing",
        "loading",
        "seeking",
        "paused",
        "stopped"
    ],
    "remoteKeysAsSwitch": [
        "channel_down",
        "channel_up",
        "down",
        "home",
        "home_hold",
        "left",
        "menu",
        "next",
        "pause",
        "play",
        "play_pause",
        "previous",
        "right",
        "select",
        "skip_backward",
        "skip_forward",
        "stop",
        "turn_off",
        "turn_on",
        "top_menu",
        "up"
    ],
    "customInputURIs": [
        "https://www.disneyplus.com/movies/rogue-one-a-star-wars-story/14CV6eSbygOA",
        "https://www.netflix.com/watch/81260280",
        "https://tv.apple.com/show/silo/umc.cmc.3yksgc857px0k0rqe5zd4jice",
        "vlc://https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8"
    ],
    "avadaKedavraAppAmount": 15,
    "discover": {
        "multicast": true,
        "unicast": ["192.168.0.15"],
        "blacklist": ["AA:BB:CC:DD:EE:FF", "192.168.0.42"]
    },
    "forceVenvRecreate": false,
    "logLevel": 3
}
```

## Known Issues

-   Apple TVs report a MAC-Address that is different from the MAC-Address that you will see in the network settings of your Apple TV when scanning for devices. Therefore, when blacklisting Apple TVs use the MAC-Address from the logs.
-   If using external speakers like HomePods as the default, the Apple TV is always reported as powered on. This is a known issue of the dependency [pyatv](https://pyatv.dev), see [postlund/pyatv#1667](https://github.com/postlund/pyatv/issues/1667). As a result, the Apple TV device will only be shown as off in HomeKit when powered off via the Apple TV device in HomeKit. After restarting the plugin the device will always be shown as on.
-   See also [open bugs](https://github.com/maxileith/homebridge-appletv-enhanced/issues?q=is%3Aissue+is%3Aopen+label%3Abug).

## Versioning

**1.2.3-4**

1.  **Major:** Introduces major and possibly breaking changes.
2.  **Minor:** Introduces new features without breaking changes.
3.  **Patch:** Bugfixes.
4.  **Prerelease:** Prereleases of upcoming major, minor or patch versions. These versions are likely to have bugs. NPM packages of this kind are tagged as _beta_.
