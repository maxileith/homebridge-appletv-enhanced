# homebridge-appletv-enhanced

[![mit license](https://badgen.net/badge/license/MIT/red)](https://github.com/maxileith/homebridge-appletv-enhanced/blob/master/LICENSE)
[![npm](https://img.shields.io/npm/v/homebridge-appletv-enhanced)](https://www.npmjs.com/package/homebridge-appletv-enhanced)
[![npm](https://badgen.net/npm/dt/homebridge-appletv-enhanced)](https://www.npmjs.com/package/homebridge-appletv-enhanced)
[![donate](https://badgen.net/badge/donate/paypal/91BE09)](https://www.paypal.me/maxileith)

[Homebridge](https://github.com/homebridge/homebridge) plugin that exposes the Apple TV to HomeKit with much richer features than the vanilla Apple TV integration of HomeKit.

This plugin automatically discovers Apple TV devices in the local network and exposes each one as a HomeKit Set-Top Box.

## Features

-   Automatically discover Apple TVs in your local network.
-   Pairing process without the need to access the command line like with other plugins.
-   Change the current App by selecting an input in HomeKit.
    -   The plugin is developed in a way that makes it possible to renamed, hide or show inputs in HomeKit natively ... and safes it.
-   For each media type (music, video, tv and unknown) the plugin will create a motion sensor (media types can be hidden or shown by changing the configuration).
-   For each device state (idle, playing, loading, seeking, paused, stopped) the plugin will create a motion sensor (device states can be hidden or shown by changing the configuration).
-   If you do not want all Apple TVs to be exposed, it is possible to blacklist them by providing the MAC-Address.

## Screenshots

<img src="https://raw.githubusercontent.com/maxileith/homebridge-appletv-enhanced/main/docs/img/inputs.png" width=280/> <img src="https://raw.githubusercontent.com/maxileith/homebridge-appletv-enhanced/main/docs/img/sensors.png" width=280/>

## Important information from behind the scenes

## Configuration

This easiest way to use this plugin is to use [homebridge-config-ui-x](https://www.npmjs.com/package/homebridge-config-ui-x).  
To configure manually, add the following to the `platforms` section of Homebridge's `config.json` after installing the plugin.

**Config:**

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
    "blacklist": ["AA:BB:CC:DD:EE:FF"]
}
```

## Known Issues

-   After adding an Apple TV device to the Home app, the same input appears many times, e.g. YouTube, instead of the different apps you have installed. This is most likely a HomeKit issue since you can see in the settings of the Set-Top Box device in HomeKit, that the inputs (Apps) are listed correctly. Wait some time or restart the plugin, that seems to work most of the time. Once the correct inputs are displayed in the Home App, they will stay right.
