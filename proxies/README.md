# ARTIK Cloud Proxy Plugins

You can extend the Proxy Hub by adding a new proxy plugin.

Read the [instructions](https://developer.artik.cloud/documentation/proxy-hub.html#develop-a-new-proxy-plugin) in the developer documentation to learn how. 

## What is a proxy plugin?

The Proxy Hub can host multiple proxy plugins. A proxy plugin does the following for local device types:

* Maps local physical devices to existing virtual devices on ARTIK cloud services or new virtual devices that it creates on ARTIK cloud services.
* Sends local device data to ARTIK cloud services.
* Relays Actions from ARTIK cloud services to local devices.

A plugin communicates with local devices via a device-specific hub (e.g. Philips Hue hub), intermediate software, manufacturer SDK, connectivity protocols (e.g. Zigbee, Z-Wave), or external APIs.
