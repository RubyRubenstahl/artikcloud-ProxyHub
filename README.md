# ARTIK Cloud Proxy Hub

ARTIK Cloud Proxy Hub application is a hub that can link to ARTIK Cloud multiple devices present in your area.

You can use Proxy Hub code in three ways:

1. Use the proxy hub out of box. Follow the [Demo](#demo) section to add and play with devices existing in your local area. Directory '/proxies' lists the supported devices such as Philips Hue, Wemo, Zway et al.
2. Extend this proxy hub by adding a new proxy. A new proxy can talk to new devices.
3. Use the code as an example to create your own proxy package that can be distributed to your end users. This way, the end user does not need to perform the steps as the developer in order to use the hub.

## Requirements

- [node](https://nodejs.org/en/download/)  (Version >= 6.5.0????) <<@TODO
- [npm](https://www.npmjs.com/get-npm) (Version >= 3.10.0????)

## Setup / Installation

 1. Clone this repository if you haven't already done so.

 2. At the root directory and run the command:
    ~~~shell
    npm install
    ~~~

Note it might take up to 1h on a slow computer to finish installation.

## Demo

 1. On a machine with the fix IP address, Run "npm start". 
 2. After the server is started, you will see this line:
"GO TO THIS WEBPAGE TO ACCESS THE UI: <url>"
 2. Open a browser and load the above url.
 3. The UI will guide you to set up you proxy hub. At the end of this setup process, you have [created an application](https://developer.artik.cloud/documentation/tools/web-tools.html#creating-an-application) in Developer Dashboard and used the application info to configure the hub. 
 4. Now you can play with the hub. Click "Add Another Device". Then you are prompt to select which type of devices to add. Depending on devices, there are two workflows of adding them. If a device (e.g. Philips Hue) is discoverable, the hub will search your nearby and notify you if any of such device is found. If found, you can add; Otherwise you cannot. If a device is not discoverable, you must added it manually. For example, "Shell Proxy" and "TTS Player" are not discoverable.
 ![Add Devices](./img/screen2.png)
 4. Lets play with TTS Player in the rest of demo. Click "+" on "TTS Player" and then click "ADD TO ARTIK Cloud". You should see you have a TTS player in the hub.
  ![Add Devices](./img/screen4_TTSplayer.png)
 5. Go to My ARTIK Cloud. You should see an TTS player has been added to your account.
 6. Click that device at My ARTIK Cloud to send an action. e.g. Play "How are you!".
  ![Add Devices](./img/screen5_sendAction.png)
 7. You should hear "How are you" from your computer running hub.
 8. Once you have added a proxy to your devices, you can log off the hub in the browswer. However, keep the proxy hub running. The devices will continue communicate with ARTIK Cloud even if you have logged out. 
 
## Restart the server
@TODO- If you stop the server you can restart it using "npm start"

## Add a new proxy to ARTIK Cloud Proxy Hub
@TODO
To add a new proxy add his folder to the `/proxies` folder.
Proxies with a folder starting with '_' are not loaded.
_template folder contains an example of what you need to do to create a proxy

## More about ARTIK Cloud

If you are not familiar with ARTIK Cloud, we have extensive documentation at https://developer.artik.cloud/documentation

The full ARTIK Cloud API specification can be found at https://developer.artik.cloud/documentation/api-spec

Check out sample applications at https://developer.artik.cloud/documentation/tutorials/

To create and manage your services and devices on ARTIK Cloud, create an account at https://developer.artik.cloud

Also see the ARTIK Cloud blog for tutorials, updates, and more: http://artik.io/blog/cloud

## License and Copyright

Licensed under the Apache License. See [LICENSE](LICENSE).

Copyright (c) 2017 Samsung Electronics Co., Ltd.

