# ARTIK Cloud Proxy Hub

Using the Proxy Hub, you can connect devices that cannot directly communicate to ARTIK cloud services. See [this documentation article](https://developer.artik.cloud/documentation/proxy-hub.html) to learn the details.

You can use the Proxy Hub repository in three ways:

1. Use the Proxy Hub out of the box. After setting up, follow the [Demo](#demo) section to add and play with your nearby devices. The `/proxies` directory includes supported devices, listed below. 
2. Extend this Proxy Hub by developing a [new proxy plugin](#develop-a-new-proxy-plugin). The hub can then communicate to more types of devices (not limited to the devices listed in `/proxies`).
3. Use the code as an example to create your own proxy plugins that can be distributed to your end users. 

**We will add new proxy plugins to this repository. Please check back from time to time.**

## Prerequisites & installation

See [this documentation article](https://developer.artik.cloud/documentation/proxy-hub.html#use-the-hub) for setup instructions.

## Demo

There are two types of devices: **discoverable** and **on demand**. A physical device (e.g. Philips Hue) should be discoverable. A device which is a piece of software running on a local machine (e.g. <a href=“https://github.com/artikcloud/artikcloud-ProxyHub/tree/master/proxies/shell”>Shell Proxy</a> and <a href=“https://github.com/artikcloud/artikcloud-ProxyHub/tree/master/proxies/ttsplayer”>TTS Player</a>) is added manually.

The following physical devices are discoverable by the Proxy Hub:

* Philips Hue
* Nest
* Belkin WeMo
* Z-Way

The following devices are available on demand:

* Media Player
* Shell
* TTS Player

In this demo, we will use the TTS Player. 

 1. After [setting up](#installation) the Proxy Hub, click “+” on “TTS Player” and then click “ADD TO ARTIK cloud services”. You will see a TTS Player listed as a local device.
  ![Add Devices](./img/screen4_TTSplayer.png)
 
 2. Go to [My ARTIK Cloud](https://my.artik.cloud). You should see that a virtual TTS Player device has been added to your ARTIK cloud services account.
 
 3. Click on this device at My ARTIK Cloud to send an Action. Try playing “How are you!”.
  ![Add Devices](./img/screen5_sendAction.png)
 
 4. You should hear “How are you” sound on your computer running the hub. The sound is played by the device running on your computer. The Proxy Hub enables the local device to act on Actions sent by ARTIK cloud services.
 
 5. If needed, add more devices to ARTIK cloud services using the hub.
 
 6. Once you have added proxy plugins for your physical devices, you can log off from the hub in your browser. **You must keep the server running**. The devices will continue to communicate with ARTIK cloud services via their plugins on the hub. 
 
## Develop a new proxy plugin

Refer to the instructions [in the documentation article](https://developer.artik.cloud/documentation/proxy-hub.html#develop-a-new-proxy-plugin) to learn more.

## More about ARTIK Cloud

If you are not familiar with ARTIK Cloud, we have extensive documentation at https://developer.artik.cloud/documentation

The full ARTIK Cloud API specification can be found at https://developer.artik.cloud/documentation/api-reference/

Check out sample applications at https://developer.artik.cloud/documentation/tutorials/

To create and manage your services and devices on ARTIK Cloud, create an account at https://developer.artik.cloud

Also see the ARTIK Cloud blog for tutorials, updates, and more: http://artik.io/blog/cloud

## License and Copyright

Licensed under the Apache License. See [LICENSE](LICENSE).

Copyright (c) 2017 Samsung Electronics Co., Ltd.
